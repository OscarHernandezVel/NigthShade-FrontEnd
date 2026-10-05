import { MemoryStore } from '../../../shared/auth-service';
import { LibraryService, MemoryBlobStore, type Playlist, type UploadResult } from '../../../shared/library-service';
import type { LibraryData, PlaylistData, PlaylistId, Session, Track, TrackId } from '../../../shared/types';
import { probeDuration, type AuthGateway, type DevMail, type LibraryGateway } from './gateway';

const SESSION_KEY = 'ns.api.session';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

class ApiClient {
  token: string | null = null;

  constructor(readonly baseUrl: string) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      });
    } catch {
      throw new ApiError('Cannot reach the server. Check your connection and try again.', 'NETWORK', 0);
    }
    const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    if (!response.ok) throw new ApiError(data.message ?? `Request failed (${response.status}).`, data.error ?? 'HTTP', response.status);
    return data as T;
  }
}

type AuthReply = { token: string; session: Session };
type MailReply = { devMail?: DevMail };

function readStored(): AuthReply | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as AuthReply | null;
  } catch {
    return null;
  }
}

export class HttpGateway implements AuthGateway {
  readonly mode = 'server' as const;
  private readonly api: ApiClient;

  constructor(baseUrl: string) {
    this.api = new ApiClient(baseUrl);
  }

  async restore(): Promise<Session | null> {
    const stored = readStored();
    if (!stored) return null;
    this.api.token = stored.token;
    try {
      return (await this.api.request<{ session: Session }>('GET', '/api/auth/me')).session;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) this.logout();
      return error instanceof ApiError && error.status === 401 ? null : stored.session;
    }
  }

  private remember(reply: AuthReply): Session {
    this.api.token = reply.token;
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(reply));
    } catch {
      /* session lasts until the tab closes */
    }
    return reply.session;
  }

  async register(name: string, email: string, password: string) {
    return (await this.api.request<MailReply>('POST', '/api/auth/register', { name, email, password })).devMail;
  }
  async resendVerification(email: string) {
    return (await this.api.request<MailReply>('POST', '/api/auth/resend', { email })).devMail;
  }
  async verifyEmail(email: string, code: string) {
    return this.remember(await this.api.request<AuthReply>('POST', '/api/auth/verify', { email, code }));
  }
  async login(email: string, password: string) {
    return this.remember(await this.api.request<AuthReply>('POST', '/api/auth/login', { email, password }));
  }
  async requestPasswordReset(email: string) {
    return (await this.api.request<MailReply>('POST', '/api/auth/forgot', { email })).devMail;
  }
  async resetPassword(email: string, code: string, password: string) {
    await this.api.request('POST', '/api/auth/reset', { email, code, password });
  }

  logout(): void {
    this.api.token = null;
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }

  async openLibrary(session: Session): Promise<LibraryGateway> {
    const library = new RemoteLibrary(this.api, session.userId);
    await library.reload();
    return library;
  }
}

/**
 * Keeps a local mirror (the same LibraryService the server runs) so drag & drop
 * feels instant: each change is applied locally first, then sent to the API in
 * order. If the server rejects it, the mirror reloads from the server.
 */
class RemoteLibrary implements LibraryGateway {
  private readonly mirror: LibraryService;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly streamUrls = new Map<TrackId, { url: string; expires: number }>();

  constructor(
    private readonly api: ApiClient,
    userId: string,
  ) {
    this.mirror = new LibraryService(userId, new MemoryStore(), new MemoryBlobStore());
  }

  get tracks() {
    return this.mirror.tracks;
  }
  get playlists() {
    return this.mirror.playlists;
  }
  get music() {
    return this.mirror.music;
  }
  onChange(listener: () => void) {
    return this.mirror.onChange(listener);
  }
  getPlaylist(id: PlaylistId) {
    return this.mirror.getPlaylist(id);
  }
  getTrack(id: TrackId) {
    return this.mirror.getTrack(id);
  }
  playlistTracks(id: PlaylistId) {
    return this.mirror.playlistTracks(id);
  }
  search(query: string) {
    return this.mirror.search(query);
  }

  async reload(): Promise<void> {
    this.mirror.replaceAll(await this.api.request<LibraryData>('GET', '/api/library'));
  }

  /** Runs API calls one after another so reorders reach the server in order. */
  private send<T>(call: () => Promise<T>): Promise<T> {
    const next = this.chain.then(call).catch(async (error: unknown) => {
      await this.reload().catch(() => undefined);
      throw error;
    });
    this.chain = next.catch(() => undefined);
    return next;
  }

  async addFiles(files: File[], alsoAddTo?: PlaylistId): Promise<UploadResult> {
    const form = new FormData();
    files.forEach((file) => form.append('files', file, file.name));
    if (alsoAddTo) form.append('alsoAddTo', alsoAddTo);
    const result = await this.send(() => this.api.request<UploadResult>('POST', '/api/tracks/upload', form));
    result.added.forEach((track) => this.mirror.importTrack(track, alsoAddTo));
    // The server stores bytes only; the browser reads each file's duration and reports it.
    const accepted = files.filter((file) => result.added.some((t) => t.source.kind === 'file' && t.source.fileName === file.name));
    void Promise.all(
      accepted.map(async (file) => {
        const track = result.added.find((t) => t.source.kind === 'file' && t.source.fileName === file.name);
        if (track) this.setDuration(track.id, await probeDuration(file));
      }),
    );
    return result;
  }

  async addRemote(url: string, meta: { title?: string; artist?: string }, alsoAddTo?: PlaylistId): Promise<Track> {
    const { track } = await this.send(() => this.api.request<{ track: Track }>('POST', '/api/tracks/remote', { url, ...meta, alsoAddTo }));
    this.mirror.importTrack(track, alsoAddTo);
    return track;
  }

  async createPlaylist(name: string): Promise<Playlist> {
    const data = await this.send(() => this.api.request<PlaylistData>('POST', '/api/playlists', { name }));
    await this.reload();
    return this.mirror.getPlaylist(data.id);
  }

  async renamePlaylist(id: PlaylistId, name: string) {
    this.mirror.renamePlaylist(id, name);
    await this.send(() => this.api.request('PATCH', `/api/playlists/${id}`, { name }));
  }

  async deletePlaylist(id: PlaylistId) {
    this.mirror.deletePlaylist(id);
    await this.send(() => this.api.request('DELETE', `/api/playlists/${id}`));
  }

  async addToPlaylist(playlistId: PlaylistId, trackId: TrackId) {
    const added = this.mirror.addToPlaylist(playlistId, trackId);
    if (added) await this.send(() => this.api.request('POST', `/api/playlists/${playlistId}/tracks`, { trackId }));
    return added;
  }

  async removeFromPlaylist(playlistId: PlaylistId, index: number) {
    await this.mirror.removeFromPlaylist(playlistId, index);
    await this.send(() => this.api.request('DELETE', `/api/playlists/${playlistId}/tracks/${index}`));
  }

  async moveInPlaylist(playlistId: PlaylistId, from: number, to: number) {
    this.mirror.moveInPlaylist(playlistId, from, to);
    await this.send(() => this.api.request('POST', `/api/playlists/${playlistId}/move`, { from, to }));
  }

  setDuration(id: TrackId, durationSec: number) {
    const before = this.mirror.getTrack(id)?.durationSec;
    this.mirror.setDuration(id, durationSec);
    if (this.mirror.getTrack(id)?.durationSec !== before) {
      void this.send(() => this.api.request('PATCH', `/api/tracks/${id}`, { durationSec })).catch(() => undefined);
    }
  }

  async resolveSource(track: Track): Promise<string> {
    if (track.source.kind === 'url') return track.source.url;
    const cached = this.streamUrls.get(track.id);
    if (cached && cached.expires > Date.now()) return cached.url;
    const { url } = await this.api.request<{ url: string }>('GET', `/api/tracks/${track.id}/stream-url`);
    this.streamUrls.set(track.id, { url, expires: Date.now() + 5 * 60 * 60 * 1000 });
    return url;
  }
}

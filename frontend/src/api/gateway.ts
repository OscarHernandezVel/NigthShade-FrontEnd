import type { Playlist, UploadResult } from '../../../shared/library-service';
import type { PlaylistId, Session, Track, TrackId } from '../../../shared/types';

type MaybePromise<T> = T | Promise<T>;

/** Code shown in the in-app inbox when real email delivery is not configured. */
export interface DevMail {
  to: string;
  subject: string;
  code: string;
}

export interface AuthGateway {
  readonly mode: 'server' | 'demo';
  restore(): Promise<Session | null>;
  register(name: string, email: string, password: string): Promise<DevMail | undefined>;
  resendVerification(email: string): Promise<DevMail | undefined>;
  verifyEmail(email: string, code: string): Promise<Session>;
  login(email: string, password: string): Promise<Session>;
  requestPasswordReset(email: string): Promise<DevMail | undefined>;
  resetPassword(email: string, code: string, password: string): Promise<void>;
  logout(): void;
  openLibrary(session: Session): Promise<LibraryGateway>;
}

/** What the UI needs from a library. The shared LibraryService satisfies it directly. */
export interface LibraryGateway {
  readonly tracks: ReadonlyMap<TrackId, Track>;
  readonly playlists: readonly Playlist[];
  readonly music: Playlist;
  onChange(listener: () => void): () => void;
  getPlaylist(id: PlaylistId): Playlist;
  getTrack(id: TrackId): Track | undefined;
  playlistTracks(id: PlaylistId): Track[];
  search(query: string): Track[];
  addFiles(files: File[], alsoAddTo?: PlaylistId): Promise<UploadResult>;
  addRemote(url: string, meta: { title?: string; artist?: string }, alsoAddTo?: PlaylistId): MaybePromise<Track>;
  createPlaylist(name: string): MaybePromise<Playlist>;
  renamePlaylist(id: PlaylistId, name: string): MaybePromise<void>;
  deletePlaylist(id: PlaylistId): MaybePromise<void>;
  addToPlaylist(playlistId: PlaylistId, trackId: TrackId): MaybePromise<boolean>;
  removeFromPlaylist(playlistId: PlaylistId, index: number): Promise<void>;
  moveInPlaylist(playlistId: PlaylistId, from: number, to: number): MaybePromise<void>;
  setDuration(id: TrackId, durationSec: number): void;
  resolveSource(track: Track): Promise<string>;
}

/** Errors from either gateway expose a machine-readable code. */
export const errorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : undefined;

export function probeDuration(blob: Blob): Promise<number> {
  if (typeof Audio === 'undefined') return Promise.resolve(0);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    const done = (value: number) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(value) ? value : 0);
    };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => done(audio.duration);
    audio.onerror = () => done(0);
    setTimeout(() => done(0), 8000);
    audio.src = url;
  });
}

export async function createGateway(apiUrl = import.meta.env.VITE_API_URL as string | undefined): Promise<AuthGateway> {
  if (apiUrl) {
    const { HttpGateway } = await import('./http-gateway');
    return new HttpGateway(apiUrl.replace(/\/$/, ''));
  }
  const { DemoGateway } = await import('./demo-gateway');
  return new DemoGateway();
}

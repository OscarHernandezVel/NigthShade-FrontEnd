import { FifoQueue, type ListNode } from '../../../shared/linked-list';
import type { Playlist } from '../../../shared/library-service';
import type { PlaylistId, Track, TrackId } from '../../../shared/types';
import type { LibraryGateway } from '../api/gateway';

/**
 * Decides what plays next. The playlist position is a pointer to a list node,
 * so drag & drop reordering (which relinks nodes) never loses the current song.
 * Songs in the FIFO queue always play before the playlist continues.
 */
export class PlaybackController {
  readonly queue = new FifoQueue<TrackId>();
  private playlist: Playlist | null = null;
  private cursor: ListNode<TrackId> | null = null;
  private current: TrackId | null = null;

  /** `resolve` returns the live playlist object for an id (it changes when the client reloads from the server). */
  constructor(private readonly resolve: (id: PlaylistId) => Playlist | undefined = () => undefined) {}

  get currentTrackId(): TrackId | null {
    return this.current;
  }

  get playlistId(): PlaylistId | null {
    return this.playlist?.id ?? null;
  }

  get cursorNode(): ListNode<TrackId> | null {
    return this.liveCursor();
  }

  startPlaylist(playlist: Playlist, index = 0): TrackId | null {
    this.playlist = playlist;
    this.cursor = playlist.tracks.size ? playlist.tracks.nodeAt(index) : null;
    this.current = this.cursor?.value ?? null;
    return this.current;
  }

  playSingle(trackId: TrackId): TrackId {
    this.current = trackId;
    const node = this.playlist?.tracks.findNode((id) => id === trackId) ?? null;
    if (node) this.cursor = node;
    return trackId;
  }

  enqueue(...trackIds: TrackId[]): void {
    trackIds.forEach((id) => this.queue.enqueue(id));
  }

  next(): TrackId | null {
    const queued = this.queue.dequeue();
    if (queued !== undefined) {
      this.current = queued;
      return queued;
    }
    const following = this.liveCursor()?.next ?? null;
    if (!following) return null;
    this.cursor = following;
    this.current = following.value;
    return this.current;
  }

  previous(): TrackId | null {
    const before = this.liveCursor()?.prev ?? null;
    if (!before) return null;
    this.cursor = before;
    this.current = before.value;
    return this.current;
  }

  forget(trackId: TrackId): void {
    this.queue.removeWhere((id) => id === trackId);
    if (this.current === trackId) this.current = null;
  }

  reset(): void {
    this.queue.clear();
    this.playlist = null;
    this.cursor = null;
    this.current = null;
  }

  private liveCursor(): ListNode<TrackId> | null {
    if (!this.playlist) return null;
    const latest = this.resolve(this.playlist.id);
    if (latest && latest !== this.playlist) {
      this.playlist = latest;
      this.cursor = null;
    }
    if (this.cursor && this.playlist.tracks.contains(this.cursor)) return this.cursor;
    // The node was unlinked (song removed): re-anchor on the current song if it is still there.
    this.cursor = this.current ? this.playlist.tracks.findNode((id) => id === this.current) : null;
    return this.cursor;
  }
}

export interface PlayerSnapshot {
  track: Track | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  error: string | null;
}

export const SKIP_SECONDS = 10;

export class AudioPlayer {
  readonly controller: PlaybackController;
  private readonly listeners = new Set<(snapshot: PlayerSnapshot) => void>();
  private error: string | null = null;

  constructor(
    private readonly audio: HTMLAudioElement,
    private readonly library: LibraryGateway,
  ) {
    this.controller = new PlaybackController((id) => library.playlists.find((p) => p.id === id));
    const emit = () => this.emit();
    for (const event of ['timeupdate', 'play', 'pause', 'durationchange', 'volumechange', 'seeked']) audio.addEventListener(event, emit);
    audio.addEventListener('loadedmetadata', () => {
      const id = this.controller.currentTrackId;
      if (id) this.library.setDuration(id, audio.duration);
      emit();
    });
    audio.addEventListener('ended', () => void this.next());
    audio.addEventListener('error', () => {
      if (!audio.getAttribute('src')) return;
      this.error = 'This song could not be played. The file or link may be broken.';
      emit();
    });
  }

  subscribe(listener: (snapshot: PlayerSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): PlayerSnapshot {
    const id = this.controller.currentTrackId;
    const track = id ? (this.library.getTrack(id) ?? null) : null;
    const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : (track?.durationSec ?? 0);
    return {
      track,
      playing: !this.audio.paused && !!track,
      currentTime: this.audio.currentTime || 0,
      duration,
      volume: this.audio.volume,
      error: this.error,
    };
  }

  async playPlaylist(playlistId: PlaylistId, index = 0): Promise<void> {
    await this.load(this.controller.startPlaylist(this.library.getPlaylist(playlistId), index));
  }

  async playTrack(trackId: TrackId): Promise<void> {
    await this.load(this.controller.playSingle(trackId));
  }

  enqueue(...trackIds: TrackId[]): void {
    this.controller.enqueue(...trackIds);
    this.emit();
  }

  async togglePlay(fallbackPlaylist: PlaylistId): Promise<void> {
    if (!this.controller.currentTrackId) return this.playPlaylist(fallbackPlaylist);
    if (this.audio.paused) await this.audio.play().catch(() => undefined);
    else this.audio.pause();
  }

  async next(): Promise<void> {
    const id = this.controller.next();
    if (id) await this.load(id);
    else {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.emit();
    }
  }

  async previous(): Promise<void> {
    if (this.audio.currentTime > 3) return this.seek(0);
    const id = this.controller.previous();
    if (id) await this.load(id);
    else this.seek(0);
  }

  seek(seconds: number): void {
    const duration = this.snapshot().duration;
    if (!this.controller.currentTrackId) return;
    this.audio.currentTime = Math.max(0, Math.min(seconds, duration || seconds));
    this.emit();
  }

  skip(delta: number): void {
    this.seek(this.audio.currentTime + delta);
  }

  setVolume(volume: number): void {
    this.audio.volume = Math.max(0, Math.min(1, volume));
  }

  /** Called after the library changes, so a deleted song stops cleanly. */
  sync(): void {
    const id = this.controller.currentTrackId;
    for (const queued of this.controller.queue.toArray()) if (!this.library.getTrack(queued)) this.controller.forget(queued);
    if (id && !this.library.getTrack(id)) {
      this.controller.forget(id);
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
    }
    if (!this.library.tracks.size) this.controller.reset();
    this.emit();
  }

  private async load(trackId: TrackId | null): Promise<void> {
    this.error = null;
    const track = trackId ? this.library.getTrack(trackId) : undefined;
    if (!track) return this.emit();
    try {
      this.audio.src = await this.library.resolveSource(track);
      await this.audio.play();
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError' && error.name !== 'NotAllowedError') this.error = error.message;
    }
    this.emit();
  }

  private emit(): void {
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

export function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const seconds = Math.floor(totalSeconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Accepts "90", "1:30" or "1:02:30". Returns null when the text is not a time. */
export function parseTime(text: string): number | null {
  const parts = text.trim().split(':');
  if (!parts.length || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

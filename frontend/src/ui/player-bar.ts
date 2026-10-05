import type { PlaylistId } from '../../../shared/types';
import type { LibraryGateway } from '../api/gateway';
import { SKIP_SECONDS, formatTime, parseTime, type AudioPlayer, type PlayerSnapshot } from '../player/player';
import { icon, type Toaster } from './dom';

/** Bottom bar: transport, seek bar with time tooltip, jump to an exact second, volume. */
export class PlayerBar {
  private seeking = false;

  constructor(
    private readonly el: HTMLElement,
    private readonly player: AudioPlayer,
    private readonly library: LibraryGateway,
    private readonly toaster: Toaster,
    private readonly fallbackPlaylist: () => PlaylistId,
  ) {
    el.innerHTML = this.markup();
    this.bind();
  }

  private $<T extends HTMLElement = HTMLElement>(selector: string): T {
    return this.el.querySelector<T>(selector)!;
  }

  private markup(): string {
    const s = SKIP_SECONDS;
    return `<div class="now"><span class="now-art">${icon('note')}</span>
        <span class="now-text"><span class="now-title" id="now-title">Nothing playing</span><span class="now-artist" id="now-artist">Upload songs to start</span></span></div>
      <div class="transport">
        <div class="controls">
          <button class="icon-btn" id="btn-prev" type="button" aria-label="Previous song" title="Previous">${icon('prev')}</button>
          <button class="icon-btn skip" id="btn-back" type="button" aria-label="Back ${s} seconds" title="Back ${s} s">${icon('back')}<small>${s}</small></button>
          <button class="play-btn" id="btn-play" type="button" aria-label="Play">${icon('play')}</button>
          <button class="icon-btn skip" id="btn-fwd" type="button" aria-label="Forward ${s} seconds" title="Forward ${s} s">${icon('fwd')}<small>${s}</small></button>
          <button class="icon-btn" id="btn-next" type="button" aria-label="Next song" title="Next">${icon('next')}</button>
        </div>
        <div class="seek-row">
          <span class="time" id="time-current">0:00</span>
          <span class="seek-wrap"><input id="seek" type="range" min="0" max="0" step="0.1" value="0" aria-label="Song position">
            <span class="seek-tip" id="seek-tip" hidden>0:00</span></span>
          <span class="time" id="time-total">0:00</span>
        </div>
      </div>
      <div class="extras">
        <form class="goto" id="goto-form"><label for="goto">Go to</label>
          <input id="goto" placeholder="1:30" autocomplete="off" title="Seconds (90) or minutes:seconds (1:30)">
          <button class="btn btn-small" type="submit">Go</button></form>
        <label class="volume" for="volume">${icon('volume')}<input id="volume" type="range" min="0" max="1" step="0.01" value="1" aria-label="Volume"></label>
      </div>
      <p class="player-error" id="player-error" role="alert" hidden></p>`;
  }

  private bind(): void {
    const player = this.player;
    this.$('#btn-play').addEventListener('click', () => void player.togglePlay(this.fallbackPlaylist()));
    this.$('#btn-prev').addEventListener('click', () => void player.previous());
    this.$('#btn-next').addEventListener('click', () => void player.next());
    this.$('#btn-back').addEventListener('click', () => player.skip(-SKIP_SECONDS));
    this.$('#btn-fwd').addEventListener('click', () => player.skip(SKIP_SECONDS));
    this.$<HTMLInputElement>('#volume').addEventListener('input', (event) => player.setVolume(Number((event.target as HTMLInputElement).value)));

    const seek = this.$<HTMLInputElement>('#seek');
    const tip = this.$('#seek-tip');
    seek.addEventListener('input', () => {
      this.seeking = true;
      this.$('#time-current').textContent = formatTime(Number(seek.value));
      seek.style.setProperty('--progress', `${(Number(seek.value) / (Number(seek.max) || 1)) * 100}%`);
    });
    seek.addEventListener('change', () => {
      this.seeking = false;
      player.seek(Number(seek.value));
    });
    seek.addEventListener('pointermove', (event) => {
      if (seek.disabled) return;
      const rect = seek.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      tip.hidden = false;
      tip.textContent = formatTime(ratio * Number(seek.max));
      tip.style.left = `${ratio * 100}%`;
    });
    seek.addEventListener('pointerleave', () => (tip.hidden = true));

    this.$<HTMLFormElement>('#goto-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const input = this.$<HTMLInputElement>('#goto');
      const seconds = parseTime(input.value);
      const duration = player.snapshot().duration;
      if (seconds === null) return this.toaster.show('Type a time such as 90 or 1:30.', 'error');
      if (duration && seconds > duration) return this.toaster.show(`This song is only ${formatTime(duration)} long.`, 'error');
      player.seek(seconds);
      input.value = '';
    });
  }

  update(snapshot: PlayerSnapshot): void {
    const hasTracks = this.library.tracks.size > 0;
    this.el.classList.toggle('is-disabled', !hasTracks);
    this.el.classList.toggle('is-playing', snapshot.playing);
    this.el.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input').forEach((control) => (control.disabled = !hasTracks));
    const seek = this.$<HTMLInputElement>('#seek');
    seek.disabled = !snapshot.track;
    this.$<HTMLInputElement>('#goto').disabled = !snapshot.track;

    this.$('#now-title').textContent = snapshot.track?.title ?? 'Nothing playing';
    this.$('#now-artist').textContent = snapshot.track?.artist ?? (hasTracks ? 'Press play to start' : 'Upload songs to start');
    const play = this.$('#btn-play');
    play.innerHTML = icon(snapshot.playing ? 'pause' : 'play');
    play.setAttribute('aria-label', snapshot.playing ? 'Pause' : 'Play');

    this.$('#time-total').textContent = formatTime(snapshot.duration);
    if (!this.seeking) {
      seek.max = String(snapshot.duration || 0);
      seek.value = String(snapshot.currentTime);
      this.$('#time-current').textContent = formatTime(snapshot.currentTime);
      seek.style.setProperty('--progress', `${snapshot.duration ? (snapshot.currentTime / snapshot.duration) * 100 : 0}%`);
    }
    const error = this.$('#player-error');
    error.hidden = !snapshot.error;
    error.textContent = snapshot.error ?? '';
  }
}

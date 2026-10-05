import { SUPPORTED_AUDIO_EXTENSIONS, type PlaylistId } from '../../../shared/types';
import type { LibraryGateway } from '../api/gateway';
import { esc, icon, message, plural, type Toaster } from './dom';

/** Accepts files dropped from the OS (dragover/drop) on any element. */
export function bindFileDrop(zone: HTMLElement, onFiles: (files: File[]) => void): void {
  const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
  zone.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    zone.classList.add('is-file-over');
  });
  zone.addEventListener('dragleave', (event) => {
    if (!zone.contains(event.relatedTarget as Node)) zone.classList.remove('is-file-over');
  });
  zone.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    zone.classList.remove('is-file-over');
    onFiles([...(event.dataTransfer?.files ?? [])]);
  });
}

/** Interactive window to upload songs from the device or add links from open music libraries. */
export class UploadDialog {
  constructor(
    private readonly backdrop: HTMLElement,
    private readonly library: LibraryGateway,
    private readonly toaster: Toaster,
    private readonly target: () => PlaylistId | undefined,
  ) {
    backdrop.innerHTML = this.markup();
    this.bind();
  }

  get isOpen(): boolean {
    return !this.backdrop.hidden;
  }

  open(): void {
    this.$('#upload-results').innerHTML = '';
    this.backdrop.hidden = false;
    this.$('#dropzone').focus();
  }

  close(): void {
    this.backdrop.hidden = true;
  }

  async upload(files: File[]): Promise<void> {
    if (!files.length) return;
    if (!this.isOpen) this.open();
    const results = this.$('#upload-results');
    results.innerHTML = `<li class="is-pending">Uploading ${plural(files.length, 'file')}…</li>`;
    try {
      const { added, rejected } = await this.library.addFiles(files, this.target());
      this.report(
        added.map((t) => t.title),
        rejected.map((r) => `${r.name}: ${r.reason}`),
      );
    } catch (error) {
      results.innerHTML = `<li class="is-error">${esc(message(error))}</li>`;
    }
  }

  private $<T extends HTMLElement = HTMLElement>(selector: string): T {
    return this.backdrop.querySelector<T>(selector)!;
  }

  private markup(): string {
    const accept = [...SUPPORTED_AUDIO_EXTENSIONS, 'audio/*'].join(',');
    const formats = SUPPORTED_AUDIO_EXTENSIONS.map((e) => e.slice(1).toUpperCase()).join(', ');
    return `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="upload-title">
      <header class="modal-head"><h2 id="upload-title">Upload songs</h2>
        <button class="icon-btn" type="button" data-close aria-label="Close">${icon('close')}</button></header>
      <label class="dropzone" id="dropzone" for="file-input" tabindex="0">
        <span class="dropzone-icon">${icon('upload')}</span>
        <strong>Drop audio files here</strong>
        <span>or click to choose from your device · ${formats}</span>
        <input id="file-input" type="file" accept="${accept}" multiple hidden>
      </label>
      <ul class="upload-results" id="upload-results"></ul>
      <form class="url-form" id="url-form" novalidate>
        <p class="eyebrow">Or add a direct link from an open music library</p>
        <input id="url-input" type="url" placeholder="https://archive.org/download/…/song.mp3" aria-label="Audio link">
        <div class="url-row"><input id="url-title" placeholder="Title (optional)" aria-label="Title"><input id="url-artist" placeholder="Artist (optional)" aria-label="Artist"></div>
        <button class="btn" type="submit">Add link</button>
        <p class="form-error" id="url-error" role="alert"></p>
      </form></div>`;
  }

  private bind(): void {
    const input = this.$<HTMLInputElement>('#file-input');
    const dropzone = this.$('#dropzone');
    this.backdrop.addEventListener('click', (event) => {
      if (event.target === this.backdrop || (event.target as Element).closest('[data-close]')) this.close();
    });
    dropzone.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      input.click();
    });
    input.addEventListener('change', () => {
      if (input.files?.length) void this.upload([...input.files]);
      input.value = '';
    });
    bindFileDrop(dropzone, (files) => void this.upload(files));

    const form = this.$<HTMLFormElement>('#url-form');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const value = (id: string) => this.$<HTMLInputElement>(id).value;
      const error = this.$('#url-error');
      try {
        const track = await this.library.addRemote(value('#url-input'), { title: value('#url-title'), artist: value('#url-artist') }, this.target());
        error.textContent = '';
        form.reset();
        this.report([track.title], []);
      } catch (e) {
        error.textContent = message(e);
      }
    });
  }

  private report(added: string[], rejected: string[]): void {
    this.$('#upload-results').innerHTML =
      added.map((title) => `<li class="is-ok">Added ${esc(title)}</li>`).join('') +
      rejected.map((line) => `<li class="is-error">Skipped ${esc(line)}</li>`).join('');
    if (added.length) this.toaster.show(`Added ${plural(added.length, 'song')} to Music`);
  }
}

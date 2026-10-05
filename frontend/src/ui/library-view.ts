import type { Playlist } from '../../../shared/library-service';
import { OPEN_MUSIC_PROVIDERS, SUPPORTED_AUDIO_EXTENSIONS, type PlaylistId, type Session, type Track } from '../../../shared/types';
import type { LibraryGateway } from '../api/gateway';
import { AudioPlayer, SKIP_SECONDS, formatTime } from '../player/player';
import { LOGO, esc, icon, message, plural, type Toaster } from './dom';
import { makeSortable } from './drag-drop';
import { PlayerBar } from './player-bar';
import { UploadDialog, bindFileDrop } from './upload-dialog';

type View = { kind: 'playlist'; id: PlaylistId } | { kind: 'search'; query: string };

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName));

/** The signed-in app: sidebar with playlists and search, track list, Up next queue, player bar. */
export class LibraryView {
  private readonly player: AudioPlayer;
  private readonly upload: UploadDialog;
  private view: View;
  private lastPlaylistId: PlaylistId;
  private renaming = false;
  private confirmingDelete = false;
  private structuresOpen = false;
  private queueKey = '';
  private mainCleanups: (() => void)[] = [];
  private queueCleanups: (() => void)[] = [];
  private readonly cleanups: (() => void)[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly audio: HTMLAudioElement,
    private readonly library: LibraryGateway,
    private readonly session: Session,
    private readonly toaster: Toaster,
    private readonly onLogout: () => void,
  ) {
    this.view = { kind: 'playlist', id: library.music.id };
    this.lastPlaylistId = library.music.id;
    root.innerHTML = `<div class="shell">
      <aside class="sidebar" id="sidebar"></aside>
      <main class="main" id="main"></main>
      <aside class="side-panel" id="queue"></aside>
      <footer class="player" id="player"></footer>
    </div>
    <div class="modal-backdrop" id="upload-modal" hidden></div>`;

    this.player = new AudioPlayer(audio, library);
    this.upload = new UploadDialog(this.$('#upload-modal'), library, toaster, () => this.uploadTarget());
    const bar = new PlayerBar(this.$('#player'), this.player, library, toaster, () => this.currentPlaylist()?.id ?? library.music.id);
    this.bindEvents();
    this.renderSidebar();
    this.renderMain();
    this.renderQueue();

    const onKey = (event: KeyboardEvent) => this.onGlobalKey(event);
    document.addEventListener('keydown', onKey);
    this.cleanups.push(
      () => document.removeEventListener('keydown', onKey),
      library.onChange(() => {
        this.player.sync();
        this.renderSidebar();
        this.renderMain();
        this.renderQueue();
      }),
      this.player.subscribe((snapshot) => {
        bar.update(snapshot);
        if (this.currentQueueKey() !== this.queueKey) {
          this.renderQueue();
          this.highlightCurrent();
        }
      }),
    );
  }

  destroy(): void {
    [...this.cleanups, ...this.mainCleanups, ...this.queueCleanups].forEach((cleanup) => cleanup());
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
  }

  private $<T extends HTMLElement = HTMLElement>(selector: string): T {
    return this.root.querySelector<T>(selector)!;
  }

  private currentPlaylist(): Playlist | null {
    if (this.view.kind !== 'playlist') return null;
    const id = this.view.id;
    return this.library.playlists.find((p) => p.id === id) ?? null;
  }

  private uploadTarget(): PlaylistId | undefined {
    const playlist = this.currentPlaylist();
    return playlist && !playlist.system ? playlist.id : undefined;
  }

  private currentQueueKey(): string {
    const controller = this.player.controller;
    return `${controller.queue.toArray().join(',')}|${controller.currentTrackId}`;
  }

  /** Runs a change and reports failures as a toast. */
  private async safely(task: () => unknown, onError?: () => void): Promise<void> {
    try {
      await task();
    } catch (error) {
      onError?.();
      this.toaster.show(message(error), 'error');
      this.renderMain();
    }
  }

  // ------------------------------------------------------------ render

  private renderSidebar(): void {
    const sidebar = this.$('#sidebar');
    const active = document.activeElement;
    const caret = active instanceof HTMLInputElement && active.id === 'search' ? active.selectionStart : null;
    const query = this.view.kind === 'search' ? this.view.query : '';
    const items = this.library.playlists
      .map(
        (p) => `<li><button class="nav-item" type="button" data-playlist="${p.id}" data-drop-playlist="${p.id}">
          ${icon(p.system ? 'note' : 'list')}<span class="nav-name">${esc(p.name)}</span><span class="nav-count">${p.tracks.size}</span></button></li>`,
      )
      .join('');

    sidebar.innerHTML = `<div class="brand">${LOGO}<span>Nightshade</span></div>
      <label class="search" for="search">${icon('search')}<input id="search" type="search" placeholder="Search your music" autocomplete="off" value="${esc(query)}"></label>
      <nav class="nav" aria-label="Playlists">
        <p class="eyebrow">Playlists</p>
        <ul class="playlist-nav" id="playlist-nav">${items}</ul>
        <form class="new-playlist" id="new-playlist">
          <input id="new-playlist-name" placeholder="New playlist name" maxlength="60" aria-label="New playlist name">
          <button class="icon-btn" type="submit" aria-label="Create playlist" title="Create playlist">${icon('plus')}</button>
        </form>
        <p class="form-error" id="sidebar-error" role="alert"></p>
      </nav>
      <div class="account">
        <span class="avatar" aria-hidden="true">${esc(this.session.displayName.charAt(0).toUpperCase())}</span>
        <span class="account-text"><strong>${esc(this.session.displayName)}</strong><small>${esc(this.session.email)}</small></span>
        <button class="icon-btn" type="button" data-action="logout" aria-label="Sign out" title="Sign out">${icon('logout')}</button>
      </div>`;
    this.updateNavActive();
    if (caret !== null) {
      const input = this.$<HTMLInputElement>('#search');
      input.focus();
      input.setSelectionRange(caret, caret);
    }
  }

  private updateNavActive(): void {
    const activeId = this.view.kind === 'playlist' ? this.view.id : null;
    this.root.querySelectorAll<HTMLElement>('[data-playlist]').forEach((el) => {
      const isActive = el.dataset.playlist === activeId;
      el.classList.toggle('is-active', isActive);
      if (isActive) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
  }

  private renderMain(): void {
    const library = this.library;
    const main = this.$('#main');
    this.mainCleanups.forEach((cleanup) => cleanup());
    this.mainCleanups = [];

    if (this.view.kind === 'search') {
      const results = library.search(this.view.query);
      main.innerHTML = `<header class="view-head"><p class="eyebrow">Search</p>
        <h1 class="view-title">Results for “${esc(this.view.query.trim())}”</h1>
        <p class="view-meta">${plural(results.length, 'song')} found in your library</p></header>
        ${
          results.length
            ? `<ol class="track-list" id="track-list">${results.map((t, i) => this.trackRow(t, i, false)).join('')}</ol>`
            : '<p class="empty-note">No songs match that search. Try a title, an artist or a file name.</p>'
        }`;
      this.highlightCurrent();
      return;
    }

    const playlist = this.currentPlaylist() ?? library.music;
    if (library.tracks.size === 0 && playlist.system) {
      main.innerHTML = `<button class="empty-drop" type="button" data-action="open-upload" id="empty-drop">
        <span class="empty-icon">${icon('upload')}</span><span class="empty-title">Upload your songs here</span></button>`;
      return;
    }

    const tracks = library.playlistTracks(playlist.id);
    const total = tracks.reduce((sum, t) => sum + t.durationSec, 0);
    const title = this.renaming
      ? `<form class="rename-form" id="rename-form">
          <input id="rename-input" value="${esc(playlist.name)}" maxlength="60" aria-label="Playlist name">
          <button class="btn btn-small btn-primary" type="submit">Save</button>
          <button class="btn btn-small btn-ghost" type="button" data-action="cancel-rename">Cancel</button></form>`
      : `<div class="title-row"><h1 class="view-title">${esc(playlist.name)}</h1>
          ${playlist.system ? '' : `<button class="icon-btn" type="button" data-action="rename" aria-label="Rename playlist" title="Rename">${icon('edit')}</button>`}</div>`;
    const deleteControls = playlist.system
      ? ''
      : this.confirmingDelete
        ? `<span class="confirm-delete">Delete “${esc(playlist.name)}”? Its songs stay in Music.
            <button class="btn btn-small btn-danger" type="button" data-action="confirm-delete">Delete</button>
            <button class="btn btn-small btn-ghost" type="button" data-action="cancel-delete">Keep</button></span>`
        : `<button class="btn btn-ghost" type="button" data-action="delete-playlist">${icon('trash')}Delete playlist</button>`;
    const disabled = tracks.length ? '' : 'disabled';

    main.innerHTML = `<header class="view-head">
        <p class="eyebrow">${playlist.system ? 'Every song you upload' : 'Playlist'}</p>
        ${title}
        <p class="view-meta">${plural(tracks.length, 'song')} · ${formatTime(total)}</p>
        <div class="view-actions">
          <button class="btn btn-primary" type="button" data-action="play-all" ${disabled}>${icon('play')}Play</button>
          <button class="btn" type="button" data-action="queue-all" ${disabled}>${icon('queue')}Add all to Up next</button>
          <button class="btn" type="button" data-action="open-upload">${icon('upload')}Upload songs</button>
          ${deleteControls}
        </div>
      </header>
      ${
        tracks.length
          ? `<p class="hint">Drag a song by its handle to change the play order, or drop it on a playlist in the sidebar. Keyboard: Alt + ↑ / ↓.</p>
             <ol class="track-list" id="track-list">${tracks.map((t, i) => this.trackRow(t, i, true)).join('')}</ol>`
          : '<p class="empty-note">This playlist is empty. Drag songs from Music onto it in the sidebar, or pick it from “Add to…” on any song.</p>'
      }`;

    if (this.renaming) {
      const input = this.$<HTMLInputElement>('#rename-input');
      input.focus();
      input.select();
    }
    const list = main.querySelector<HTMLElement>('#track-list');
    if (list) {
      this.mainCleanups.push(
        makeSortable({
          container: list,
          itemSelector: '.track-row',
          handleSelector: '.grip',
          dropTargetSelector: '[data-drop-playlist]',
          onMove: (from, to) => void this.safely(() => library.moveInPlaylist(playlist.id, from, to)),
          onDropOnTarget: (from, target) =>
            void this.safely(async () => {
              const destination = library.getPlaylist(target.dataset.dropPlaylist!);
              const added = await library.addToPlaylist(destination.id, playlist.tracks.get(from));
              this.toaster.show(added ? `Added to ${destination.name}` : `Already in ${destination.name}`);
            }),
        }),
      );
    }
    this.highlightCurrent();
  }

  private trackRow(track: Track, index: number, sortable: boolean): string {
    const source = track.source;
    const badge =
      source.kind === 'file'
        ? (source.fileName.split('.').pop() ?? 'audio').toUpperCase()
        : (OPEN_MUSIC_PROVIDERS.find((p) => p.id === source.provider)?.label ?? 'Link');
    const options = this.library.playlists
      .filter((p) => !p.system)
      .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
      .join('');
    const removeLabel = this.currentPlaylist()?.system ? 'Delete from library' : 'Remove from playlist';
    return `<li class="track-row" data-index="${index}" data-track="${track.id}" tabindex="0" aria-label="${esc(track.title)} by ${esc(track.artist)}">
      ${sortable ? `<span class="grip" title="Drag to reorder">${icon('grip')}</span>` : ''}
      <span class="track-num">${index + 1}</span>
      <button class="track-main" type="button" data-action="play" title="Play">
        <span class="track-title">${esc(track.title)}</span><span class="track-artist">${esc(track.artist)}</span></button>
      <span class="badge">${esc(badge)}</span>
      <span class="track-time">${track.durationSec ? formatTime(track.durationSec) : '–:––'}</span>
      <span class="track-actions">
        <button class="icon-btn" type="button" data-action="enqueue" aria-label="Add to Up next" title="Add to Up next">${icon('queue')}</button>
        ${options ? `<select class="add-to" data-action="add-to" aria-label="Add to playlist"><option value="">Add to…</option>${options}</select>` : ''}
        ${sortable ? `<button class="icon-btn" type="button" data-action="remove" aria-label="${removeLabel}" title="${removeLabel}">${icon('trash')}</button>` : ''}
      </span></li>`;
  }

  private highlightCurrent(): void {
    const current = this.player.controller.currentTrackId;
    this.root.querySelectorAll<HTMLElement>('.track-row').forEach((row) => row.classList.toggle('is-current', row.dataset.track === current));
  }

  private renderQueue(): void {
    const library = this.library;
    const controller = this.player.controller;
    const panel = this.$('#queue');
    this.queueCleanups.forEach((cleanup) => cleanup());
    this.queueCleanups = [];
    const queued = controller.queue.toArray();
    this.queueKey = this.currentQueueKey();
    const title = (id: string) => library.getTrack(id)?.title ?? 'Removed song';

    const playlist = (controller.playlistId && library.playlists.find((p) => p.id === controller.playlistId)) || this.currentPlaylist() || library.music;
    const cursor = controller.playlistId === playlist.id ? controller.cursorNode : null;
    const cursorIndex = cursor ? playlist.tracks.indexOfNode(cursor) : -1;
    const nodes = [...playlist.tracks].map(
      (id, i) => `<span class="ll-node${i === cursorIndex ? ' is-cursor' : ''}" title="${esc(title(id))}">${esc(title(id))}</span>`,
    );
    const rows = queued
      .map(
        (id, i) => `<li class="queue-row" data-index="${i}" tabindex="0">
          <span class="grip" title="Drag to reorder">${icon('grip')}</span><span class="queue-pos">${i + 1}</span>
          <span class="queue-title">${esc(title(id))}</span>
          <button class="icon-btn" type="button" data-action="dequeue" aria-label="Remove from Up next">${icon('close')}</button></li>`,
      )
      .join('');

    panel.innerHTML = `<section class="panel">
        <div class="panel-head"><h2>Up next</h2><span class="pill">${queued.length}</span>
          ${queued.length ? '<button class="link" type="button" data-action="clear-queue">Clear</button>' : ''}</div>
        <p class="panel-note">First in, first out. Queued songs play before the playlist continues.</p>
        ${queued.length ? `<ol class="queue-list" id="queue-list">${rows}</ol>` : '<p class="empty-note small">Nothing queued.</p>'}
      </section>
      <details class="panel structures" ${this.structuresOpen ? 'open' : ''}>
        <summary>Data structures</summary>
        <p class="eyebrow">${esc(playlist.name)} · doubly linked list</p>
        <div class="ll"><span class="ll-end">HEAD</span>${nodes.length ? nodes.join('<span class="ll-link">⇄</span>') : '<span class="ll-null">null</span>'}<span class="ll-end">TAIL</span></div>
        <p class="eyebrow">Up next · FIFO queue as array</p>
        <pre class="code">${esc(JSON.stringify(queued.map(title), null, 1))}</pre>
        <p class="eyebrow">SUPPORTED_AUDIO_EXTENSIONS</p>
        <pre class="code">${esc(JSON.stringify(SUPPORTED_AUDIO_EXTENSIONS))}</pre>
        <p class="eyebrow">OPEN_MUSIC_PROVIDERS</p>
        <pre class="code">${esc(JSON.stringify(OPEN_MUSIC_PROVIDERS.map((p) => p.host), null, 1))}</pre>
      </details>`;

    const list = panel.querySelector<HTMLElement>('#queue-list');
    if (list) {
      this.queueCleanups.push(
        makeSortable({
          container: list,
          itemSelector: '.queue-row',
          handleSelector: '.grip',
          onMove: (from, to) => {
            controller.queue.move(from, to);
            this.renderQueue();
          },
        }),
      );
    }
  }

  // ------------------------------------------------------------ events

  private bindEvents(): void {
    const sidebar = this.$('#sidebar');
    const main = this.$('#main');
    const queue = this.$('#queue');

    sidebar.addEventListener('click', (event) => {
      const target = event.target as Element;
      const nav = target.closest<HTMLElement>('[data-playlist]');
      if (nav) return this.openPlaylist(nav.dataset.playlist!);
      if (target.closest('[data-action="logout"]')) this.onLogout();
    });
    sidebar.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.createPlaylist();
    });
    sidebar.addEventListener('input', (event) => {
      const input = event.target as HTMLInputElement;
      if (input.id !== 'search') return;
      this.view = input.value.trim() ? { kind: 'search', query: input.value } : { kind: 'playlist', id: this.lastPlaylistId };
      this.updateNavActive();
      this.renderMain();
    });

    main.addEventListener('click', (event) => this.onMainClick(event));
    main.addEventListener('change', (event) => this.onMainChange(event));
    main.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.savePlaylistName();
    });
    main.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.renaming) return;
      this.renaming = false;
      this.renderMain();
    });
    main.addEventListener('dblclick', (event) => {
      const playlist = this.currentPlaylist();
      if (!(event.target as Element).closest('.view-title') || !playlist || playlist.system) return;
      this.renaming = true;
      this.renderMain();
    });
    bindFileDrop(main, (files) => void this.upload.upload(files));

    queue.addEventListener('click', (event) => {
      const target = (event.target as Element).closest<HTMLElement>('[data-action]');
      const fifo = this.player.controller.queue;
      if (target?.dataset.action === 'clear-queue') fifo.clear();
      else if (target?.dataset.action === 'dequeue') fifo.removeAt(Number(target.closest<HTMLElement>('.queue-row')!.dataset.index));
      else return;
      this.renderQueue();
    });
    queue.addEventListener(
      'toggle',
      (event) => {
        if (event.target instanceof HTMLDetailsElement) this.structuresOpen = event.target.open;
      },
      true,
    );
  }

  private openPlaylist(id: PlaylistId): void {
    this.view = { kind: 'playlist', id };
    this.lastPlaylistId = id;
    this.renaming = this.confirmingDelete = false;
    const search = this.root.querySelector<HTMLInputElement>('#search');
    if (search) search.value = '';
    this.updateNavActive();
    this.renderMain();
    this.renderQueue();
  }

  private async createPlaylist(): Promise<void> {
    const input = this.$<HTMLInputElement>('#new-playlist-name');
    try {
      const created = await this.library.createPlaylist(input.value);
      this.toaster.show(`Created ${created.name}`);
      this.renderSidebar();
      this.openPlaylist(created.id);
    } catch (error) {
      this.$('#sidebar-error').textContent = message(error);
    }
  }

  private async savePlaylistName(): Promise<void> {
    const playlist = this.currentPlaylist();
    const input = this.root.querySelector<HTMLInputElement>('#rename-input');
    if (!playlist || !input) return;
    const previous = playlist.name;
    this.renaming = false;
    await this.safely(
      async () => {
        await this.library.renamePlaylist(playlist.id, input.value);
        if (playlist.name !== previous) this.toaster.show(`Renamed to ${playlist.name}`);
        else this.renderMain();
      },
      () => (this.renaming = true),
    );
  }

  private onMainClick(event: Event): void {
    const target = (event.target as Element).closest<HTMLElement>('[data-action]');
    if (!target) return;
    const { library, player } = this;
    const row = target.closest<HTMLElement>('.track-row');
    const playlist = this.currentPlaylist();

    switch (target.dataset.action) {
      case 'open-upload':
        return this.upload.open();
      case 'play':
        if (!row) return;
        if (playlist) return void player.playPlaylist(playlist.id, Number(row.dataset.index));
        return void player.playTrack(row.dataset.track!);
      case 'enqueue':
        if (!row) return;
        player.enqueue(row.dataset.track!);
        return this.toaster.show(`Added “${library.getTrack(row.dataset.track!)?.title}” to Up next`);
      case 'remove':
        if (!row || !playlist) return;
        return void this.safely(() => library.removeFromPlaylist(playlist.id, Number(row.dataset.index)));
      case 'play-all':
        if (playlist) void player.playPlaylist(playlist.id, 0);
        return;
      case 'queue-all':
        if (!playlist) return;
        player.enqueue(...playlist.tracks.toArray());
        return this.toaster.show(`Added ${plural(playlist.tracks.size, 'song')} to Up next`);
      case 'rename':
      case 'cancel-rename':
        this.renaming = target.dataset.action === 'rename';
        return this.renderMain();
      case 'delete-playlist':
      case 'cancel-delete':
        this.confirmingDelete = target.dataset.action === 'delete-playlist';
        return this.renderMain();
      case 'confirm-delete':
        if (!playlist) return;
        return void this.safely(async () => {
          const name = playlist.name;
          this.confirmingDelete = false;
          this.view = { kind: 'playlist', id: library.music.id };
          this.lastPlaylistId = library.music.id;
          await library.deletePlaylist(playlist.id);
          this.toaster.show(`Deleted ${name}`);
        });
    }
  }

  private onMainChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    if (select.dataset.action !== 'add-to' || !select.value) return;
    const trackId = select.closest<HTMLElement>('.track-row')!.dataset.track!;
    const destination = this.library.getPlaylist(select.value);
    select.value = '';
    void this.safely(async () => {
      const added = await this.library.addToPlaylist(destination.id, trackId);
      this.toaster.show(added ? `Added to ${destination.name}` : `Already in ${destination.name}`);
    });
  }

  private onGlobalKey(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.upload.isOpen) return this.upload.close();
    if (isTyping(event.target) || event.altKey || event.ctrlKey || event.metaKey || !this.library.tracks.size) return;
    if ((event.target as Element).closest?.('.track-row, .queue-row')) return;
    if (event.key === ' ') {
      event.preventDefault();
      void this.player.togglePlay(this.currentPlaylist()?.id ?? this.library.music.id);
    } else if (event.key === 'ArrowRight') this.player.skip(SKIP_SECONDS);
    else if (event.key === 'ArrowLeft') this.player.skip(-SKIP_SECONDS);
  }
}

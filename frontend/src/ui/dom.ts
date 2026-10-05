import type { DevMail } from '../api/gateway';

const ICONS = {
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
  prev: '<path d="M6 5h2v14H6zM20 5v14L9 12z"/>',
  next: '<path d="M16 5h2v14h-2zM4 5v14l11-7z"/>',
  back: '<path d="M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/>',
  fwd: '<path d="M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z"/>',
  queue: '<path d="M3 6h12v2H3zM3 11h12v2H3zM3 16h8v2H3zM17 13v-3h2v3h3v2h-3v3h-2v-3h-3v-2z"/>',
  trash: '<path d="M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 12H7z"/>',
  edit: '<path d="M4 17.2V20h2.8L17 9.8 14.2 7zM19.7 7.1a1 1 0 0 0 0-1.4l-1.4-1.4a1 1 0 0 0-1.4 0L15.6 5.6l2.8 2.8z"/>',
  grip: '<path d="M9 5h2v2H9zM13 5h2v2h-2zM9 11h2v2H9zM13 11h2v2h-2zM9 17h2v2H9zM13 17h2v2h-2z"/>',
  search: '<path d="M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/>',
  upload: '<path d="M11 16V7.8l-3.3 3.3-1.4-1.4L12 4l5.7 5.7-1.4 1.4L13 7.8V16zM5 18h14v2H5z"/>',
  volume: '<path d="M4 9h4l5-4v14l-5-4H4zM16 8a5 5 0 0 1 0 8l-1.4-1.4a3 3 0 0 0 0-5.2z"/>',
  close: '<path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4L12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z"/>',
  logout: '<path d="M10 4H5v16h5v-2H7V6h3zM15 7l-1.4 1.4 2.6 2.6H9v2h7.2l-2.6 2.6L15 17l5-5z"/>',
  note: '<path d="M10 4h10v3h-8v9.5A3.5 3.5 0 1 1 10 13.4z"/>',
  list: '<path d="M4 6h16v2H4zM4 11h16v2H4zM4 16h10v2H4z"/>',
  plus: '<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/>',
} as const;

export type IconName = keyof typeof ICONS;

export const icon = (name: IconName) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

export const LOGO =
  '<svg class="logo" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="#3b1d5e"/><path d="M24 9a12 12 0 1 0 7 20 10 10 0 0 1-7-20z" fill="#ff8c00"/><circle cx="17" cy="18" r="1.8" fill="#1d0f30"/><circle cx="23" cy="18" r="1.8" fill="#1d0f30"/></svg>';

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ENTITIES[char]);

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

export const message = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong. Try again.');

export class Toaster {
  constructor(private readonly region: HTMLElement) {}

  show(text: string, tone: 'info' | 'error' = 'info'): void {
    const el = document.createElement('div');
    el.className = `toast toast-${tone}`;
    el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    el.textContent = text;
    this.region.prepend(el);
    setTimeout(() => el.remove(), 4000);
  }

  /** Shows a code that would normally arrive by email (demo mode or a backend without SMTP). */
  mail(mail: DevMail, onUse: (code: string) => void): void {
    const card = document.createElement('div');
    card.className = 'toast toast-mail';
    card.innerHTML = `<p class="toast-eyebrow">Demo inbox · ${esc(mail.to)}</p>
      <p class="toast-title">${esc(mail.subject)}</p>
      <p class="mail-code">${esc(mail.code)}</p>
      <p class="toast-note">Email delivery is simulated here. With SMTP configured, this code arrives by email.</p>
      <div class="toast-actions"><button class="btn btn-small btn-primary" type="button" data-use>Use code</button>
      <button class="btn btn-small btn-ghost" type="button" data-dismiss>Dismiss</button></div>`;
    card.addEventListener('click', (event) => {
      const target = event.target as Element;
      if (target.closest('[data-use]')) onUse(mail.code);
      if (target.closest('[data-use], [data-dismiss]')) card.remove();
    });
    this.region.prepend(card);
    setTimeout(() => card.remove(), 120_000);
  }
}

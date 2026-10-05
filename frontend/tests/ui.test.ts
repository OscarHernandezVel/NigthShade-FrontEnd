import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../../shared/auth-service';
import { MemoryBlobStore } from '../../shared/library-service';
import { DemoGateway } from '../src/api/demo-gateway';
import { startApp } from '../src/main';

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => unknown, timeout = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for the UI');
    await tick(10);
  }
}

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const type = (selector: string, value: string) => {
  const input = $<HTMLInputElement>(selector);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const submit = (selector: string) => $<HTMLFormElement>(selector).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
const titles = () => [...document.querySelectorAll('#track-list .track-title')].map((el) => el.textContent);

describe('Nightshade UI (demo gateway)', () => {
  beforeEach(async () => {
    document.body.innerHTML = '<div id="app"></div><div id="toasts"></div><audio id="audio"></audio>';
    const gateway = new DemoGateway(new MemoryStore(), async () => new MemoryBlobStore(), async () => 200);
    await startApp({ root: $('#app'), toasts: $('#toasts'), audio: $<HTMLAudioElement>('#audio') }, gateway);
  });

  async function signUpAndIn() {
    $('[data-screen="register"]').click();
    type('#name', 'Morticia');
    type('#email', 'morticia@example.com');
    type('#password', 'pumpkin42');
    type('#confirm', 'pumpkin42');
    submit('#auth-form');
    await until(() => document.querySelector('.toast-mail [data-use]'));
    expect($('.auth-title').textContent).toBe('Verify your email');
    $('.toast-mail [data-use]').click();
    expect($<HTMLInputElement>('#code').value).toMatch(/^\d{6}$/);
    submit('#auth-form');
    await until(() => document.querySelector('.shell'));
  }

  async function upload(names: string[]) {
    const input = $<HTMLInputElement>('#file-input');
    const files = names.map((n) => new File([new Uint8Array(8)], n, { type: 'audio/mpeg' }));
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
    await until(() => document.querySelectorAll('#track-list .track-row').length === names.length);
  }

  it('shows validation errors on the auth forms', async () => {
    submit('#auth-form');
    await until(() => $('#auth-error').textContent);
    expect($('#auth-error').textContent).toBe('Email or password is incorrect.');
    $('[data-screen="register"]').click();
    type('#name', 'X');
    type('#email', 'x@example.com');
    type('#password', 'pumpkin42');
    type('#confirm', 'different1');
    submit('#auth-form');
    await until(() => $('#auth-error').textContent);
    expect($('#auth-error').textContent).toBe('The passwords do not match.');
  });

  it('starts empty: only the upload prompt, the player disabled', async () => {
    await signUpAndIn();
    expect($('#main').textContent?.trim()).toBe('Upload your songs here');
    expect($('#player').classList.contains('is-disabled')).toBe(true);
    expect($<HTMLButtonElement>('#btn-play').disabled).toBe(true);
    expect($('.nav-item.is-active').textContent).toContain('Music');
  });

  it('uploads, reorders, builds playlists, searches and queues', async () => {
    await signUpAndIn();
    $('#empty-drop').click();
    expect($('#upload-modal').hidden).toBe(false);
    await upload(['Bauhaus - Bela Lugosi.mp3', 'Siouxsie - Spellbound.mp3', 'The Cure - Lullaby.mp3']);
    expect(titles()).toEqual(['Bela Lugosi', 'Spellbound', 'Lullaby']);
    expect($('#player').classList.contains('is-disabled')).toBe(false);
    expect($('.view-meta').textContent).toBe('3 songs · 10:00');

    // Keyboard reorder (same code path as pointer drag & drop): Alt + ArrowDown
    $('.track-row').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));
    await until(() => titles()[0] === 'Spellbound');
    expect(titles()).toEqual(['Spellbound', 'Bela Lugosi', 'Lullaby']);
    expect($('.ll').textContent).toContain('HEAD');

    type('#new-playlist-name', 'Night drive');
    submit('#new-playlist');
    await until(() => $('.view-title')?.textContent === 'Night drive');

    $('[data-playlist]').click();
    const select = $<HTMLSelectElement>('.track-row .add-to');
    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => document.querySelectorAll('.nav-count')[1]?.textContent === '1');

    document.querySelectorAll<HTMLElement>('[data-playlist]')[1].click();
    $('[data-action="rename"]').click();
    type('#rename-input', 'Moonlight');
    submit('#rename-form');
    await until(() => $('.view-title')?.textContent === 'Moonlight');
    expect(titles()).toEqual(['Spellbound']);

    type('#search', 'cure');
    expect($('.view-title').textContent).toContain('cure');
    expect(titles()).toEqual(['Lullaby']);
    $('[data-action="enqueue"]').click();
    expect($('#queue-list').textContent).toContain('Lullaby');
    expect($('.pill').textContent).toBe('1');
  });
});

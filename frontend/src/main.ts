import './styles/main.css';
import type { Session } from '../../shared/types';
import { createGateway, type AuthGateway } from './api/gateway';
import { AuthView } from './ui/auth-view';
import { Toaster, message } from './ui/dom';
import { mountHalloween } from './ui/halloween';
import { LibraryView } from './ui/library-view';

export interface Elements {
  root: HTMLElement;
  toasts: HTMLElement;
  audio: HTMLAudioElement;
  decor?: HTMLElement;
}

/** Wires the screens together. Exported so the UI tests can boot it with a demo gateway. */
export async function startApp(elements: Elements, gateway: AuthGateway): Promise<void> {
  const toaster = new Toaster(elements.toasts);
  let libraryView: LibraryView | null = null;

  const auth = new AuthView(elements.root, gateway, toaster, enter);

  async function enter(session: Session): Promise<void> {
    const library = await gateway.openLibrary(session);
    libraryView = new LibraryView(elements.root, elements.audio, library, session, toaster, () => {
      libraryView?.destroy();
      libraryView = null;
      gateway.logout();
      auth.show('login', 'You signed out.');
    });
  }

  if (elements.decor) mountHalloween(elements.decor);
  const session = await gateway.restore();
  if (!session) return auth.show();
  try {
    await enter(session);
  } catch (error) {
    auth.show('login', message(error));
  }
}

const root = document.getElementById('app');
if (root && !import.meta.env.VITEST) {
  void createGateway().then((gateway) =>
    startApp(
      {
        root,
        toasts: document.getElementById('toasts')!,
        audio: document.getElementById('audio') as HTMLAudioElement,
        decor: document.getElementById('decor') ?? undefined,
      },
      gateway,
    ),
  );
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  }
}

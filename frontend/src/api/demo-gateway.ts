import { AuthService, DemoInbox, MemoryStore, type KeyValueStore } from '../../../shared/auth-service';
import { LibraryService, MemoryBlobStore, type BlobStore } from '../../../shared/library-service';
import type { Session } from '../../../shared/types';
import { probeDuration, type AuthGateway, type DevMail, type LibraryGateway } from './gateway';

const SESSION_KEY = 'ns.demo.session';

/** localStorage when available; memory otherwise (private windows, blocked storage). */
export function createBrowserStore(): KeyValueStore {
  try {
    localStorage.setItem('__ns_probe__', '1');
    localStorage.removeItem('__ns_probe__');
  } catch {
    return new MemoryStore();
  }
  return {
    get: (key) => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set: (key, value) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* quota exceeded: the session keeps working in memory */
      }
    },
    remove: (key) => {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

export class IndexedDbBlobStore implements BlobStore {
  private readonly db: Promise<IDBDatabase>;

  constructor(name = 'nightshade-audio') {
    this.db = new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('blobs');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  ready(): Promise<unknown> {
    return this.db;
  }

  private async run<R>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<R> {
    const db = await this.db;
    return new Promise<R>((resolve, reject) => {
      const request = action(db.transaction('blobs', mode).objectStore('blobs'));
      request.onsuccess = () => resolve(request.result as R);
      request.onerror = () => reject(request.error);
    });
  }

  async put(key: string, blob: Blob) {
    await this.run('readwrite', (store) => store.put(blob, key));
  }
  get(key: string) {
    return this.run<Blob | undefined>('readonly', (store) => store.get(key));
  }
  async delete(key: string) {
    await this.run('readwrite', (store) => store.delete(key));
  }
}

async function createBlobStore(): Promise<BlobStore> {
  try {
    const store = new IndexedDbBlobStore();
    await store.ready();
    return store;
  } catch {
    return new MemoryBlobStore();
  }
}

/** Runs the whole backend logic inside the browser: accounts, songs and playlists stay on this device. */
export class DemoGateway implements AuthGateway {
  readonly mode = 'demo' as const;
  private readonly inbox = new DemoInbox();
  private readonly auth: AuthService;

  constructor(
    private readonly kv: KeyValueStore = createBrowserStore(),
    private readonly blobs: () => Promise<BlobStore> = createBlobStore,
    private readonly probe: (blob: Blob) => Promise<number> = probeDuration,
  ) {
    this.auth = new AuthService(kv, this.inbox);
  }

  async restore(): Promise<Session | null> {
    try {
      const session = JSON.parse(this.kv.get(SESSION_KEY) ?? 'null') as Session | null;
      return session && this.auth.findUser(session.userId) ? session : null;
    } catch {
      return null;
    }
  }

  private lastMail(): DevMail | undefined {
    const mail = this.inbox.messages[0];
    return mail ? { to: mail.to, subject: mail.subject, code: mail.code } : undefined;
  }

  private remember(session: Session): Session {
    this.kv.set(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  async register(name: string, email: string, password: string) {
    await this.auth.register(name, email, password);
    return this.lastMail();
  }

  async resendVerification(email: string) {
    const before = this.inbox.messages.length;
    await this.auth.resendVerification(email);
    return this.inbox.messages.length > before ? this.lastMail() : undefined;
  }

  async verifyEmail(email: string, code: string) {
    return this.remember(await this.auth.verifyEmail(email, code));
  }

  async login(email: string, password: string) {
    return this.remember(await this.auth.login(email, password));
  }

  async requestPasswordReset(email: string) {
    const before = this.inbox.messages.length;
    await this.auth.requestPasswordReset(email);
    return this.inbox.messages.length > before ? this.lastMail() : undefined;
  }

  resetPassword(email: string, code: string, password: string) {
    return this.auth.resetPassword(email, code, password);
  }

  logout(): void {
    this.kv.remove(SESSION_KEY);
  }

  async openLibrary(session: Session): Promise<LibraryGateway> {
    return new LibraryService(session.userId, this.kv, await this.blobs(), this.probe);
  }
}

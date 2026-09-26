// The page's one AuthSession, wired to the browser. Nothing opens IndexedDB or
// touches the network until the session is first used.
import { openLocalDb, type LocalDb } from '../storage/localDb';
import { configuredOidc } from './config';
import { AuthSession } from './session';

export interface BrowserLike {
  location: { origin: string; assign(url: string): void };
  fetch: typeof fetch;
  indexedDB: IDBFactory;
}

/**
 * The local store, opened on first use and kept while its connection lives. Another page
 * deleting or upgrading the store, or the browser clearing site data, closes the connection;
 * the next call opens a fresh one. A store a newer build upgraded cannot be opened by this
 * code: that open fails, and the next call retries it.
 */
export function localDbOwner(factory: IDBFactory): () => Promise<LocalDb> {
  let db: Promise<LocalDb> | undefined;
  const drop = () => {
    db = undefined;
  };
  return () =>
    (db ??= openLocalDb({ factory, onVersionChange: drop, onClose: drop }).catch((err: unknown) => {
      drop();
      throw err;
    }));
}

export function createBrowserSession(win: BrowserLike): AuthSession {
  return new AuthSession({
    db: localDbOwner(win.indexedDB),
    config: configuredOidc(),
    origin: win.location.origin,
    fetch: (input, init) => win.fetch(input, init),
    navigate: (url) => win.location.assign(url),
  });
}

let session: AuthSession | undefined;

export function getAuthSession(): AuthSession {
  session ??= createBrowserSession(window);
  return session;
}

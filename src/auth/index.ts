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

export function createBrowserSession(win: BrowserLike): AuthSession {
  let db: Promise<LocalDb> | undefined;
  return new AuthSession({
    // Another page deleting or upgrading the store closes this connection; the session asks
    // for the store on every use, so the next call opens a fresh one. A store a newer build
    // upgraded cannot be opened by this code: that open fails, and the next call retries it.
    db: () =>
      (db ??= openLocalDb({ factory: win.indexedDB, onVersionChange: () => (db = undefined) }).catch((err: unknown) => {
        db = undefined;
        throw err;
      })),
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

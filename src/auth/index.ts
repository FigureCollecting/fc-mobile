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
 * code: `onNewerBuild` hears of it as the newer build asks, that open fails, and the next
 * call retries it. Only the connection the owner currently holds can clear it: a late event
 * from one it already dropped leaves the newer one alone.
 */
export function localDbOwner(factory: IDBFactory, onNewerBuild?: () => void): () => Promise<LocalDb> {
  let db: Promise<LocalDb> | undefined;
  return () => {
    if (db !== undefined) return db;
    const drop = (): void => {
      if (db === mine) db = undefined;
    };
    const onVersionChange = (newVersion: number | null): void => {
      drop();
      // null is a delete: the next open starts an empty store this build can use.
      if (newVersion !== null) onNewerBuild?.();
    };
    const mine: Promise<LocalDb> = openLocalDb({ factory, onVersionChange, onClose: drop }).catch((err: unknown) => {
      drop();
      throw err;
    });
    db = mine;
    return mine;
  };
}

export function createBrowserSession(win: BrowserLike): AuthSession {
  const session: AuthSession = new AuthSession({
    db: localDbOwner(win.indexedDB, () => session.reloadRequired()),
    config: configuredOidc(),
    origin: win.location.origin,
    fetch: (input, init) => win.fetch(input, init),
    navigate: (url) => win.location.assign(url),
  });
  return session;
}

let session: AuthSession | undefined;

export function getAuthSession(): AuthSession {
  session ??= createBrowserSession(window);
  return session;
}

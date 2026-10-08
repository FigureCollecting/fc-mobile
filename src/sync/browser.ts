// The sync engine on the page: the session's local store and enrolled device, the coordinator
// transport, the page's triggers, and the auth status, which it reads and never writes (every
// status change stays the session's, inside its settle() guard).
import { effect, type ReadonlySignal } from '@preact/signals';
import { createClient } from '@connectrpc/connect';
import { CatalogService, SyncService } from '@figurecollecting/fc-api-contract';
import { createCoordinatorTransport } from '../api/transport';
import type { DpopFetch } from '../auth/dpopFetch';
import type { AuthStatus } from '../auth/statusGate';
import type { LocalDb } from '../storage/localDb';
import { UserStore } from '../storage/userStore';
import { SyncEngine, type CatalogCalls, type SyncCalls } from './engine';

/** What the engine needs of the auth session. */
export interface SyncSession {
  readonly status: ReadonlySignal<AuthStatus>;
  readonly fetch: DpopFetch;
  sub(): string | undefined;
  /** The device key; enrols it first when it has no device id yet. */
  deviceKey(enrolment: boolean): Promise<{ deviceId?: string }>;
  /** The open local store; a new connection after the browser closed the last one. */
  localDb(): Promise<LocalDb>;
}

/** Nothing is sent in these: only the session (a sign-in, a reload) moves on from them. Edits still queue. */
export const HELD_STATUSES: ReadonlySet<AuthStatus> = new Set(['loading', 'signed-out', 'reauth-required', 'reload-required']);

export class NotEnrolledError extends Error {
  constructor() {
    super('this device is not enrolled yet');
    this.name = 'NotEnrolledError';
  }
}

/**
 * The signed-in user's store, kept while the connection, the user and the device stay the same.
 * Site data cleared (a new, empty connection) or another user signing in opens a fresh one.
 */
export function storeProvider(session: SyncSession): () => Promise<UserStore> {
  let held: { db: LocalDb; sub: string; deviceId: string; store: Promise<UserStore> } | undefined;
  return async () => {
    const { deviceId } = await session.deviceKey(false);
    const sub = session.sub();
    if (deviceId === undefined || sub === undefined) throw new NotEnrolledError();
    const db = await session.localDb();
    if (held !== undefined && held.db === db && held.sub === sub && held.deviceId === deviceId) return held.store;
    const store = UserStore.open(db, { sub, deviceId });
    const mine = { db, sub, deviceId, store };
    held = mine;
    store.catch(() => {
      if (held === mine) held = undefined;
    });
    return store;
  };
}

export interface BrowserSyncOptions {
  session: SyncSession;
  window?: EventTarget;
  document?: EventTarget & { visibilityState: DocumentVisibilityState };
  /** The coordinator clients; built on the session's DPoP fetch when absent. */
  sync?: SyncCalls;
  catalog?: CatalogCalls;
}

export interface BrowserSync {
  engine: SyncEngine;
  dispose(): void;
}

export function createBrowserSync(opts: BrowserSyncOptions): BrowserSync {
  const { session } = opts;
  const transport = opts.sync === undefined || opts.catalog === undefined ? createCoordinatorTransport(session.fetch) : undefined;
  const engine = new SyncEngine({
    store: storeProvider(session),
    sync: opts.sync ?? createClient(SyncService, transport!),
    catalog: opts.catalog ?? createClient(CatalogService, transport!),
    blocked: () => HELD_STATUSES.has(session.status.peek()),
    ...(opts.window === undefined ? {} : { window: opts.window }),
    ...(opts.document === undefined ? {} : { document: opts.document }),
  });
  // A status that lets sync go again (signed in after 'sign in to sync', back online) resumes it.
  let first = true;
  const stop = effect(() => {
    const status = session.status.value;
    if (first) {
      first = false;
      return;
    }
    if (!HELD_STATUSES.has(status)) void engine.trigger('auth');
  });
  engine.start();
  return {
    engine,
    dispose: () => {
      stop();
      engine.stop();
    },
  };
}

const running = new WeakMap<SyncSession, BrowserSync>();

/** The page's one sync for its session, on the page's window and document. */
export function startBrowserSync(session: SyncSession): BrowserSync {
  let sync = running.get(session);
  if (sync === undefined) {
    sync = createBrowserSync({ session, window, document });
    running.set(session, sync);
  }
  return sync;
}

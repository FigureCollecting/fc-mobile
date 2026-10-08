// The client sync engine (WK-13): hydrate, drain, reachability.
//
// One pass, in the order sync.proto rule 6 asks for (push before pull):
//   1. a Status probe bounded at 3 s: the reachability test (never navigator.onLine) and the clock
//      sample the store anchors its HLC to, taken at the midpoint of the round trip;
//   2. drain: frozen Push batches of at most 100 events, each under one client_id the store keeps,
//      so a batch whose answer was lost goes again byte for byte and is answered DUPLICATE;
//   3. pull: Delta from the stored cursor in pages of 500 until has_more is false, applying a server
//      transaction only once the event carrying its commit_cursor has arrived (rule 7), and parking
//      the cursor at that commit. An unreadable cursor (INVALID_ARGUMENT) replays from '' onto an
//      empty replica, the outbox untouched;
//   4. GetProducts, in batches of 200, for the figures the user holds (occ/*/head and uf/* rows)
//      that have no card or a card older than 24 h.
// Passes run one at a time on: start, online, visibilitychange to visible, pageshow, 1 s after a
// local write, and a full-jitter backoff (cap 2 s doubling to 5 min) while the page is visible.
// While the session needs a sign-in or a reload, nothing goes out and nothing is lost: edits stay
// in the outbox. The engine reads facet rows only through the store's index fields (family,
// head_id), never parsing a key, and never writes the auth status.
import { signal, type ReadonlySignal } from '@preact/signals';
import { Code, ConnectError, type Client } from '@connectrpc/connect';
import {
  isCanonicalVersion,
  type CatalogService,
  type HlcClock,
  type SyncEvent,
  type SyncService,
} from '@figurecollecting/fc-api-contract';
import type { UserStore } from '../storage/userStore';

export const DELTA_PAGE = 500;
export const PRODUCT_BATCH = 200;
export const PUSH_BATCH = 100;
export const PROBE_TIMEOUT_MS = 3_000;
/** Any other call that has not answered by then counts as unreachable; its batch is retried as sent. */
export const CALL_TIMEOUT_MS = 30_000;
export const PRODUCT_TTL_MS = 24 * 60 * 60 * 1000;
export const WRITE_DELAY_MS = 1_000;
export const BACKOFF_MIN_MS = 2_000;
export const BACKOFF_MAX_MS = 5 * 60 * 1000;
/** Push rounds in one pass, a guard against a store that never empties. */
const MAX_ROUNDS = 10_000;

export type SyncCalls = Pick<Client<typeof SyncService>, 'status' | 'delta' | 'push'>;
export type CatalogCalls = Pick<Client<typeof CatalogService>, 'getProducts'>;
export type SyncTrigger = 'start' | 'online' | 'visible' | 'pageshow' | 'write' | 'retry' | 'auth' | 'manual';
export type Reachability = 'unknown' | 'reachable' | 'unreachable';
/** unreachable: retry on the backoff; paused: wait for the session (sign in, reload); error: retry on the backoff. */
export type FailureKind = 'unreachable' | 'paused' | 'error';

export interface RejectedEdit {
  id: number;
  facet_key: string;
  reason: string;
}

export interface SyncState {
  reachability: Reachability;
  phase: 'idle' | 'syncing' | 'paused';
  /** Changes not yet answered by the server (pending, in flight, or owed a re-mint), one per intent. */
  pending: number;
  /** REJECTED edits the server would not take and the user has not dismissed. */
  rejected: RejectedEdit[];
  /** Facets whose value from this device another device replaced. */
  overwritten: number;
  lastSyncedAt: number | null;
  lastError: string | null;
}

interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export interface SyncEngineDeps {
  /** The signed-in user's store; asked for on every pass, so a new connection or user is picked up. */
  store: () => Promise<UserStore>;
  sync: SyncCalls;
  catalog: CatalogCalls;
  /** True while the session cannot sync (sign in to sync, reload required): nothing goes out. */
  blocked?: () => boolean;
  clock?: HlcClock;
  timers?: Timers;
  random?: () => number;
  /** AbortSignal.timeout by default. */
  timeoutSignal?: (ms: number) => AbortSignal;
  /** Where online and pageshow fire; none in tests that drive trigger() by hand. */
  window?: EventTarget;
  document?: EventTarget & { visibilityState: DocumentVisibilityState };
}

class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

/** Full jitter: uniform in [0, min(5 min, 2 s * 2^attempt)). */
export function backoffDelay(attempt: number, random: () => number): number {
  const cap = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.min(attempt, 30));
  return Math.floor(random() * cap);
}

const UNREACHABLE = new Set([Code.Unavailable, Code.DeadlineExceeded, Code.Canceled]);
const PAUSED = new Set([Code.Unauthenticated, Code.FailedPrecondition]);

export function classify(err: unknown): FailureKind {
  const name = (err as { name?: unknown } | null)?.name;
  if (err instanceof ConnectError) {
    if (UNREACHABLE.has(err.code)) return 'unreachable';
    if (PAUSED.has(err.code)) return 'paused';
    return 'error';
  }
  if (name === 'TimeoutError' || name === 'AbortError' || name === 'NetworkError' || err instanceof TypeError) return 'unreachable';
  if (name === 'AuthRequiredError' || name === 'ReloadRequiredError' || name === 'VersionError') return 'paused';
  return 'error';
}

// A DOMException is not always an Error (jsdom, some engines): read any message it carries.
const message = (err: unknown): string => {
  const text = (err as { message?: unknown } | null)?.message;
  return typeof text === 'string' ? text : String(err);
};

/** The call, and a rejection when its signal aborts even if the call ignores it. */
function bounded<T>(signal: AbortSignal, call: (signal: AbortSignal) => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    call(signal).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

const systemClock: HlcClock = { wallMs: () => Date.now(), monoMs: () => performance.now() };
const systemTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof globalThis.setTimeout>),
};

export class SyncEngine {
  private readonly deps: SyncEngineDeps;
  private readonly clock: HlcClock;
  private readonly timers: Timers;
  private readonly random: () => number;
  private readonly timeoutSignal: (ms: number) => AbortSignal;
  readonly #state = signal<SyncState>({
    reachability: 'unknown',
    phase: 'idle',
    pending: 0,
    rejected: [],
    overwritten: 0,
    lastSyncedAt: null,
    lastError: null,
  });
  readonly state: ReadonlySignal<SyncState> = this.#state;
  private running: Promise<void> | undefined;
  private again = false;
  private attempt = 0;
  private retryTimer: unknown;
  private writeTimer: unknown;
  private started = false;
  private stopped = false;

  constructor(deps: SyncEngineDeps) {
    this.deps = deps;
    this.clock = deps.clock ?? systemClock;
    this.timers = deps.timers ?? systemTimers;
    this.random = deps.random ?? Math.random;
    this.timeoutSignal = deps.timeoutSignal ?? ((ms) => AbortSignal.timeout(ms));
  }

  // ------------------------------------------------------------ triggers

  /** Listen for the triggers and run the first pass. */
  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.deps.window?.addEventListener('online', this.onOnline);
    this.deps.window?.addEventListener('pageshow', this.onPageShow);
    this.deps.document?.addEventListener('visibilitychange', this.onVisibility);
    void this.trigger('start');
  }

  stop(): void {
    this.stopped = true;
    this.deps.window?.removeEventListener('online', this.onOnline);
    this.deps.window?.removeEventListener('pageshow', this.onPageShow);
    this.deps.document?.removeEventListener('visibilitychange', this.onVisibility);
    this.clearRetry();
    this.timers.clearTimeout(this.writeTimer);
  }

  private readonly onOnline = (): void => void this.trigger('online');
  private readonly onPageShow = (): void => void this.trigger('pageshow');
  private readonly onVisibility = (): void => {
    if (this.visible()) void this.trigger('visible');
    else this.clearRetry();
  };

  /** Run a pass now; one already running takes one more pass after it. Resolves when the passes end. */
  trigger(_reason: SyncTrigger): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.clearRetry();
    if (this.running !== undefined) {
      this.again = true;
      return this.running;
    }
    this.set({ phase: 'syncing' });
    this.running = this.loop().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  /** A local write happened: show it as pending now, sync 1 s later (once for a burst). */
  notifyWrite(): void {
    this.timers.clearTimeout(this.writeTimer);
    this.writeTimer = this.timers.setTimeout(() => void this.trigger('write'), WRITE_DELAY_MS);
  }

  /** Make a local edit through the store, then schedule its sync. */
  async write<T>(fn: (store: UserStore) => Promise<T>): Promise<T> {
    const store = await this.deps.store();
    const out = await fn(store);
    this.notifyWrite();
    await this.refresh(store);
    return out;
  }

  /** Read through the signed-in user's store. */
  async read<T>(fn: (store: UserStore) => Promise<T>): Promise<T> {
    return fn(await this.deps.store());
  }

  /** The user has read the REJECTED edits shown; they stay in the store, marked seen. */
  async dismissRejected(): Promise<void> {
    const store = await this.deps.store();
    await store.dismissRejected(this.#state.peek().rejected.map((r) => r.id));
    await this.refresh(store);
  }

  private visible(): boolean {
    return this.deps.document === undefined || this.deps.document.visibilityState === 'visible';
  }

  private clearRetry(): void {
    if (this.retryTimer === undefined) return;
    this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  private set(patch: Partial<SyncState>): void {
    this.#state.value = { ...this.#state.peek(), ...patch };
  }

  // ------------------------------------------------------------ one pass

  private async loop(): Promise<void> {
    let outcome: 'ok' | FailureKind;
    // A trigger during a pass gets one more pass whatever this one came to: a sign-in that lands
    // while boot still held sync, or 'online' during a pass that found the network down.
    do {
      this.again = false;
      outcome = await this.pass();
    } while (this.again && !this.stopped);
    // Only the session holds sync. A refusal it did not turn into a held status (a proof the
    // browser replayed on its own and the server refused as a replay) is retried like any failure.
    if (outcome === 'paused' && this.deps.blocked?.() !== true) outcome = 'error';
    this.set({ phase: outcome === 'paused' ? 'paused' : 'idle' });
    if (outcome === 'ok') this.attempt = 0;
    else if (outcome !== 'paused') this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.stopped || !this.visible()) return;
    const delay = backoffDelay(this.attempt, this.random);
    this.attempt += 1;
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = undefined;
      void this.trigger('retry');
    }, delay);
  }

  private async pass(): Promise<'ok' | FailureKind> {
    if (this.deps.blocked?.() === true) {
      // Nothing goes out, but what waits is still shown (after a reload into 'sign in to sync').
      await this.deps
        .store()
        .then((store) => this.refresh(store))
        .catch(() => undefined);
      return 'paused';
    }
    let store: UserStore | undefined;
    try {
      store = await this.deps.store();
      await this.probe(store);
      await this.drain(store);
      await this.pull(store);
      await this.hydrateProducts(store);
      this.set({ lastSyncedAt: this.clock.wallMs(), lastError: null });
      return 'ok';
    } catch (err) {
      const kind = classify(err);
      this.set({ lastError: message(err), ...(kind === 'unreachable' ? { reachability: 'unreachable' as const } : {}) });
      return kind;
    } finally {
      if (store !== undefined) await this.refresh(store).catch(() => undefined);
    }
  }

  // The Status probe: reachability, and the HLC's clock sample with its round trip clamped
  // into [0, the probe's bound] (a monotonic glitch or a stalled tab must not skew the offset).
  private async probe(store: UserStore): Promise<void> {
    const sent = this.clock.monoMs();
    const status = await bounded(this.timeoutSignal(PROBE_TIMEOUT_MS), (signal) => this.deps.sync.status({}, { signal }));
    const rtt = Math.min(Math.max(this.clock.monoMs() - sent, 0), PROBE_TIMEOUT_MS);
    if (!isCanonicalVersion(status.serverNowIso)) throw new ProtocolError(`unreadable server_now_iso: ${JSON.stringify(status.serverNowIso)}`);
    this.set({ reachability: 'reachable' });
    await store.onStatus(status, rtt);
  }

  private call<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return bounded(this.timeoutSignal(CALL_TIMEOUT_MS), fn);
  }

  private async drain(store: UserStore): Promise<void> {
    let probed = false;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const next = await store.nextBatch(PUSH_BATCH);
      if (next.kind === 'empty') return;
      if (next.kind === 'status_required') {
        if (probed) throw new ProtocolError('the store keeps asking for a Status');
        await this.probe(store);
        probed = true;
        continue;
      }
      probed = false;
      const answer = await this.call((signal) => this.deps.sync.push(next.batch.request, { signal }));
      await store.recordPush(next.batch.clientId, answer);
      // A REJECTED edit owes a fresh Status before the next mint (rule 5); a version_future one is re-minted by it.
      if ((await store.getMeta()).rejected_past !== null) {
        await this.probe(store);
        probed = true;
      }
    }
  }

  private async pull(store: UserStore): Promise<void> {
    const { cursor } = await store.getMeta();
    try {
      await this.walk(cursor, (events, commit) => store.apply(events, { cursor: commit }).then(() => undefined));
    } catch (err) {
      if (!(err instanceof ConnectError) || err.code !== Code.InvalidArgument) throw err;
      // The cursor is unreadable here (a restored server): replay the whole feed onto an empty replica.
      const all: SyncEvent[] = [];
      let last = '';
      await this.walk('', async (events, commit) => {
        all.push(...events);
        last = commit;
      });
      await store.replaceReplica(all, last);
    }
  }

  // Delta from `from` until has_more is false. Each page's complete transactions go to `take` with
  // the commit_cursor of the last; events after it stay staged and are fetched again next time.
  private async walk(from: string, take: (events: SyncEvent[], commit: string) => Promise<void>): Promise<void> {
    let cursor = from;
    let staged: SyncEvent[] = [];
    for (;;) {
      const page = await this.call((signal) => this.deps.sync.delta({ cursor, limit: DELTA_PAGE }, { signal }));
      const complete: SyncEvent[] = [];
      let commit: string | undefined;
      for (const event of page.events) {
        staged.push(event);
        if (event.commitCursor !== '') {
          complete.push(...staged);
          staged = [];
          commit = event.commitCursor;
        }
      }
      if (commit !== undefined) await take(complete, commit);
      if (!page.hasMore || page.nextCursor === cursor) return;
      cursor = page.nextCursor;
    }
  }

  private async hydrateProducts(store: UserStore): Promise<void> {
    const heads = new Set<string>();
    for (const rec of await store.listFacets()) {
      if (rec.head_id !== undefined && (rec.family === 'occ/head' || rec.family?.startsWith('uf/') === true)) heads.add(rec.head_id);
    }
    const fetched = new Map<string, number>();
    for (const p of await store.listProducts()) {
      const ids = [p.head_id, ...p.card.requestedAs.flatMap((r) => (r.ref.case === 'headId' ? [r.ref.value] : []))];
      for (const id of ids) fetched.set(id, Math.max(fetched.get(id) ?? -Infinity, p.fetched_at));
    }
    const now = this.clock.wallMs();
    const due = [...heads].filter((h) => !(now - (fetched.get(h) ?? -Infinity) < PRODUCT_TTL_MS)).sort();
    for (let i = 0; i < due.length; i += PRODUCT_BATCH) {
      const refs = due.slice(i, i + PRODUCT_BATCH).map((value) => ({ ref: { case: 'headId' as const, value } }));
      let pageToken = '';
      do {
        const page = await this.call((signal) => this.deps.catalog.getProducts({ refs, pageToken }, { signal }));
        await store.putProducts(page.products);
        pageToken = page.nextPageToken;
      } while (pageToken !== '');
    }
  }

  // ------------------------------------------------------------ what the UI shows

  private async refresh(store: UserStore): Promise<void> {
    const outbox = await store.listOutbox();
    const facets = await store.listFacets();
    this.set({
      // One change the user made is one intent (its group), however many facets it wrote.
      pending: new Set(outbox.filter((e) => e.state === 'PENDING' || e.state === 'IN_FLIGHT' || e.remint === 'awaiting').map((e) => e.group ?? e.id)).size,
      rejected: outbox
        .filter((e) => e.state === 'REJECTED' && e.remint === undefined && e.dismissed !== true)
        .map((e) => ({ id: e.id!, facet_key: e.facet_key, reason: e.reason ?? '' })),
      overwritten: facets.filter((f) => f.overwritten !== null).length,
    });
  }
}

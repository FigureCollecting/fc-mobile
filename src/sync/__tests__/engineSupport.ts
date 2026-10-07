// Shared pieces of the engine tests: manual timers, uuids, server-side copies, a store + engine.
import { IDBFactory } from 'fake-indexeddb';
import { SyncOp, occFacetKey } from '@figurecollecting/fc-api-contract';
import type { LocalDb } from '../../storage/localDb';
import type { UserStore } from '../../storage/userStore';
import { SyncEngine, type SyncEngineDeps } from '../engine';
import { FakeCoordinator } from './fakeCoordinator';
import { FakeClock, T0, freshDb, openStore } from './harness';

export const STAMP = { edited_at: '2026-09-26T07:00:00.000-05:00', tz: 'America/Chicago' };

/** A lowercase dashed uuid from a number and a 1-hex-digit family tag. */
export function uuid(n: number, family = 'a'): string {
  return `${family}${n.toString(16).padStart(7, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

export const headOf = (i: number) => uuid(i, 'b');
export const occOf = (i: number) => uuid(i, 'a');

/** A server device's version at the fake's wall clock. */
export function serverVersion(ms: number, counter: number, device = 'cccccccccccccccccccccccccccccccc'): string {
  return `${new Date(ms).toISOString().slice(0, 23)}000Z#${String(counter).padStart(10, '0')}#${device}`;
}

/** n copies (head + status) written on the server by another device, `perTx` copies to a transaction. */
export function seedCopies(server: FakeCoordinator, n: number, perTx = 100, status = 'owned'): void {
  let counter = 0;
  for (let start = 0; start < n; start += perTx) {
    const events = [];
    for (let i = start; i < Math.min(n, start + perTx); i++) {
      events.push({ facetKey: occFacetKey(occOf(i), 'head'), version: serverVersion(T0 - 60_000, ++counter), op: SyncOp.UPSERT, payload: JSON.stringify({ head_id: headOf(i), ...STAMP }) });
      events.push({ facetKey: occFacetKey(occOf(i), 'status'), version: serverVersion(T0 - 60_000, ++counter), op: SyncOp.UPSERT, payload: JSON.stringify({ status, ...STAMP }) });
    }
    server.write(events);
  }
}

/** setTimeout/clearTimeout that only fire when the test says so. */
export class ManualTimers {
  private next = 1;
  readonly pending = new Map<number, { fn: () => void; ms: number }>();

  setTimeout = (fn: () => void, ms: number): number => {
    const id = this.next++;
    this.pending.set(id, { fn, ms });
    return id;
  };

  clearTimeout = (id: unknown): void => {
    this.pending.delete(id as number);
  };

  delays(): number[] {
    return [...this.pending.values()].map((t) => t.ms);
  }

  /** Fire every pending timer (in creation order) and drop them. */
  fireAll(): void {
    const due = [...this.pending.values()];
    this.pending.clear();
    for (const t of due) t.fn();
  }
}

/** An AbortSignal per call that the test aborts by hand, as AbortSignal.timeout would. */
export class ManualTimeouts {
  readonly made: Array<{ ms: number; controller: AbortController }> = [];

  signal = (ms: number): AbortSignal => {
    const controller = new AbortController();
    this.made.push({ ms, controller });
    return controller.signal;
  };

  expireAll(): void {
    for (const m of this.made) m.controller.abort(new DOMException('signal timed out', 'TimeoutError'));
  }
}

export interface Rig {
  server: FakeCoordinator;
  clock: FakeClock;
  db: LocalDb;
  factory: IDBFactory;
  store: UserStore;
  engine: SyncEngine;
  timers: ManualTimers;
  timeouts: ManualTimeouts;
}

export async function rig(opts: { server?: FakeCoordinator; device?: string; deps?: Partial<SyncEngineDeps>; clock?: FakeClock } = {}): Promise<Rig> {
  const clock = opts.clock ?? new FakeClock();
  const server = opts.server ?? new FakeCoordinator(clock.wall);
  const { factory, db } = await freshDb();
  const store = await openStore(db, { clock, ...(opts.device === undefined ? {} : { deviceId: opts.device }), newClientId: () => crypto.randomUUID() });
  const timers = new ManualTimers();
  const timeouts = new ManualTimeouts();
  const engine = new SyncEngine({
    store: async () => store,
    sync: server.sync,
    catalog: server.catalog,
    clock,
    timers,
    timeoutSignal: timeouts.signal,
    random: () => 0.5,
    ...opts.deps,
  });
  return { server, clock, db, factory, store, engine, timers, timeouts };
}

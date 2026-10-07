// The client sync engine (WK-13): hydrate, drain, reachability. Stub for the red run.
import { signal, type ReadonlySignal } from '@preact/signals';
import type { Client } from '@connectrpc/connect';
import type { CatalogService, HlcClock, SyncService } from '@figurecollecting/fc-api-contract';
import type { UserStore } from '../storage/userStore';

export const DELTA_PAGE = 500;
export const PRODUCT_BATCH = 200;
export const PUSH_BATCH = 100;
export const PROBE_TIMEOUT_MS = 3_000;
export const CALL_TIMEOUT_MS = 30_000;
export const PRODUCT_TTL_MS = 24 * 60 * 60 * 1000;
export const WRITE_DELAY_MS = 1_000;
export const BACKOFF_MIN_MS = 2_000;
export const BACKOFF_MAX_MS = 5 * 60 * 1000;

export type SyncCalls = Pick<Client<typeof SyncService>, 'status' | 'delta' | 'push'>;
export type CatalogCalls = Pick<Client<typeof CatalogService>, 'getProducts'>;
export type SyncTrigger = 'start' | 'online' | 'visible' | 'pageshow' | 'write' | 'retry' | 'auth' | 'manual';
export type Reachability = 'unknown' | 'reachable' | 'unreachable';
export type FailureKind = 'unreachable' | 'paused' | 'error';

export interface RejectedEdit {
  id: number;
  facet_key: string;
  reason: string;
}

export interface SyncState {
  reachability: Reachability;
  phase: 'idle' | 'syncing' | 'paused';
  pending: number;
  rejected: RejectedEdit[];
  overwritten: number;
  lastSyncedAt: number | null;
  lastError: string | null;
}

export interface SyncEngineDeps {
  store: () => Promise<UserStore>;
  sync: SyncCalls;
  catalog: CatalogCalls;
  blocked?: () => boolean;
  clock?: HlcClock;
  timers?: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(id: unknown): void };
  random?: () => number;
  timeoutSignal?: (ms: number) => AbortSignal;
  window?: EventTarget;
  document?: EventTarget & { visibilityState: DocumentVisibilityState };
}

export function backoffDelay(_attempt: number, _random: () => number): number {
  return 0;
}

export function classify(_err: unknown): FailureKind {
  return 'error';
}

export class SyncEngine {
  readonly state: ReadonlySignal<SyncState> = signal<SyncState>({
    reachability: 'unknown',
    phase: 'idle',
    pending: 0,
    rejected: [],
    overwritten: 0,
    lastSyncedAt: null,
    lastError: null,
  });

  constructor(_deps: SyncEngineDeps) {}

  start(): void {}

  stop(): void {}

  async trigger(_reason: SyncTrigger): Promise<void> {}

  notifyWrite(): void {}

  async write<T>(fn: (store: UserStore) => Promise<T>): Promise<T> {
    return fn(undefined as never);
  }

  async dismissRejected(): Promise<void> {}
}

import { IDBFactory } from 'fake-indexeddb';
import { create } from '@bufbuild/protobuf';
import {
  PushOutcome,
  PushResultSchema,
  StatusResponseSchema,
  SyncEventSchema,
  SyncOp,
  type HlcClock,
  type PushResult,
  type StatusResponse,
  type SyncEvent,
  type UserFacetField,
  userFacetKey,
} from '@figurecollecting/fc-api-contract';
import { openLocalDb, type LocalDb } from '../../storage/localDb';
import { UserStore, type UserStoreOptions } from '../../storage/userStore';

export const DEVICE = '0f3a5c7e9b1d2f4a6c8e0b2d4f6a8c0e';
export const OTHER_DEVICE = '9c1e3a5b7d9f1b3d5f7a9c1e3b5d7f9a';
export const SERVER_DEVICE = '00000000000000000000000000000000';

export const HEAD = [
  '1b4e28ba-2fa1-11d2-883f-0016d3cca427',
  '6fa459ea-ee8a-3ca4-894e-db77e160355e',
  '886313e1-3b8a-5372-9b90-0c9aee199e5d',
] as const;

/** 2026-09-26T12:00:00Z. */
export const T0 = Date.UTC(2026, 8, 26, 12, 0, 0);
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export class FakeClock implements HlcClock {
  wall: number;
  mono: number;

  constructor(wall = T0, mono = 1_000) {
    this.wall = wall;
    this.mono = mono;
  }

  wallMs(): number {
    return this.wall;
  }

  monoMs(): number {
    return this.mono;
  }

  /** Real time passes: both clocks move. */
  advance(ms: number): void {
    this.wall += ms;
    this.mono += ms;
  }
}

/** Canonical instant for epoch ms plus extra micros. */
export function iso(ms: number, extraMicros = 0): string {
  const base = new Date(ms).toISOString().slice(0, 23);
  return `${base}${String(extraMicros).padStart(3, '0')}Z`;
}

export function token(ms: number, counter: number, device: string = DEVICE): string {
  return `${iso(ms)}#${String(counter).padStart(10, '0')}#${device}`;
}

export function key(head: number, field: UserFacetField): string {
  return userFacetKey(HEAD[head], field);
}

export function ev(facetKey: string, version: string, op: 'upsert' | 'delete' = 'upsert', payload?: string): SyncEvent {
  return create(SyncEventSchema, {
    facetKey,
    version,
    op: op === 'upsert' ? SyncOp.UPSERT : SyncOp.DELETE,
    payload: op === 'upsert' ? (payload ?? JSON.stringify({ v: version })) : '',
  });
}

export function status(serverMs: number, cursor = 'head'): StatusResponse {
  return create(StatusResponseSchema, { cursor, serverNowIso: iso(serverMs), pendingReview: 0n });
}

export function result(
  facetKey: string,
  outcome: PushOutcome,
  current?: SyncEvent,
  reason = '',
): PushResult {
  return create(PushResultSchema, {
    facetKey,
    outcome,
    current,
    version: current?.version ?? '',
    reason,
  });
}

/** The server applied every event of the request as sent. */
export function appliedAll(events: SyncEvent[]): { results: PushResult[] } {
  return { results: events.map((e) => result(e.facetKey, PushOutcome.APPLIED, e)) };
}

export async function freshDb(factory: IDBFactory = new IDBFactory()): Promise<{ factory: IDBFactory; db: LocalDb }> {
  return { factory, db: await openLocalDb({ factory }) };
}

let clientSeq = 0;

export function openStore(db: LocalDb, opts: Partial<UserStoreOptions> = {}): Promise<UserStore> {
  return UserStore.open(db, {
    sub: 'user-a',
    deviceId: DEVICE,
    clock: new FakeClock(),
    timeZone: () => 'America/Chicago',
    newClientId: () => `batch-${++clientSeq}`,
    ...opts,
  });
}

export { PushOutcome, SyncOp };

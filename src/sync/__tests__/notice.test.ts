// The client-only 'replaced by another device' notice (GR 2026-09-26 D11): shown when a value this
// device wrote is replaced by a different value another device wrote. It needs no wire change.
import { describe, expect, it } from 'vitest';
import { normaliseDeviceId } from '@figurecollecting/fc-api-contract';
import type { UserStore } from '../../storage/userStore';
import { replacedMine } from '../facetMerge';
import {
  DEVICE,
  OTHER_DEVICE,
  PushOutcome,
  SERVER_DEVICE,
  T0,
  appliedAll,
  ev,
  freshDb,
  key,
  openStore,
  result,
  status,
  token,
  write,
} from './harness';
import { STAMP } from './viewFixtures';

const NOTE = key(0, 'note');
const note = (text: string, stamp: Record<string, string> = STAMP) => JSON.stringify({ note: text, ...stamp });

/** A store whose note 'mine' the server has applied. */
async function landed(text = 'mine') {
  const { db } = await freshDb();
  const store = await openStore(db);
  const edit = await write(store, 0, 'note', text);
  await store.onStatus(status(T0), 0);
  const next = await store.nextBatch();
  if (next.kind !== 'send') throw new Error('expected a batch');
  await store.recordPush(next.batch.clientId, appliedAll(next.batch.request.events));
  return { store, edit };
}

const notice = async (store: UserStore) => (await store.getFacet(NOTE))!.overwritten;

describe("'replaced by another device'", () => {
  it('shows when a Delta event from another device replaces a value this device wrote, even though this device synced first', async () => {
    const { store, edit } = await landed();
    await store.apply([ev(NOTE, token(T0 + 5_000, 0, OTHER_DEVICE), 'upsert', note('theirs'))]);
    const n = await notice(store);
    expect(n!.version).toBe(edit.version);
    expect(JSON.parse(n!.payload).note).toBe('mine');
    expect(JSON.parse((await store.getFacet(NOTE))!.value!.payload).note).toBe('theirs');
  });

  it('shows when another device tombstones it', async () => {
    const { store } = await landed();
    await store.apply([ev(NOTE, token(T0 + 5_000, 0, OTHER_DEVICE), 'delete')]);
    expect(await notice(store)).not.toBeNull();
  });

  it('does not show when another device tombstones what this device had tombstoned', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    await write(store, 0, 'note', null);
    await store.onStatus(status(T0), 0);
    const next = await store.nextBatch();
    if (next.kind !== 'send') throw new Error('expected a batch');
    await store.recordPush(next.batch.clientId, appliedAll(next.batch.request.events));
    await store.apply([ev(NOTE, token(T0 + 5_000, 0, OTHER_DEVICE), 'delete')]);
    expect(await notice(store)).toBeNull();
  });

  it('does not show when the other device wrote the same value at another time or zone', async () => {
    const { store } = await landed();
    await store.apply([ev(NOTE, token(T0 + 5_000, 0, OTHER_DEVICE), 'upsert', note('mine', { edited_at: '2026-09-27T01:00:00.000+09:00', tz: 'Asia/Tokyo' }))]);
    expect(await notice(store)).toBeNull();
  });

  it('does not show for the import, which writes as the server device and lists its own changes', async () => {
    const { store } = await landed();
    await store.apply([ev(NOTE, token(T0 + 5_000, 0, SERVER_DEVICE), 'upsert', note('from MFC'))]);
    expect(await notice(store)).toBeNull();
  });

  it("does not show when the replaced value was another device's", async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    await store.apply([ev(NOTE, token(T0, 0, OTHER_DEVICE), 'upsert', note('first'))]);
    await store.apply([ev(NOTE, token(T0 + 1_000, 1, OTHER_DEVICE), 'upsert', note('second'))]);
    expect(await notice(store)).toBeNull();
  });

  it('does not show while the edit is unanswered; shows once the server answers STALE with the other value', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    await write(store, 0, 'note', 'mine');
    const theirs = ev(NOTE, token(T0 + 5_000, 0, OTHER_DEVICE), 'upsert', note('theirs'));
    await store.apply([theirs]);
    expect(await notice(store)).toBeNull();

    await store.onStatus(status(T0), 0);
    const next = await store.nextBatch();
    if (next.kind !== 'send') throw new Error('expected a batch');
    await store.recordPush(next.batch.clientId, { results: [result(NOTE, PushOutcome.STALE, theirs)] });

    expect(JSON.parse((await notice(store))!.payload).note).toBe('mine');
  });

  it('does not show for a REVIEW answer, which holds the edit for review rather than losing it to a device', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    await write(store, 0, 'note', 'mine');
    await store.onStatus(status(T0), 0);
    const next = await store.nextBatch();
    if (next.kind !== 'send') throw new Error('expected a batch');
    const kept = ev(NOTE, token(T0 - 60_000, 0, OTHER_DEVICE), 'upsert', note('kept'));
    await store.recordPush(next.batch.clientId, { results: [result(NOTE, PushOutcome.REVIEW, kept)] });
    expect(await notice(store)).toBeNull();
  });

  it('stays until seen when a third device replaces the other device\'s value', async () => {
    const { store } = await landed();
    await store.apply([ev(NOTE, token(T0 + 5_000, 0, OTHER_DEVICE), 'upsert', note('theirs'))]);
    await store.apply([ev(NOTE, token(T0 + 9_000, 0, 'abcdefabcdefabcdefabcdefabcdefab'), 'upsert', note('third'))]);
    expect(JSON.parse((await notice(store))!.payload).note).toBe('mine');
  });

  it('is cleared by a new local edit and by dismissing it', async () => {
    const { store } = await landed();
    await store.apply([ev(NOTE, token(T0 + 5_000, 0, OTHER_DEVICE), 'upsert', note('theirs'))]);
    await write(store, 0, 'note', 'again');
    expect(await notice(store)).toBeNull();

    const second = await landed();
    await second.store.apply([ev(NOTE, token(T0 + 5_000, 0, OTHER_DEVICE), 'upsert', note('theirs'))]);
    await second.store.dismissReplaced(NOTE);
    expect(await notice(second.store)).toBeNull();
    await second.store.dismissReplaced(key(1, 'note'));
    expect(await second.store.getFacet(key(1, 'note'))).toBeUndefined();
  });

  it('compares an unreadable payload as text', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    await store.apply([ev(NOTE, token(T0, 0, OTHER_DEVICE), 'upsert', '{bad')]);
    await store.apply([ev(NOTE, token(T0 + 1, 0, OTHER_DEVICE), 'upsert', '{bad')]);
    expect(await notice(store)).toBeNull();
    const { store: mine } = await landed();
    await mine.apply([ev(NOTE, token(T0 + 5_000, 0, OTHER_DEVICE), 'upsert', '{bad')]);
    expect(await notice(mine)).not.toBeNull();
  });
});

describe("'replaced by another device' compares content, not its key order", () => {
  const mine = (fields: Record<string, unknown>) => ({ version: token(T0, 0), op: 'upsert' as const, payload: JSON.stringify({ ...fields, ...STAMP }) });
  const theirs = (fields: Record<string, unknown>) => ({ version: token(T0 + 5_000, 0, OTHER_DEVICE), op: 'upsert' as const, payload: JSON.stringify(fields) });
  const replaced = (a: Record<string, unknown>, b: Record<string, unknown>) => replacedMine(mine(a), theirs(b), normaliseDeviceId(DEVICE));

  it('does not show when another device wrote the same fields in another order, at any depth', () => {
    expect(replaced({ reason: 'sold', on: '2026-09-01', note: null }, { note: null, on: '2026-09-01', reason: 'sold', ...STAMP })).toBeNull();
    const answer = { item: 'figure', rev: '1', choice: 'per_copy', copies: [{ occ_id: 'a', keep: true }] };
    expect(replaced(answer, { copies: [{ keep: true, occ_id: 'a' }], choice: 'per_copy', rev: '1', item: 'figure' })).toBeNull();
  });

  it('still shows when the content differs, the order of an array included', () => {
    expect(replaced({ reason: 'sold', on: '2026-09-01' }, { on: '2026-09-02', reason: 'sold' })).not.toBeNull();
    expect(replaced({ copies: ['a', 'b'] }, { copies: ['b', 'a'] })).not.toBeNull();
    expect(replaced({ copies: ['a'] }, { copies: { 0: 'a' } })).not.toBeNull();
  });
});

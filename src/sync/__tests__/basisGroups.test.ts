// 0.3.0: every pushed event carries the basis it was minted on (sync.proto SyncEvent.basis), and the
// writes of one intent travel in one Push batch (rule 6: a kind change writes its filing in the same batch).
import { describe, expect, it } from 'vitest';
import type { UserStore } from '../../storage/userStore';
import { HEAD, OTHER_DEVICE, PushOutcome, T0, ev, freshDb, key, openStore, result, status, token, write } from './harness';

async function send(store: UserStore, max = 100) {
  const next = await store.nextBatch(max);
  if (next.kind !== 'send') throw new Error(`expected a batch, got ${next.kind}`);
  return next.batch;
}

describe('basis', () => {
  it('mints each edit with the cursor of the last transaction applied, or "" when none, and sends it', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    const first = await write(store, 0, 'note', 'before any pull');
    await store.apply([ev(key(1, 'note'), token(T0, 0, OTHER_DEVICE))], { cursor: 'c-7' });
    const second = await write(store, 1, 'note', 'after c-7');

    const entries = await store.listOutbox();
    expect(entries.map((e) => [e.id, e.basis])).toEqual([
      [first.outbox_id, ''],
      [second.outbox_id, 'c-7'],
    ]);
    await store.onStatus(status(T0), 0);
    const batch = await send(store);
    expect(batch.request.events.map((e) => e.basis)).toEqual(['', 'c-7']);
  });

  it('never changes the basis when the edit is re-minted, whatever is pulled since', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    await store.apply([], { cursor: 'c-1' });
    await store.onStatus(status(T0), 0);
    await write(store, 0, 'score', 7);
    const batch = await send(store);
    await store.apply([], { cursor: 'c-9' });
    await store.recordPush(batch.clientId, { results: [result(key(0, 'score'), PushOutcome.REJECTED, undefined, 'version_future')] });
    await store.onStatus(status(T0), 0);

    const [rejected, reminted] = await store.listOutbox();
    expect(rejected.remint).toBe('done');
    expect(reminted).toMatchObject({ state: 'PENDING', basis: 'c-1' });
  });
});

describe('groups', () => {
  it('never splits the writes of one intent across two batches', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    await write(store, 0, 'note', 'one');
    await write(store, 1, 'note', 'two');
    const occ = await store.createCopy(HEAD[2], 'owned');
    await write(store, 2, 'note', 'three');
    await store.onStatus(status(T0), 0);

    const first = await send(store, 3);
    expect(first.request.events.map((e) => e.facetKey)).toEqual([key(0, 'note'), key(1, 'note')]);
    await store.recordPush(first.clientId, { results: first.request.events.map((e) => result(e.facetKey, PushOutcome.APPLIED, e)) });
    const second = await send(store, 3);
    expect(second.request.events.map((e) => e.facetKey)).toEqual([`occ/${occ}/head`, `occ/${occ}/status`, key(2, 'note')]);
  });

  it('sends a group larger than the limit whole, alone', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    const cid = await store.createCollection('owned', 'Shelf');
    await store.onStatus(status(T0), 0);
    const named = await send(store, 1);
    await store.recordPush(named.clientId, { results: named.request.events.map((e) => result(e.facetKey, PushOutcome.APPLIED, e)) });
    const occ = await store.createCopy(HEAD[0], 'owned', { collection: `owned/${cid}` });
    await write(store, 1, 'note', 'later');

    const batch = await send(store, 2);
    expect(batch.request.events.map((e) => e.facetKey)).toEqual([`occ/${occ}/head`, `occ/${occ}/status`, `occ/${occ}/collection`]);
  });
});

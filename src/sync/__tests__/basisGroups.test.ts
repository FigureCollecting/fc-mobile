// 0.3.0: every pushed event carries the basis it was minted on (sync.proto SyncEvent.basis), and the
// writes of one intent travel in one Push batch (rule 6: a kind change writes its filing in the same batch).
import { describe, expect, it } from 'vitest';
import { occFacetKey } from '@figurecollecting/fc-api-contract';
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

  it('re-mints a REJECTED group as one group of its own and never splits it', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    await store.onStatus(status(T0), 0);
    const occs = [await store.createCopy(HEAD[0], 'owned'), await store.createCopy(HEAD[1], 'owned')];
    const made = await send(store);
    await store.recordPush(made.clientId, { results: made.request.events.map((e) => result(e.facetKey, PushOutcome.APPLIED, e)) });
    for (const occ of occs) await store.setStatus(occ, 'wished');
    const kinds = await send(store);
    // Each status answers with the owned value it keeps; no filing was ever written.
    const results = await Promise.all(
      kinds.request.events.map(async (e) => {
        const known = (await store.getFacet(e.facetKey))!.known;
        return result(e.facetKey, PushOutcome.REJECTED, known ? ev(e.facetKey, known.version, 'upsert', known.payload) : undefined, 'version_future');
      }),
    );
    await store.recordPush(kinds.clientId, { results });
    await write(store, 2, 'note', 'unrelated');
    expect((await store.onStatus(status(T0), 0)).reminted).toBe(4);

    const queued = (await store.listOutbox()).filter((e) => e.state === 'PENDING');
    const [note, s0, c0, s1, c1] = queued;
    expect(queued.map((e) => e.facet_key)).toEqual([
      key(2, 'note'),
      occFacetKey(occs[0], 'status'),
      occFacetKey(occs[0], 'collection'),
      occFacetKey(occs[1], 'status'),
      occFacetKey(occs[1], 'collection'),
    ]);
    expect([s0.group, c0.group, s1.group, c1.group]).toEqual([s0.id, s0.id, s1.id, s1.id]);
    expect(note.group).toBe(note.id);

    const batches: string[][] = [];
    for (let next = await store.nextBatch(3); next.kind === 'send'; next = await store.nextBatch(3)) {
      batches.push(next.batch.request.events.map((e) => e.facetKey));
      await store.recordPush(next.batch.clientId, { results: next.batch.request.events.map((e) => result(e.facetKey, PushOutcome.APPLIED, e)) });
    }
    expect(batches).toEqual([[note.facet_key], [s0.facet_key, c0.facet_key], [s1.facet_key, c1.facet_key]]);
  });
});

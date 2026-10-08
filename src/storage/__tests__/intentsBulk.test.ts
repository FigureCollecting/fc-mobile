// The collection screen's copy actions (GR 2026-09-26): bulk 'Move N copies to…', 'Mark
// sold/traded/gifted/…' and Dedupe. Each is ONE intent: one transaction, one outbox group, so one
// Push batch carries it whole.
import { describe, expect, it } from 'vitest';
import { occFacetKey } from '@figurecollecting/fc-api-contract';
import type { UserStore } from '../userStore';
import { shownCopies } from '../../sync/occurrences';
import { HEAD, freshDb, openStore } from '../../sync/__tests__/harness';

function ids(prefix: string) {
  let i = 0;
  return () => `${prefix}${String(++i).padStart(7, '0')}-0000-4000-8000-000000000000`;
}

async function fresh() {
  const { db } = await freshDb();
  return openStore(db, { newId: ids('a') });
}

const payloadOf = async (store: UserStore, key: string) => {
  const rec = await store.getFacet(key);
  return rec?.value?.op === 'upsert' ? (JSON.parse(rec.value.payload) as Record<string, unknown>) : null;
};

/** Outbox keys of the newest group, in minting order. */
async function lastGroup(store: UserStore): Promise<string[]> {
  const entries = await store.listOutbox();
  const group = entries.at(-1)!.group;
  return entries.filter((e) => e.group === group).map((e) => e.facet_key);
}

describe('moveCopies: bulk Move N copies to a collection', () => {
  it('moves copies of another kind with status and filing, and copies of the kind with the filing alone, in one group', async () => {
    const store = await fresh();
    const w1 = await store.createCopy(HEAD[0], 'wished');
    const w2 = await store.createCopy(HEAD[1], 'wished');
    const cid = await store.createCollection('ordered', 'Preorders');
    const o1 = await store.createCopy(HEAD[2], 'ordered');
    await store.moveCopies([w1, w2, o1], `ordered/${cid}`);
    expect(await lastGroup(store)).toEqual([
      occFacetKey(w1, 'status'),
      occFacetKey(w1, 'collection'),
      occFacetKey(w2, 'status'),
      occFacetKey(w2, 'collection'),
      occFacetKey(o1, 'collection'),
    ]);
    const view = await store.getView();
    expect(shownCopies(view).map((c) => [c.occ_id, c.status, c.shown_in])).toEqual([
      [w1, 'ordered', `ordered/${cid}`],
      [w2, 'ordered', `ordered/${cid}`],
      [o1, 'ordered', `ordered/${cid}`],
    ]);
  });

  it('moves to another tab: the default collection of a kind', async () => {
    const store = await fresh();
    const w1 = await store.createCopy(HEAD[0], 'wished');
    await store.moveCopies([w1], 'owned/default');
    expect(await payloadOf(store, occFacetKey(w1, 'status'))).toMatchObject({ status: 'owned' });
    expect(await payloadOf(store, occFacetKey(w1, 'collection'))).toMatchObject({ collection: 'owned/default' });
  });

  it('refuses a collection that does not exist, and a copy that is not shown, writing nothing', async () => {
    const store = await fresh();
    const w1 = await store.createCopy(HEAD[0], 'wished');
    const before = (await store.listOutbox()).length;
    await expect(store.moveCopies([w1], 'owned/0a0a0a0a-0000-4000-8000-000000000000')).rejects.toMatchObject({ code: 'no_collection' });
    await store.removeCopy({ occ_id: w1 });
    const after = (await store.listOutbox()).length;
    await expect(store.moveCopies([w1], 'owned/default')).rejects.toMatchObject({ code: 'no_copy' });
    expect((await store.listOutbox()).length).toBe(after);
    expect(after).toBe(before + 1);
  });
});

describe('markFormer: no longer owned, with its disposal, in one batch', () => {
  it('writes status former, its filing and the disposal for each copy, in one group', async () => {
    const store = await fresh();
    const o1 = await store.createCopy(HEAD[0], 'owned');
    const o2 = await store.createCopy(HEAD[0], 'owned');
    const disposal = { reason: 'sold' as const, on: '2026-10-01', note: 'to a friend', counterparty: 'Kai', price: { amount: '120.50', currency: 'USD' } };
    await store.markFormer([o1, o2], disposal);
    expect(await lastGroup(store)).toEqual([
      occFacetKey(o1, 'status'),
      occFacetKey(o1, 'collection'),
      occFacetKey(o1, 'disposal'),
      occFacetKey(o2, 'status'),
      occFacetKey(o2, 'collection'),
      occFacetKey(o2, 'disposal'),
    ]);
    const view = await store.getView();
    expect(view.copies.map((c) => [c.status, c.shown_in, c.disposal?.['reason'], c.disposal?.['counterparty']])).toEqual([
      ['former', 'former/default', 'sold', 'Kai'],
      ['former', 'former/default', 'sold', 'Kai'],
    ]);
    expect(await payloadOf(store, occFacetKey(o1, 'disposal'))).toMatchObject({ ...disposal, tz: 'America/Chicago' });
  });

  it('takes a reason alone', async () => {
    const store = await fresh();
    const o1 = await store.createCopy(HEAD[0], 'owned');
    await store.markFormer([o1], { reason: 'gifted' });
    expect((await store.getView()).copies[0]!.disposal).toMatchObject({ reason: 'gifted' });
  });

  it('refuses a disposal the schema refuses, and a copy already gone, writing nothing', async () => {
    const store = await fresh();
    const o1 = await store.createCopy(HEAD[0], 'owned');
    const before = (await store.listOutbox()).length;
    await expect(store.markFormer([o1], { reason: 'sold', note: '' })).rejects.toThrow(/disposal/);
    await expect(store.markFormer(['0a0a0a0a-0000-4000-8000-000000000000'], { reason: 'sold' })).rejects.toMatchObject({ code: 'no_copy' });
    expect((await store.listOutbox()).length).toBe(before);
  });
});

describe('moveCopies: a collection that does not exist', () => {
  it('refuses it for copies of its kind as for any other, writing nothing', async () => {
    const store = await fresh();
    const o1 = await store.createCopy(HEAD[0], 'owned');
    const before = (await store.listOutbox()).length;
    await expect(store.moveCopies([o1], 'owned/0c0c0c0c-0000-4000-8000-000000000000')).rejects.toMatchObject({ code: 'no_collection' });
    expect((await store.listOutbox()).length).toBe(before);
    expect(shownCopies(await store.getView())[0]!.shown_in).toBe('owned/default');
  });
});

describe('dedupe: keep the lowest of N identical copies', () => {
  it('tombstones every shown copy of the figure and kind but the lowest, in one group, and returns them', async () => {
    const store = await fresh();
    const [o1, o2, o3] = [await store.createCopy(HEAD[0], 'owned'), await store.createCopy(HEAD[0], 'owned'), await store.createCopy(HEAD[0], 'owned')];
    const w1 = await store.createCopy(HEAD[0], 'wished');
    expect(await store.dedupe([HEAD[0]], 'owned')).toEqual([o2, o3]);
    expect(await lastGroup(store)).toEqual([occFacetKey(o2, 'status'), occFacetKey(o3, 'status')]);
    expect(shownCopies(await store.getView()).map((c) => c.occ_id)).toEqual([o1, w1]);
  });

  it("keeps one copy across every head of the figure (an ER merge's requested_as), not the display head's alone", async () => {
    const store = await fresh();
    const [o1, o2] = [await store.createCopy(HEAD[0], 'owned'), await store.createCopy(HEAD[0], 'owned')];
    const o3 = await store.createCopy(HEAD[1], 'owned');
    const other = await store.createCopy(HEAD[2], 'owned');
    expect(await store.dedupe([HEAD[1], HEAD[0]], 'owned')).toEqual([o2, o3]);
    expect(shownCopies(await store.getView()).map((c) => c.occ_id)).toEqual([o1, other]);
  });

  it('writes nothing when there is one copy or none', async () => {
    const store = await fresh();
    await store.createCopy(HEAD[0], 'owned');
    const before = (await store.listOutbox()).length;
    expect(await store.dedupe([HEAD[0]], 'owned')).toEqual([]);
    expect(await store.dedupe([HEAD[1]], 'owned')).toEqual([]);
    expect((await store.listOutbox()).length).toBe(before);
  });
});

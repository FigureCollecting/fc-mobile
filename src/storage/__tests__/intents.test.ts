import { describe, expect, it } from 'vitest';
import { collNameKey, occFacetKey, occTagKey, tagNameKey, ufKindTagKey, ufTagKey } from '@figurecollecting/fc-api-contract';
import { IntentError, type UserStore } from '../userStore';
import { effectiveTags, inLibrary, shownCopies } from '../../sync/occurrences';
import { HEAD, OTHER_DEVICE, PushOutcome, T0, ev, freshDb, openStore, result, status, token } from '../../sync/__tests__/harness';
import { STAMP } from '../../sync/__tests__/viewFixtures';

// Device-minted ids in a known order, so the picks are checkable.
function ids(prefix: string) {
  let i = 0;
  return () => `${prefix}${String(++i).padStart(7, '0')}-0000-4000-8000-000000000000`;
}

async function fresh(newId = ids('a')) {
  const { db } = await freshDb();
  const store = await openStore(db, { newId });
  return { db, store };
}

const payloadOf = async (store: UserStore, key: string) => {
  const rec = await store.getFacet(key);
  return rec?.value?.op === 'upsert' ? (JSON.parse(rec.value.payload) as Record<string, unknown>) : null;
};

describe('create and remove a copy', () => {
  it('creates a copy with its head written with its first status, in one group', async () => {
    const { store } = await fresh();
    const occ = await store.createCopy(HEAD[0], 'wished');
    expect(occ).toBe('a0000001-0000-4000-8000-000000000000');
    const entries = await store.listOutbox();
    expect(entries.map((e) => e.facet_key)).toEqual([occFacetKey(occ, 'head'), occFacetKey(occ, 'status')]);
    expect(new Set(entries.map((e) => e.group))).toEqual(new Set([entries[0].id]));
    expect(await payloadOf(store, occFacetKey(occ, 'head'))).toMatchObject({ head_id: HEAD[0], tz: 'America/Chicago' });
    expect(await payloadOf(store, occFacetKey(occ, 'status'))).toMatchObject({ status: 'wished' });
    const view = await store.getView();
    expect(shownCopies(view).map((c) => [c.occ_id, c.head_id, c.shown_in])).toEqual([[occ, HEAD[0], 'wished/default']]);
    expect((await store.getFacet(occFacetKey(occ, 'head')))!.head_id).toBe(HEAD[0]);
  });

  it('files a new copy into a collection of its kind', async () => {
    const { store } = await fresh();
    const cid = await store.createCollection('owned', 'Shelf 2');
    const occ = await store.createCopy(HEAD[0], 'owned', { collection: `owned/${cid}` });
    expect((await store.getView()).copies[0]).toMatchObject({ occ_id: occ, shown_in: `owned/${cid}` });
    expect(await payloadOf(store, collNameKey('owned', cid))).toMatchObject({ name: 'Shelf 2' });
  });

  it('refuses to file a new copy into a collection of another kind or one that does not exist, writing nothing', async () => {
    const { store } = await fresh();
    const cid = await store.createCollection('ordered', 'Preorders');
    await expect(store.createCopy(HEAD[0], 'owned', { collection: `ordered/${cid}` })).rejects.toMatchObject({ code: 'kind_mismatch' });
    await expect(store.createCopy(HEAD[0], 'owned', { collection: `owned/${cid}` })).rejects.toMatchObject({ code: 'no_collection' });
    await expect(store.createCopy(HEAD[0], 'owned', { collection: 'owned' })).rejects.toBeInstanceOf(IntentError);
    expect((await store.listOutbox()).map((e) => e.facet_key)).toEqual([collNameKey('ordered', cid)]);
  });

  it('removes the highest of N identical copies by tombstoning its status, keeping its head and filing', async () => {
    const { store } = await fresh();
    const [o1, o2, o3] = [await store.createCopy(HEAD[0], 'owned'), await store.createCopy(HEAD[0], 'owned'), await store.createCopy(HEAD[0], 'owned')];
    await store.moveCopy(o3, 'owned/default');
    const removed = await store.removeCopy({ head_id: HEAD[0], kind: 'owned' });
    expect(removed).toBe(o3);
    const rec = await store.getFacet(occFacetKey(o3, 'status'));
    expect(rec!.value).toMatchObject({ op: 'delete', payload: '' });
    expect(await payloadOf(store, occFacetKey(o3, 'head'))).toMatchObject({ head_id: HEAD[0] });
    expect(await payloadOf(store, occFacetKey(o3, 'collection'))).toMatchObject({ collection: 'owned/default' });
    expect(shownCopies(await store.getView()).map((c) => c.occ_id)).toEqual([o1, o2]);
  });

  it('removes a named copy, and returns nothing when there is none to remove', async () => {
    const { store } = await fresh();
    const o1 = await store.createCopy(HEAD[0], 'owned');
    expect(await store.removeCopy({ occ_id: o1 })).toBe(o1);
    expect(await store.removeCopy({ occ_id: o1 })).toBeUndefined();
    expect(await store.removeCopy({ head_id: HEAD[1], kind: 'owned' })).toBeUndefined();
  });

  it('undo of a removal re-upserts the status alone and restores the copy whole', async () => {
    const { store } = await fresh();
    const cid = await store.createCollection('owned', 'Shelf');
    const occ = await store.createCopy(HEAD[0], 'owned', { collection: `owned/${cid}` });
    await store.removeCopy({ occ_id: occ });
    const before = (await store.listOutbox()).length;
    await store.setStatus(occ, 'owned');
    const added = (await store.listOutbox()).slice(before).map((e) => e.facet_key);
    expect(added).toEqual([occFacetKey(occ, 'status')]);
    expect((await store.getView()).copies[0]).toMatchObject({ status: 'owned', shown_in: `owned/${cid}` });
  });
});

describe('mark arrived: status and filing in one group', () => {
  it('receives the lowest ordered copy, writing owned and owned/default together', async () => {
    const { store } = await fresh();
    const cid = await store.createCollection('ordered', 'Preorders');
    const o1 = await store.createCopy(HEAD[0], 'ordered', { collection: `ordered/${cid}` });
    const o2 = await store.createCopy(HEAD[0], 'ordered');
    const before = (await store.listOutbox()).length;

    expect(await store.markArrived({ head_id: HEAD[0] })).toBe(o1);

    const added = (await store.listOutbox()).slice(before);
    expect(added.map((e) => e.facet_key)).toEqual([occFacetKey(o1, 'status'), occFacetKey(o1, 'collection')]);
    expect(new Set(added.map((e) => e.group)).size).toBe(1);
    expect(await payloadOf(store, occFacetKey(o1, 'status'))).toMatchObject({ status: 'owned' });
    expect(await payloadOf(store, occFacetKey(o1, 'collection'))).toMatchObject({ collection: 'owned/default' });
    const view = await store.getView();
    expect(shownCopies(view, { head_id: HEAD[0] }).map((c) => [c.occ_id, c.shown_in, c.flag])).toEqual([
      [o1, 'owned/default', null],
      [o2, 'ordered/default', null],
    ]);
  });

  it('receives into a chosen owned collection, and only among the copies shown where asked', async () => {
    const { store } = await fresh();
    const pre = await store.createCollection('ordered', 'Preorders');
    const shelf = await store.createCollection('owned', 'Shelf');
    await store.createCopy(HEAD[0], 'ordered', { collection: `ordered/${pre}` });
    const o2 = await store.createCopy(HEAD[0], 'ordered');
    expect(await store.markArrived({ head_id: HEAD[0], shown_in: 'ordered/default' }, { collection: `owned/${shelf}` })).toBe(o2);
    expect(await payloadOf(store, occFacetKey(o2, 'collection'))).toMatchObject({ collection: `owned/${shelf}` });
  });

  it('restores a removed copy that was never filed into its default, with a filing write', async () => {
    const { store } = await fresh();
    const occ = await store.createCopy(HEAD[0], 'wished');
    await store.removeCopy({ occ_id: occ });
    const before = (await store.listOutbox()).length;
    await store.setStatus(occ, 'wished');
    expect((await store.listOutbox()).slice(before).map((e) => e.facet_key)).toEqual([occFacetKey(occ, 'status'), occFacetKey(occ, 'collection')]);
    expect((await store.getView()).copies[0]).toMatchObject({ shown_in: 'wished/default', flag: null });
  });

  it('refuses to mark arrived a copy it does not show', async () => {
    const { store } = await fresh();
    await expect(store.markArrived({ occ_id: 'b0000000-0000-4000-8000-000000000000' })).rejects.toMatchObject({ code: 'no_copy' });
  });

  it('marks a named ordered copy arrived, refuses one that is not ordered, and returns nothing with none ordered', async () => {
    const { store } = await fresh();
    const o1 = await store.createCopy(HEAD[0], 'ordered');
    const o2 = await store.createCopy(HEAD[0], 'wished');
    expect(await store.markArrived({ occ_id: o1 })).toBe(o1);
    await expect(store.markArrived({ occ_id: o2 })).rejects.toMatchObject({ code: 'kind_mismatch' });
    expect(await store.markArrived({ head_id: HEAD[0] })).toBeUndefined();
  });

  it('a stale re-file from another device never reverts the arrival (O3-H)', async () => {
    const { store } = await fresh();
    const pre = await store.createCollection('ordered', 'Preorders');
    const occ = await store.createCopy(HEAD[0], 'ordered');
    await store.markArrived({ occ_id: occ });
    // The other device, still seeing the copy ordered, re-files it later in real time and syncs first.
    const filing = occFacetKey(occ, 'collection');
    const refile = ev(filing, token(T0 + 60_000, 0, OTHER_DEVICE), 'upsert', JSON.stringify({ collection: `ordered/${pre}`, ...STAMP }));
    await store.apply([refile]);
    expect((await store.getView()).copies[0]).toMatchObject({ status: 'owned', shown_in: 'owned/default', flag: null });

    await store.onStatus(status(T0), 0);
    const next = await store.nextBatch();
    if (next.kind !== 'send') throw new Error('expected a batch');
    const results = next.batch.request.events.map((e) =>
      e.facetKey === filing ? result(filing, PushOutcome.STALE, refile) : result(e.facetKey, PushOutcome.APPLIED, e),
    );
    await store.recordPush(next.batch.clientId, { results });

    expect((await store.getView()).copies[0]).toMatchObject({ status: 'owned', shown_in: 'owned/default', flag: 'other_kind' });
  });

  it('writes the filing with every kind change and none when the kind stays', async () => {
    const { store } = await fresh();
    const occ = await store.createCopy(HEAD[0], 'owned');
    let before = (await store.listOutbox()).length;
    await store.setStatus(occ, 'owned');
    expect((await store.listOutbox()).slice(before).map((e) => e.facet_key)).toEqual([occFacetKey(occ, 'status')]);
    before = (await store.listOutbox()).length;
    await store.setStatus(occ, 'former');
    expect((await store.listOutbox()).slice(before).map((e) => e.facet_key)).toEqual([occFacetKey(occ, 'status'), occFacetKey(occ, 'collection')]);
    expect(await payloadOf(store, occFacetKey(occ, 'collection'))).toMatchObject({ collection: 'former/default' });
  });

  it('files a status change into the collection asked for, and refuses one of another kind, writing nothing', async () => {
    const { store } = await fresh();
    const occ = await store.createCopy(HEAD[0], 'owned');
    const grails = await store.createCollection('wished', 'Grails');
    await store.setStatus(occ, 'wished', { collection: `wished/${grails}` });
    expect(await payloadOf(store, occFacetKey(occ, 'collection'))).toMatchObject({ collection: `wished/${grails}` });
    expect((await store.getView()).copies[0]).toMatchObject({ status: 'wished', shown_in: `wished/${grails}` });
    const before = (await store.listOutbox()).length;
    await expect(store.setStatus(occ, 'owned', { collection: `wished/${grails}` })).rejects.toMatchObject({ code: 'kind_mismatch' });
    expect((await store.listOutbox()).length).toBe(before);
  });

  it('refuses a status change for a copy it does not know or cannot show', async () => {
    const { store } = await fresh();
    await expect(store.setStatus('b0000000-0000-4000-8000-000000000000', 'owned')).rejects.toMatchObject({ code: 'no_copy' });
    // A status a later release added, on a copy with a head: hidden, so not this client's to change.
    const lent = 'c0000000-0000-4000-8000-000000000000';
    await store.apply([
      ev(occFacetKey(lent, 'head'), token(T0, 0, OTHER_DEVICE), 'upsert', JSON.stringify({ head_id: HEAD[0], ...STAMP })),
      ev(occFacetKey(lent, 'status'), token(T0, 1, OTHER_DEVICE), 'upsert', JSON.stringify({ status: 'lent', ...STAMP })),
    ]);
    await expect(store.setStatus(lent, 'owned')).rejects.toMatchObject({ code: 'no_copy' });
    // A copy known only by a filing, with no head and no status: nothing to give a status to.
    const bare = 'c1000000-0000-4000-8000-000000000000';
    await store.apply([ev(occFacetKey(bare, 'collection'), token(T0, 2, OTHER_DEVICE), 'upsert', JSON.stringify({ collection: 'owned/default', ...STAMP }))]);
    await expect(store.setStatus(bare, 'owned')).rejects.toMatchObject({ code: 'no_copy' });
  });
});

describe('move and re-point', () => {
  it('moves a copy between collections of its kind with one filing write', async () => {
    const { store } = await fresh();
    const a = await store.createCollection('owned', 'A');
    const occ = await store.createCopy(HEAD[0], 'owned', { collection: `owned/${a}` });
    const before = (await store.listOutbox()).length;
    await store.moveCopy(occ, 'owned/default');
    expect((await store.listOutbox()).slice(before).map((e) => e.facet_key)).toEqual([occFacetKey(occ, 'collection')]);
    expect((await store.getView()).copies[0].shown_in).toBe('owned/default');
  });

  it('refuses a move to another kind, to a missing collection or of a copy it does not show', async () => {
    const { store } = await fresh();
    const pre = await store.createCollection('ordered', 'Preorders');
    const occ = await store.createCopy(HEAD[0], 'owned');
    await expect(store.moveCopy(occ, `ordered/${pre}`)).rejects.toMatchObject({ code: 'kind_mismatch' });
    await expect(store.moveCopy(occ, `owned/${pre}`)).rejects.toMatchObject({ code: 'no_collection' });
    await expect(store.moveCopy(occ, 'nowhere')).rejects.toMatchObject({ code: 'no_collection' });
    await store.removeCopy({ occ_id: occ });
    await expect(store.moveCopy(occ, 'owned/default')).rejects.toMatchObject({ code: 'no_copy' });
  });

  it('re-points a copy with one write of its head, and can fix a copy that has none', async () => {
    const { store } = await fresh();
    const occ = await store.createCopy(HEAD[0], 'owned');
    const before = (await store.listOutbox()).length;
    await store.repointCopy(occ, HEAD[1]);
    expect((await store.listOutbox()).slice(before).map((e) => e.facet_key)).toEqual([occFacetKey(occ, 'head')]);
    expect((await store.getView()).copies[0].head_id).toBe(HEAD[1]);

    const headless = 'd0000000-0000-4000-8000-000000000000';
    await store.apply([ev(occFacetKey(headless, 'status'), token(T0, 0, OTHER_DEVICE), 'upsert', JSON.stringify({ status: 'owned', ...STAMP }))]);
    expect((await store.getView()).copies.find((c) => c.occ_id === headless)!.hidden).toBe('no_head');
    await store.repointCopy(headless, HEAD[2]);
    expect((await store.getView()).copies.find((c) => c.occ_id === headless)).toMatchObject({ hidden: null, shown_in: 'owned/default' });
    await expect(store.repointCopy('e0000000-0000-4000-8000-000000000000', HEAD[2])).rejects.toMatchObject({ code: 'no_copy' });
  });
});

describe('an answered re-point that did not land', () => {
  it.each([
    ['REVIEW', PushOutcome.REVIEW],
    ['REJECTED', PushOutcome.REJECTED],
  ] as const)('%s leaves the by_head index on the head the copy reverts to', async (_name, outcome) => {
    const { db, store } = await fresh();
    await store.onStatus(status(T0), 0);
    const occ = await store.createCopy(HEAD[0], 'owned');
    let next = await store.nextBatch();
    if (next.kind !== 'send') throw new Error(next.kind);
    await store.recordPush(next.batch.clientId, { results: next.batch.request.events.map((e) => result(e.facetKey, PushOutcome.APPLIED, e)) });
    await store.repointCopy(occ, HEAD[1]);
    const byHead = async (head: string) =>
      (await db.getAllFromIndex('facets', 'by_head', IDBKeyRange.only(['user-a', head]))).map((r) => r.facet_key);
    expect(await byHead(HEAD[1])).toEqual([occFacetKey(occ, 'head')]);
    next = await store.nextBatch();
    if (next.kind !== 'send') throw new Error(next.kind);
    await store.recordPush(next.batch.clientId, { results: [result(occFacetKey(occ, 'head'), outcome, undefined, 'payload_invalid')] });
    expect(await byHead(HEAD[1])).toEqual([]);
    expect(await byHead(HEAD[0])).toEqual([occFacetKey(occ, 'head')]);
  });
});

describe('tags at three scopes', () => {
  it('tags a copy, a figure and a figure per kind, and untags with a tombstone', async () => {
    const { store } = await fresh();
    const occ = await store.createCopy(HEAD[0], 'ordered');
    const red = await store.createTag('red');
    const grail = await store.createTag('grail');
    const owned = await store.createTag('figure-x-owned');
    await store.tagCopy(occ, red);
    await store.tagFigure(HEAD[0], grail);
    await store.tagFigureKind(HEAD[0], 'owned', owned);
    expect(await payloadOf(store, tagNameKey(red))).toMatchObject({ name: 'red' });
    expect(await payloadOf(store, occTagKey(occ, red))).toEqual(STAMP_KEYS);
    expect(effectiveTags(await store.getView(), occ)).toEqual([red, grail].sort());

    // The kind tag is picked up by a copy that arrives, with no tag write.
    const before = (await store.listOutbox()).length;
    await store.markArrived({ occ_id: occ });
    expect((await store.listOutbox()).slice(before).some((e) => e.facet_key.includes('/tag'))).toBe(false);
    expect(effectiveTags(await store.getView(), occ)).toEqual([red, grail, owned].sort());

    await store.tagCopy(occ, red, false);
    await store.tagFigure(HEAD[0], grail, false);
    await store.tagFigureKind(HEAD[0], 'owned', owned, false);
    expect(effectiveTags(await store.getView(), occ)).toEqual([]);
    expect((await store.getFacet(ufTagKey(HEAD[0], grail)))!.value!.op).toBe('delete');
    expect((await store.getFacet(ufKindTagKey(HEAD[0], 'owned', owned)))!.value!.op).toBe('delete');
  });

  it('refuses to tag with a tag that does not exist, or a copy it does not know', async () => {
    const { store } = await fresh();
    const occ = await store.createCopy(HEAD[0], 'owned');
    const red = await store.createTag('red');
    await expect(store.tagCopy(occ, 'f0000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ code: 'no_tag' });
    await expect(store.tagFigure(HEAD[0], 'f0000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ code: 'no_tag' });
    await expect(store.tagCopy('f1000000-0000-4000-8000-000000000000', red)).rejects.toMatchObject({ code: 'no_copy' });
    // Untagging needs neither: a tombstone for a membership of a deleted tag is still a valid write.
    await store.writeFacet(tagNameKey(red), null);
    await expect(store.tagCopy(occ, red, false)).resolves.toBeUndefined();
  });

  it('keeps a figure in the library by a figure tag alone', async () => {
    const { store } = await fresh();
    const tagId = await store.createTag('someday');
    await store.tagFigure(HEAD[2], tagId);
    expect(inLibrary(await store.getView(), HEAD[2])).toBe(true);
  });
});

describe('deterministic picks converge across devices', () => {
  it('two devices removing one of the same copies offline remove the same one', async () => {
    const seed = await fresh(ids('b'));
    const occs = [await seed.store.createCopy(HEAD[0], 'owned'), await seed.store.createCopy(HEAD[0], 'owned')];
    const events = (await seed.store.listOutbox()).map((e) =>
      ev(e.facet_key, e.edit_version, e.op, e.payload),
    );
    const phone = await fresh(ids('c'));
    const tablet = await fresh(ids('d'));
    await phone.store.apply(events);
    await tablet.store.apply([...events].reverse());
    const a = await phone.store.removeCopy({ head_id: HEAD[0], kind: 'owned' });
    const b = await tablet.store.removeCopy({ head_id: HEAD[0], kind: 'owned' });
    expect(a).toBe(occs[1]);
    expect(b).toBe(a);
    expect(await phone.store.markArrived({ head_id: HEAD[0] })).toBeUndefined();
  });
});

const STAMP_KEYS = { edited_at: expect.any(String), tz: 'America/Chicago' };


// The v2 -> v3 upgrade (WK-06b, contract 0.3.0): a HARD gate for WK-16.
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_DB_NAME, LOCAL_DB_VERSION, openLocalDb } from '../localDb';
import { UserStore } from '../userStore';
import { buildView } from '../../sync/occurrences';

const H0 = '1b4e28ba-2fa1-11d2-883f-0016d3cca427';
const H1 = '6fa459ea-ee8a-3ca4-894e-db77e160355e';
const DEVICE = '0f3a5c7e9b1d2f4a6c8e0b2d4f6a8c0e';
const STAMP = { edited_at: '2026-09-26T12:05:09.042-05:00', tz: 'America/Chicago' };
const v = (n: number) => `2026-09-26T12:00:0${n}.000000Z#0000000000#${DEVICE}`;

// The v2 layout exactly as WK-06 (7f7ba2a) created it.
function createV2(db: IDBDatabase): void {
  const facets = db.createObjectStore('facets', { keyPath: ['sub', 'facet_key'] });
  facets.createIndex('by_head', ['sub', 'head_id']);
  const outbox = db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
  outbox.createIndex('by_sub', ['sub', 'id']);
  outbox.createIndex('by_sub_state', ['sub', 'state', 'id']);
  outbox.createIndex('by_sub_client', ['sub', 'client_id', 'batch_pos']);
  db.createObjectStore('products', { keyPath: ['sub', 'head_id'] });
  db.createObjectStore('sync_meta', { keyPath: 'sub' });
  db.createObjectStore('device_key', { keyPath: 'sub' });
  db.createObjectStore('auth');
  db.createObjectStore('legacy_pending', { autoIncrement: true });
}

const val = (n: number, fields: Record<string, unknown>) => ({ version: v(n), op: 'upsert', payload: JSON.stringify({ ...fields, ...STAMP }) });

// v2 rows: the retired per-figure holding grain beside uf facets that 0.3.0 keeps.
const FACETS = [
  { sub: 'user-a', facet_key: `holding/${H0}/status`, head_id: H0, field: 'status', value: val(1, { status: 'owned' }), known: null, pending_id: 1, overwritten: null },
  { sub: 'user-a', facet_key: `holding/${H0}/count`, head_id: H0, field: 'count', value: val(3, { count: 2 }), known: null, pending_id: 3, overwritten: null },
  { sub: 'user-a', facet_key: `uf/${H0}/note`, head_id: H0, field: 'note', value: val(2, { note: 'boxed' }), known: null, pending_id: 2, overwritten: null },
  { sub: 'user-a', facet_key: `uf/${H1}/score`, head_id: H1, field: 'score', value: val(4, { score: 8 }), known: val(4, { score: 8 }), pending_id: null, overwritten: null },
  { sub: 'user-b', facet_key: `holding/${H1}/status`, head_id: H1, field: 'status', value: val(5, { status: 'wished' }), known: null, pending_id: 7, overwritten: null },
];

const entry = (id: number, sub: string, key: string, state: string, extra: Record<string, unknown> = {}) => ({
  id,
  sub,
  facet_key: key,
  op: 'upsert',
  payload: '{}',
  edit_version: v(id % 10),
  base_version: null,
  state,
  attempts: state === 'PENDING' ? 0 : 1,
  created_at: 1_000 + id,
  ...extra,
});

const OUTBOX = [
  entry(1, 'user-a', `holding/${H0}/status`, 'PENDING'),
  entry(2, 'user-a', `uf/${H0}/note`, 'PENDING'),
  entry(3, 'user-a', `holding/${H0}/count`, 'IN_FLIGHT', { client_id: 'b-1', batch_pos: 0 }),
  entry(4, 'user-a', `uf/${H1}/score`, 'IN_FLIGHT', { client_id: 'b-1', batch_pos: 1 }),
  entry(5, 'user-a', `holding/${H0}/status`, 'APPLIED', { client_id: 'b-0', batch_pos: 0, outcome: 'APPLIED' }),
  entry(6, 'user-a', `uf/${H0}/note`, 'APPLIED', { client_id: 'b-0', batch_pos: 1, outcome: 'APPLIED' }),
  entry(7, 'user-b', `holding/${H1}/status`, 'PENDING'),
];

const OLD_LEGACY = [{ type: 'update', figureId: 'f-2', createdAt: 2 }];
const META = { sub: 'user-a', device_id: DEVICE, cursor: 'c-41', hlc: { micros: '1', counter: 0 }, offset_ms: 0, rejected_past: null };

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function seedV2(factory: IDBFactory): Promise<void> {
  const open = factory.open(LOCAL_DB_NAME, 2);
  open.onupgradeneeded = () => createV2(open.result);
  const db = await req(open);
  const tx = db.transaction(['facets', 'outbox', 'products', 'sync_meta', 'device_key', 'auth', 'legacy_pending'], 'readwrite');
  for (const f of FACETS) tx.objectStore('facets').put(f);
  for (const e of OUTBOX) tx.objectStore('outbox').put(e);
  tx.objectStore('products').put({ sub: 'user-a', head_id: H0, card: { headId: H0 }, as_of: null, fetched_at: 9 });
  tx.objectStore('sync_meta').put(META);
  tx.objectStore('device_key').put({ sub: 'user-a', jwk: 'k' });
  tx.objectStore('auth').put({ sub: 'user-a' }, 'current');
  for (const op of OLD_LEGACY) tx.objectStore('legacy_pending').add(op);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

describe('the seeded v2 store upgrades to v3', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is version 3', () => {
    expect(LOCAL_DB_VERSION).toBe(3);
  });

  it('adds the by_occ and by_tag indexes', async () => {
    const factory = new IDBFactory();
    await seedV2(factory);
    const db = await openLocalDb({ factory });
    expect(db.version).toBe(3);
    const facets = db.transaction('facets').objectStore('facets');
    expect([...facets.indexNames].sort()).toEqual(['by_head', 'by_occ', 'by_tag']);
    expect(facets.index('by_occ').keyPath).toEqual(['sub', 'occ_id']);
    expect(facets.index('by_tag').keyPath).toEqual(['sub', 'tag_id']);
    db.close();
  });

  it('re-parses every facet row: the retired holding rows are kept, inert and unindexed; uf rows keep their head', async () => {
    const factory = new IDBFactory();
    await seedV2(factory);
    const db = await openLocalDb({ factory });
    const rows = await db.getAll('facets');
    expect(rows).toHaveLength(FACETS.length);
    for (const r of rows) expect('field' in r).toBe(false);
    const byKey = new Map(rows.map((r) => [`${r.sub} ${r.facet_key}`, r]));
    const holding = byKey.get(`user-a holding/${H0}/status`)!;
    expect(holding.family).toBeUndefined();
    expect(holding.head_id).toBeUndefined();
    expect(holding.value).toEqual(FACETS[0].value);
    expect(holding.pending_id).toBeNull();
    expect(byKey.get(`user-a uf/${H0}/note`)).toMatchObject({ family: 'uf/note', head_id: H0, pending_id: 2, value: FACETS[2].value });
    expect(byKey.get(`user-a uf/${H1}/score`)).toMatchObject({ family: 'uf/score', head_id: H1, known: FACETS[3].known });
    expect(byKey.get(`user-b holding/${H1}/status`)!.head_id).toBeUndefined();
    const forH0 = await db.getAllFromIndex('facets', 'by_head', IDBKeyRange.only(['user-a', H0]));
    expect(forH0.map((r) => r.facet_key)).toEqual([`uf/${H0}/note`]);
    db.close();
  });

  it('moves every holding/* outbox entry to legacy_pending, whatever its state or user, and never deletes them', async () => {
    const factory = new IDBFactory();
    await seedV2(factory);
    const db = await openLocalDb({ factory });
    const left = await db.getAll('outbox');
    expect(left.map((e) => e.id)).toEqual([2, 4, 6]);
    const legacy = await db.getAll('legacy_pending');
    expect(legacy).toEqual([...OLD_LEGACY, OUTBOX[0], OUTBOX[2], OUTBOX[4], OUTBOX[6]]);
    db.close();
  });

  it('re-queues the rest of a sent batch the move broke, and gives every kept entry an empty basis', async () => {
    const factory = new IDBFactory();
    await seedV2(factory);
    const db = await openLocalDb({ factory });
    const [note, score, applied] = await db.getAll('outbox');
    expect(note).toMatchObject({ state: 'PENDING', basis: '' });
    expect(score).toMatchObject({ state: 'PENDING', basis: '', attempts: 1 });
    expect(score.client_id).toBeUndefined();
    expect(score.batch_pos).toBeUndefined();
    expect(applied).toMatchObject({ state: 'APPLIED', client_id: 'b-0', basis: '' });
    db.close();
  });

  it('leaves products, sync_meta, device_key and auth as they were', async () => {
    const factory = new IDBFactory();
    await seedV2(factory);
    const db = await openLocalDb({ factory });
    expect(await db.get('sync_meta', 'user-a')).toEqual(META);
    expect(await db.count('products')).toBe(1);
    expect(await db.get('device_key', 'user-a')).toEqual({ sub: 'user-a', jwk: 'k' });
    expect(await db.get('auth', 'current')).toEqual({ sub: 'user-a' });
    db.close();
  });

  it('hands the upgraded store to a user session that shows no holding and pushes only the kept uf edits', async () => {
    const factory = new IDBFactory();
    await seedV2(factory);
    const db = await openLocalDb({ factory });
    const store = await UserStore.open(db, { sub: 'user-a', deviceId: DEVICE, newClientId: () => 'b-2' });
    const view = buildView(await store.listFacets());
    expect(view.copies).toEqual([]);
    expect([...view.library].sort()).toEqual([H0, H1].sort());
    await store.onStatus({ cursor: 'c-41', serverNowIso: '2026-09-26T12:00:09.000000Z', pendingReview: 0n }, 10);
    const next = await store.nextBatch();
    expect(next.kind).toBe('send');
    if (next.kind !== 'send') return;
    expect(next.batch.request.events.map((e) => [e.facetKey, e.basis])).toEqual([
      [`uf/${H0}/note`, ''],
      [`uf/${H1}/score`, ''],
    ]);
    db.close();
  });

  it('leaves the v2 store intact when the upgrade fails', async () => {
    const factory = new IDBFactory();
    await seedV2(factory);
    const realPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'legacy_pending') throw new DOMException('disk full', 'QuotaExceededError');
      return realPut.apply(this, args as Parameters<typeof realPut>);
    });
    await expect(openLocalDb({ factory })).rejects.toThrow();
    vi.restoreAllMocks();

    const db = await req(factory.open(LOCAL_DB_NAME, 2));
    expect(db.version).toBe(2);
    const tx = db.transaction(['facets', 'outbox', 'legacy_pending']);
    expect([...tx.objectStore('facets').indexNames]).toEqual(['by_head']);
    expect(await req(tx.objectStore('outbox').count())).toBe(OUTBOX.length);
    expect(await req(tx.objectStore('legacy_pending').count())).toBe(OLD_LEGACY.length);
    const holding = await req(tx.objectStore('facets').get(['user-a', `holding/${H0}/status`]));
    expect(holding).toMatchObject({ field: 'status', head_id: H0 });
    db.close();
  });

  it('upgrades an empty v2 store', async () => {
    const factory = new IDBFactory();
    const open = factory.open(LOCAL_DB_NAME, 2);
    open.onupgradeneeded = () => createV2(open.result);
    (await req(open)).close();
    const db = await openLocalDb({ factory });
    expect(db.version).toBe(3);
    expect(await db.count('facets')).toBe(0);
    db.close();
  });
});

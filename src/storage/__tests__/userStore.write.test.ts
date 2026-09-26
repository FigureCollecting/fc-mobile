import { afterEach, describe, expect, it, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { ProductCardSchema, compareVersion, parseVersion } from '@figurecollecting/fc-api-contract';
import { LocalWriteError, UnsyncedEditsError, UserStore } from '../userStore';
import { PayloadInvalidError } from '../../sync/payload';
import {
  DAY,
  DEVICE,
  FakeClock,
  HEAD,
  HOUR,
  OTHER_DEVICE,
  PushOutcome,
  T0,
  appliedAll,
  ev,
  freshDb,
  key,
  openStore,
  result,
  status,
  token,
} from '../../sync/__tests__/harness';

afterEach(() => vi.restoreAllMocks());

describe('writeFacet', () => {
  it('writes the facet, its outbox entry and the HLC state together', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);

    const res = await store.writeFacet(HEAD[0], 'status', 'owned');

    expect(res.facet_key).toBe(key(0, 'status'));
    expect(res.version).toBe(token(T0, 0, DEVICE));
    const facet = await store.getFacet(key(0, 'status'));
    expect(facet).toMatchObject({
      sub: 'user-a',
      head_id: HEAD[0],
      field: 'status',
      value: { version: res.version, op: 'upsert' },
      known: null,
      pending_id: res.outbox_id,
      overwritten: null,
    });
    expect(JSON.parse(facet!.value!.payload)).toMatchObject({ status: 'owned', tz: 'America/Chicago' });
    const [entry] = await store.listOutbox();
    expect(entry).toMatchObject({
      id: res.outbox_id,
      facet_key: key(0, 'status'),
      op: 'upsert',
      payload: facet!.value!.payload,
      edit_version: res.version,
      base_version: null,
      state: 'PENDING',
      attempts: 0,
      created_at: T0,
    });
    const meta = await store.getMeta();
    expect(meta.hlc).toEqual({ micros: String(parseVersion(res.version)!.micros), counter: 0 });
    expect(meta.device_id).toBe(DEVICE);
  });

  it('mints above the base version even when the base is an hour ahead of this clock', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    const remote = token(T0 + HOUR, 4, OTHER_DEVICE);
    await store.apply([ev(key(0, 'note'), remote)]);

    const res = await store.writeFacet(HEAD[0], 'note', 'mine');

    expect(compareVersion(res.version, remote)).toBe(1);
    const [entry] = await store.listOutbox();
    expect(entry.base_version).toBe(remote);
  });

  it('still mints above the base after a rebase lowered the clock below it', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    // Another device's edit 2 minutes ahead of this server sample: held locally, then the rebase drops it from the clock.
    const theirs = token(T0 + 120_000, 0, OTHER_DEVICE);
    await store.apply([ev(key(0, 'status'), theirs, 'upsert', '{"status":"wished"}')]);
    expect((await store.onStatus({ cursor: '', serverNowIso: '2026-09-26T12:00:00.000000Z', pendingReview: 0n }, 0)).rebased).toBe(true);

    const mine = await store.writeFacet(HEAD[0], 'status', 'owned');

    expect(compareVersion(mine.version, theirs)).toBe(1);
    expect((await store.getFacet(key(0, 'status')))!.value!.version).toBe(mine.version);
  });

  it('writes a tombstone as a delete with an empty payload and keeps the row', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    await store.writeFacet(HEAD[0], 'status', 'owned');

    await store.writeFacet(HEAD[0], 'status', null);

    const facet = await store.getFacet(key(0, 'status'));
    expect(facet!.value).toMatchObject({ op: 'delete', payload: '' });
    const entries = await store.listOutbox();
    expect(entries.map((e) => e.op)).toEqual(['upsert', 'delete']);
    expect(entries[1].base_version).toBe(entries[0].edit_version);
  });

  it('refuses an invalid value before touching the database', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);

    await expect(store.writeFacet(HEAD[0], 'score', 11)).rejects.toThrow(PayloadInvalidError);
    await expect(store.writeFacet('not-a-head', 'score', 5)).rejects.toThrow(TypeError);

    expect(await store.listOutbox()).toEqual([]);
    expect(await store.listFacets()).toEqual([]);
  });

  it('continues past the last issued version after a reload with the clock an hour behind', async () => {
    const { db } = await freshDb();
    const first = await (await openStore(db)).writeFacet(HEAD[0], 'status', 'owned');

    const reloaded = await openStore(db, { clock: new FakeClock(T0 - HOUR) });
    const next = await reloaded.writeFacet(HEAD[1], 'status', 'wished');

    expect(compareVersion(next.version, first.version)).toBe(1);
  });

  it('keeps a remote version seen only through apply() across a reload with the clock an hour behind', async () => {
    const { db } = await freshDb();
    const remote = token(T0 + HOUR, 5, OTHER_DEVICE);
    await (await openStore(db)).apply([ev(key(0, 'note'), remote)]);

    const reloaded = await openStore(db, { clock: new FakeClock(T0 - HOUR) });
    const next = await reloaded.writeFacet(HEAD[2], 'score', 4);

    expect(compareVersion(next.version, remote)).toBe(1);
  });

  it('aborts the whole write on QuotaExceededError and leaves no optimistic overlay', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    const before = await store.writeFacet(HEAD[0], 'note', 'first');
    const metaBefore = await store.getMeta();
    const realAdd = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'outbox') throw new DOMException('quota', 'QuotaExceededError');
      return realAdd.apply(this, args as Parameters<typeof realAdd>);
    });

    const err = await store.writeFacet(HEAD[0], 'note', 'second').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LocalWriteError);
    expect((err as LocalWriteError).quota).toBe(true);
    vi.restoreAllMocks();
    const facet = await store.getFacet(key(0, 'note'));
    expect(facet!.value!.version).toBe(before.version);
    expect(JSON.parse(facet!.value!.payload).note).toBe('first');
    expect(await store.listOutbox()).toHaveLength(1);
    expect(await store.getMeta()).toEqual(metaBefore);
    // The store stays usable once space is back.
    await expect(store.writeFacet(HEAD[0], 'note', 'third')).resolves.toBeDefined();
  });

  it('rolls back the facet and outbox rows already written when the last write hits the quota', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    await store.writeFacet(HEAD[0], 'note', 'first');
    const realPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'sync_meta') throw new DOMException('quota', 'QuotaExceededError');
      return realPut.apply(this, args as Parameters<typeof realPut>);
    });

    await expect(store.writeFacet(HEAD[1], 'status', 'owned')).rejects.toMatchObject({ name: 'LocalWriteError', quota: true });

    vi.restoreAllMocks();
    expect(await store.getFacet(key(1, 'status'))).toBeUndefined();
    expect((await store.listOutbox()).map((e) => e.facet_key)).toEqual([key(0, 'note')]);
  });

  it('aborts the whole write when a request fails inside the transaction', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    const first = await store.writeFacet(HEAD[0], 'count', 1);
    const realAdd = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value, ...rest) {
      // Collide with the existing entry: the request fails asynchronously with ConstraintError.
      if (this.name === 'outbox') return realAdd.call(this, { ...(value as object), id: first.outbox_id }, ...rest);
      return realAdd.call(this, value, ...rest);
    });

    const err = await store.writeFacet(HEAD[1], 'count', 2).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LocalWriteError);
    expect((err as LocalWriteError).quota).toBe(false);
    vi.restoreAllMocks();
    expect(await store.getFacet(key(1, 'count'))).toBeUndefined();
    expect(await store.listOutbox()).toHaveLength(1);
  });
});

describe('defaults', () => {
  it('runs on the system clock and a random client id when none is given', async () => {
    const { db } = await freshDb();
    const store = await UserStore.open(db, { sub: 'user-a', deviceId: '0F3A5C7E-9B1D-2F4A-6C8E-0B2D4F6A8C0E' });
    const before = Date.now();
    const res = await store.writeFacet(HEAD[0], 'status', 'owned');
    const micros = parseVersion(res.version)!.micros;
    expect(Number(micros / 1000n)).toBeGreaterThanOrEqual(before);
    expect(res.version.endsWith(DEVICE)).toBe(true);
    await store.onStatus({ cursor: '', serverNowIso: '2020-01-01T00:00:00.000000Z', pendingReview: 0n }, 0);
    const next = await store.nextBatch();
    expect(next.kind === 'send' && next.batch.clientId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('holding view', () => {
  it('shows count, score and note only beside a live status, and keeps them for a re-add', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    await store.writeFacet(HEAD[0], 'status', 'owned');
    await store.writeFacet(HEAD[0], 'count', 2);
    await store.writeFacet(HEAD[0], 'score', 8);
    await store.writeFacet(HEAD[0], 'note', 'boxed');
    await store.writeFacet(HEAD[1], 'score', 3); // no status: not a holding
    await store.writeFacet(HEAD[2], 'status', 'wished');
    await store.writeFacet(HEAD[2], 'note', 'gone soon');
    await store.writeFacet(HEAD[2], 'note', null);

    const held = await store.getHolding(HEAD[0]);
    expect(held!.status.field).toBe('status');
    expect(held!.count!.field).toBe('count');
    expect(held!.score!.field).toBe('score');
    expect(held!.note!.field).toBe('note');
    expect(await store.getHolding(HEAD[1])).toBeUndefined();
    expect((await store.getHolding(HEAD[2]))!.note).toBeUndefined();
    expect((await store.listHoldings()).map((h) => h.head_id).sort()).toEqual([HEAD[0], HEAD[2]].sort());

    await store.writeFacet(HEAD[0], 'status', null);
    expect(await store.getHolding(HEAD[0])).toBeUndefined();
    expect(await store.getFacet(key(0, 'score'))).toBeDefined();

    await store.writeFacet(HEAD[0], 'status', 'ordered');
    expect((await store.getHolding(HEAD[0]))!.score!.value!.op).toBe('upsert');
  });

  it('treats a status the server told us about like a local one', async () => {
    const { db } = await freshDb();
    const store = await openStore(db);
    await store.apply([
      ev(key(1, 'status'), token(T0, 0, OTHER_DEVICE), 'upsert', '{"status":"owned"}'),
      ev('identity/' + HEAD[1], '2026-09-26T11:00:00.000000Z', 'upsert', '{"title":"x"}'),
    ]);
    const held = await store.getHolding(HEAD[1]);
    expect(held!.status.known!.version).toBe(token(T0, 0, OTHER_DEVICE));
    expect(await store.listHoldings()).toHaveLength(1);
  });
});

describe('products', () => {
  it('keeps each card with its newest as_of and when it was fetched', async () => {
    const { db } = await freshDb();
    const clock = new FakeClock();
    const store = await openStore(db, { clock });
    const card = create(ProductCardSchema, {
      headId: HEAD[0],
      title: { value: 'Miku', asOf: '2026-09-01T00:00:00.000000Z' },
      manufacturer: { value: 'GSC', asOf: '2026-09-20T08:00:00.000000Z' },
      series: { value: 'Vocaloid', asOf: '' },
    });
    const bare = create(ProductCardSchema, { headId: HEAD[1] });

    await store.putProducts([card, bare]);

    const got = await store.getProduct(HEAD[0]);
    expect(got).toMatchObject({ sub: 'user-a', head_id: HEAD[0], as_of: '2026-09-20T08:00:00.000000Z', fetched_at: T0 });
    expect(got!.card.title!.value).toBe('Miku');
    expect((await store.getProduct(HEAD[1]))!.as_of).toBeNull();
    expect((await store.listProducts()).map((p) => p.head_id).sort()).toEqual([HEAD[0], HEAD[1]].sort());
  });
});

describe('per-user partitioning', () => {
  it("never shows user A's rows to user B's queries", async () => {
    const { db } = await freshDb();
    const a = await openStore(db, { sub: 'user-a' });
    const b = await openStore(db, { sub: 'user-b' });
    await a.writeFacet(HEAD[0], 'status', 'owned');
    await a.apply([ev(key(1, 'status'), token(T0, 0, OTHER_DEVICE), 'upsert', '{"status":"wished"}')], { cursor: 'a-1' });
    await a.putProducts([create(ProductCardSchema, { headId: HEAD[0] })]);
    await a.onStatus({ cursor: 'a-head', serverNowIso: '2026-09-26T12:00:00.000000Z', pendingReview: 0n }, 0);

    expect(await b.listFacets()).toEqual([]);
    expect(await b.getFacet(key(0, 'status'))).toBeUndefined();
    expect(await b.getHolding(HEAD[0])).toBeUndefined();
    expect(await b.listHoldings()).toEqual([]);
    expect(await b.listOutbox()).toEqual([]);
    expect(await b.listProducts()).toEqual([]);
    expect(await b.getProduct(HEAD[0])).toBeUndefined();
    expect((await b.getMeta()).cursor).toBe('');
    await b.onStatus({ cursor: 'b-head', serverNowIso: '2026-09-26T12:00:00.000000Z', pendingReview: 0n }, 0);
    expect(await b.nextBatch()).toEqual({ kind: 'empty' });

    // A's edit is still queued under A.
    expect((await a.listOutbox()).map((e) => e.state)).toEqual(['PENDING']);
    expect((await a.getMeta()).cursor).toBe('a-1');
  });

  it("never marks user B's pending edit superseded when user A's facet takes a newer remote value", async () => {
    const { db } = await freshDb();
    const a = await openStore(db, { sub: 'user-a' });
    const b = await openStore(db, { sub: 'user-b' });
    const bEdit = await b.writeFacet(HEAD[0], 'note', 'b-mine');
    await a.writeFacet(HEAD[0], 'note', 'a-mine');

    await a.apply([ev(key(0, 'note'), token(T0 + HOUR, 0, OTHER_DEVICE), 'upsert', '{"note":"a-remote"}')]);

    expect((await a.listOutbox())[0]).toMatchObject({ state: 'STALE', superseded: true });
    const [bEntry] = await b.listOutbox();
    expect(bEntry).toMatchObject({ state: 'PENDING', edit_version: bEdit.version });
    expect(bEntry.superseded).toBeUndefined();
    expect((await b.getFacet(key(0, 'note')))!.value!.version).toBe(bEdit.version);
  });

  it("never re-mints user B's edits in user A's first-Status rebase", async () => {
    const { db } = await freshDb();
    const bEdit = await (await openStore(db, { sub: 'user-b', clock: new FakeClock(T0 + DAY) })).writeFacet(HEAD[0], 'note', 'b-ahead');
    const aEdit = await (await openStore(db, { sub: 'user-a', clock: new FakeClock(T0 + DAY) })).writeFacet(HEAD[1], 'note', 'a-ahead');
    const a = await openStore(db, { sub: 'user-a', clock: new FakeClock(T0 + 1_000) });

    expect(await a.onStatus(status(T0 + 1_000), 0)).toEqual({ rebased: true, reminted: 1 });

    expect((await a.listOutbox())[0].edit_version).not.toBe(aEdit.version);
    const b = await openStore(db, { sub: 'user-b', clock: new FakeClock(T0 + 1_000) });
    expect((await b.listOutbox())[0].edit_version).toBe(bEdit.version);
    expect((await b.getFacet(key(0, 'note')))!.value!.version).toBe(bEdit.version);
  });
});

describe('removeLocalData', () => {
  it("refuses while any of the user's edits is unsynced, then removes only that user's rows", async () => {
    const { db } = await freshDb();
    const a = await openStore(db, { sub: 'user-a' });
    const b = await openStore(db, { sub: 'user-b' });
    await a.writeFacet(HEAD[0], 'status', 'owned');
    await a.putProducts([create(ProductCardSchema, { headId: HEAD[0] })]);
    await db.put('device_key', { sub: 'user-a', key: 'a-key' });
    await db.put('device_key', { sub: 'user-b', key: 'b-key' });
    await db.put('legacy_pending', { type: 'update' });
    await b.writeFacet(HEAD[1], 'status', 'wished');

    await expect(a.removeLocalData()).rejects.toThrow(UnsyncedEditsError);
    expect(await a.listOutbox()).toHaveLength(1);

    await a.onStatus({ cursor: '', serverNowIso: '2026-09-26T12:00:00.000000Z', pendingReview: 0n }, 0);
    const batch = await a.nextBatch();
    if (batch.kind !== 'send') throw new Error('expected a batch');
    await expect(a.removeLocalData()).rejects.toThrow(UnsyncedEditsError);
    await a.recordPush(batch.batch.clientId, appliedAll(batch.batch.request.events));

    await a.removeLocalData();

    const range = IDBKeyRange.bound(['user-a'], ['user-a', []]);
    expect(await db.getAll('facets', range)).toEqual([]);
    expect(await db.getAllFromIndex('outbox', 'by_sub', range)).toEqual([]);
    expect(await db.getAll('products', range)).toEqual([]);
    expect(await db.get('sync_meta', 'user-a')).toBeUndefined();
    expect(await db.get('device_key', 'user-a')).toBeUndefined();
    // B's rows and the legacy v1 queue stay.
    expect(await b.listOutbox()).toHaveLength(1);
    expect(await b.listFacets()).toHaveLength(1);
    expect(await db.get('device_key', 'user-b')).toEqual({ sub: 'user-b', key: 'b-key' });
    expect(await db.count('legacy_pending')).toBe(1);
  });

  it('counts a REJECTED edit still waiting to be re-minted as unsynced', async () => {
    const { db } = await freshDb();
    const clock = new FakeClock(T0);
    const store = await openStore(db, { clock });
    await store.onStatus({ cursor: '', serverNowIso: '2026-09-26T12:00:00.000000Z', pendingReview: 0n }, 0);
    await store.writeFacet(HEAD[0], 'score', 7);
    const batch = await store.nextBatch();
    if (batch.kind !== 'send') throw new Error('expected a batch');
    await store.recordPush(batch.batch.clientId, {
      results: [result(key(0, 'score'), PushOutcome.REJECTED, undefined, 'version_future')],
    });

    const err = await store.removeLocalData().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnsyncedEditsError);
    expect((err as UnsyncedEditsError).count).toBe(1);
  });
});

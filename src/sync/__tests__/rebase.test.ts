import { afterEach, describe, expect, it, vi } from 'vitest';
import { compareVersion } from '@figurecollecting/fc-api-contract';
import type { UserStore } from '../../storage/userStore';
import {
  DAY,
  FakeClock,
  HOUR,
  OTHER_DEVICE,
  PushOutcome,
  T0,
  ev,
  freshDb,
  key,
  openStore,
  result,
  status,
  token,
  write,
} from './harness';

async function send(store: UserStore) {
  const next = await store.nextBatch();
  if (next.kind !== 'send') throw new Error(`expected a batch, got ${next.kind}`);
  return next.batch;
}

async function byId(store: UserStore, id: number) {
  return (await store.listOutbox()).find((e) => e.id === id)!;
}

afterEach(() => vi.restoreAllMocks());

// The next put on `storeName` throws QuotaExceededError, aborting its transaction.
function quotaOnce(storeName: string) {
  const realPut = IDBObjectStore.prototype.put;
  let fired = false;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
    if (!fired && this.name === storeName) {
      fired = true;
      throw new DOMException('quota', 'QuotaExceededError');
    }
    return realPut.apply(this, args as Parameters<typeof realPut>);
  });
}

/** Below server_now + MAX_FUTURE_SKEW_MS (5 min): the server would accept it. */
const withinBound = (version: string, serverMs: number) => compareVersion(version, token(serverMs + 300_000, 0)) < 0;

describe("rebase after each session's first Status", () => {
  it('re-mints unpushed edits past the new present on their server versions, chaining per facet', async () => {
    const { db } = await freshDb();
    const clock = new FakeClock(T0);
    const s1 = await openStore(db, { clock });
    const known = token(T0 - HOUR, 0, OTHER_DEVICE);
    await s1.apply([ev(key(0, 'note'), known, 'upsert', '{"note":"server"}')]);
    await s1.onStatus(status(T0), 0);
    // The wall jumps a day ahead mid-session; the Hlc trusts it.
    clock.wall += DAY;
    const flying = await write(s1, 2, 'status', 'owned');
    const sent = await send(s1);
    const e1 = await write(s1, 0, 'note', 'one');
    const e2 = await write(s1, 0, 'note', 'two');
    const e3 = await write(s1, 1, 'status', 'wished');
    const e4 = await write(s1, 2, 'status', 'ordered');
    expect(e1.version).toBe(token(T0 + DAY, 1));

    // Reload with the wall corrected.
    const clock2 = new FakeClock(T0 + 1_000, 50);
    const s2 = await openStore(db, { clock: clock2 });
    const report = await s2.onStatus(status(T0 + 1_000), 0);

    expect(report.rebased).toBe(true);
    expect(report.reminted).toBe(4);
    const r1 = await byId(s2, e1.outbox_id);
    const r2 = await byId(s2, e2.outbox_id);
    const r3 = await byId(s2, e3.outbox_id);
    const r4 = await byId(s2, e4.outbox_id);
    expect(r1).toMatchObject({ state: 'PENDING', edit_version: token(T0 + 1_000, 1), base_version: known });
    expect(r2).toMatchObject({ edit_version: token(T0 + 1_000, 2), base_version: r1.edit_version });
    expect(r3).toMatchObject({ edit_version: token(T0 + 1_000, 3), base_version: null });
    // Chained on the unanswered in-flight edit, which is never re-minted in place.
    expect(r4.base_version).toBe(flying.version);
    expect(r4.edit_version > flying.version).toBe(true);
    const inFlight = await byId(s2, flying.outbox_id);
    expect(inFlight).toMatchObject({ state: 'IN_FLIGHT', edit_version: flying.version, client_id: sent.clientId });
    // The facets show the re-minted versions.
    expect((await s2.getFacet(key(0, 'note')))!.value!.version).toBe(r2.edit_version);
    expect((await s2.getFacet(key(1, 'status')))!.value!.version).toBe(r3.edit_version);
    // A later edit takes the re-minted version as its base.
    const e5 = await write(s2, 0, 'note', 'three');
    expect((await byId(s2, e5.outbox_id)).base_version).toBe(r2.edit_version);
  });

  it('is a no-op when the clock is not ahead', async () => {
    const { db } = await freshDb();
    const s1 = await openStore(db);
    const e = await write(s1, 0, 'status', 'owned');
    const s2 = await openStore(db, { clock: new FakeClock(T0 + 10_000) });

    const report = await s2.onStatus(status(T0 + 10_000), 0);

    expect(report).toEqual({ rebased: false, reminted: 0 });
    expect((await byId(s2, e.outbox_id)).edit_version).toBe(e.version);
  });

  it('does not rebase on a later Status of the same session with nothing rejected', async () => {
    const { db } = await freshDb();
    const clock = new FakeClock(T0);
    const store = await openStore(db, { clock });
    await store.onStatus(status(T0), 0);
    clock.wall += DAY;
    const e = await write(store, 0, 'status', 'owned');
    clock.advance(2_000);

    const report = await store.onStatus(status(T0 + 2_000), 0);

    expect(report).toEqual({ rebased: false, reminted: 0 });
    expect((await byId(store, e.outbox_id)).edit_version).toBe(e.version);
  });

  it('does not rebase or re-mint again on a later Status after the first one rebased', async () => {
    const { db } = await freshDb();
    const clock = new FakeClock(T0);
    const s1 = await openStore(db, { clock });
    await s1.onStatus(status(T0), 0);
    clock.wall += DAY;
    await write(s1, 0, 'status', 'owned');
    const clock2 = new FakeClock(T0 + 1_000, 50);
    const s2 = await openStore(db, { clock: clock2 });
    expect((await s2.onStatus(status(T0 + 1_000), 0)).rebased).toBe(true);
    const stored = (await s2.getMeta()).hlc;
    clock2.advance(2_000);

    expect(await s2.onStatus(status(T0 + 3_000), 0)).toEqual({ rebased: false, reminted: 0 });
    expect((await s2.getMeta()).hlc).toEqual(stored);
  });

  it('keeps the measured offset and the last Status for the next session', async () => {
    const { db } = await freshDb();
    const s1 = await openStore(db, { clock: new FakeClock(T0) });
    await s1.onStatus({ ...status(T0 + 600_000, 'head-7'), pendingReview: 2n }, 0);
    const meta = await s1.getMeta();
    expect(meta).toMatchObject({ offset_ms: 600_000, server_cursor: 'head-7', pending_review: 2, status_at: T0 });

    const s2 = await openStore(db, { clock: new FakeClock(T0 + 1_000) });
    const e = await write(s2, 0, 'status', 'owned');
    expect(e.version).toBe(token(T0 + 601_000, 0));
  });

  it('stores the lowered clock, so a reload before the next Status mints at the present', async () => {
    const { db } = await freshDb();
    const clock = new FakeClock(T0);
    const s1 = await openStore(db, { clock });
    await s1.onStatus(status(T0), 0);
    clock.wall += DAY;
    await write(s1, 0, 'status', 'owned');
    const s2 = await openStore(db, { clock: new FakeClock(T0 + 1_000, 5) });
    await s2.onStatus(status(T0 + 1_000), 0);

    const s3 = await openStore(db, { clock: new FakeClock(T0 + 2_000, 5) });
    const next = await write(s3, 1, 'note', 'x');

    expect(next.version).toBe(token(T0 + 2_000, 0));
  });

  it('still re-mints on the retry when the first Status transaction aborts after the rebase', async () => {
    const { db } = await freshDb();
    const clock = new FakeClock(T0);
    const s1 = await openStore(db, { clock });
    await s1.onStatus(status(T0), 0);
    clock.wall += DAY;
    const ahead = await write(s1, 0, 'note', 'ahead');
    const s2 = await openStore(db, { clock: new FakeClock(T0 + 1_000, 50) });
    quotaOnce('sync_meta');
    await expect(s2.onStatus(status(T0 + 1_000), 0)).rejects.toMatchObject({ name: 'LocalWriteError', quota: true });
    vi.restoreAllMocks();
    expect((await byId(s2, ahead.outbox_id)).edit_version).toBe(ahead.version);

    const report = await s2.onStatus(status(T0 + 1_000), 0);

    expect(report).toEqual({ rebased: true, reminted: 1 });
    const reminted = (await byId(s2, ahead.outbox_id)).edit_version;
    expect(withinBound(reminted, T0 + 1_000)).toBe(true);
    expect((await s2.getFacet(key(0, 'note')))!.value!.version).toBe(reminted);
    expect(BigInt((await s2.getMeta()).hlc.micros) < BigInt(T0 + DAY) * 1000n).toBe(true);
    const next = await send(s2);
    expect(next.request.events.map((e) => e.version)).toEqual([reminted]);
  });
});

describe('after a REJECTED edit, a fresh Status before minting', () => {
  async function aheadAndSent() {
    const { db } = await freshDb();
    const clock = new FakeClock(T0);
    const store = await openStore(db, { clock });
    const known = token(T0 - HOUR, 0, OTHER_DEVICE);
    await store.apply([ev(key(0, 'note'), known, 'upsert', '{"note":"server"}')]);
    const early = await write(store, 2, 'wishability', 1);
    await store.onStatus(status(T0), 0);
    const first = await send(store);
    await store.recordPush(first.clientId, { results: first.request.events.map((e) => result(e.facetKey, PushOutcome.APPLIED, e)) });
    const kept = await write(store, 2, 'wishability', 2);
    clock.wall += DAY;
    const edit = await write(store, 0, 'note', 'future');
    const batch = await send(store);
    const later = await write(store, 1, 'status', 'owned');
    clock.advance(5_000);
    return { db, store, clock, known, early, kept, edit, batch, later };
  }

  it('drops a REJECTED edit, holds new batches until the Status, then rebases and re-mints', async () => {
    const { store, edit, batch, later, kept, known } = await aheadAndSent();
    expect(batch.entryIds).toEqual([kept.outbox_id, edit.outbox_id]);
    const results = [
      result(key(2, 'wishability'), PushOutcome.APPLIED, batch.request.events[0]),
      result(key(0, 'note'), PushOutcome.REJECTED, ev(key(0, 'note'), known, 'upsert', '{"note":"server"}'), 'payload_invalid: bad'),
    ];
    await store.recordPush(batch.clientId, { results });

    expect((await store.getMeta()).rejected_past).toBe(edit.version);
    expect(await store.nextBatch()).toEqual({ kind: 'status_required' });
    // Minting is still possible offline; the Status re-mints it if it lands past the present.
    const offline = await write(store, 1, 'score', 4);

    const report = await store.onStatus(status(T0 + 5_000), 0);

    expect(report).toEqual({ rebased: true, reminted: 2 });
    expect(await byId(store, edit.outbox_id)).toMatchObject({ state: 'REJECTED', reason: 'payload_invalid: bad' });
    expect((await byId(store, edit.outbox_id)).remint).toBeUndefined();
    expect((await store.getFacet(key(0, 'note')))!.value!.version).toBe(known);
    expect((await byId(store, later.outbox_id)).edit_version).toBe(token(T0 + 5_000, 1));
    expect((await byId(store, offline.outbox_id)).edit_version).toBe(token(T0 + 5_000, 2));
    expect((await store.getMeta()).rejected_past).toBeNull();
    const next = await send(store);
    expect(next.entryIds).toEqual([later.outbox_id, offline.outbox_id]);
  });

  it('still rebases and re-mints on the retry when that fresh Status transaction aborts', async () => {
    const { store, edit, batch, later, known } = await aheadAndSent();
    await store.recordPush(batch.clientId, {
      results: [
        result(key(2, 'wishability'), PushOutcome.APPLIED, batch.request.events[0]),
        result(key(0, 'note'), PushOutcome.REJECTED, ev(key(0, 'note'), known, 'upsert', '{"note":"server"}'), 'payload_invalid: bad'),
      ],
    });
    quotaOnce('sync_meta');
    await expect(store.onStatus(status(T0 + 5_000), 0)).rejects.toMatchObject({ name: 'LocalWriteError', quota: true });
    vi.restoreAllMocks();
    expect((await store.getMeta()).rejected_past).toBe(edit.version);

    const report = await store.onStatus(status(T0 + 5_000), 0);

    expect(report).toEqual({ rebased: true, reminted: 1 });
    const reminted = (await byId(store, later.outbox_id)).edit_version;
    expect(withinBound(reminted, T0 + 5_000)).toBe(true);
    expect((await store.getFacet(key(1, 'status')))!.value!.version).toBe(reminted);
    expect((await store.getMeta()).rejected_past).toBeNull();
  });

  it('leaves an edit minted before the jump alone', async () => {
    const { store, batch, early, kept } = await aheadAndSent();
    await store.recordPush(batch.clientId, {
      results: [
        result(key(2, 'wishability'), PushOutcome.APPLIED, batch.request.events[0]),
        result(key(0, 'note'), PushOutcome.REJECTED, undefined, 'device_mismatch'),
      ],
    });
    await store.onStatus(status(T0 + 5_000), 0);
    expect((await byId(store, early.outbox_id)).state).toBe('APPLIED');
    expect((await byId(store, kept.outbox_id)).edit_version).toBe(kept.version);
  });

  it('re-mints a version_future edit on the adopted current after the rebase', async () => {
    const { store, edit, batch, known, later } = await aheadAndSent();
    const current = ev(key(0, 'note'), known, 'upsert', '{"note":"server"}');
    await store.recordPush(batch.clientId, {
      results: [
        result(key(2, 'wishability'), PushOutcome.APPLIED, batch.request.events[0]),
        result(key(0, 'note'), PushOutcome.REJECTED, current, 'version_future'),
      ],
    });
    expect(await byId(store, edit.outbox_id)).toMatchObject({ remint: 'awaiting', adopted_version: known });
    expect((await store.getFacet(key(0, 'note')))!.value!.version).toBe(known);

    const report = await store.onStatus(status(T0 + 5_000), 0);

    expect(report).toEqual({ rebased: true, reminted: 2 });
    const old = await byId(store, edit.outbox_id);
    expect(old).toMatchObject({ state: 'REJECTED', remint: 'done' });
    const again = await byId(store, old.reminted_as!);
    expect(again).toMatchObject({
      state: 'PENDING',
      facet_key: key(0, 'note'),
      op: 'upsert',
      payload: batch.request.events[1].payload,
      base_version: known,
      edit_version: token(T0 + 5_000, 1),
    });
    const facet = await store.getFacet(key(0, 'note'));
    expect(facet!.value!.version).toBe(again.edit_version);
    expect(facet!.pending_id).toBe(again.id);
    const next = await send(store);
    expect(next.entryIds).toEqual([later.outbox_id, again.id]);
  });

  it('does not re-mint a version_future edit a newer local edit replaced', async () => {
    const { store, edit, batch, known } = await aheadAndSent();
    await store.recordPush(batch.clientId, {
      results: [
        result(key(2, 'wishability'), PushOutcome.APPLIED, batch.request.events[0]),
        result(key(0, 'note'), PushOutcome.REJECTED, ev(key(0, 'note'), known, 'upsert', '{"note":"server"}'), 'version_future: too far'),
      ],
    });
    const newer = await write(store, 0, 'note', 'newer');

    await store.onStatus(status(T0 + 5_000), 0);

    expect(await byId(store, edit.outbox_id)).toMatchObject({ remint: 'skipped' });
    expect((await store.getFacet(key(0, 'note')))!.pending_id).toBe(newer.outbox_id);
  });

  it('does not re-mint a version_future edit a newer remote value replaced', async () => {
    const { store, edit, batch, known } = await aheadAndSent();
    await store.recordPush(batch.clientId, {
      results: [
        result(key(2, 'wishability'), PushOutcome.APPLIED, batch.request.events[0]),
        result(key(0, 'note'), PushOutcome.REJECTED, ev(key(0, 'note'), known, 'upsert', '{"note":"server"}'), 'version_future'),
      ],
    });
    const theirs = token(T0 + 2_000, 0, OTHER_DEVICE);
    await store.apply([ev(key(0, 'note'), theirs, 'upsert', '{"note":"theirs"}')]);

    await store.onStatus(status(T0 + 5_000), 0);

    expect(await byId(store, edit.outbox_id)).toMatchObject({ remint: 'skipped' });
    expect((await store.getFacet(key(0, 'note')))!.value!.version).toBe(theirs);
  });

  it('does not rebase when the REJECTED edit is not past the fresh sample', async () => {
    const { db } = await freshDb();
    const clock = new FakeClock(T0);
    const store = await openStore(db, { clock });
    await store.onStatus(status(T0), 0);
    const e = await write(store, 0, 'score', 5);
    const batch = await send(store);
    await store.recordPush(batch.clientId, { results: [result(key(0, 'score'), PushOutcome.REJECTED, undefined, 'payload_invalid')] });
    clock.advance(10_000);

    const report = await store.onStatus(status(T0 + 10_000), 0);

    expect(report).toEqual({ rebased: false, reminted: 0 });
    expect((await byId(store, e.outbox_id)).state).toBe('REJECTED');
    expect(await store.nextBatch()).toEqual({ kind: 'empty' });
  });

  it('treats a REJECTED answer to a retried batch the same way, across a reload', async () => {
    const { db, batch, edit, known } = await aheadAndSent();
    // The first answer was lost. The page reloads with the wall corrected and retries.
    const s2 = await openStore(db, { clock: new FakeClock(T0 + 5_000, 99) });
    const retry = await send(s2);
    expect(retry.clientId).toBe(batch.clientId);
    await s2.recordPush(retry.clientId, {
      results: [
        result(key(2, 'wishability'), PushOutcome.DUPLICATE, retry.request.events[0]),
        result(key(0, 'note'), PushOutcome.REJECTED, ev(key(0, 'note'), known, 'upsert', '{"note":"server"}'), 'version_future'),
      ],
    });
    expect(await s2.nextBatch()).toEqual({ kind: 'status_required' });

    const report = await s2.onStatus(status(T0 + 5_000), 0);

    expect(report.rebased).toBe(true);
    const old = await byId(s2, edit.outbox_id);
    expect(old.remint).toBe('done');
    expect((await byId(s2, old.reminted_as!)).edit_version < token(T0 + 5_000 + 300_000, 0)).toBe(true);
  });
});

describe('rebase edge cases', () => {
  it("leaves an edit minted before another tab's clock ran ahead untouched", async () => {
    const { db } = await freshDb();
    const tabA = await openStore(db, { clock: new FakeClock(T0) });
    const early = await write(tabA, 0, 'status', 'owned');
    // Another tab with a clock a day fast writes; the stored clock keeps the higher state.
    const tabB = await openStore(db, { clock: new FakeClock(T0 + DAY) });
    const ahead = await write(tabB, 1, 'status', 'wished');

    const reloaded = await openStore(db, { clock: new FakeClock(T0 + 1_000) });
    const report = await reloaded.onStatus(status(T0 + 1_000), 0);

    expect(report).toEqual({ rebased: true, reminted: 1 });
    expect((await byId(reloaded, early.outbox_id)).edit_version).toBe(early.version);
    expect((await byId(reloaded, ahead.outbox_id)).edit_version).toBe(token(T0 + 1_000, 1));
  });

  it("leaves another tab's edit that is not past the present alone when the rebase moves nothing", async () => {
    const { db } = await freshDb();
    const tabA = await openStore(db, { clock: new FakeClock(T0) });
    const fromB = await write(await openStore(db, { clock: new FakeClock(T0 + 60_000) }), 1, 'status', 'wished');
    const stored = (await tabA.getMeta()).hlc;

    const report = await tabA.onStatus(status(T0 + 120_000), 0);

    expect(report).toEqual({ rebased: false, reminted: 0 });
    expect((await byId(tabA, fromB.outbox_id)).edit_version).toBe(fromB.version);
    expect((await tabA.getMeta()).hlc).toEqual(stored);
  });

  it('re-mints a version_future edit the server held nothing for on no base', async () => {
    const { db } = await freshDb();
    const clock = new FakeClock(T0);
    const store = await openStore(db, { clock });
    await store.onStatus(status(T0), 0);
    clock.wall += DAY;
    const edit = await write(store, 0, 'score', 9);
    const batch = await send(store);
    await store.recordPush(batch.clientId, { results: [result(key(0, 'score'), PushOutcome.REJECTED, undefined, 'version_future')] });
    expect(await byId(store, edit.outbox_id)).toMatchObject({ remint: 'awaiting', adopted_version: null });
    expect((await store.getFacet(key(0, 'score')))!.value).toBeNull();
    clock.advance(1_000);

    await store.onStatus(status(T0 + 1_000), 0);

    const again = await byId(store, (await byId(store, edit.outbox_id)).reminted_as!);
    expect(again).toMatchObject({ base_version: null, edit_version: token(T0 + 1_000, 1) });
    expect((await store.getFacet(key(0, 'score')))!.value!.version).toBe(again.edit_version);
  });

  it('does not queue a re-mint for a version_future edit already replaced before the answer', async () => {
    const { db } = await freshDb();
    const clock = new FakeClock(T0);
    const store = await openStore(db, { clock });
    await store.onStatus(status(T0), 0);
    clock.wall += DAY;
    const edit = await write(store, 0, 'score', 9);
    const batch = await send(store);
    const newer = await write(store, 0, 'score', 10);

    await store.recordPush(batch.clientId, { results: [result(key(0, 'score'), PushOutcome.REJECTED, undefined, 'version_future')] });

    const old = await byId(store, edit.outbox_id);
    expect(old.state).toBe('REJECTED');
    expect(old.remint).toBeUndefined();
    expect((await store.getFacet(key(0, 'score')))!.pending_id).toBe(newer.outbox_id);
  });

  it('owes the rebase for the highest REJECTED version in an answer, whatever its position', async () => {
    const { db } = await freshDb();
    const clock = new FakeClock(T0);
    const s1 = await openStore(db, { clock });
    await s1.onStatus(status(T0), 0);
    clock.wall += DAY;
    await write(s1, 0, 'status', 'owned');
    const flying = await send(s1);
    const chained = await write(s1, 0, 'status', 'wished');
    await write(s1, 1, 'status', 'owned');
    // Reload corrected: the chained edit stays above the in-flight one, the other comes back to the present.
    const s2 = await openStore(db, { clock: new FakeClock(T0 + 1_000, 7) });
    await s2.onStatus(status(T0 + 1_000), 0);
    await s2.recordPush(flying.clientId, { results: flying.request.events.map((e) => result(e.facetKey, PushOutcome.APPLIED, e)) });
    const batch = await send(s2);
    const [high, low] = batch.request.events;
    expect(batch.entryIds[0]).toBe(chained.outbox_id);
    expect(high.version > low.version).toBe(true);

    await s2.recordPush(batch.clientId, {
      results: [
        result(high.facetKey, PushOutcome.REJECTED, undefined, 'version_future'),
        result(low.facetKey, PushOutcome.REJECTED, undefined, 'device_mismatch'),
      ],
    });

    expect((await s2.getMeta()).rejected_past).toBe(high.version);
  });
});

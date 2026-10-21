// GK2-IMPORT-2: a head the catalogue answers `unresolved` (a figure no store lists, held under a head the importer
// minted) is remembered, so it is not asked about again on every pass: a negative cache with a long TTL, kept in the
// sync meta so it survives a restart, bypassed by pull-to-refresh, and forgotten the moment a card for the head arrives.
import { Code, ConnectError } from '@connectrpc/connect';
import { SyncOp, occFacetKey, ufFacetKey } from '@figurecollecting/fc-api-contract';
import { describe, expect, it } from 'vitest';
import { PRODUCT_TTL_MS, SyncEngine, UNRESOLVED_TTL_MS } from '../engine';
import { STAMP, headOf, occOf, rig, seedCopies, serverVersion, type Rig } from './engineSupport';
import { T0 } from './harness';

const DAY = 24 * 60 * 60 * 1000;
const UNKNOWN = 7;
const OTHER_UNKNOWN = 8;

/** A copy of `head` written by another device: its head and its status, and a label when `labelled` (a head the importer minted). */
function holdCopy(r: Rig, occ: number, head: number, counter: number, labelled = true): void {
  if (labelled) r.server.write([{ facetKey: ufFacetKey(headOf(head), 'label'), version: serverVersion(T0 - 60_000, counter + 2), op: SyncOp.UPSERT, payload: JSON.stringify({ name: `Figure ${head}`, ...STAMP }) }]);
  r.server.write([
    { facetKey: occFacetKey(occOf(occ), 'head'), version: serverVersion(T0 - 60_000, counter), op: SyncOp.UPSERT, payload: JSON.stringify({ head_id: headOf(head), ...STAMP }) },
    { facetKey: occFacetKey(occOf(occ), 'status'), version: serverVersion(T0 - 60_000, counter + 1), op: SyncOp.UPSERT, payload: JSON.stringify({ status: 'owned', ...STAMP }) },
  ]);
}

const asks = (r: Rig) =>
  r.server.calls.filter((c) => c.rpc === 'getProducts').map((c) => (c.request as { refs: Array<{ ref: { value: string } }> }).refs.map((x) => x.ref.value).sort());
const unresolved = async (r: Rig) => Object.keys((await r.store.getMeta()).unresolved ?? {}).sort();

/** Two known heads and two unknown ones, after one pass. */
async function held() {
  const r = await rig();
  seedCopies(r.server, 2);
  holdCopy(r, UNKNOWN, UNKNOWN, 100);
  holdCopy(r, OTHER_UNKNOWN, OTHER_UNKNOWN, 110);
  r.server.seedProducts([headOf(0), headOf(1)]);
  await r.engine.trigger('start');
  return r;
}

describe('the negative cache of unresolved heads', () => {
  it('has a TTL longer than a card\'s', () => {
    expect(UNRESOLVED_TTL_MS).toBe(7 * DAY);
    expect(UNRESOLVED_TTL_MS).toBeGreaterThan(PRODUCT_TTL_MS);
  });

  it('asks a head the catalogue left unresolved once, and records it in the sync meta', async () => {
    const r = await held();
    expect(asks(r)).toEqual([[headOf(0), headOf(1), headOf(OTHER_UNKNOWN), headOf(UNKNOWN)].sort()]);
    expect(await unresolved(r)).toEqual([headOf(OTHER_UNKNOWN), headOf(UNKNOWN)].sort());
    await r.engine.trigger('manual');
    await r.engine.trigger('manual');
    expect(r.server.count('getProducts')).toBe(1);
  });

  it('still refetches the known heads\' cards at their own 24 h TTL, without the remembered ones', async () => {
    const r = await held();
    r.clock.advance(PRODUCT_TTL_MS);
    await r.engine.trigger('manual');
    expect(asks(r)[1]).toEqual([headOf(0), headOf(1)].sort());
  });

  it('asks again once the TTL has passed, and not a moment before', async () => {
    const r = await held();
    r.clock.advance(UNRESOLVED_TTL_MS - 1);
    await r.engine.trigger('manual');
    expect(asks(r).slice(1).flat()).not.toContain(headOf(UNKNOWN));
    r.clock.advance(1);
    await r.engine.trigger('manual');
    expect(asks(r).at(-1)).toEqual(expect.arrayContaining([headOf(UNKNOWN), headOf(OTHER_UNKNOWN)]));
  });

  it('asks again on pull-to-refresh, whatever the memory says', async () => {
    const r = await held();
    r.clock.advance(60_000);
    await r.engine.refreshCards();
    expect(asks(r).at(-1)).toEqual(expect.arrayContaining([headOf(UNKNOWN), headOf(OTHER_UNKNOWN), headOf(0), headOf(1)]));
  });

  it('remembers across a restart: an engine on the same store does not ask again', async () => {
    const r = await held();
    const next = new SyncEngine({ store: async () => r.store, sync: r.server.sync, catalog: r.server.catalog, clock: r.clock, timers: r.timers, timeoutSignal: r.timeouts.signal, random: () => 0.5 });
    await next.trigger('start');
    expect(r.server.count('getProducts')).toBe(1);
  });

  it('forgets a head when its card arrives, and does not remember it again', async () => {
    const r = await held();
    r.server.seedProducts([headOf(UNKNOWN)]);
    r.clock.advance(UNRESOLVED_TTL_MS);
    await r.engine.trigger('manual');
    expect(await unresolved(r)).toEqual([headOf(OTHER_UNKNOWN)]);
    expect((await r.store.listProducts()).map((p) => p.head_id)).toContain(headOf(UNKNOWN));
  });

  it('forgets a head a card names in requested_as (a merge into a head that resolves)', async () => {
    const r = await held();
    r.server.seedProducts([headOf(99)]);
    r.server.redirects.set(headOf(UNKNOWN), headOf(99));
    r.clock.advance(UNRESOLVED_TTL_MS);
    await r.engine.trigger('manual');
    expect(await unresolved(r)).toEqual([headOf(OTHER_UNKNOWN)]);
  });

  it('remembers a head only a label names (no copy yet), and asks about a head only a note names every pass', async () => {
    const r = await rig();
    r.server.write([
      { facetKey: ufFacetKey(headOf(UNKNOWN), 'label'), version: serverVersion(T0 - 60_000, 1), op: SyncOp.UPSERT, payload: JSON.stringify({ name: 'Mine', ...STAMP }) },
      { facetKey: ufFacetKey(headOf(OTHER_UNKNOWN), 'note'), version: serverVersion(T0 - 60_000, 2), op: SyncOp.UPSERT, payload: JSON.stringify({ note: 'n', ...STAMP }) },
    ]);
    await r.engine.trigger('start');
    await r.engine.trigger('manual');
    expect(asks(r)).toEqual([[headOf(OTHER_UNKNOWN), headOf(UNKNOWN)].sort(), [headOf(OTHER_UNKNOWN)]]);
    expect(await unresolved(r)).toEqual([headOf(UNKNOWN)]);
  });

  // The cold-start case (Ross 10-18): the copies are held before the server serves their cards. Those heads are real
  // products, so an `unresolved` answer for them is never remembered: the card lands on the very next pass.
  it('never remembers an unlabelled head: a real product whose card is not served yet is asked again at once', async () => {
    const r = await rig();
    holdCopy(r, UNKNOWN, UNKNOWN, 100, false);
    await r.engine.trigger('start');
    expect(await unresolved(r)).toEqual([]);
    r.server.seedProducts([headOf(UNKNOWN)]);
    await r.engine.trigger('manual');
    expect(r.server.count('getProducts')).toBe(2);
    expect((await r.store.listProducts()).map((p) => p.head_id)).toEqual([headOf(UNKNOWN)]);
  });

  it('forgets a head whose label is withdrawn', async () => {
    const r = await held();
    r.server.write([{ facetKey: ufFacetKey(headOf(UNKNOWN), 'label'), version: serverVersion(T0 + 60_000, 600), op: SyncOp.DELETE, payload: '' }]);
    await r.engine.trigger('manual');
    expect(await unresolved(r)).toEqual([headOf(OTHER_UNKNOWN)]);
  });

  it('remembers nothing from a GetProducts that failed, and asks again on the retry', async () => {
    const r = await rig();
    holdCopy(r, UNKNOWN, UNKNOWN, 100);
    r.server.fault('getProducts', { kind: 'throw', error: new ConnectError('down', Code.Unavailable) });
    await r.engine.trigger('start');
    expect(await unresolved(r)).toEqual([]);
    r.timers.fireAll();
    await r.engine.trigger('manual');
    expect(r.server.count('getProducts')).toBe(2);
    expect(await unresolved(r)).toEqual([headOf(UNKNOWN)]);
  });

  it('keeps a card the catalogue has even when its sibling in the batch is unresolved', async () => {
    const r = await held();
    expect((await r.store.listProducts()).map((p) => p.head_id).sort()).toEqual([headOf(0), headOf(1)].sort());
  });

  it('does not read an old sync meta with no memory as anything but empty', async () => {
    const r = await rig();
    const meta = await r.store.getMeta();
    expect(meta.unresolved).toBeUndefined();
    expect(await unresolved(r)).toEqual([]);
  });
});

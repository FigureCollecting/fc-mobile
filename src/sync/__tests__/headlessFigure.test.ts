// GK2-IMPORT-2 PREP, step 1: does the client tolerate a copy whose head the spine does not know?
// Ross's text-only holdings (no catalogue product) would be copies on a head the importer mints. The
// catalog contract says a ref that matches nothing is not an error but comes back in `unresolved`;
// these tests run the real engine, store and read model against the fake coordinator to see what the
// client does with one: sync must complete, the known figures must keep their cards, and the unknown
// head must still be a usable figure (a copy, a note, a tab, a detail).
import { describe, expect, it } from 'vitest';
import { SyncOp, occFacetKey, ufFacetKey } from '@figurecollecting/fc-api-contract';
import { buildFigures, figureOf } from '../../local/figures';
import { UNTITLED } from '../../local/cardName';
import { STAMP, headOf, occOf, rig, seedCopies, serverVersion } from './engineSupport';
import { T0 } from './harness';

const UNKNOWN = 7;

async function syncedWithOneUnknownHead() {
  const r = await rig();
  seedCopies(r.server, 2);
  // copy 7: a head no card exists for, with a figure note and the label the importer would write
  r.server.write([
    { facetKey: occFacetKey(occOf(UNKNOWN), 'head'), version: serverVersion(T0 - 60_000, 100), op: SyncOp.UPSERT, payload: JSON.stringify({ head_id: headOf(UNKNOWN), ...STAMP }) },
    { facetKey: occFacetKey(occOf(UNKNOWN), 'status'), version: serverVersion(T0 - 60_000, 101), op: SyncOp.UPSERT, payload: JSON.stringify({ status: 'owned', ...STAMP }) },
    { facetKey: ufFacetKey(headOf(UNKNOWN), 'note'), version: serverVersion(T0 - 60_000, 102), op: SyncOp.UPSERT, payload: JSON.stringify({ note: 'Luxury ver', ...STAMP }) },
    { facetKey: `uf/${headOf(UNKNOWN)}/label`, version: serverVersion(T0 - 60_000, 103), op: SyncOp.UPSERT, payload: JSON.stringify({ name: 'Atlas Studio - Yor Forger - 1/6', ...STAMP }) },
  ]);
  r.server.seedProducts([headOf(0), headOf(1)]);
  await r.engine.trigger('start');
  const inputs = async () => ({ sub: 'user-a', facets: await r.store.listFacets(), products: await r.store.listProducts(), stale: false });
  return { r, inputs };
}

describe('a copy on a head the spine does not know', () => {
  it('syncs without error: the known cards are stored, the unknown head is simply left without one', async () => {
    const { r } = await syncedWithOneUnknownHead();
    expect(r.engine.state.value).toMatchObject({ reachability: 'reachable', phase: 'idle', lastError: null });
    expect((await r.store.listProducts()).map((p) => p.head_id).sort()).toEqual([headOf(0), headOf(1)].sort());
    expect(r.server.count('getProducts')).toBe(1);
    const asked = (r.server.calls.find((c) => c.rpc === 'getProducts')!.request as { refs: Array<{ ref: { value: string } }> }).refs.map((x) => x.ref.value);
    expect(asked).toContain(headOf(UNKNOWN));
  });

  it('is a figure in the Owned tab with its copy, its note and no card', async () => {
    const { inputs } = await syncedWithOneUnknownHead();
    const figures = buildFigures(await inputs());
    const f = figures.find((x) => x._id === headOf(UNKNOWN))!;
    expect(f).toBeDefined();
    expect(f.local.kind).toBe('owned');
    expect(f.local.hasCard).toBe(false);
    expect(f.quantity).toBe(1);
    expect(f.note).toBe('Luxury ver');
    expect(f.local.sync).toBe('known');
    expect(figures).toHaveLength(3);
    expect(figureOf(await inputs(), headOf(UNKNOWN))?._id).toBe(headOf(UNKNOWN));
  });

  it('keeps the known figures whole beside it', async () => {
    const { inputs } = await syncedWithOneUnknownHead();
    const known = buildFigures(await inputs()).filter((x) => x._id !== headOf(UNKNOWN));
    expect(known.map((x) => x.local.hasCard)).toEqual([true, true]);
  });

  it('is not asked about again on the next sync: the catalogue said it matches nothing, and that is remembered', async () => {
    const { r } = await syncedWithOneUnknownHead();
    await r.engine.trigger('manual');
    expect(r.server.count('getProducts')).toBe(1);
  });

  it('is shown under its label (the name the importer wrote), not as an untitled figure', async () => {
    const { inputs } = await syncedWithOneUnknownHead();
    const f = buildFigures(await inputs()).find((x) => x._id === headOf(UNKNOWN))!;
    expect(f.name).not.toBe(UNTITLED);
    expect(f.name).toBe('Atlas Studio - Yor Forger - 1/6');
  });
});

// Two devices of one user against one coordinator (GR 2026-09-26): each edits offline, then they
// reconnect in both orders. The engine stays key-agnostic; these are the intents' outcomes.
import { describe, expect, it } from 'vitest';
import { SyncOp, collNameKey, occFacetKey, tagNameKey, ufKindTagKey } from '@figurecollecting/fc-api-contract';
import { countsFor, effectiveTags } from '../occurrences';
import { FakeCoordinator } from './fakeCoordinator';
import { DEVICE, FakeClock, OTHER_DEVICE, T0 } from './harness';
import { STAMP, rig, serverVersion, uuid, type Rig } from './engineSupport';

const H = uuid(1, 'b');
const O1 = uuid(1, 'a');
const O2 = uuid(2, 'a');
const X = uuid(1, 'c');
const Y = uuid(2, 'c');
const TAG = uuid(1, 'e');

let n = 0;
const up = (facetKey: string, fields: Record<string, unknown>) => ({
  facetKey,
  version: serverVersion(T0 - 60_000, ++n),
  op: SyncOp.UPSERT,
  payload: JSON.stringify({ ...fields, ...STAMP }),
});

/** A and B, both hydrated; B's clock runs 1 s behind A's, so B's offline edits lose ties of intent to A's only by time. */
async function pair(seed: (server: FakeCoordinator) => void): Promise<{ server: FakeCoordinator; a: Rig; b: Rig }> {
  const server = new FakeCoordinator(T0);
  seed(server);
  const a = await rig({ server, device: DEVICE, clock: new FakeClock(T0) });
  const b = await rig({ server, device: OTHER_DEVICE, clock: new FakeClock(T0) });
  await a.engine.trigger('start');
  await b.engine.trigger('start');
  return { server, a, b };
}

/** Both reconnect, `first` first, then the other, then `first` again to take the other's edits. */
async function reconnect(first: Rig, second: Rig): Promise<void> {
  await first.engine.trigger('online');
  await second.engine.trigger('online');
  await first.engine.trigger('online');
}

const copy = async (r: Rig, occ: string) => (await r.store.getView()).copies.find((c) => c.occ_id === occ)!;

describe.each([
  ['A first', true],
  ['B first', false],
])('two devices, reconnecting %s', (_name, aFirst) => {
  const order = (a: Rig, b: Rig): [Rig, Rig] => (aFirst ? [a, b] : [b, a]);

  it('move the same copy offline: both end on the higher HLC, and the loser hears it was overwritten', async () => {
    const { a, b } = await pair((s) =>
      s.write([up(occFacetKey(O1, 'head'), { head_id: H }), up(occFacetKey(O1, 'status'), { status: 'owned' }), up(collNameKey('owned', X), { name: 'Shelf' }), up(collNameKey('owned', Y), { name: 'Cabinet' })]),
    );
    a.clock.advance(1_000);
    await a.store.moveCopy(O1, `owned/${X}`);
    b.clock.advance(2_000); // later: B's move wins in either order
    await b.store.moveCopy(O1, `owned/${Y}`);
    await reconnect(...order(a, b));
    for (const r of [a, b]) expect(await copy(r, O1)).toMatchObject({ shown_in: `owned/${Y}`, flag: null });
    expect((await a.store.getFacet(occFacetKey(O1, 'collection')))!.overwritten).not.toBeNull();
    expect((await b.store.getFacet(occFacetKey(O1, 'collection')))!.overwritten).toBeNull();
  });

  it('a stale same-kind re-file never reverts an arrival (O3-H)', async () => {
    const { a, b } = await pair((s) =>
      s.write([
        up(occFacetKey(O1, 'head'), { head_id: H }),
        up(occFacetKey(O1, 'status'), { status: 'ordered' }),
        up(occFacetKey(O1, 'collection'), { collection: `ordered/${X}` }),
        up(collNameKey('ordered', X), { name: 'Preorders' }),
        up(collNameKey('ordered', Y), { name: 'Late' }),
      ]),
    );
    a.clock.advance(1_000);
    await a.store.markArrived({ occ_id: O1 });
    b.clock.advance(2_000); // B never saw the arrival, and re-files the copy among the ordered ones later
    await b.store.moveCopy(O1, `ordered/${Y}`);
    await reconnect(...order(a, b));
    for (const r of [a, b]) {
      expect(await copy(r, O1)).toMatchObject({ status: 'owned', shown_in: 'owned/default', flag: 'other_kind' });
      expect(countsFor(await r.store.getView(), H)).toMatchObject({ owned: 1, ordered: 0 });
    }
  });

  it('a collection deleted while the other device files into it, then undone', async () => {
    const { a, b } = await pair((s) =>
      s.write([up(occFacetKey(O1, 'head'), { head_id: H }), up(occFacetKey(O1, 'status'), { status: 'owned' }), up(collNameKey('owned', X), { name: 'Shelf' })]),
    );
    a.clock.advance(1_000);
    await a.store.writeFacet(collNameKey('owned', X), null);
    b.clock.advance(2_000);
    await b.store.moveCopy(O1, `owned/${X}`);
    await reconnect(...order(a, b));
    for (const r of [a, b]) expect(await copy(r, O1)).toMatchObject({ shown_in: 'owned/default', flag: 'dangling' });
    a.clock.advance(5_000);
    await a.store.writeFacet(collNameKey('owned', X), { name: 'Shelf' });
    await reconnect(...order(a, b));
    for (const r of [a, b]) expect(await copy(r, O1)).toMatchObject({ shown_in: `owned/${X}`, flag: null });
  });

  it("'1 of 2 arrived' on both devices marks the same copy, once", async () => {
    const { a, b } = await pair((s) =>
      s.write([
        up(occFacetKey(O1, 'head'), { head_id: H }),
        up(occFacetKey(O1, 'status'), { status: 'ordered' }),
        up(occFacetKey(O2, 'head'), { head_id: H }),
        up(occFacetKey(O2, 'status'), { status: 'ordered' }),
      ]),
    );
    a.clock.advance(1_000);
    expect(await a.store.markArrived({ head_id: H })).toBe(O1);
    b.clock.advance(2_000);
    expect(await b.store.markArrived({ head_id: H })).toBe(O1);
    await reconnect(...order(a, b));
    for (const r of [a, b]) {
      expect(countsFor(await r.store.getView(), H)).toMatchObject({ owned: 1, ordered: 1 });
      expect(await copy(r, O1)).toMatchObject({ status: 'owned' });
      expect(await copy(r, O2)).toMatchObject({ status: 'ordered' });
    }
  });

  it("the figure's owned tag picks up a copy received on the other device", async () => {
    const { a, b } = await pair((s) =>
      s.write([
        up(tagNameKey(TAG), { name: 'Display' }),
        up(ufKindTagKey(H, 'owned', TAG), {}),
        up(occFacetKey(O1, 'head'), { head_id: H }),
        up(occFacetKey(O1, 'status'), { status: 'ordered' }),
      ]),
    );
    for (const r of [a, b]) expect(effectiveTags(await r.store.getView(), O1)).toEqual([]);
    a.clock.advance(1_000);
    await a.store.markArrived({ occ_id: O1 });
    await reconnect(...order(a, b));
    for (const r of [a, b]) expect(effectiveTags(await r.store.getView(), O1)).toEqual([TAG]);
  });
});

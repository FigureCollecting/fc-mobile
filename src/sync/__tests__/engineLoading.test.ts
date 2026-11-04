// LOADBAR (Ross 11-03): the pass says what of the catalogue it is loading, so the app can show it at the top while it loads
// on a weak link: the pull's pages on a first load or a pull of more than one page (how many are still to come is unknown),
// then the cards (of how many are due). Nothing for a pass that loads nothing of the catalogue, and nothing once it ends.
import { Code, ConnectError } from '@connectrpc/connect';
import { SyncOp, occFacetKey } from '@figurecollecting/fc-api-contract';
import { describe, expect, it } from 'vitest';
import { DELTA_PAGE, PRODUCT_BATCH, type CatalogCalls, type SyncCalls, type SyncState } from '../engine';
import { STAMP, headOf, occOf, rig, seedCopies, serverVersion, type Rig } from './engineSupport';
import { FakeCoordinator } from './fakeCoordinator';
import { FakeClock, T0 } from './harness';

/** A rig whose Delta and GetProducts calls note what the engine said it was loading as each was sent. */
async function watched(seed: (server: FakeCoordinator) => void) {
  const clock = new FakeClock();
  const server = new FakeCoordinator(clock.wall);
  seed(server);
  const seen: { rpc: string; loading: SyncState['loading'] }[] = [];
  let r: Rig | undefined;
  const note = (rpc: string) => seen.push({ rpc, loading: r!.engine.state.value.loading });
  const sync: SyncCalls = { ...server.sync, delta: (req, opts) => (note('delta'), server.sync.delta(req, opts)) };
  const catalog: CatalogCalls = { getProducts: (req, opts) => (note('getProducts'), server.catalog.getProducts(req, opts)) };
  r = await rig({ server, clock, deps: { sync, catalog } });
  return { r, seen };
}

describe('the pass says what of the catalogue it is loading (LOADBAR)', () => {
  it('nothing before the first pass', async () => {
    const { r } = await watched(() => {});
    expect(r.engine.state.value.loading).toBeNull();
  });

  it("a first load: the pull's pages as they come, total unknown, then the cards of the heads due, in batches; nothing once done", async () => {
    const n = PRODUCT_BATCH * 2 + 50;
    const { r, seen } = await watched((server) => {
      seedCopies(server, n);
      server.seedProducts(Array.from({ length: n }, (_, i) => headOf(i)));
    });
    await r.engine.trigger('start');
    const pulls = seen.filter((s) => s.rpc === 'delta').map((s) => s.loading);
    // 2 events a copy, DELTA_PAGE to a page
    expect(pulls.length).toBeGreaterThanOrEqual(Math.ceil((2 * n) / DELTA_PAGE));
    pulls.forEach((loading, page) => expect(loading).toEqual({ step: 'pull', pages: page }));
    expect(seen.filter((s) => s.rpc === 'getProducts').map((s) => s.loading)).toEqual([
      { step: 'cards', done: 0, total: n },
      { step: 'cards', done: PRODUCT_BATCH, total: n },
      { step: 'cards', done: 2 * PRODUCT_BATCH, total: n },
    ]);
    expect(r.engine.state.value.loading).toBeNull();
    expect(r.engine.state.value.phase).toBe('idle');
  });

  it('a later pass that pulls one page and has no card due loads nothing of the catalogue: never said', async () => {
    const { r, seen } = await watched((server) => {
      seedCopies(server, 3);
      server.seedProducts([headOf(0), headOf(1), headOf(2)]);
    });
    await r.engine.trigger('start');
    seen.length = 0;
    await r.engine.trigger('manual');
    expect(seen.map((s) => s.rpc)).toEqual(['delta']);
    expect(seen[0].loading).toBeNull();
  });

  it('a later pull of more than one page is said from its second page on', async () => {
    const { r, seen } = await watched((server) => {
      seedCopies(server, 1);
      server.seedProducts([headOf(0)]);
    });
    await r.engine.trigger('start');
    // another device adds DELTA_PAGE copies of one head: more than one page of the feed, no card due
    r.server.write(
      Array.from({ length: DELTA_PAGE }, (_, i) => ({
        facetKey: occFacetKey(occOf(1000 + i), 'head'),
        version: serverVersion(T0, 1000 + i),
        op: SyncOp.UPSERT,
        payload: JSON.stringify({ head_id: headOf(0), ...STAMP }),
      })),
    );
    r.server.write([{ facetKey: occFacetKey(occOf(2000), 'head'), version: serverVersion(T0, 3000), op: SyncOp.UPSERT, payload: JSON.stringify({ head_id: headOf(0), ...STAMP }) }]);
    seen.length = 0;
    await r.engine.trigger('manual');
    const pulls = seen.filter((s) => s.rpc === 'delta').map((s) => s.loading);
    expect(pulls[0]).toBeNull();
    expect(pulls.length).toBeGreaterThan(1);
    expect(pulls.slice(1)).toEqual(pulls.slice(1).map((_, i) => ({ step: 'pull', pages: i + 1 })));
    expect(seen.some((s) => s.rpc === 'getProducts')).toBe(false);
  });

  it('a pass that fails part way says nothing once it has failed', async () => {
    const { r } = await watched((server) => {
      seedCopies(server, 3);
    });
    r.server.fault('getProducts', { kind: 'throw', error: new ConnectError('down', Code.Unavailable) });
    await r.engine.trigger('start');
    expect(r.server.count('getProducts')).toBe(1);
    expect(r.engine.state.value.loading).toBeNull();
  });
});

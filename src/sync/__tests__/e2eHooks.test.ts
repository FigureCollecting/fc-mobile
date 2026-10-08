import { describe, expect, it } from 'vitest';
import { ufFacetKey } from '@figurecollecting/fc-api-contract';
import { createSyncHooks, installSyncHooks } from '../e2eHooks';
import { headOf, rig } from './engineSupport';

describe('sync e2e hooks', () => {
  it('make edits through the engine, run a pass, and read back the store', async () => {
    const r = await rig();
    r.server.seedProducts([headOf(0)]);
    const hooks = createSyncHooks(r.engine);
    const occ = await hooks.createCopy(headOf(0), 'ordered');
    await hooks.writeNote(headOf(0), 'hello');
    const shelf = await hooks.createCollection('owned', 'Shelf');
    expect(hooks.state().pending).toBe(4);
    expect(await hooks.counts()).toMatchObject({ shown: 1, products: 0, cursor: '', outbox: { PENDING: 4 } });
    const after = await hooks.syncNow();
    expect(after).toMatchObject({ pending: 0, reachability: 'reachable' });
    await hooks.setStatus(occ, 'owned');
    await hooks.moveCopy(occ, `owned/${shelf}`);
    await hooks.syncNow();
    expect(await hooks.copies()).toEqual([{ occ_id: occ, head_id: headOf(0), status: 'owned', shown_in: `owned/${shelf}` }]);
    const counts = await hooks.counts();
    expect(counts).toMatchObject({ shown: 1, products: 1, outbox: { APPLIED: 7 } });
    expect(counts.cursor).not.toBe('');
    const outbox = await hooks.outbox();
    expect(outbox[0]).toMatchObject({ state: 'APPLIED', outcome: 'APPLIED', client_id: expect.any(String) });
    expect(outbox.some((e) => 'reason' in e)).toBe(false);
    expect(JSON.parse((await hooks.facet(ufFacetKey(headOf(0), 'note')))!.value!.payload).note).toBe('hello');
  });

  it('report a REJECTED reason in the outbox', async () => {
    const r = await rig();
    r.server.now -= 10 * 60_000; // the device's clock runs 10 min ahead of the server's
    const hooks = createSyncHooks(r.engine);
    await hooks.writeNote(headOf(0), 'x');
    expect(await hooks.outbox()).toEqual([{ facet_key: ufFacetKey(headOf(0), 'note'), state: 'PENDING' }]);
    // This session's first Status has been taken (from a clock far ahead, so it rebased nothing):
    // the edit goes out as minted and the server answers version_future.
    await r.store.onStatus({ cursor: '', serverNowIso: '2099-01-01T00:00:00.000000Z', pendingReview: 0n }, 0);
    await hooks.syncNow();
    expect((await hooks.outbox())[0]).toMatchObject({ state: 'REJECTED', reason: 'version_future' });
  });

  it('install on a target object', async () => {
    const r = await rig();
    const target: { __fcSync?: unknown } = {};
    installSyncHooks(r.engine, target);
    expect(target.__fcSync).toBeDefined();
  });
});

// The screens re-read the local store when the engine says its data may have changed: after every
// pass (whatever it came to), after every local write, and after REJECTED edits are dismissed.
import { describe, expect, it } from 'vitest';
import { Code, ConnectError } from '@connectrpc/connect';
import { ufFacetKey } from '@figurecollecting/fc-api-contract';
import { headOf, rig, seedCopies } from './engineSupport';

describe('SyncEngine.changes', () => {
  it('starts at 0 and moves after a pass that pulled', async () => {
    const r = await rig();
    expect(r.engine.changes.value).toBe(0);
    seedCopies(r.server, 3);
    await r.engine.trigger('start');
    expect(r.engine.changes.value).toBeGreaterThan(0);
  });

  it('moves after a pass that failed, so a screen re-reads what the store holds', async () => {
    const r = await rig();
    r.server.fault('status', { kind: 'throw', error: new ConnectError('down', Code.Unavailable) });
    const before = r.engine.changes.value;
    await r.engine.trigger('start');
    expect(r.engine.state.value.reachability).toBe('unreachable');
    expect(r.engine.changes.value).toBe(before + 1);
  });

  it('moves after a local write, before its sync runs', async () => {
    const r = await rig();
    const before = r.engine.changes.value;
    await r.engine.write((store) => store.writeFacet(ufFacetKey(headOf(1), 'note'), { note: 'hi' }));
    expect(r.engine.changes.value).toBe(before + 1);
    expect(r.timers.delays()).toEqual([1000]);
  });

  it('moves after REJECTED edits are dismissed', async () => {
    const r = await rig();
    const before = r.engine.changes.value;
    await r.engine.dismissRejected();
    expect(r.engine.changes.value).toBe(before + 1);
  });

  it('moves after a held pass too (sign in to sync): what waits is shown', async () => {
    const r = await rig({ deps: { blocked: () => true } });
    const before = r.engine.changes.value;
    await r.engine.trigger('start');
    expect(r.engine.state.value.phase).toBe('paused');
    expect(r.engine.changes.value).toBe(before + 1);
  });
});

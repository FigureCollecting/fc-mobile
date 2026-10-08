// useCollection on the local store (WK-15): the whole collection from IndexedDB, no page cap and no
// request, re-read whenever the engine says the store changed; the same PaginatedResponse shape.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/preact';
import { Code, ConnectError } from '@connectrpc/connect';
import { localRig, queryWrapper } from '../../local/__tests__/localHarness';
import { headOf, seedCopies } from '../../sync/__tests__/engineSupport';
import { localSession } from '../../local/session';
import { useAuthPhase, useLastSynced } from '../../local/useLocal';
import { useCollection } from '../useCollection';

const pwaStorage = vi.hoisted(() => ({ markHydrated: vi.fn(async () => undefined) }));
vi.mock('../../pwa/storage', () => ({ markHydrated: pwaStorage.markHydrated }));

afterEach(() => {
  localSession.value = undefined;
});

describe('useCollection', () => {
  it('waits, fetching nothing, while no session is published', () => {
    const { result } = renderHook(() => useCollection(), { wrapper: queryWrapper() });
    expect(result.current.data).toBeUndefined();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('reads nothing while signed out', async () => {
    const r = await localRig({ status: 'signed-out' });
    const read = vi.spyOn(r.engine, 'read');
    const { result } = renderHook(() => useCollection(), { wrapper: queryWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(read).not.toHaveBeenCalled();
  });

  it('returns every held figure, 250 of them, with no page cap and no network call', async () => {
    const r = await localRig();
    seedCopies(r.server, 250);
    r.server.seedProducts(Array.from({ length: 250 }, (_, i) => headOf(i)));
    await r.engine.trigger('start');
    const calls = r.server.calls.length;
    const { result } = renderHook(() => useCollection({ limit: 20 }), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data?.data).toHaveLength(250));
    expect(result.current.data).toMatchObject({ success: true, total: 250, count: 250, page: 1, pages: 1 });
    expect(result.current.data!.data[0]).toMatchObject({ collectionStatus: 'owned', name: `Figure ${headOf(0).slice(0, 8)}` });
    expect(r.server.calls.length).toBe(calls);
    expect(pwaStorage.markHydrated).toHaveBeenCalled();
  });

  it('filters by tab, the No longer owned tab included, and leaves former copies out of the whole collection', async () => {
    const r = await localRig();
    seedCopies(r.server, 2, 100, 'wished');
    await r.engine.trigger('start');
    const occ = await r.engine.write((s) => s.createCopy(headOf(9), 'owned'));
    await r.engine.write((s) => s.markFormer([occ], { reason: 'sold' }));
    const wrapper = queryWrapper();
    const wished = renderHook(() => useCollection({ status: 'wished' }), { wrapper });
    const former = renderHook(() => useCollection({ status: 'former' }), { wrapper });
    const all = renderHook(() => useCollection(), { wrapper });
    await waitFor(() => expect(former.result.current.data?.total).toBe(1));
    await waitFor(() => expect(wished.result.current.data?.total).toBe(2));
    await waitFor(() => expect(all.result.current.data?.total).toBe(2));
    expect(former.result.current.data!.data[0]!.local.copies[0]!.disposal).toMatchObject({ reason: 'sold' });
  });

  it('shows a local write at once as pending, and as known once the engine has synced it', async () => {
    const r = await localRig();
    await r.engine.trigger('start');
    const { result } = renderHook(() => useCollection(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data?.total).toBe(0));
    await act(async () => {
      await r.engine.write((s) => s.createCopy(headOf(3), 'ordered'));
    });
    await waitFor(() => expect(result.current.data?.data.map((f) => f.local.sync)).toEqual(['pending']));
    await act(() => r.engine.trigger('manual'));
    await waitFor(() => expect(result.current.data?.data.map((f) => f.local.sync)).toEqual(['known']));
  });

  it('marks settled items offline-stale while the server cannot be reached', async () => {
    const r = await localRig();
    seedCopies(r.server, 1);
    await r.engine.trigger('start');
    const { result } = renderHook(() => useCollection(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data?.data[0]?.local.sync).toBe('known'));
    r.server.fault('status', { kind: 'throw', error: new ConnectError('down', Code.Unavailable) });
    await act(() => r.engine.trigger('manual'));
    await waitFor(() => expect(result.current.data?.data[0]?.local.sync).toBe('offline-stale'));
  });

  it('marks settled items offline-stale while sync is held (sign in to sync)', async () => {
    let held = false;
    const r = await localRig({ deps: { blocked: () => held } });
    seedCopies(r.server, 1);
    await r.engine.trigger('start');
    const { result } = renderHook(() => useCollection(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data?.data[0]?.local.sync).toBe('known'));
    held = true;
    await act(() => r.engine.trigger('manual'));
    expect(r.engine.state.value.phase).toBe('paused');
    await waitFor(() => expect(result.current.data?.data[0]?.local.sync).toBe('offline-stale'));
  });

  it('surfaces a failed read as an error', async () => {
    const r = await localRig();
    vi.spyOn(r.engine, 'read').mockRejectedValue(new Error('store closed'));
    const { result } = renderHook(() => useCollection(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useLastSynced', () => {
  it('reads the last Status from sync_meta, and is null before any', async () => {
    const r = await localRig();
    const { result } = renderHook(() => useLastSynced(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current).toBeNull());
    await act(() => r.engine.trigger('start'));
    await waitFor(() => expect(result.current).toBe(r.clock.wallMs()));
  });
});

describe('useAuthPhase', () => {
  it('is loading with no session, then follows the session: signed-out, or signed-in for any status with a user', async () => {
    const { result } = renderHook(() => useAuthPhase(), { wrapper: queryWrapper() });
    expect(result.current).toBe('loading');
    const r = await localRig({ status: 'loading' });
    await waitFor(() => expect(result.current).toBe('loading'));
    act(() => {
      r.status.value = 'signed-out';
    });
    expect(result.current).toBe('signed-out');
    for (const s of ['signed-in', 'offline', 'reauth-required', 'reload-required'] as const) {
      act(() => {
        r.status.value = s;
      });
      expect(result.current).toBe('signed-in');
    }
  });
});

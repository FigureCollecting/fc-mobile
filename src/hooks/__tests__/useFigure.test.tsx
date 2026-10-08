// useFigure on the local store (WK-15): one figure, every copy of every kind, from IndexedDB.
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/preact';
import { localRig, queryWrapper } from '../../local/__tests__/localHarness';
import { headOf, seedCopies } from '../../sync/__tests__/engineSupport';
import { localSession } from '../../local/session';
import { useFigure } from '../useFigure';

afterEach(() => {
  localSession.value = undefined;
});

describe('useFigure', () => {
  it('is idle without an id', async () => {
    await localRig();
    const { result } = renderHook(() => useFigure(undefined), { wrapper: queryWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('reads the figure with its card and every copy, its status the first held kind', async () => {
    const r = await localRig();
    seedCopies(r.server, 1, 100, 'wished');
    r.server.seedProducts([headOf(0)]);
    await r.engine.trigger('start');
    await r.engine.write((s) => s.createCopy(headOf(0), 'ordered'));
    const { result } = renderHook(() => useFigure(headOf(0)), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toMatchObject({ _id: headOf(0), name: `Figure ${headOf(0).slice(0, 8)}`, collectionStatus: 'ordered', quantity: 1 });
    expect(result.current.data!.local.copies.map((c) => c.status).sort()).toEqual(['ordered', 'wished']);
    expect(result.current.data!.imageUrl).toBeUndefined();
  });

  it('errors for a figure the user holds no copy of', async () => {
    await localRig();
    const { result } = renderHook(() => useFigure(headOf(5)), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it('follows an edit', async () => {
    const r = await localRig();
    const occ = await r.engine.write((s) => s.createCopy(headOf(1), 'ordered'));
    const { result } = renderHook(() => useFigure(headOf(1)), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.data?.collectionStatus).toBe('ordered'));
    await act(async () => {
      await r.engine.write((s) => s.markArrived({ occ_id: occ }));
    });
    await waitFor(() => expect(result.current.data?.collectionStatus).toBe('owned'));
  });
});

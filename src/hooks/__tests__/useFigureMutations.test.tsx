// The edit hooks on the local store (WK-15): status, count, score and note are local writes through
// the engine (writeFacet and the store's intents), queued in the outbox and synced by WK-13's
// engine, the only sync path. The same mutate({ id, data }) signatures the pages bind to.
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/preact';
import { ufFacetKey } from '@figurecollecting/fc-api-contract';
import { localRig, queryWrapper, type LocalRig } from '../../local/__tests__/localHarness';
import { headOf } from '../../sync/__tests__/engineSupport';
import { localSession } from '../../local/session';
import { shownCopies } from '../../sync/occurrences';
import { useBulkDelete, useBulkUpdateStatus, useCopyActions, useDeleteFigure, useUpdateFigure } from '../useFigureMutations';

afterEach(() => {
  localSession.value = undefined;
});

const copiesOf = async (r: LocalRig, head: string) =>
  shownCopies(await r.store.getView())
    .filter((c) => c.head_id === head)
    .map((c) => c.status);

const live = async (r: LocalRig, key: string) => {
  const rec = await r.store.getFacet(key);
  return rec?.value?.op === 'upsert' ? JSON.parse(rec.value.payload) : null;
};

describe('useUpdateFigure', () => {
  it("changes the status of the figure's copies of its shown kind, in one batch, and schedules a sync", async () => {
    const r = await localRig();
    await r.engine.write(async (s) => {
      await s.createCopy(headOf(0), 'wished');
      await s.createCopy(headOf(0), 'wished');
    });
    r.timers.pending.clear();
    const { result } = renderHook(() => useUpdateFigure(), { wrapper: queryWrapper() });
    await act(() => result.current.mutateAsync({ id: headOf(0), data: { collectionStatus: 'ordered' } }));
    expect(await copiesOf(r, headOf(0))).toEqual(['ordered', 'ordered']);
    const groups = new Set((await r.store.listOutbox()).filter((e) => e.facet_key.endsWith('/status')).map((e) => e.group));
    expect(groups.size).toBe(3); // two creates and one move
    expect(r.timers.delays()).toEqual([1000]);
  });

  it('writes the note, score and wishability through writeFacet, and clears a note with a tombstone', async () => {
    const r = await localRig();
    await r.engine.write((s) => s.createCopy(headOf(1), 'owned'));
    const { result } = renderHook(() => useUpdateFigure(), { wrapper: queryWrapper() });
    await act(() => result.current.mutateAsync({ id: headOf(1), data: { note: 'mint in box', rating: 9, wishRating: 3 } }));
    expect(await live(r, ufFacetKey(headOf(1), 'note'))).toMatchObject({ note: 'mint in box' });
    expect(await live(r, ufFacetKey(headOf(1), 'score'))).toMatchObject({ score: 9 });
    expect(await live(r, ufFacetKey(headOf(1), 'wishability'))).toMatchObject({ wishability: 3 });
    await act(() => result.current.mutateAsync({ id: headOf(1), data: { note: '', rating: null } }));
    expect((await r.store.getFacet(ufFacetKey(headOf(1), 'note')))!.value).toMatchObject({ op: 'delete' });
    expect((await r.store.getFacet(ufFacetKey(headOf(1), 'score')))!.value).toMatchObject({ op: 'delete' });
  });

  it('sets the count of copies of the shown kind: adds copies, and removes the highest', async () => {
    const r = await localRig();
    await r.engine.write((s) => s.createCopy(headOf(2), 'owned'));
    const { result } = renderHook(() => useUpdateFigure(), { wrapper: queryWrapper() });
    await act(() => result.current.mutateAsync({ id: headOf(2), data: { quantity: 3 } }));
    const three = shownCopies(await r.store.getView()).filter((c) => c.head_id === headOf(2));
    expect(three.map((c) => c.status)).toEqual(['owned', 'owned', 'owned']);
    await act(() => result.current.mutateAsync({ id: headOf(2), data: { quantity: 1 } }));
    const left = shownCopies(await r.store.getView()).filter((c) => c.head_id === headOf(2));
    expect(left.map((c) => c.occ_id)).toEqual([three.map((c) => c.occ_id).sort()[0]]);
  });

  it('refuses a count below one, and an edit of a figure with no copy, writing nothing', async () => {
    const r = await localRig();
    await r.engine.write((s) => s.createCopy(headOf(3), 'owned'));
    const before = (await r.store.listOutbox()).length;
    const { result } = renderHook(() => useUpdateFigure(), { wrapper: queryWrapper() });
    await expect(result.current.mutateAsync({ id: headOf(3), data: { quantity: 0 } })).rejects.toThrow(/at least 1/);
    await expect(result.current.mutateAsync({ id: headOf(8), data: { note: 'x' } })).rejects.toThrow(/no copy/);
    expect((await r.store.listOutbox()).length).toBe(before);
  });

  it('fails when no session is published', async () => {
    const { result } = renderHook(() => useUpdateFigure(), { wrapper: queryWrapper() });
    await expect(result.current.mutateAsync({ id: headOf(0), data: { note: 'x' } })).rejects.toThrow(/not signed in/);
  });
});

describe('useDeleteFigure and the bulk hooks', () => {
  it('removes every shown copy of a figure but its former ones', async () => {
    const r = await localRig();
    const sold = await r.engine.write(async (s) => {
      await s.createCopy(headOf(0), 'owned');
      await s.createCopy(headOf(0), 'wished');
      return s.createCopy(headOf(0), 'owned');
    });
    await r.engine.write((s) => s.markFormer([sold], { reason: 'sold' }));
    const { result } = renderHook(() => useDeleteFigure(), { wrapper: queryWrapper() });
    await act(() => result.current.mutateAsync(headOf(0)));
    expect(await copiesOf(r, headOf(0))).toEqual(['former']);
  });

  it('moves the held copies of several figures to one status in one batch', async () => {
    const r = await localRig();
    await r.engine.write(async (s) => {
      await s.createCopy(headOf(0), 'wished');
      await s.createCopy(headOf(1), 'ordered');
      await s.createCopy(headOf(1), 'owned');
    });
    const { result } = renderHook(() => useBulkUpdateStatus(), { wrapper: queryWrapper() });
    await act(() => result.current.mutateAsync({ ids: [headOf(0), headOf(1)], status: 'owned' }));
    expect([...(await copiesOf(r, headOf(0))), ...(await copiesOf(r, headOf(1)))]).toEqual(['owned', 'owned', 'owned']);
    const last = (await r.store.listOutbox()).at(-1)!;
    expect((await r.store.listOutbox()).filter((e) => e.group === last.group).map((e) => e.facet_key.split('/').at(-1))).toEqual([
      'status',
      'collection',
      'status',
      'collection',
    ]);
  });

  it('bulk-removes figures', async () => {
    const r = await localRig();
    await r.engine.write(async (s) => {
      await s.createCopy(headOf(0), 'wished');
      await s.createCopy(headOf(1), 'ordered');
    });
    const { result } = renderHook(() => useBulkDelete(), { wrapper: queryWrapper() });
    await act(() => result.current.mutateAsync([headOf(0), headOf(1)]));
    expect(shownCopies(await r.store.getView())).toEqual([]);
  });
});

describe('useCopyActions', () => {
  it('marks an ordered copy arrived, moves, removes, dedupes, marks sold, and adds to the collection', async () => {
    const r = await localRig();
    const { result } = renderHook(() => useCopyActions(), { wrapper: queryWrapper() });
    const occ = await act(() => result.current.addToCollection(headOf(4), 'ordered'));
    expect(await copiesOf(r, headOf(4))).toEqual(['ordered']);
    await act(() => result.current.markArrived(occ));
    expect(await copiesOf(r, headOf(4))).toEqual(['owned']);
    const second = await act(() => result.current.addToCollection(headOf(4), 'owned'));
    await act(() => result.current.dedupe(headOf(4), 'owned'));
    expect(await copiesOf(r, headOf(4))).toEqual(['owned']);
    await act(() => result.current.moveCopies([occ], 'wished/default'));
    expect(await copiesOf(r, headOf(4))).toEqual(['wished']);
    await act(() => result.current.markFormer([occ], { reason: 'traded', counterparty: 'Ana' }));
    expect(await copiesOf(r, headOf(4))).toEqual(['former']);
    await act(() => result.current.removeCopy(occ));
    expect(await copiesOf(r, headOf(4))).toEqual([]);
    expect(second).not.toBe(occ);
  });

  it('reports a refused action as an error and writes nothing', async () => {
    const r = await localRig();
    const { result } = renderHook(() => useCopyActions(), { wrapper: queryWrapper() });
    const occ = await act(() => result.current.addToCollection(headOf(4), 'wished'));
    const before = (await r.store.listOutbox()).length;
    await expect(result.current.markArrived(occ)).rejects.toMatchObject({ code: 'kind_mismatch' });
    expect((await r.store.listOutbox()).length).toBe(before);
  });

  it('refreshes the screens after an action', async () => {
    const r = await localRig();
    const { result } = renderHook(() => useCopyActions(), { wrapper: queryWrapper() });
    const before = r.engine.changes.value;
    await act(() => result.current.addToCollection(headOf(4), 'wished'));
    await waitFor(() => expect(r.engine.changes.value).toBe(before + 1));
  });
});

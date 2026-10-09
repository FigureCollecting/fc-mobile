// The edit hooks on the local store (WK-15): status, count, score and note are local writes through
// the engine (writeFacet and the store's intents), queued in the outbox and synced by WK-13's
// engine, the only sync path. The same mutate({ id, data }) signatures the pages bind to.
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/preact';
import { QueryClient, onlineManager } from '@tanstack/react-query';
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
    // Clearing what no head holds writes nothing.
    const before = (await r.store.listOutbox()).length;
    await act(() => result.current.mutateAsync({ id: headOf(1), data: { note: '', wishRating: undefined } }));
    expect((await r.store.listOutbox()).length).toBe(before);
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

  it('writes nothing when every copy already has the status', async () => {
    const r = await localRig();
    await r.engine.write((s) => s.createCopy(headOf(0), 'owned'));
    const before = (await r.store.listOutbox()).length;
    const { result } = renderHook(() => useBulkUpdateStatus(), { wrapper: queryWrapper() });
    await act(() => result.current.mutateAsync({ ids: [headOf(0), headOf(9)], status: 'owned' }));
    expect((await r.store.listOutbox()).length).toBe(before);
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
    const call = async <T,>(fn: () => Promise<T>): Promise<T> => {
      let out: T;
      await act(async () => {
        out = await fn();
      });
      return out!;
    };
    const occ = await call(() => result.current.addToCollection(headOf(4), 'ordered'));
    expect(await copiesOf(r, headOf(4))).toEqual(['ordered']);
    await call(() => result.current.markArrived(occ));
    expect(await copiesOf(r, headOf(4))).toEqual(['owned']);
    const second = await call(() => result.current.addToCollection(headOf(4), 'owned'));
    // Dedupe keeps the lowest occurrence id of the two (ids are random here).
    const removed = await call(() => result.current.dedupe([headOf(4)], 'owned'));
    const kept = [occ, second].sort()[0]!;
    expect(removed).toEqual([[occ, second].sort()[1]]);
    expect(await copiesOf(r, headOf(4))).toEqual(['owned']);
    await call(() => result.current.moveCopies([kept], 'wished/default'));
    expect(await copiesOf(r, headOf(4))).toEqual(['wished']);
    await call(() => result.current.markFormer([kept], { reason: 'traded', counterparty: 'Ana' }));
    expect(await copiesOf(r, headOf(4))).toEqual(['former']);
    await call(() => result.current.removeCopy(kept));
    expect(await copiesOf(r, headOf(4))).toEqual([]);
  });

  it('reports a refused action as an error and writes nothing', async () => {
    const r = await localRig();
    const { result } = renderHook(() => useCopyActions(), { wrapper: queryWrapper() });
    const occ = await result.current.addToCollection(headOf(4), 'wished');
    const before = (await r.store.listOutbox()).length;
    await expect(result.current.markArrived(occ)).rejects.toMatchObject({ code: 'kind_mismatch' });
    expect((await r.store.listOutbox()).length).toBe(before);
  });

  it('refreshes the screens after an action', async () => {
    const r = await localRig();
    const { result } = renderHook(() => useCopyActions(), { wrapper: queryWrapper() });
    const before = r.engine.changes.value;
    await act(async () => {
      await result.current.addToCollection(headOf(4), 'wished');
    });
    await waitFor(() => expect(r.engine.changes.value).toBe(before + 1));
  });
});

// WK-16 F9/F12: in Airplane mode the browser fires 'offline' and TanStack's onlineManager reads
// offline. A mutation on the default networkMode ('online') is then paused in memory: 'Saving…'
// never resolves, nothing reaches the store, and killing the app loses the edit. The local-store
// edits run whatever the network says, on the app's own QueryClient defaults (not 'always').
describe('offline: the edit hooks commit to the local store at once (WK-13b)', () => {
  afterEach(() => {
    onlineManager.setOnline(true);
  });

  const appClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const STUCK = Symbol('stuck');
  // A paused mutation never settles: give it 1 s, as 'Saving…' would hang.
  const settles = <T,>(p: Promise<T>): Promise<T | typeof STUCK> => Promise.race([p, new Promise<typeof STUCK>((res) => setTimeout(() => res(STUCK), 1_000))]);

  it('useUpdateFigure writes the note to the store and its outbox offline, before any network', async () => {
    const r = await localRig();
    await r.engine.write((s) => s.createCopy(headOf(1), 'owned'));
    const calls = r.server.calls.length;
    onlineManager.setOnline(false);
    const { result } = renderHook(() => useUpdateFigure(), { wrapper: queryWrapper(appClient()) });
    let out: unknown;
    await act(async () => {
      out = await settles(result.current.mutateAsync({ id: headOf(1), data: { note: 'kept offline' } }));
    });
    expect(out).not.toBe(STUCK);
    expect(await live(r, ufFacetKey(headOf(1), 'note'))).toMatchObject({ note: 'kept offline' });
    expect((await r.store.getFacet(ufFacetKey(headOf(1), 'note')))!.pending_id).not.toBeNull();
    expect((await r.store.listOutbox()).filter((e) => e.facet_key === ufFacetKey(headOf(1), 'note')).map((e) => e.state)).toEqual(['PENDING']);
    expect(r.server.calls.length).toBe(calls);
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.isPaused).toBe(false);
  });

  it.each([
    ['useDeleteFigure', () => useDeleteFigure(), (m: { mutateAsync: (v: never) => Promise<unknown> }) => m.mutateAsync(headOf(2) as never)],
    ['useBulkUpdateStatus', () => useBulkUpdateStatus(), (m: { mutateAsync: (v: never) => Promise<unknown> }) => m.mutateAsync({ ids: [headOf(2)], status: 'ordered' } as never)],
    ['useBulkDelete', () => useBulkDelete(), (m: { mutateAsync: (v: never) => Promise<unknown> }) => m.mutateAsync([headOf(2)] as never)],
  ])('%s commits offline', async (_name, hook, run) => {
    const r = await localRig();
    await r.engine.write((s) => s.createCopy(headOf(2), 'owned'));
    const before = (await r.store.listOutbox()).length;
    onlineManager.setOnline(false);
    const { result } = renderHook(hook, { wrapper: queryWrapper(appClient()) });
    let out: unknown;
    await act(async () => {
      out = await settles(run(result.current as never));
    });
    expect(out).not.toBe(STUCK);
    expect((await r.store.listOutbox()).length).toBeGreaterThan(before);
  });
});

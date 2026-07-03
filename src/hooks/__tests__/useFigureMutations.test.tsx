import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@figurecollecting/fc-shared', async () => {
  const actual = await vi.importActual<typeof import('@figurecollecting/fc-shared')>(
    '@figurecollecting/fc-shared',
  );
  return { ...actual, updateFigure: vi.fn(), deleteFigure: vi.fn() };
});

// Mock the online-status hook so we can toggle it explicitly per test without
// juggling event dispatch timing.
const onlineSignal = { value: true };
vi.mock('../useOnlineStatus', () => ({
  useOnlineStatus: () => onlineSignal,
}));

// Mock pendingOps so tests don't exercise IndexedDB.
vi.mock('../../storage/pendingOps', () => ({
  queueOperation: vi.fn().mockResolvedValue(undefined),
  getPendingOpsCount: vi.fn().mockResolvedValue(0),
  flushPendingOps: vi.fn().mockResolvedValue({ success: 0, failed: 0 }),
}));

import { updateFigure, deleteFigure } from '@figurecollecting/fc-shared';
import {
  useUpdateFigure,
  useDeleteFigure,
  useBulkUpdateStatus,
  useBulkDelete,
} from '../useFigureMutations';

const mockedUpdate = updateFigure as unknown as ReturnType<typeof vi.fn>;
const mockedDelete = deleteFigure as unknown as ReturnType<typeof vi.fn>;

function makeWrapper() {
  const client = new QueryClient({
    // gcTime high enough that optimistic cache writes don't get swept before
    // the test can inspect them.
    defaultOptions: { queries: { retry: false, gcTime: 5 * 60_000 }, mutations: { retry: false } },
  });
  return {
    client,
    Wrapper: ({ children }: { children: unknown }) => (
      <QueryClientProvider client={client}>{children as any}</QueryClientProvider>
    ),
  };
}

describe('figure mutation hooks', () => {
  beforeEach(() => {
    mockedUpdate.mockReset();
    mockedDelete.mockReset();
    onlineSignal.value = true;
  });

  it('updateFigure calls the API when online', async () => {
    mockedUpdate.mockResolvedValue({ _id: 'f1', name: 'x' } as any);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateFigure(), { wrapper: Wrapper });

    act(() => { result.current.mutate({ id: 'f1', data: { note: 'hi' } as any }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedUpdate).toHaveBeenCalled();
  });

  it('deleteFigure calls the API when online', async () => {
    mockedDelete.mockResolvedValue(undefined);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDeleteFigure(), { wrapper: Wrapper });

    act(() => { result.current.mutate('f1'); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedDelete).toHaveBeenCalledWith(expect.anything(), 'f1');
  });

  it('bulk update status calls updateFigure for every id', async () => {
    mockedUpdate.mockResolvedValue({} as any);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useBulkUpdateStatus(), { wrapper: Wrapper });

    act(() => { result.current.mutate({ ids: ['a', 'b'], status: 'owned' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedUpdate).toHaveBeenCalledTimes(2);
  });

  it('bulk delete calls deleteFigure for every id', async () => {
    mockedDelete.mockResolvedValue(undefined);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useBulkDelete(), { wrapper: Wrapper });

    act(() => { result.current.mutate(['a', 'b', 'c']); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedDelete).toHaveBeenCalledTimes(3);
  });

  // Offline paths — queue operations and apply optimistic cache updates.
  function goOffline() {
    onlineSignal.value = false;
  }

  it('updateFigure queues an offline op and updates query cache optimistically', async () => {
    const { client, Wrapper } = makeWrapper();
    client.setQueryData(['figure', 'f1'], { _id: 'f1', name: 'orig', manufacturer: 'GSC' });
    goOffline();
    const { result } = renderHook(() => useUpdateFigure(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({
        id: 'f1',
        data: { note: 'offline-note', collectionStatus: 'owned' } as any,
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const cached = client.getQueryData(['figure', 'f1']) as any;
    expect(cached?.note).toBe('offline-note');
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('deleteFigure offline removes the figure from cached collection lists', async () => {
    const { client, Wrapper } = makeWrapper();
    client.setQueryData(
      ['collection', { page: 1, limit: 20, sortBy: 'activity', sortOrder: 'asc' }],
      { success: true, data: [{ _id: 'f1' }, { _id: 'f2' }], count: 2, page: 1, pages: 1, total: 2 },
    );
    const { result } = renderHook(() => useDeleteFigure(), { wrapper: Wrapper });
    goOffline();

    act(() => { result.current.mutate('f1'); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const cached = client.getQueryData<any>([
      'collection', { page: 1, limit: 20, sortBy: 'activity', sortOrder: 'asc' },
    ]);
    expect(cached?.data).toHaveLength(1);
    expect(cached?.data[0]._id).toBe('f2');
  });

  it('bulkUpdateStatus offline updates each matching figure', async () => {
    const { client, Wrapper } = makeWrapper();
    client.setQueryData(
      ['collection', { page: 1, limit: 20 }],
      { success: true, data: [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }], count: 3, page: 1, pages: 1, total: 3 },
    );
    const { result } = renderHook(() => useBulkUpdateStatus(), { wrapper: Wrapper });
    goOffline();

    act(() => { result.current.mutate({ ids: ['a', 'b'], status: 'owned' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const cached = client.getQueryData<any>(['collection', { page: 1, limit: 20 }]);
    expect(cached?.data.find((f: any) => f._id === 'a').collectionStatus).toBe('owned');
    expect(cached?.data.find((f: any) => f._id === 'b').collectionStatus).toBe('owned');
    expect(cached?.data.find((f: any) => f._id === 'c').collectionStatus).toBeUndefined();
  });

  it('bulkDelete offline removes every id from cached lists', async () => {
    const { client, Wrapper } = makeWrapper();
    client.setQueryData(
      ['collection', { page: 1, limit: 20 }],
      { success: true, data: [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }], count: 3, page: 1, pages: 1, total: 3 },
    );
    const { result } = renderHook(() => useBulkDelete(), { wrapper: Wrapper });
    goOffline();

    act(() => { result.current.mutate(['a', 'c']); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const cached = client.getQueryData<any>(['collection', { page: 1, limit: 20 }]);
    expect(cached?.data.map((f: any) => f._id)).toEqual(['b']);
  });
});

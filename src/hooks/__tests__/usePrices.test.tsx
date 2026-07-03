import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

import { api } from '../../api/client';
import {
  useWatchlist,
  usePriceHistory,
  useCurrentPrices,
  useAlerts,
  useAddToWatchlist,
  useRemoveFromWatchlist,
  useSaveAlert,
  useDeleteAlert,
} from '../usePrices';
import { useAuthStore } from '../../stores/auth';

const apiGet = api.get as unknown as ReturnType<typeof vi.fn>;
const apiPost = api.post as unknown as ReturnType<typeof vi.fn>;
const apiPut = api.put as unknown as ReturnType<typeof vi.fn>;
const apiDel = api.delete as unknown as ReturnType<typeof vi.fn>;

function signIn() {
  useAuthStore.setState({
    user: {
      _id: 'u1', username: 't', email: 'a@b.co', isAdmin: false,
      token: 'tok', tokenExpiresAt: Date.now() + 60_000,
    },
    isAuthenticated: true,
    lastActivity: Date.now(),
    twoFactorPending: null,
  });
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return {
    client,
    Wrapper: ({ children }: { children: unknown }) => (
      <QueryClientProvider client={client}>{children as any}</QueryClientProvider>
    ),
  };
}

describe('price hooks', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPut.mockReset();
    apiDel.mockReset();
  });

  it('useWatchlist returns payload from the watchlist endpoint', async () => {
    signIn();
    apiGet.mockResolvedValueOnce({ data: { items: [], summary: { totalItems: 0, avgTrend: 'stable', avgTrendPercent: 0 } } });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useWatchlist(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiGet).toHaveBeenCalledWith('/prices/watchlist');
  });

  it('usePriceHistory and useCurrentPrices query the right URLs', async () => {
    signIn();
    apiGet.mockResolvedValue({ data: [] });
    const { Wrapper } = makeWrapper();
    const { result: history } = renderHook(() => usePriceHistory('f1'), { wrapper: Wrapper });
    const { result: current } = renderHook(() => useCurrentPrices('f1'), { wrapper: Wrapper });
    await waitFor(() => expect(history.current.isSuccess).toBe(true));
    await waitFor(() => expect(current.current.isSuccess).toBe(true));
    expect(apiGet).toHaveBeenCalledWith('/prices/f1/history');
    expect(apiGet).toHaveBeenCalledWith('/prices/f1/current');
  });

  it('useAlerts switches URL based on figureId', async () => {
    signIn();
    apiGet.mockResolvedValue({ data: [] });
    const { Wrapper } = makeWrapper();
    const { result: scoped } = renderHook(() => useAlerts('f1'), { wrapper: Wrapper });
    await waitFor(() => expect(scoped.current.isSuccess).toBe(true));
    expect(apiGet).toHaveBeenCalledWith('/prices/alerts?figureId=f1');
    const { result: all } = renderHook(() => useAlerts(), { wrapper: Wrapper });
    await waitFor(() => expect(all.current.isSuccess).toBe(true));
    expect(apiGet).toHaveBeenCalledWith('/prices/alerts');
  });

  it('useAddToWatchlist POSTs /prices/watchlist', async () => {
    apiPost.mockResolvedValueOnce({ data: {} });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useAddToWatchlist(), { wrapper: Wrapper });
    act(() => { result.current.mutate('fig-1'); });
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/prices/watchlist', { figureId: 'fig-1' }));
  });

  it('useRemoveFromWatchlist DELETEs /prices/watchlist/:id', async () => {
    apiDel.mockResolvedValueOnce({ data: {} });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRemoveFromWatchlist(), { wrapper: Wrapper });
    act(() => { result.current.mutate('fig-x'); });
    await waitFor(() => expect(apiDel).toHaveBeenCalledWith('/prices/watchlist/fig-x'));
  });

  it('useSaveAlert POSTs for a new alert and PUTs when updating an existing one', async () => {
    apiPost.mockResolvedValueOnce({ data: {} });
    apiPut.mockResolvedValueOnce({ data: {} });
    const { Wrapper } = makeWrapper();

    const { result: create } = renderHook(() => useSaveAlert(), { wrapper: Wrapper });
    act(() => {
      create.current.mutate({
        figureId: 'f1', figureName: 'x', type: 'price_below',
        sites: [], pushEnabled: true,
      } as any);
    });
    await waitFor(() => expect(apiPost).toHaveBeenCalled());

    const { result: update } = renderHook(() => useSaveAlert(), { wrapper: Wrapper });
    act(() => {
      update.current.mutate({
        _id: 'a1', figureId: 'f1', figureName: 'x', type: 'price_below',
        sites: [], pushEnabled: true,
      } as any);
    });
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/prices/alerts/a1', expect.any(Object)));
  });

  it('useDeleteAlert DELETEs /prices/alerts/:id', async () => {
    apiDel.mockResolvedValueOnce({ data: {} });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDeleteAlert(), { wrapper: Wrapper });
    act(() => { result.current.mutate('a2'); });
    await waitFor(() => expect(apiDel).toHaveBeenCalledWith('/prices/alerts/a2'));
  });
});

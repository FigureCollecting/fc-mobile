import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

import { api } from '../../api/client';
import {
  useCollectionAnalytics,
  useCollectionBreakdown,
  useCollectionTimeline,
  usePriceSummary,
} from '../useAnalytics';
import { useAuthStore } from '../../stores/auth';

const apiGet = api.get as unknown as ReturnType<typeof vi.fn>;

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

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: unknown }) => (
    <QueryClientProvider client={client}>{children as any}</QueryClientProvider>
  );
}

describe('analytics hooks', () => {
  beforeEach(() => apiGet.mockReset());

  it('useCollectionAnalytics returns analytics data', async () => {
    signIn();
    apiGet.mockResolvedValueOnce({
      data: { analytics: { totalFigures: 10, statusCounts: { owned: 5, ordered: 2, wished: 3 }, totalValue: null, uniqueManufacturers: 4 } },
    });
    const { result } = renderHook(() => useCollectionAnalytics(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.totalFigures).toBe(10);
  });

  it('useCollectionAnalytics surfaces errors instead of returning mocks', async () => {
    signIn();
    apiGet.mockRejectedValueOnce(new Error('nope'));
    const { result } = renderHook(() => useCollectionAnalytics(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('useCollectionBreakdown fetches with groupBy param', async () => {
    signIn();
    apiGet.mockResolvedValueOnce({ data: { breakdown: [{ _id: 'GSC', count: 4 }] } });
    const { result } = renderHook(() => useCollectionBreakdown('manufacturer'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiGet).toHaveBeenCalledWith('/analytics/collection/breakdown?groupBy=manufacturer');
  });

  it('useCollectionTimeline defaults to 12 months', async () => {
    signIn();
    apiGet.mockResolvedValueOnce({ data: { timeline: [] } });
    const { result } = renderHook(() => useCollectionTimeline(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiGet).toHaveBeenCalledWith('/analytics/collection/timeline?months=12');
  });

  it('usePriceSummary fetches the summary endpoint', async () => {
    signIn();
    apiGet.mockResolvedValueOnce({ data: { summary: { trackedItems: 0, trends: { up: 0, down: 0, stable: 0 }, activeAlerts: 0 } } });
    const { result } = renderHook(() => usePriceSummary(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiGet).toHaveBeenCalledWith('/analytics/prices/summary');
  });
});

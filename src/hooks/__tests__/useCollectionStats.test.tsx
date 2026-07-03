import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@figurecollecting/fc-shared', async () => {
  const actual = await vi.importActual<typeof import('@figurecollecting/fc-shared')>(
    '@figurecollecting/fc-shared',
  );
  return { ...actual, getFigureStats: vi.fn() };
});

import { getFigureStats } from '@figurecollecting/fc-shared';
import { useCollectionStats } from '../useCollectionStats';
import { useAuthStore } from '../../stores/auth';

const mockedStats = getFigureStats as unknown as ReturnType<typeof vi.fn>;

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

describe('useCollectionStats', () => {
  beforeEach(() => mockedStats.mockReset());

  it('returns counts when the API succeeds', async () => {
    signIn();
    mockedStats.mockResolvedValueOnce({
      totalCount: 10,
      statusCounts: { owned: 5, ordered: 3, wished: 2 },
    });
    const { result } = renderHook(() => useCollectionStats(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total).toBe(10);
  });

  it('falls back to zero-count cache when API fails', async () => {
    signIn();
    mockedStats.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useCollectionStats(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total).toBe(0);
  });
});

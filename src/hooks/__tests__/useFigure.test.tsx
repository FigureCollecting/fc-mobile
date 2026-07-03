import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@figurecollecting/fc-shared', async () => {
  const actual = await vi.importActual<typeof import('@figurecollecting/fc-shared')>(
    '@figurecollecting/fc-shared',
  );
  return { ...actual, getFigureById: vi.fn() };
});

import { getFigureById } from '@figurecollecting/fc-shared';
import { useFigure } from '../useFigure';
import { useAuthStore } from '../../stores/auth';
import { cacheFigures } from '../../storage/figureCache';

const mockedGet = getFigureById as unknown as ReturnType<typeof vi.fn>;

function signIn() {
  useAuthStore.setState({
    user: {
      _id: 'u1',
      username: 't',
      email: 'a@b.co',
      isAdmin: false,
      token: 'tok',
      tokenExpiresAt: Date.now() + 60_000,
    },
    isAuthenticated: true,
    lastActivity: Date.now(),
    twoFactorPending: null,
  });
}

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: unknown }) => (
    <QueryClientProvider client={client}>{children as any}</QueryClientProvider>
  );
}

describe('useFigure', () => {
  beforeEach(() => mockedGet.mockReset());

  it('returns the fetched figure when the API succeeds', async () => {
    signIn();
    mockedGet.mockResolvedValueOnce({ _id: 'f1', name: 'Api Figure', manufacturer: 'GSC' });

    const { result } = renderHook(() => useFigure('f1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.name).toBe('Api Figure');
  });

  it('falls back to the IndexedDB cache when the API fails', async () => {
    signIn();
    await cacheFigures([
      { _id: 'f2', name: 'Cached Figure', manufacturer: 'Alter' } as any,
    ]);

    mockedGet.mockRejectedValueOnce(new Error('offline'));

    const { result } = renderHook(() => useFigure('f2'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.name).toBe('Cached Figure');
  });

  it('stays disabled and empty when unauthenticated', async () => {
    const { result } = renderHook(() => useFigure('f3'), { wrapper: wrapper() });
    // Not authenticated → query is disabled, never fetches.
    expect(mockedGet).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it('uses collection placeholderData when the figure is already in a collection query', async () => {
    signIn();
    mockedGet.mockResolvedValue({ _id: 'f4', name: 'Api Figure', manufacturer: 'X' });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 5 * 60_000 } } });
    client.setQueryData(['collection', { page: 1 }], {
      success: true,
      data: [{ _id: 'f4', name: 'Placeholder Figure', manufacturer: 'X' }],
      count: 1, page: 1, pages: 1, total: 1,
    });
    const Wrapper = ({ children }: { children: unknown }) => (
      <QueryClientProvider client={client}>{children as any}</QueryClientProvider>
    );

    const { result } = renderHook(() => useFigure('f4'), { wrapper: Wrapper });
    // Initially placeholderData returns the match from the collection cache.
    expect(result.current.data?.name).toBe('Placeholder Figure');
    // Eventually the real fetch wins.
    await waitFor(() => expect(result.current.data?.name).toBe('Api Figure'));
  });
});

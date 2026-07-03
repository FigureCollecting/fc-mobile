import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@figurecollecting/fc-shared', async () => {
  const actual = await vi.importActual<typeof import('@figurecollecting/fc-shared')>(
    '@figurecollecting/fc-shared',
  );
  return { ...actual, getFigures: vi.fn() };
});

import { getFigures } from '@figurecollecting/fc-shared';
import { useCollection } from '../useCollection';
import { useAuthStore } from '../../stores/auth';
import { cacheFigures } from '../../storage/figureCache';

const mockedGetFigures = getFigures as unknown as ReturnType<typeof vi.fn>;

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

function makeFigure(id: string) {
  return {
    _id: id,
    user: 'u1',
    manufacturer: 'GSC',
    name: `Figure ${id}`,
  } as any;
}

describe('useCollection', () => {
  beforeEach(() => mockedGetFigures.mockReset());

  it('returns API data and caches it to IndexedDB', async () => {
    signIn();
    const figures = [makeFigure('1'), makeFigure('2')];
    mockedGetFigures.mockResolvedValueOnce({
      success: true,
      data: figures,
      count: 2,
      page: 1,
      pages: 1,
      total: 2,
    });

    const { result } = renderHook(() => useCollection(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(2);

    // Cache should now contain those figures.
    const { getCachedFigures } = await import('../../storage/figureCache');
    const cached = await getCachedFigures();
    expect(cached).toHaveLength(2);
  });

  it('falls back to cached figures when the API fails', async () => {
    signIn();
    // Pre-seed the cache.
    await cacheFigures([makeFigure('cached-a'), makeFigure('cached-b')]);

    mockedGetFigures.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useCollection(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const names = (result.current.data?.data ?? []).map((f) => f.name).sort();
    expect(names).toEqual(['Figure cached-a', 'Figure cached-b']);
  });

  it('propagates the error when the API fails AND the cache is empty', async () => {
    signIn();
    mockedGetFigures.mockRejectedValueOnce(new Error('nope'));

    const { result } = renderHook(() => useCollection(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

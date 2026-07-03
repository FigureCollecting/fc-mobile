import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@figurecollecting/fc-shared', async () => {
  const actual = await vi.importActual<typeof import('@figurecollecting/fc-shared')>(
    '@figurecollecting/fc-shared',
  );
  return { ...actual, searchFigures: vi.fn() };
});

import { searchFigures } from '@figurecollecting/fc-shared';
import { useSearch } from '../useSearch';
import { useAuthStore } from '../../stores/auth';

const mockedSearch = searchFigures as unknown as ReturnType<typeof vi.fn>;

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

describe('useSearch', () => {
  beforeEach(() => mockedSearch.mockReset());

  it('persists recent searches to localStorage', () => {
    const { result } = renderHook(() => useSearch(), { wrapper: wrapper() });
    act(() => result.current.saveRecentSearch('nendoroid'));
    expect(result.current.getRecentSearches()).toContain('nendoroid');
  });

  it('deduplicates and bounds recent searches', () => {
    const { result } = renderHook(() => useSearch(), { wrapper: wrapper() });
    act(() => {
      for (let i = 0; i < 12; i++) result.current.saveRecentSearch(`q${i}`);
      result.current.saveRecentSearch('q0'); // duplicate, should move to front
    });
    const recent = result.current.getRecentSearches();
    expect(recent.length).toBeLessThanOrEqual(10);
    expect(recent[0]).toBe('q0');
  });

  it('debounces the query and reports results', async () => {
    signIn();
    mockedSearch.mockResolvedValue([
      { id: 'r1', name: 'Result 1' } as any,
    ]);

    const { result } = renderHook(() => useSearch(), { wrapper: wrapper() });
    act(() => result.current.updateQuery('scale'));
    await waitFor(() => expect(mockedSearch).toHaveBeenCalled(), { timeout: 1000 });
    await waitFor(() => expect(result.current.results.length).toBe(1));
  });

  it('clears recent searches', () => {
    const { result } = renderHook(() => useSearch(), { wrapper: wrapper() });
    act(() => result.current.saveRecentSearch('foo'));
    expect(result.current.getRecentSearches()).toContain('foo');
    act(() => result.current.clearRecentSearches());
    expect(result.current.getRecentSearches()).toEqual([]);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@figurecollecting/fc-shared', async () => {
  const actual = await vi.importActual<typeof import('@figurecollecting/fc-shared')>(
    '@figurecollecting/fc-shared',
  );
  return { ...actual, getFigures: vi.fn() };
});

import { getFigures } from '@figurecollecting/fc-shared';
import { useUpcomingReleases } from '../useUpcomingReleases';
import { useAuthStore } from '../../stores/auth';

const mockedGetFigures = getFigures as unknown as ReturnType<typeof vi.fn>;

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

describe('useUpcomingReleases', () => {
  it('returns upcoming releases within the window sorted by soonest', async () => {
    signIn();
    const in5Days = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
    const in30Days = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const in90Days = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();

    mockedGetFigures.mockImplementation(
      (_api: unknown, _p: number, _l: number, _s: string, _o: string, status: string) => {
        if (status === 'ordered') {
          return Promise.resolve({
            success: true,
            data: [
              { _id: 'a', manufacturer: 'GSC', name: 'A', releases: [{ date: in30Days }] },
              { _id: 'b', manufacturer: 'GSC', name: 'B', releases: [{ date: in90Days }] },
            ],
            count: 2, page: 1, pages: 1, total: 2,
          });
        }
        return Promise.resolve({
          success: true,
          data: [{ _id: 'c', manufacturer: 'Alter', name: 'C', releases: [{ date: in5Days }] }],
          count: 1, page: 1, pages: 1, total: 1,
        });
      },
    );

    const { result } = renderHook(() => useUpcomingReleases(60), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.releases.length).toBeGreaterThan(0));
    // in90Days should be excluded; in5Days first, then in30Days
    expect(result.current.releases.map((r) => r.figure.name)).toEqual(['C', 'A']);
  });
});

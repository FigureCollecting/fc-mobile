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
import { useReleaseCalendar } from '../useReleaseCalendar';
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

describe('useReleaseCalendar', () => {
  it('filters releases to the selected month', async () => {
    signIn();
    const year = 2027;
    const month = 5; // June
    const releaseDate = new Date(year, month, 14).toISOString();

    mockedGetFigures.mockImplementation(
      (_api: unknown, _p: number, _l: number, _s: string, _o: string, status: string) => {
        if (status === 'ordered') {
          return Promise.resolve({
            success: true,
            data: [{
              _id: 'a', manufacturer: 'GSC', name: 'Fig A',
              collectionStatus: 'ordered',
              releases: [{ date: releaseDate }],
            }],
            count: 1, page: 1, pages: 1, total: 1,
          });
        }
        return Promise.resolve({ success: true, data: [], count: 0, page: 1, pages: 0, total: 0 });
      },
    );

    const { result } = renderHook(() => useReleaseCalendar(year, month), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.totalReleases).toBe(1));
    expect(result.current.releaseDays.has(14)).toBe(true);
  });
});

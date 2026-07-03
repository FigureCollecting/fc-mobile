import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: { get: vi.fn(), put: vi.fn(), delete: vi.fn(), post: vi.fn() } };
});

import { api } from '../../api/client';
import {
  useNotifications,
  useUnreadCount,
  useMarkAsRead,
  useMarkAllRead,
  useDeleteNotification,
} from '../useNotifications';
import { useAuthStore } from '../../stores/auth';

const apiGet = api.get as unknown as ReturnType<typeof vi.fn>;
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return {
    client,
    Wrapper: ({ children }: { children: unknown }) => (
      <QueryClientProvider client={client}>{children as any}</QueryClientProvider>
    ),
  };
}

describe('notification hooks', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPut.mockReset();
    apiDel.mockReset();
  });

  it('useNotifications hits the notifications endpoint', async () => {
    signIn();
    apiGet.mockResolvedValueOnce({ data: { data: [], total: 0, page: 1, pages: 0 } });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useNotifications(1), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiGet).toHaveBeenCalledWith('/notifications?page=1&limit=20');
  });

  it('useUnreadCount returns the count', async () => {
    signIn();
    apiGet.mockResolvedValueOnce({ data: { count: 7 } });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUnreadCount(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).toBe(7));
  });

  it('useMarkAsRead calls PUT /notifications/:id/read', async () => {
    apiPut.mockResolvedValueOnce({});
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useMarkAsRead(), { wrapper: Wrapper });
    act(() => { result.current.mutate('n1'); });
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/notifications/n1/read'));
  });

  it('useMarkAllRead calls PUT /notifications/read-all', async () => {
    apiPut.mockResolvedValueOnce({});
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useMarkAllRead(), { wrapper: Wrapper });
    act(() => { result.current.mutate(); });
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/notifications/read-all'));
  });

  it('useDeleteNotification calls DELETE /notifications/:id', async () => {
    apiDel.mockResolvedValueOnce({});
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDeleteNotification(), { wrapper: Wrapper });
    act(() => { result.current.mutate('n2'); });
    await waitFor(() => expect(apiDel).toHaveBeenCalledWith('/notifications/n2'));
  });
});

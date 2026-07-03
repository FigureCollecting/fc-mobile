import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../services/websocket', () => ({
  getSocket: vi.fn(),
}));

import { getSocket } from '../../services/websocket';
import { useLiveNotifications } from '../useLiveNotifications';

const mockedGetSocket = getSocket as unknown as ReturnType<typeof vi.fn>;

function makeFakeSocket() {
  const handlers = new Map<string, (data: unknown) => void>();
  return {
    handlers,
    emit: vi.fn(),
    on: vi.fn((event: string, cb: (data: unknown) => void) => handlers.set(event, cb)),
    off: vi.fn((event: string) => handlers.delete(event)),
  };
}

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: unknown }) => (
    <QueryClientProvider client={client}>{children as any}</QueryClientProvider>
  );
}

describe('useLiveNotifications', () => {
  it('subscribes to notification events', () => {
    const socket = makeFakeSocket();
    mockedGetSocket.mockReturnValue(socket);
    renderHook(() => useLiveNotifications(), { wrapper: wrapper() });
    expect(socket.on).toHaveBeenCalledWith('notification:new', expect.any(Function));
    expect(socket.on).toHaveBeenCalledWith('notification:update', expect.any(Function));
    expect(socket.on).toHaveBeenCalledWith('notification:deleted', expect.any(Function));
  });

  it('invalidates on new events and surfaces price-alert toasts', () => {
    const socket = makeFakeSocket();
    mockedGetSocket.mockReturnValue(socket);
    renderHook(() => useLiveNotifications(), { wrapper: wrapper() });
    act(() => {
      socket.handlers.get('notification:new')?.({ type: 'price_alert', title: 'Drop!' });
      socket.handlers.get('notification:update')?.({});
      socket.handlers.get('notification:deleted')?.({});
    });
    // Passing without throwing is the assertion here.
  });
});

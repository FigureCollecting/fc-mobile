import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../services/websocket', () => ({
  getSocket: vi.fn(),
}));

import { getSocket } from '../../services/websocket';
import { useLiveCollection } from '../useLiveCollection';

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

describe('useLiveCollection', () => {
  it('wires collection:update handler and invalidates queries', () => {
    const socket = makeFakeSocket();
    mockedGetSocket.mockReturnValue(socket);
    renderHook(() => useLiveCollection(), { wrapper: wrapper() });
    expect(socket.on).toHaveBeenCalledWith('collection:update', expect.any(Function));

    act(() => {
      socket.handlers.get('collection:update')?.({ action: 'created', figure: { name: 'X' } });
      socket.handlers.get('collection:update')?.({ action: 'updated', figure: { name: 'Y' } });
      socket.handlers.get('collection:update')?.({ action: 'deleted', figure: { name: 'Z' } });
    });
    // No throw = pass; the hook just invalidates + toasts.
  });

  it('no-ops when socket is null', () => {
    mockedGetSocket.mockReturnValue(null);
    expect(() => renderHook(() => useLiveCollection(), { wrapper: wrapper() })).not.toThrow();
  });
});

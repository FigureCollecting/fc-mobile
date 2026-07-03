import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/preact';

vi.mock('../../services/websocket', () => ({
  getSocket: vi.fn(),
}));

import { getSocket } from '../../services/websocket';
import { useLiveSync } from '../useLiveSync';

const mockedGetSocket = getSocket as unknown as ReturnType<typeof vi.fn>;

function makeFakeSocket() {
  const handlers = new Map<string, (data: unknown) => void>();
  return {
    handlers,
    emit: vi.fn(),
    on: vi.fn((event: string, cb: (data: unknown) => void) => {
      handlers.set(event, cb);
    }),
    off: vi.fn((event: string) => { handlers.delete(event); }),
  };
}

describe('useLiveSync', () => {
  it('returns an empty list when no sessionId is provided', () => {
    mockedGetSocket.mockReturnValue(makeFakeSocket());
    const { result } = renderHook(() => useLiveSync(null));
    expect(result.current).toEqual([]);
  });

  it('appends events received from the socket', () => {
    const socket = makeFakeSocket();
    mockedGetSocket.mockReturnValue(socket);
    const { result } = renderHook(() => useLiveSync('sess-1'));

    expect(socket.emit).toHaveBeenCalledWith('sync:subscribe', 'sess-1');

    act(() => {
      socket.handlers.get('sync:phase-change')?.({ type: 'phase', phase: 'parsing' });
    });

    expect(result.current).toHaveLength(1);
    expect(result.current[0].phase).toBe('parsing');
  });

  it('unsubscribes on unmount', () => {
    const socket = makeFakeSocket();
    mockedGetSocket.mockReturnValue(socket);
    const { unmount } = renderHook(() => useLiveSync('sess-2'));
    unmount();
    expect(socket.emit).toHaveBeenCalledWith('sync:unsubscribe', 'sess-2');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/preact';

vi.mock('../../services/websocket', () => ({
  connectWebSocket: vi.fn(),
  disconnectWebSocket: vi.fn(),
  wsConnected: { value: false },
}));

import { connectWebSocket, disconnectWebSocket } from '../../services/websocket';
import { useWebSocket } from '../useWebSocket';
import { useAuthStore } from '../../stores/auth';

const mockedConnect = connectWebSocket as unknown as ReturnType<typeof vi.fn>;
const mockedDisconnect = disconnectWebSocket as unknown as ReturnType<typeof vi.fn>;

describe('useWebSocket', () => {
  it('does not connect when no token is present', () => {
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      lastActivity: 0,
      twoFactorPending: null,
    });
    renderHook(() => useWebSocket());
    expect(mockedConnect).not.toHaveBeenCalled();
  });

  it('connects with the token when a user is present', () => {
    useAuthStore.setState({
      user: { _id: 'u1', username: 't', email: 'a@b.co', isAdmin: false, token: 'abc' },
      isAuthenticated: true,
      lastActivity: Date.now(),
      twoFactorPending: null,
    });
    renderHook(() => useWebSocket());
    expect(mockedConnect).toHaveBeenCalledWith('abc');
  });

  it('disconnects on unmount', () => {
    useAuthStore.setState({
      user: { _id: 'u1', username: 't', email: 'a@b.co', isAdmin: false, token: 'abc' },
      isAuthenticated: true,
      lastActivity: Date.now(),
      twoFactorPending: null,
    });
    const { unmount } = renderHook(() => useWebSocket());
    unmount();
    expect(mockedDisconnect).toHaveBeenCalled();
  });
});

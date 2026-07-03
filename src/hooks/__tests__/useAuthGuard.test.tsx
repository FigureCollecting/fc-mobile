import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/preact';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { ComponentChildren } from 'preact';

import { useAuthGuard } from '../useAuthGuard';
import { useAuthStore } from '../../stores/auth';

function withRouter(initialPath: string) {
  const loc = memoryLocation({ path: initialPath, record: true });
  const Wrapper = ({ children }: { children: ComponentChildren }) => (
    <Router hook={loc.hook}>{children}</Router>
  );
  return { Wrapper, history: loc.history! };
}

describe('useAuthGuard', () => {
  it('redirects unauthenticated users to /login', async () => {
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      lastActivity: 0,
      twoFactorPending: null,
    });

    const { Wrapper, history } = withRouter('/figure/123');
    renderHook(() => useAuthGuard(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(history[history.length - 1]).toBe('/login');
    });
  });

  it('returns true and does not redirect when authenticated', async () => {
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

    const { Wrapper, history } = withRouter('/');
    const { result } = renderHook(() => useAuthGuard(), { wrapper: Wrapper });

    // Let any effect-driven navigation attempt settle.
    await new Promise((r) => setTimeout(r, 10));

    expect(result.current).toBe(true);
    expect(history[history.length - 1]).toBe('/');
  });

  it('avoids loop: never silently swaps a logged-in user back to /login', async () => {
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

    const pushSpy = vi.fn();
    const { Wrapper } = withRouter('/settings');
    const { result } = renderHook(() => useAuthGuard(), { wrapper: Wrapper });
    // No navigation attempts should have fired.
    expect(pushSpy).not.toHaveBeenCalled();
    expect(result.current).toBe(true);
  });
});

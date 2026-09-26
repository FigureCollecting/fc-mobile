import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

// Exercises the LEGACY_SCREENS_ENABLED=true path: notifications, export, MFC
// sync, and push-notification quick actions all reappear.
vi.mock('../../config/features', () => ({ LEGACY_SCREENS_ENABLED: true }));

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() } };
});

const unreadState = vi.hoisted(() => ({ count: 12 }));
vi.mock('../../hooks/useNotifications', () => ({
  useUnreadCount: () => ({ data: unreadState.count }),
}));

vi.mock('../../hooks/usePushNotifications', () => ({
  usePushNotifications: () => ({
    isSupported: true,
    isSubscribed: false,
    permission: 'default',
    loading: false,
    requestPermission: vi.fn(),
    unsubscribe: vi.fn(),
  }),
}));

import { Profile } from '../Profile';
import { renderWithProviders } from '../../test/testUtils';
import { useAuthStore } from '../../stores/auth';

function signIn() {
  useAuthStore.setState({
    user: {
      _id: 'u1', username: 'tester', email: 'a@b.co', isAdmin: false,
      token: 'tok', tokenExpiresAt: Date.now() + 60 * 60_000,
    },
    isAuthenticated: true,
    lastActivity: Date.now(),
    twoFactorPending: null,
  });
}

describe('Profile page (LEGACY_SCREENS_ENABLED=true)', () => {
  it('shows the notifications, export, MFC sync and push quick actions', () => {
    signIn();
    renderWithProviders(<Profile />, { initialPath: '/profile' });

    expect(screen.getByText(/^notifications$/i)).toBeInTheDocument();
    expect(screen.getByText('9+')).toBeInTheDocument(); // unreadCount=12, badge caps at 9+
    expect(screen.getByText(/export & share/i)).toBeInTheDocument();
    expect(screen.getByText(/^mfc sync$/i)).toBeInTheDocument();
    expect(screen.getByText(/push notifications/i)).toBeInTheDocument();
  });

  it('navigates to /notifications from the quick action', async () => {
    signIn();
    const user = userEvent.setup();
    const { currentPath } = renderWithProviders(<Profile />, { initialPath: '/profile' });
    await user.click(screen.getByText(/^notifications$/i));
    expect(currentPath()).toBe('/notifications');
  });

  it('navigates to /export from the quick action', async () => {
    signIn();
    const user = userEvent.setup();
    const { currentPath } = renderWithProviders(<Profile />, { initialPath: '/profile' });
    await user.click(screen.getByText(/export & share/i));
    expect(currentPath()).toBe('/export');
  });

  it('opens the MFC Sync bottom sheet from the quick action', async () => {
    signIn();
    const user = userEvent.setup();
    renderWithProviders(<Profile />, { initialPath: '/profile' });
    await user.click(screen.getByText(/^mfc sync$/i));
    expect(await screen.findByRole('heading', { name: /mfc sync/i })).toBeInTheDocument();
  });
});

describe('Profile page (LEGACY_SCREENS_ENABLED=true, no unread notifications)', () => {
  it('hides the unread badge when the count is zero', () => {
    unreadState.count = 0;
    signIn();
    renderWithProviders(<Profile />, { initialPath: '/profile' });
    expect(screen.getByText(/^notifications$/i)).toBeInTheDocument();
    expect(screen.queryByText('9+')).not.toBeInTheDocument();
  });
});

describe('Profile page (LEGACY_SCREENS_ENABLED=true, single-digit unread count)', () => {
  it('shows the raw count under 10, not the "9+" cap', () => {
    unreadState.count = 3;
    signIn();
    renderWithProviders(<Profile />, { initialPath: '/profile' });
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.queryByText('9+')).not.toBeInTheDocument();
  });
});

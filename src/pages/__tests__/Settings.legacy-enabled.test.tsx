import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

// Exercises the LEGACY_SCREENS_ENABLED=true path: the push-notification
// toggle and its "blocked in browser settings" hint reappear.
vi.mock('../../config/features', () => ({ LEGACY_SCREENS_ENABLED: true }));

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

const pushState = vi.hoisted(() => ({
  isSupported: true,
  isSubscribed: false,
  permission: 'default' as NotificationPermission,
  loading: false,
}));

vi.mock('../../hooks/usePushNotifications', () => ({
  usePushNotifications: () => ({
    ...pushState,
    requestPermission: vi.fn(),
    unsubscribe: vi.fn(),
  }),
}));

import { Settings } from '../Settings';
import { renderWithProviders } from '../../test/testUtils';
import { useAuthStore } from '../../stores/auth';

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

function pushToggle() {
  return screen.getByText('Push Notifications').closest('.settings__row')!.querySelector('[role="switch"]')!;
}

describe('Settings page (LEGACY_SCREENS_ENABLED=true)', () => {
  it('subscribing: toggling on requests permission', async () => {
    Object.assign(pushState, { isSupported: true, isSubscribed: false, permission: 'default', loading: false });
    signIn();
    const user = userEvent.setup();
    renderWithProviders(<Settings />, { initialPath: '/settings' });

    const toggle = pushToggle();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
  });

  it('unsubscribing: toggling off unsubscribes', async () => {
    Object.assign(pushState, { isSupported: true, isSubscribed: true, permission: 'default', loading: false });
    signIn();
    const user = userEvent.setup();
    renderWithProviders(<Settings />, { initialPath: '/settings' });

    const toggle = pushToggle();
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);
  });

  it('shows the blocked hint and disables the toggle when permission is denied', () => {
    Object.assign(pushState, { isSupported: true, isSubscribed: false, permission: 'denied', loading: false });
    signIn();
    renderWithProviders(<Settings />, { initialPath: '/settings' });

    expect(screen.getByText(/blocked in browser settings/i)).toBeInTheDocument();
    expect(pushToggle()).toBeDisabled();
  });
});

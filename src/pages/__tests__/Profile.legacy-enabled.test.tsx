import { afterEach, describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

// Exercises the LEGACY_SCREENS_ENABLED=true path: the notifications, export and push quick actions
// reappear. The MFC cookie sync is gone for good: the MFC export import replaces it (WK-15).
vi.mock('../../config/features', () => ({ LEGACY_SCREENS_ENABLED: true }));

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

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
import { localRig } from '../../local/__tests__/localHarness';
import { localSession } from '../../local/session';

afterEach(() => {
  localSession.value = undefined;
});

describe('Profile page (LEGACY_SCREENS_ENABLED=true)', () => {
  it('shows the notifications, export and push quick actions, and no MFC cookie sync', async () => {
    await localRig();
    renderWithProviders(<Profile />, { initialPath: '/profile' });
    expect(screen.getByText(/^notifications$/i)).toBeInTheDocument();
    expect(screen.getByText(/export & share/i)).toBeInTheDocument();
    expect(screen.getByText(/push notifications/i)).toBeInTheDocument();
    expect(screen.queryByText(/^mfc sync$/i)).not.toBeInTheDocument();
  });

  it('navigates to /notifications from the quick action', async () => {
    await localRig();
    const user = userEvent.setup();
    const { currentPath } = renderWithProviders(<Profile />, { initialPath: '/profile' });
    await user.click(screen.getByText(/^notifications$/i));
    expect(currentPath()).toBe('/notifications');
  });

  it('navigates to /export from the quick action', async () => {
    await localRig();
    const user = userEvent.setup();
    const { currentPath } = renderWithProviders(<Profile />, { initialPath: '/profile' });
    await user.click(screen.getByText(/export & share/i));
    expect(currentPath()).toBe('/export');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/preact';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

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

describe('Settings page', () => {
  it('renders without crashing for authenticated users', () => {
    signIn();
    renderWithProviders(<Settings />, { initialPath: '/settings' });
    expect(screen.getAllByText(/settings/i).length).toBeGreaterThan(0);
  });

  it('renders without crashing for guests too', () => {
    renderWithProviders(<Settings />, { initialPath: '/settings' });
    expect(screen.getAllByText(/settings/i).length).toBeGreaterThan(0);
  });
});

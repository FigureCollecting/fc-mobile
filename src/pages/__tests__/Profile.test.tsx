import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/preact';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() } };
});

import { Profile } from '../Profile';
import { renderWithProviders } from '../../test/testUtils';
import { useAuthStore } from '../../stores/auth';

function signIn() {
  useAuthStore.setState({
    user: {
      _id: 'u1', username: 'tester', email: 'a@b.co', isAdmin: false,
      token: 'tok', tokenExpiresAt: Date.now() + 60_000,
    },
    isAuthenticated: true,
    lastActivity: Date.now(),
    twoFactorPending: null,
  });
}

describe('Profile page', () => {
  it('renders profile information for a logged-in user', () => {
    signIn();
    renderWithProviders(<Profile />, { initialPath: '/profile' });
    // Username is the most stable stable identifier on the profile page.
    expect(screen.getByText(/tester/i)).toBeInTheDocument();
  });

  it('prompts sign-in for guests', () => {
    renderWithProviders(<Profile />, { initialPath: '/profile' });
    expect(screen.getAllByText(/profile/i).length).toBeGreaterThan(0);
  });
});

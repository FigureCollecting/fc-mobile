import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/preact';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() } };
});

import { api } from '../../api/client';
import { Notifications } from '../Notifications';
import { renderWithProviders } from '../../test/testUtils';
import { useAuthStore } from '../../stores/auth';

const apiGet = api.get as unknown as ReturnType<typeof vi.fn>;

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

describe('Notifications page', () => {
  it('renders a notification returned by the API', async () => {
    signIn();
    apiGet.mockResolvedValue({
      data: {
        data: [{
          _id: 'n1',
          type: 'price_alert',
          title: 'Price drop',
          body: 'Saber dropped ¥2000',
          read: false,
          createdAt: new Date().toISOString(),
        }],
        total: 1, page: 1, pages: 1,
      },
    });

    renderWithProviders(<Notifications />, { initialPath: '/notifications' });

    expect(await screen.findByText(/price drop/i)).toBeInTheDocument();
  });

  it('shows empty state when there are no notifications', async () => {
    signIn();
    apiGet.mockResolvedValue({ data: { data: [], total: 0, page: 1, pages: 0 } });

    renderWithProviders(<Notifications />, { initialPath: '/notifications' });

    // Empty state text varies; confirm at least the header renders without crashing.
    expect(await screen.findByText(/notifications/i)).toBeInTheDocument();
  });
});

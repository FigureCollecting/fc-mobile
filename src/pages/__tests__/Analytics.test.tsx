import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/preact';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() } };
});

import { api } from '../../api/client';
import { Analytics } from '../Analytics';
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

describe('Analytics page', () => {
  it('renders the overview using API data', async () => {
    signIn();
    apiGet.mockImplementation((url: string) => {
      if (url === '/analytics/collection') {
        return Promise.resolve({
          data: { analytics: {
            totalFigures: 42,
            statusCounts: { owned: 30, ordered: 8, wished: 4 },
            totalValue: 123_456,
            uniqueManufacturers: 7,
          } },
        });
      }
      if (url.startsWith('/analytics/collection/breakdown')) {
        return Promise.resolve({ data: { breakdown: [] } });
      }
      if (url.startsWith('/analytics/collection/timeline')) {
        return Promise.resolve({ data: { timeline: [] } });
      }
      if (url === '/analytics/prices/summary') {
        return Promise.resolve({ data: { summary: { trackedItems: 0, trends: { up: 0, down: 0, stable: 0 }, activeAlerts: 0 } } });
      }
      return Promise.resolve({ data: {} });
    });

    renderWithProviders(<Analytics />, { initialPath: '/analytics' });

    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByText(/total figures/i)).toBeInTheDocument();
  });

  it('prompts unauthenticated visitors', () => {
    renderWithProviders(<Analytics />, { initialPath: '/analytics' });
    expect(screen.getByText(/sign in to view your collection analytics/i)).toBeInTheDocument();
  });
});

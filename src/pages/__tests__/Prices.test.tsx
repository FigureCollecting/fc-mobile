import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

// Mock the shared api client so `api.get` can be controlled per test.
vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
      put: vi.fn(),
    },
  };
});

import { api } from '../../api/client';
import { Prices } from '../Prices';
import { renderWithProviders } from '../../test/testUtils';
import { useAuthStore } from '../../stores/auth';

const apiGet = api.get as unknown as ReturnType<typeof vi.fn>;

function signIn() {
  useAuthStore.setState({
    user: {
      _id: 'u1',
      username: 'tester',
      email: 'a@b.co',
      isAdmin: false,
      token: 'tok',
      tokenExpiresAt: Date.now() + 60_000,
    },
    isAuthenticated: true,
    lastActivity: Date.now(),
    twoFactorPending: null,
  });
}

describe('Prices page', () => {
  it('does not silently render mock data — an API failure produces an error state with retry', async () => {
    const user = userEvent.setup();
    signIn();
    apiGet.mockRejectedValueOnce(new Error('boom'));
    apiGet.mockResolvedValueOnce({
      data: { items: [], summary: { totalItems: 0, avgTrend: 'stable', avgTrendPercent: 0 } },
    });

    renderWithProviders(<Prices />, { initialPath: '/prices' });

    expect(await screen.findByText(/couldn't load watchlist/i)).toBeInTheDocument();

    // There should not be fabricated figure names showing through.
    expect(screen.queryByText(/hatsune miku: magical mirai/i)).not.toBeInTheDocument();

    const retry = screen.getByRole('button', { name: /retry/i });
    await user.click(retry);
    expect(await screen.findByText(/no tracked items/i)).toBeInTheDocument();
  });

  it('renders the empty state when the watchlist is empty', async () => {
    signIn();
    apiGet.mockResolvedValueOnce({
      data: { items: [], summary: { totalItems: 0, avgTrend: 'stable', avgTrendPercent: 0 } },
    });

    renderWithProviders(<Prices />, { initialPath: '/prices' });

    expect(await screen.findByText(/no tracked items/i)).toBeInTheDocument();
  });

  it('prompts unauthenticated visitors to sign in', () => {
    renderWithProviders(<Prices />, { initialPath: '/prices' });
    expect(screen.getByText(/sign in to track prices/i)).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/preact';

vi.mock('@figurecollecting/fc-shared', async () => {
  const actual = await vi.importActual<typeof import('@figurecollecting/fc-shared')>(
    '@figurecollecting/fc-shared',
  );
  return { ...actual, getFigureStats: vi.fn() };
});

vi.mock('../../api/client', () => ({
  api: { get: vi.fn() },
}));

import { getFigureStats } from '@figurecollecting/fc-shared';
import { api } from '../../api/client';
import { Stats } from '../Stats';
import { renderWithProviders } from '../../test/testUtils';
import { useAuthStore } from '../../stores/auth';

const mockedStats = getFigureStats as unknown as ReturnType<typeof vi.fn>;
const mockedGet = api.get as unknown as ReturnType<typeof vi.fn>;

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

beforeEach(() => {
  mockedStats.mockReset();
  mockedGet.mockReset();
});

describe('Stats page', () => {
  it('prompts sign-in for guests', () => {
    useAuthStore.setState({ user: null, isAuthenticated: false, lastActivity: 0, twoFactorPending: null });
    renderWithProviders(<Stats />);
    expect(screen.getByText(/sign in to see your stats/i)).toBeInTheDocument();
  });

  it('renders status tiles and manufacturer breakdown', async () => {
    signIn();
    mockedStats.mockResolvedValue({
      totalCount: 42,
      statusCounts: { owned: 30, ordered: 7, wished: 5 },
    });
    mockedGet.mockResolvedValue({
      data: { breakdown: [{ _id: 'Good Smile Company', count: 12 }, { _id: 'Max Factory', count: 4 }] },
    });

    renderWithProviders(<Stats />);

    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(await screen.findByText('Good Smile Company')).toBeInTheDocument();
  });
});

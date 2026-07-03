import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

vi.mock('@figurecollecting/fc-shared', async () => {
  const actual = await vi.importActual<typeof import('@figurecollecting/fc-shared')>(
    '@figurecollecting/fc-shared',
  );
  return {
    ...actual,
    searchFigures: vi.fn(),
    getFigures: vi.fn().mockResolvedValue({
      success: true, data: [], count: 0, page: 1, pages: 0, total: 0,
    }),
  };
});

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    api: {
      get: vi.fn().mockResolvedValue({ data: { breakdown: [] } }),
      post: vi.fn(), put: vi.fn(), delete: vi.fn(),
    },
  };
});

import { searchFigures } from '@figurecollecting/fc-shared';
import { Discover } from '../Discover';
import { renderWithProviders } from '../../test/testUtils';
import { useAuthStore } from '../../stores/auth';

const mockedSearch = searchFigures as unknown as ReturnType<typeof vi.fn>;

function signIn() {
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
}

describe('Discover page', () => {
  it('renders the search field and a default placeholder', () => {
    signIn();
    renderWithProviders(<Discover />, { initialPath: '/discover' });
    expect(screen.getByPlaceholderText(/search figures/i)).toBeInTheDocument();
    expect(screen.getByText(/browse the catalog/i)).toBeInTheDocument();
  });

  it('shows a retry error state when search fails', async () => {
    const user = userEvent.setup();
    signIn();
    mockedSearch.mockRejectedValue(new Error('boom'));

    renderWithProviders(<Discover />, { initialPath: '/discover' });
    const input = screen.getByPlaceholderText(/search figures/i);
    await user.click(input);
    await user.type(input, 'abc');

    expect(await screen.findByText(/search failed/i)).toBeInTheDocument();
  });

  it('shows empty state when the search returns no matches', async () => {
    const user = userEvent.setup();
    signIn();
    mockedSearch.mockResolvedValue([]);

    renderWithProviders(<Discover />, { initialPath: '/discover' });
    const input = screen.getByPlaceholderText(/search figures/i);
    await user.click(input);
    await user.type(input, 'nothing-like-this-exists');

    expect(await screen.findByText(/no results found/i)).toBeInTheDocument();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/preact';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  };
});

vi.mock('@figurecollecting/fc-shared', async () => {
  const actual = await vi.importActual<typeof import('@figurecollecting/fc-shared')>(
    '@figurecollecting/fc-shared',
  );
  return { ...actual, getFigureById: vi.fn() };
});

import { api } from '../../api/client';
import { getFigureById } from '@figurecollecting/fc-shared';
import { PriceDetail } from '../PriceDetail';
import { renderWithProviders } from '../../test/testUtils';
import { useAuthStore } from '../../stores/auth';

const apiGet = api.get as unknown as ReturnType<typeof vi.fn>;
const mockedGetFigure = getFigureById as unknown as ReturnType<typeof vi.fn>;

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

describe('PriceDetail page', () => {
  it('renders figure information when the API returns data (no mock fallback)', async () => {
    signIn();
    mockedGetFigure.mockResolvedValueOnce({
      _id: 'f1',
      manufacturer: 'GSC',
      name: 'Real Figure Name',
      imageUrl: '',
    });
    apiGet.mockImplementation((url: string) => {
      if (url.includes('/current')) return Promise.resolve({ data: [] });
      if (url.includes('/history')) return Promise.resolve({ data: [] });
      if (url.includes('/alerts')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });

    renderWithProviders(<PriceDetail />, { initialPath: '/prices/f1' });

    expect(await screen.findByText('Real Figure Name')).toBeInTheDocument();
    // Absolutely no fabricated Hatsune Miku line anywhere on the page.
    expect(screen.queryByText(/hatsune miku: magical mirai/i)).not.toBeInTheDocument();
  });

  it('shows an error state when the figure lookup fails', async () => {
    signIn();
    mockedGetFigure.mockRejectedValueOnce(new Error('not found'));
    apiGet.mockResolvedValue({ data: [] });

    renderWithProviders(<PriceDetail />, { initialPath: '/prices/f2' });

    expect(await screen.findByText(/couldn't load figure/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});

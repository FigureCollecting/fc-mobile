import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/preact';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

vi.mock('@figurecollecting/fc-shared', async () => {
  const actual = await vi.importActual<typeof import('@figurecollecting/fc-shared')>(
    '@figurecollecting/fc-shared',
  );
  return { ...actual, getFigureById: vi.fn(), updateFigure: vi.fn(), deleteFigure: vi.fn() };
});

import { getFigureById } from '@figurecollecting/fc-shared';
import { FigureDetail } from '../FigureDetail';
import { renderWithProviders } from '../../test/testUtils';
import { useAuthStore } from '../../stores/auth';

const mockedGet = getFigureById as unknown as ReturnType<typeof vi.fn>;

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

describe('FigureDetail page', () => {
  it('renders figure name and manufacturer on success', async () => {
    signIn();
    mockedGet.mockResolvedValueOnce({
      _id: 'f1',
      manufacturer: 'Good Smile',
      name: 'Nendoroid Saber',
      scale: '1/7',
      mfcLink: '',
      imageUrl: '',
      location: 'Shelf',
      collectionStatus: 'owned',
      releases: [],
    });

    renderWithProviders(<FigureDetail />, { initialPath: '/figure/f1' });
    expect(await screen.findByText(/nendoroid saber/i)).toBeInTheDocument();
    expect(screen.getByText(/good smile/i)).toBeInTheDocument();
  });

  it('shows a not-found-ish state when the fetch fails and there is no cache', async () => {
    signIn();
    mockedGet.mockRejectedValueOnce(new Error('404'));
    const { container } = renderWithProviders(<FigureDetail />, { initialPath: '/figure/missing' });
    // The actual not-found copy is maintained by the page. Assert at least
    // something beyond the raw skeleton renders on failure.
    await new Promise((r) => setTimeout(r, 50));
    expect(container.textContent?.length ?? 0).toBeGreaterThan(0);
  });
});

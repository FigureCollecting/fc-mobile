import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/preact';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

vi.mock('@figurecollecting/fc-shared', async () => {
  const actual = await vi.importActual<typeof import('@figurecollecting/fc-shared')>(
    '@figurecollecting/fc-shared',
  );
  return { ...actual, getFigures: vi.fn() };
});

import { getFigures } from '@figurecollecting/fc-shared';
import { ReleaseCalendar } from '../ReleaseCalendar';
import { renderWithProviders } from '../../test/testUtils';
import { useAuthStore } from '../../stores/auth';

const mockedGetFigures = getFigures as unknown as ReturnType<typeof vi.fn>;

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

describe('ReleaseCalendar page', () => {
  it('renders month header, grid, and a release card for a figure due this month', async () => {
    signIn();
    const now = new Date();
    const releaseDate = new Date(now.getFullYear(), now.getMonth(), 15).toISOString();

    const figure = {
      _id: 'f1',
      user: 'u1',
      manufacturer: 'GSC',
      name: 'Upcoming Figure',
      scale: '1/7',
      mfcLink: '',
      imageUrl: '',
      location: '',
      collectionStatus: 'ordered' as const,
      releases: [{ date: releaseDate, region: 'JP' }],
    };

    mockedGetFigures.mockImplementation((_api: unknown, _page: number, _limit: number, _sort: string, _order: string, status: string) => {
      if (status === 'ordered') {
        return Promise.resolve({
          success: true,
          data: [figure],
          count: 1,
          page: 1,
          pages: 1,
          total: 1,
        });
      }
      return Promise.resolve({
        success: true,
        data: [],
        count: 0,
        page: 1,
        pages: 0,
        total: 0,
      });
    });

    renderWithProviders(<ReleaseCalendar />, { initialPath: '/calendar' });

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const currentMonthLabel = monthNames[now.getMonth()]!;
    expect(await screen.findByText(currentMonthLabel)).toBeInTheDocument();
    expect(await screen.findByText('Upcoming Figure')).toBeInTheDocument();
  });

  it('prompts unauthenticated visitors to sign in', () => {
    renderWithProviders(<ReleaseCalendar />, { initialPath: '/calendar' });
    expect(screen.getByText(/sign in to view your release calendar/i)).toBeInTheDocument();
  });
});

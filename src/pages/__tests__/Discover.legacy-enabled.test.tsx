import { describe, it, expect, vi } from 'vitest';

// Exercises the LEGACY_SCREENS_ENABLED=true path: the manufacturer breakdown
// still fetches when the flag opts back into the legacy backend.
vi.mock('../../config/features', () => ({ LEGACY_SCREENS_ENABLED: true }));

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));
vi.mock('photoswipe', () => ({ default: class {} }));
vi.mock('photoswipe/style.css', () => ({}));

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

import { waitFor } from '@testing-library/preact';
import { api } from '../../api/client';
import { Discover } from '../Discover';
import { renderWithProviders } from '../../test/testUtils';
import { useAuthStore } from '../../stores/auth';

const mockedGet = api.get as unknown as ReturnType<typeof vi.fn>;

function signIn() {
  useAuthStore.setState({
    user: {
      _id: 'u1', username: 't', email: 'a@b.co', isAdmin: false,
      token: 'tok', tokenExpiresAt: Date.now() + 60 * 60_000,
    },
    isAuthenticated: true,
    lastActivity: Date.now(),
    twoFactorPending: null,
  });
}

describe('Discover page (LEGACY_SCREENS_ENABLED=true)', () => {
  it('fetches the manufacturer breakdown for suggestions', async () => {
    signIn();
    renderWithProviders(<Discover />, { initialPath: '/discover' });
    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith('/analytics/collection/breakdown?groupBy=manufacturer'),
    );
  });
});

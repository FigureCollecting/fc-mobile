import { describe, it, expect, vi } from 'vitest';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

vi.mock('@figurecollecting/fc-shared', async () => {
  const actual = await vi.importActual<typeof import('@figurecollecting/fc-shared')>(
    '@figurecollecting/fc-shared',
  );
  return {
    ...actual,
    getFigures: vi.fn().mockResolvedValue({
      success: true, data: [], count: 0, page: 1, pages: 0, total: 0,
    }),
  };
});

import { Export } from '../Export';
import { renderWithProviders } from '../../test/testUtils';
import { useAuthStore } from '../../stores/auth';

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

describe('Export page', () => {
  it('mounts without crashing', () => {
    signIn();
    const { container } = renderWithProviders(<Export />, { initialPath: '/export' });
    expect(container.textContent?.length ?? 0).toBeGreaterThan(0);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/preact';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
    scraperApi: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  };
});

import { Import } from '../Import';
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

describe('Import page', () => {
  it('mounts without crashing for authenticated users', () => {
    signIn();
    const { container } = renderWithProviders(<Import />, { initialPath: '/import' });
    expect(container.textContent?.length ?? 0).toBeGreaterThan(0);
    expect(screen.getAllByText(/import/i).length).toBeGreaterThan(0);
  });
});

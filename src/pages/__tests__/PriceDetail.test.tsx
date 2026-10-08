import { afterEach, describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/preact';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  };
});

import { api } from '../../api/client';
import { PriceDetail } from '../PriceDetail';
import { renderWithProviders } from '../../test/testUtils';
import { useAuthStore } from '../../stores/auth';
import { localRig } from '../../local/__tests__/localHarness';
import { seedFigures } from '../../local/__tests__/seedFigures';
import { localSession } from '../../local/session';
import { headOf } from '../../sync/__tests__/engineSupport';

const apiGet = api.get as unknown as ReturnType<typeof vi.fn>;

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

afterEach(() => {
  localSession.value = undefined;
});

// The figure comes from the local store (WK-15); prices stay on the legacy API (a gated screen).
describe('PriceDetail page', () => {
  it('renders figure information when the API returns data (no mock fallback)', async () => {
    signIn();
    const r = await localRig();
    await seedFigures(r, [{ title: 'Real Figure Name', manufacturer: 'GSC' }]);
    apiGet.mockImplementation((url: string) => {
      if (url.includes('/current')) return Promise.resolve({ data: [] });
      if (url.includes('/history')) return Promise.resolve({ data: [] });
      if (url.includes('/alerts')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });

    renderWithProviders(<PriceDetail />, { initialPath: `/prices/${headOf(0)}` });

    expect(await screen.findByText('Real Figure Name')).toBeInTheDocument();
    // Absolutely no fabricated Hatsune Miku line anywhere on the page.
    expect(screen.queryByText(/hatsune miku: magical mirai/i)).not.toBeInTheDocument();
  });

  it('shows an error state when the figure lookup fails', async () => {
    signIn();
    await localRig();
    apiGet.mockResolvedValue({ data: [] });

    renderWithProviders(<PriceDetail />, { initialPath: '/prices/f2' });

    expect(await screen.findByText(/couldn't load figure/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});

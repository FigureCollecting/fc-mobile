import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

vi.mock('../../storage/cacheManager', () => ({
  getCacheStats: vi.fn(),
  clearAllCaches: vi.fn().mockResolvedValue(undefined),
}));

import { getCacheStats } from '../../storage/cacheManager';
import { Settings } from '../Settings';
import { renderWithProviders } from '../../test/testUtils';
import { useAuthStore } from '../../stores/auth';

const mockedGetCacheStats = getCacheStats as unknown as ReturnType<typeof vi.fn>;

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

beforeEach(() => {
  mockedGetCacheStats.mockReset();
  mockedGetCacheStats.mockResolvedValue({ figureCount: 0, pendingOpsCount: 0, estimatedSizeKb: 0 });
});

describe('Settings page', () => {
  it('renders without crashing for authenticated users', () => {
    signIn();
    renderWithProviders(<Settings />, { initialPath: '/settings' });
    expect(screen.getAllByText(/settings/i).length).toBeGreaterThan(0);
  });

  it('renders without crashing for guests too', () => {
    renderWithProviders(<Settings />, { initialPath: '/settings' });
    expect(screen.getAllByText(/settings/i).length).toBeGreaterThan(0);
  });

  it('re-reads real cache stats after Clear Cache (pending ops are kept, not zeroed)', async () => {
    signIn();
    mockedGetCacheStats
      .mockResolvedValueOnce({ figureCount: 5, pendingOpsCount: 3, estimatedSizeKb: 10 })
      .mockResolvedValueOnce({ figureCount: 0, pendingOpsCount: 3, estimatedSizeKb: 1 });

    const user = userEvent.setup();
    renderWithProviders(<Settings />, { initialPath: '/settings' });

    expect(await screen.findByText('5')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^clear cache$/i }));
    const sheet = await screen.findByText(/clear cache\?/i);
    const confirmButton = sheet.closest('.settings__confirm')!.querySelector('.settings__confirm-btn--warning')!;
    await user.click(confirmButton);

    // The re-read (not a hardcoded {figureCount: 0, pendingOpsCount: 0, ...})
    // is what surfaces the real, unzeroed pendingOpsCount here.
    await waitFor(() => expect(mockedGetCacheStats).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('0')).toBeInTheDocument();
  });
});

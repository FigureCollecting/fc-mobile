import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

vi.mock('../../storage/cacheManager', () => ({
  getCacheStats: vi.fn(),
  clearAllCaches: vi.fn().mockResolvedValue(undefined),
}));

const pwaStorage = vi.hoisted(() => ({ readStorageStatus: vi.fn() }));
vi.mock('../../pwa/storage', () => ({ readStorageStatus: pwaStorage.readStorageStatus }));

// The real check unless a test says otherwise: jsdom has no service worker.
const pwaUpdates = vi.hoisted(() => ({ checkForUpdate: vi.fn() }));
vi.mock('../../pwa/updates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../pwa/updates')>();
  pwaUpdates.checkForUpdate.mockImplementation(actual.checkForUpdate);
  return { ...actual, checkForUpdate: pwaUpdates.checkForUpdate };
});

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
  pwaUpdates.checkForUpdate.mockClear();
  pwaStorage.readStorageStatus.mockReset();
  pwaStorage.readStorageStatus.mockResolvedValue(null);
  mockedGetCacheStats.mockReset();
  mockedGetCacheStats.mockResolvedValue({ figureCount: 0, pendingOpsCount: 0, estimatedSizeKb: 0 });
});

describe('Settings about', () => {
  it('shows the build next to the version, so a user can tell which build is running', () => {
    renderWithProviders(<Settings />, { initialPath: '/settings' });
    expect(screen.getByText(`0.1.0 (${import.meta.env.VITE_BUILD_ID})`)).toBeInTheDocument();
  });
});

describe('Settings check for update', () => {
  const checkButton = () => screen.getByRole('button', { name: 'Check for update' });

  it.each([
    ['ready', 'A new version is ready'],
    ['latest', 'You are on the latest build'],
    ['offline', 'Could not check (offline)'],
    ['unavailable', 'Update checks are not available here'],
  ] as const)('runs the check from About and reports %s as "%s"', async (outcome, message) => {
    pwaUpdates.checkForUpdate.mockResolvedValueOnce(outcome);
    renderWithProviders(<Settings />, { initialPath: '/settings' });
    expect(screen.queryByText(message)).toBeNull();
    await userEvent.click(checkButton());
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(pwaUpdates.checkForUpdate).toHaveBeenCalledTimes(1);
  });

  it('is disabled while a check runs, then offers it again', async () => {
    let finish: (o: 'latest') => void = () => {};
    pwaUpdates.checkForUpdate.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    renderWithProviders(<Settings />, { initialPath: '/settings' });
    await userEvent.click(checkButton());
    expect(checkButton()).toBeDisabled();
    expect(screen.getByText('Checking…')).toBeInTheDocument();
    finish('latest');
    expect(await screen.findByText('You are on the latest build')).toBeInTheDocument();
    expect(checkButton()).toBeEnabled();
    expect(screen.queryByText('Checking…')).toBeNull();
  });

  it('says checks are not available in a browser with no service worker (the real check, in jsdom)', async () => {
    renderWithProviders(<Settings />, { initialPath: '/settings' });
    await userEvent.click(checkButton());
    expect(await screen.findByText('Update checks are not available here')).toBeInTheDocument();
  });

  it('never throws: a check that fails reports that it could not check', async () => {
    pwaUpdates.checkForUpdate.mockRejectedValueOnce(new Error('boom'));
    renderWithProviders(<Settings />, { initialPath: '/settings' });
    await userEvent.click(checkButton());
    expect(await screen.findByText('Could not check (offline)')).toBeInTheDocument();
    expect(checkButton()).toBeEnabled();
  });
});

describe('Settings storage', () => {
  it("shows the browser's estimate: usage against quota", async () => {
    pwaStorage.readStorageStatus.mockResolvedValue({ usage: 5 * 1024 * 1024, quota: 2 * 1024 * 1024 * 1024, persisted: false });
    renderWithProviders(<Settings />, { initialPath: '/settings' });
    expect(await screen.findByText('5.0 MB of 2.0 GB')).toBeInTheDocument();
  });

  it('says whether offline data is kept (persisted) or may be cleared', async () => {
    pwaStorage.readStorageStatus.mockResolvedValueOnce({ usage: 1024, quota: 1024 * 1024, persisted: true });
    const kept = renderWithProviders(<Settings />, { initialPath: '/settings' });
    expect(await screen.findByText('Kept')).toBeInTheDocument();
    expect(screen.getByText('1 KB of 1.0 MB')).toBeInTheDocument();
    kept.unmount();

    pwaStorage.readStorageStatus.mockResolvedValueOnce({ usage: 0, quota: 0, persisted: false });
    renderWithProviders(<Settings />, { initialPath: '/settings' });
    expect(await screen.findByText('May be cleared by the browser')).toBeInTheDocument();
  });

  it('omits the rows when the browser gives no estimate', async () => {
    renderWithProviders(<Settings />, { initialPath: '/settings' });
    await waitFor(() => expect(pwaStorage.readStorageStatus).toHaveBeenCalled());
    expect(screen.queryByText('Offline Data')).toBeNull();
  });
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

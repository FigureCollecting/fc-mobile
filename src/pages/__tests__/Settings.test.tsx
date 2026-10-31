import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/preact';
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
import { DIAG_IDS_KEY, DIAG_IDS_TEXT, diagIdsDefault, diagIdsOn, setDiagIds } from '../../auth/diagIds';
import { localSession, type LocalSession } from '../../local/session';

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
  it("shows package.json's version with the build next to it, so a user can tell which build is running", () => {
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')) as { version: string };
    renderWithProviders(<Settings />, { initialPath: '/settings' });
    expect(screen.getByText(`${pkg.version} (${import.meta.env.VITE_BUILD_ID})`)).toBeInTheDocument();
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

describe('Settings privacy: the Diagnostic ids switch', () => {
  const diagSwitch = () => screen.getByRole('switch', { name: DIAG_IDS_TEXT.label });

  // Before the shared teardown, which writes to storage: a refused setItem must not outlive its test,
  // and neither may a choice the module holds as unsaved.
  afterEach(() => {
    vi.restoreAllMocks();
    setDiagIds(diagIdsDefault());
  });

  it("pins the desk wording, pending Ross's approval, in the one constant the page shows", () => {
    expect(DIAG_IDS_TEXT).toEqual({
      label: 'Diagnostic ids',
      description:
        "Adds a random id to this device's requests to our servers and to each change you make, so we can find out why something failed. Our normal server logs are kept either way.",
      hint: 'Set for this device only.',
      unsaved: "This browser can't save the choice",
      privacyLink: 'How we use your data',
    });
  });

  it('renders a Privacy section between Sync and About, with the label, description and per-device hint', () => {
    renderWithProviders(<Settings />, { initialPath: '/settings' });
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles.slice(titles.indexOf('Sync'), titles.indexOf('About') + 1)).toEqual(['Sync', 'Privacy', 'About']);
    const section = screen.getByRole('heading', { name: 'Privacy' }).closest('section')!;
    expect(section).toContainElement(diagSwitch());
    expect(screen.getByText(DIAG_IDS_TEXT.label)).toBeInTheDocument();
    expect(diagSwitch()).toHaveAccessibleDescription(DIAG_IDS_TEXT.description);
    expect(section).toHaveTextContent(DIAG_IDS_TEXT.hint);
    expect(screen.queryByText(DIAG_IDS_TEXT.unsaved)).toBeNull();
  });

  it('starts on with nothing stored, and off when this device chose off', () => {
    const first = renderWithProviders(<Settings />, { initialPath: '/settings' });
    expect(diagSwitch()).toHaveAttribute('aria-checked', 'true');
    first.unmount();
    localStorage.setItem(DIAG_IDS_KEY, 'off');
    renderWithProviders(<Settings />, { initialPath: '/settings' });
    expect(diagSwitch()).toHaveAttribute('aria-checked', 'false');
  });

  it("a tap writes 'off' and turns the ids off; a re-render shows off; a second tap turns them back on", async () => {
    const user = userEvent.setup();
    const first = renderWithProviders(<Settings />, { initialPath: '/settings' });
    await user.click(diagSwitch());
    expect(localStorage.getItem(DIAG_IDS_KEY)).toBe('off');
    expect(diagIdsOn()).toBe(false);
    expect(diagSwitch()).toHaveAttribute('aria-checked', 'false');
    first.unmount();

    renderWithProviders(<Settings />, { initialPath: '/settings' });
    expect(diagSwitch()).toHaveAttribute('aria-checked', 'false');
    await user.click(diagSwitch());
    expect(localStorage.getItem(DIAG_IDS_KEY)).toBeNull();
    expect(diagIdsOn()).toBe(true);
    expect(diagSwitch()).toHaveAttribute('aria-checked', 'true');
  });

  it("says when this browser can't save the choice, and the choice still holds for the session", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    renderWithProviders(<Settings />, { initialPath: '/settings' });
    await user.click(diagSwitch());
    expect(diagSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(diagIdsOn()).toBe(false);
    expect(screen.getByText(DIAG_IDS_TEXT.unsaved)).toHaveAttribute('aria-live', 'polite');
    // The next choice is saved: storage decides again and the warning goes.
    write.mockRestore();
    await user.click(diagSwitch());
    expect(screen.queryByText(DIAG_IDS_TEXT.unsaved)).toBeNull();
    expect(diagSwitch()).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem(DIAG_IDS_KEY)).toBeNull();
  });

  it("still says the choice is not saved after leaving Settings and coming back", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    const first = renderWithProviders(<Settings />, { initialPath: '/settings' });
    await user.click(diagSwitch());
    expect(screen.getByText(DIAG_IDS_TEXT.unsaved)).toBeInTheDocument();
    first.unmount();

    renderWithProviders(<Settings />, { initialPath: '/settings' });
    expect(diagSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(DIAG_IDS_TEXT.unsaved)).toBeInTheDocument();
    write.mockRestore();
    await user.click(diagSwitch());
    expect(screen.queryByText(DIAG_IDS_TEXT.unsaved)).toBeNull();
  });

  it('follows a choice another tab saves, and stops listening once Settings is gone', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const otherTab = (newValue: string | null, key = DIAG_IDS_KEY) => {
      if (newValue === null) localStorage.removeItem(key);
      else localStorage.setItem(key, newValue);
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', { key, newValue, storageArea: localStorage }));
      });
    };
    const view = renderWithProviders(<Settings />, { initialPath: '/settings' });
    expect(diagSwitch()).toHaveAttribute('aria-checked', 'true');
    otherTab('off');
    expect(diagSwitch()).toHaveAttribute('aria-checked', 'false');
    otherTab(null);
    expect(diagSwitch()).toHaveAttribute('aria-checked', 'true');
    // another key changing is not this switch's business
    localStorage.setItem(DIAG_IDS_KEY, 'off');
    otherTab('dark', 'fc-theme');
    expect(diagSwitch()).toHaveAttribute('aria-checked', 'true');

    const storageListeners = (calls: unknown[][]) => calls.filter(([type]) => type === 'storage').map(([, fn]) => fn);
    const listeners = storageListeners(add.mock.calls);
    expect(listeners).toHaveLength(1);
    view.unmount();
    expect(storageListeners(remove.mock.calls)).toEqual(listeners);
  });

  describe('off also clears the ids already kept on queued edits (LGMOB M2)', () => {
    afterEach(() => {
      localSession.value = undefined;
    });

    const withEngine = (clearOriginTraces: () => Promise<void>) => {
      localSession.value = { engine: { clearOriginTraces } } as unknown as LocalSession;
    };

    it('an off tap asks the engine to clear them; an on tap does not', async () => {
      const user = userEvent.setup();
      const clearOriginTraces = vi.fn(async () => undefined);
      withEngine(clearOriginTraces);
      renderWithProviders(<Settings />, { initialPath: '/settings' });
      await user.click(diagSwitch());
      expect(diagIdsOn()).toBe(false);
      expect(clearOriginTraces).toHaveBeenCalledTimes(1);
      await user.click(diagSwitch());
      expect(diagIdsOn()).toBe(true);
      expect(clearOriginTraces).toHaveBeenCalledTimes(1);
    });

    it('an off tap with no signed-in engine, or a clear that fails, still turns the ids off and throws nothing', async () => {
      const user = userEvent.setup();
      const first = renderWithProviders(<Settings />, { initialPath: '/settings' });
      await user.click(diagSwitch());
      expect(diagSwitch()).toHaveAttribute('aria-checked', 'false');
      first.unmount();
      setDiagIds(true);

      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      try {
        // Not a vi.fn: a spy watches the promises its mock returns, which would hide an unhandled rejection.
        let calls = 0;
        withEngine(() => {
          calls += 1;
          return Promise.reject(new Error('the store is gone'));
        });
        renderWithProviders(<Settings />, { initialPath: '/settings' });
        await user.click(diagSwitch());
        expect(calls).toBe(1);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(unhandled).not.toHaveBeenCalled();
        expect(diagSwitch()).toHaveAttribute('aria-checked', 'false');
        expect(diagIdsOn()).toBe(false);
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    });
  });

  it('links "How we use your data" to /privacy', async () => {
    const user = userEvent.setup();
    const view = renderWithProviders(<Settings />, { initialPath: '/settings' });
    const link = screen.getByRole('link', { name: DIAG_IDS_TEXT.privacyLink });
    expect(link).toHaveAttribute('href', '/privacy');
    await user.click(link);
    expect(view.currentPath()).toBe('/privacy');
  });
});

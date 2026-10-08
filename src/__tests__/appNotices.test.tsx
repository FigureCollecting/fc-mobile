import { screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('framer-motion', () => import('../test/framerMotionMock'));

const platform = vi.hoisted(() => ({ isIosBrowserTab: vi.fn(() => false) }));
vi.mock('../pwa/platform', () => ({ isIosBrowserTab: platform.isIosBrowserTab }));

const fake = vi.hoisted(() => ({ session: undefined as unknown, sync: undefined as unknown }));
vi.mock('../auth', () => ({ getAuthSession: () => fake.session }));
vi.mock('../sync/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sync/browser')>()),
  startBrowserSync: () => fake.sync,
}));

import { App } from '../app';
import { updateReady } from '../pwa/updates';
import { renderWithProviders } from '../test/testUtils';
import { fakeAuthSession, fakeBrowserSync } from '../test/appSession';
import { localSession } from '../local/session';
import { headOf } from '../sync/__tests__/engineSupport';

beforeEach(async () => {
  fake.session = fakeAuthSession('signed-out');
  fake.sync = await fakeBrowserSync();
  localStorage.setItem('onboarding_complete', '1');
});

afterEach(() => {
  updateReady.value = false;
  platform.isIosBrowserTab.mockReturnValue(false);
  sessionStorage.clear();
  localSession.value = undefined;
});

describe('app-level PWA notices', () => {
  it('shows the update prompt over any screen once a new build waits', async () => {
    updateReady.value = true;
    renderWithProviders(<App />, { initialPath: '/' });
    expect(await screen.findByText(/a new version is ready/i)).toBeInTheDocument();
  });

  it("asks an iOS tab to install before sign-in, counting the edits this tab's outbox holds", async () => {
    platform.isIosBrowserTab.mockReturnValue(true);
    const { engine } = fake.sync as Awaited<ReturnType<typeof fakeBrowserSync>>;
    await engine.write((s) => s.createCopy(headOf(1), 'wished'));
    renderWithProviders(<App />, { initialPath: '/' });
    expect(await screen.findByText('Install to keep offline data')).toBeInTheDocument();
    expect(await screen.findByText(/1 edit in this tab is waiting to sync/i)).toBeInTheDocument();
  });

  it('keeps the install banner in the layout above the screen, never floating over its controls', async () => {
    platform.isIosBrowserTab.mockReturnValue(true);
    renderWithProviders(<App />, { initialPath: '/' });
    const banner = (await screen.findByText('Install to keep offline data')).closest('[role="note"]') as HTMLElement;
    expect(banner.closest('.pwa-notices')).toBeNull();
    const shell = banner.parentElement as HTMLElement;
    expect(shell).toHaveClass('app-shell');
    const main = shell.querySelector(':scope > main') as HTMLElement;
    expect(banner.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await within(main).findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});

import { screen, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('framer-motion', () => import('../test/framerMotionMock'));

const platform = vi.hoisted(() => ({ isIosBrowserTab: vi.fn(() => false) }));
vi.mock('../pwa/platform', () => ({ isIosBrowserTab: platform.isIosBrowserTab }));

import { App } from '../app';
import { updateReady } from '../pwa/updates';
import { queueOperation } from '../storage/pendingOps';
import { renderWithProviders } from '../test/testUtils';

afterEach(() => {
  updateReady.value = false;
  platform.isIosBrowserTab.mockReturnValue(false);
  sessionStorage.clear();
});

describe('app-level PWA notices', () => {
  it('shows the update prompt over any screen once a new build waits', async () => {
    localStorage.setItem('onboarding_complete', '1');
    updateReady.value = true;
    renderWithProviders(<App />, { initialPath: '/login' });
    expect(await screen.findByText(/a new version is ready/i)).toBeInTheDocument();
  });

  it('asks an iOS tab to install before sign-in, counting edits queued in this tab', async () => {
    localStorage.setItem('onboarding_complete', '1');
    platform.isIosBrowserTab.mockReturnValue(true);
    await queueOperation({ type: 'update', figureId: 'f1', data: {} });
    renderWithProviders(<App />, { initialPath: '/login' });
    expect(await screen.findByText('Install to keep offline data')).toBeInTheDocument();
    expect(await screen.findByText(/1 edit in this tab is waiting to sync/i)).toBeInTheDocument();
  });

  it('keeps the install banner in the layout above the screen, never floating over its controls', async () => {
    localStorage.setItem('onboarding_complete', '1');
    platform.isIosBrowserTab.mockReturnValue(true);
    renderWithProviders(<App />, { initialPath: '/login' });
    const banner = (await screen.findByText('Install to keep offline data')).closest('[role="note"]') as HTMLElement;
    expect(banner.closest('.pwa-notices')).toBeNull();
    const shell = banner.parentElement as HTMLElement;
    expect(shell).toHaveClass('app-shell');
    const main = shell.querySelector(':scope > main') as HTMLElement;
    expect(banner.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(main).getByRole('button', { name: /create account/i })).toBeInTheDocument();
  });
});

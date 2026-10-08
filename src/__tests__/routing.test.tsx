import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/preact';

vi.mock('framer-motion', () => import('../test/framerMotionMock'));

const fake = vi.hoisted(() => ({ session: undefined as unknown, sync: undefined as unknown }));
vi.mock('../auth', () => ({ getAuthSession: () => fake.session }));
vi.mock('../sync/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sync/browser')>()),
  startBrowserSync: () => fake.sync,
}));

import { App } from '../app';
import { renderWithProviders } from '../test/testUtils';
import { fakeAuthSession, fakeBrowserSync } from '../test/appSession';
import { localSession } from '../local/session';

const SIGNED_IN_ROUTES: Array<{ path: string; unique: RegExp | string }> = [
  { path: '/', unique: /collection/i },
  { path: '/discover', unique: /discover/i },
  { path: '/profile', unique: /profile/i },
  { path: '/settings', unique: /settings/i },
  { path: '/import', unique: /import/i },
  { path: '/stats', unique: /stats/i },
];

// No backend anywhere (src/config/features.ts) — off by default, deep links
// land back on the collection instead of a dead screen.
const DEAD_ROUTES = ['/prices', '/prices/fig-1', '/analytics', '/export', '/notifications', '/calendar', '/collection-dna', '/sync'];

// Authentik owns sign-in, registration and second factors (WK-15): the legacy screens are gone.
const HIDDEN_ROUTES = ['/login', '/register', '/2fa'];

beforeEach(async () => {
  fake.session = fakeAuthSession('signed-in');
  fake.sync = await fakeBrowserSync();
  localStorage.setItem('onboarding_complete', '1');
});

afterEach(() => {
  localSession.value = undefined;
});

describe('routing reachability', () => {
  for (const { path, unique } of SIGNED_IN_ROUTES) {
    it(`mounts ${path}`, async () => {
      renderWithProviders(<App />, { initialPath: path });
      await waitFor(() => expect(screen.getAllByText(unique).length).toBeGreaterThan(0));
    });
  }

  for (const path of DEAD_ROUTES) {
    it(`redirects ${path} to the collection`, async () => {
      const { currentPath } = renderWithProviders(<App />, { initialPath: path });
      await waitFor(() => expect(currentPath()).toBe('/'));
    });
  }

  for (const path of HIDDEN_ROUTES) {
    it(`hides ${path}: it lands on the collection, with no legacy sign-in, register or 2FA form`, async () => {
      fake.session = fakeAuthSession('signed-out');
      const { currentPath } = renderWithProviders(<App />, { initialPath: path });
      await waitFor(() => expect(currentPath()).toBe('/'));
      expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument(); // the banner's, the only one
      expect(screen.queryByText(/welcome back|create your account|two-factor authentication/i)).toBeNull();
      expect(screen.queryByPlaceholderText(/email address|password/i)).toBeNull();
    });
  }
});

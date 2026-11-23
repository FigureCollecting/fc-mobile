import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/preact';

/**
 * The account rows' host is the build's IdP origin from src/auth/config.ts and nothing else. Every runtime input a
 * visitor or another page could set is planted with a hostile host BEFORE Profile is imported (module-level reads)
 * and again before it renders (render-time reads); the rows must still point at the production sign-in server, also
 * once effects, microtasks and timers have run (a late read from storage would move them after the first paint).
 */
const EVIL = 'https://evil.example';
// A hostile settings route in the app's own hash: another tab and a next= must not leak into the rows.
const EVIL_HASH = `#/settings;${encodeURIComponent(JSON.stringify({ page: 'page-sessions', next: `${EVIL}/` }))}`;
// vi.hoisted runs before the imports below, so a module-level read in Profile already sees the planted values.
const plant = vi.hoisted(() => {
  const evil = 'https://evil.example';
  const evilHash = `#/settings;${encodeURIComponent(JSON.stringify({ page: 'page-sessions', next: `${evil}/` }))}`;
  const plantAll = () => {
    window.history.replaceState(null, '', `/profile?idp=${encodeURIComponent(evil)}&origin=${encodeURIComponent(evil)}&next=${encodeURIComponent(`${evil}/`)}${evilHash}`);
    for (const store of [localStorage, sessionStorage]) {
      for (const key of ['fc.idp', 'idp', 'oidc_origin', 'VITE_OIDC_ORIGIN']) store.setItem(key, evil);
    }
    window.name = evil;
    document.cookie = `idp=${encodeURIComponent(evil)}; path=/`;
    (globalThis as Record<string, unknown>).VITE_OIDC_ORIGIN = evil;
  };
  plantAll();
  return plantAll;
});

vi.mock('framer-motion', () => import('../../test/framerMotionMock'));

import { Profile } from '../Profile';
import { renderWithProviders } from '../../test/testUtils';
import { localRig } from '../../local/__tests__/localHarness';

/** Longer than any plausible "read it a moment later" (a microtask, a 400 ms timer). */
const SETTLE_MS = 1000;

describe('Profile account rows', () => {
  it('take the sign-in server only from the build config, never from the URL, storage or the window, even once settled', async () => {
    await localRig();
    plant();
    renderWithProviders(<Profile />, { initialPath: `/profile?idp=${encodeURIComponent(EVIL)}${EVIL_HASH}` });
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const account = screen.getByRole('heading', { level: 3, name: 'Account' }).parentElement as HTMLElement;
    const hrefs = within(account).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      'https://auth.mindsignals1.com/if/user/#/settings;%7B%22page%22%3A%22page-details%22%7D',
      'https://auth.mindsignals1.com/if/user/#/settings;%7B%22page%22%3A%22page-credentials%22%7D',
    ]);
    for (const href of hrefs) expect(href).not.toMatch(/next|evil|page-sessions/);
  }, SETTLE_MS + 10_000);
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/preact';

// Sign-in is OIDC only (WK-15): the session drives a banner in place of any /login redirect,
// /callback finishes the sign-in, and the page's sync is published to the screens.
vi.mock('framer-motion', () => import('../test/framerMotionMock'));

const fake = vi.hoisted(() => ({ session: undefined as unknown, sync: undefined as unknown }));
vi.mock('../auth', () => ({ getAuthSession: () => fake.session }));
vi.mock('../sync/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sync/browser')>()),
  startBrowserSync: () => fake.sync,
}));

import { App } from '../app';
import { renderWithProviders } from '../test/testUtils';
import { fakeAuthSession, fakeBrowserSync, type FakeAuthSession } from '../test/appSession';
import { localSession } from '../local/session';
import type { AuthStatus } from '../auth/session';

async function boot(status: AuthStatus): Promise<FakeAuthSession> {
  const session = fakeAuthSession(status);
  fake.session = session;
  fake.sync = await fakeBrowserSync();
  localStorage.setItem('onboarding_complete', '1');
  return session;
}

afterEach(() => {
  localSession.value = undefined;
});

describe('OIDC sign-in', () => {
  it('never bounces a signed-out visitor to /login; it offers sign-in to sync in place', async () => {
    const session = await boot('signed-out');
    const { currentPath } = renderWithProviders(<App />, { initialPath: '/' });
    expect((await screen.findAllByRole('button', { name: /sign in/i })).length).toBeGreaterThan(0);
    expect(session.boot).toHaveBeenCalled();
    expect(currentPath()).toBe('/');
  });

  it('finishes the sign-in at /callback and hides the banner there', async () => {
    const session = await boot('signed-out');
    session.completeSignIn.mockResolvedValue({ sub: 's', returnTo: '/discover' });
    const { currentPath } = renderWithProviders(<App />, { initialPath: '/callback' });
    await waitFor(() => expect(currentPath()).toBe('/discover'));
    expect(session.completeSignIn).toHaveBeenCalled();
  });

  it("publishes the page's sync, the session's status and the online clients to the screens", async () => {
    const session = await boot('signed-in');
    renderWithProviders(<App />, { initialPath: '/' });
    await waitFor(() => expect(localSession.value).toBeDefined());
    const local = localSession.value!;
    expect(local.engine).toBe((fake.sync as { engine: unknown }).engine);
    expect(local.status).toBe(session.status);
    expect(local.sub()).toBe('user-a');
    expect(Object.keys(local.clients).sort()).toEqual(['catalog', 'compare', 'import']);
    await local.signIn('/x');
    expect(session.signIn).toHaveBeenCalledWith('/x');
    await local.signOut();
    expect(session.signOut).toHaveBeenCalled();
  });

  it('installs the e2e handles only in a build that asks for them', async () => {
    await boot('signed-in');
    const win = window as { __fcAuth?: unknown };
    delete win.__fcAuth;
    renderWithProviders(<App />, { initialPath: '/' });
    await waitFor(() => expect(localSession.value).toBeDefined());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(win.__fcAuth).toBeUndefined();

    vi.stubEnv('VITE_E2E_HOOKS', 'true');
    try {
      renderWithProviders(<App />, { initialPath: '/' });
      await waitFor(() => expect(win.__fcAuth).toBeDefined());
    } finally {
      vi.unstubAllEnvs();
      delete win.__fcAuth;
    }
  });
});

import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/preact';
import { signal } from '@preact/signals';

// The OIDC build (VITE_AUTH_MODE=oidc): the session drives a banner instead of
// the legacy /login redirect, and /callback finishes the sign-in.
vi.mock('../config/features', () => ({ LEGACY_SCREENS_ENABLED: false, OIDC_AUTH_ENABLED: true }));
vi.mock('framer-motion', () => import('../test/framerMotionMock'));

const fake = vi.hoisted(() => ({ session: undefined as unknown }));
vi.mock('../auth', () => ({ getAuthSession: () => fake.session }));

import { App } from '../app';
import { renderWithProviders } from '../test/testUtils';
import type { AuthStatus } from '../auth/session';

function fakeSession(status: AuthStatus) {
  const session = {
    status: signal<AuthStatus>('loading'),
    start: vi.fn(async () => {
      session.status.value = status;
      return status;
    }),
    signIn: vi.fn(async () => undefined),
    completeSignIn: vi.fn(async () => ({ sub: 's', returnTo: '/discover' })),
  };
  fake.session = session;
  return session;
}

describe('OIDC mode', () => {
  it('never bounces a signed-out visitor to /login; it offers sign-in to sync in place', async () => {
    const session = fakeSession('signed-out');
    localStorage.setItem('onboarding_complete', '1');
    const { currentPath } = renderWithProviders(<App />, { initialPath: '/' });
    await screen.findByRole('button', { name: /sign in/i });
    expect(session.start).toHaveBeenCalled();
    expect(currentPath()).toBe('/');
  });

  it('finishes the sign-in at /callback and hides the banner there', async () => {
    const session = fakeSession('signed-out');
    localStorage.setItem('onboarding_complete', '1');
    const { currentPath } = renderWithProviders(<App />, { initialPath: '/callback' });
    await waitFor(() => expect(currentPath()).toBe('/discover'));
    expect(session.completeSignIn).toHaveBeenCalled();
  });

  it('installs the e2e handles only in a build that asks for them', async () => {
    fakeSession('signed-in');
    localStorage.setItem('onboarding_complete', '1');
    const win = window as { __fcAuth?: unknown };
    delete win.__fcAuth;
    renderWithProviders(<App />, { initialPath: '/' });
    await waitFor(() => expect(fake.session).toBeDefined());
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

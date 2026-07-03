import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/preact';

vi.mock('framer-motion', () => import('../test/framerMotionMock'));

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    api: {
      get: vi.fn().mockResolvedValue({ data: {} }),
      post: vi.fn().mockResolvedValue({ data: {} }),
      put: vi.fn().mockResolvedValue({ data: {} }),
      delete: vi.fn().mockResolvedValue({ data: {} }),
    },
    scraperApi: {
      get: vi.fn().mockResolvedValue({ data: {} }),
    },
  };
});

vi.mock('@figurecollecting/fc-shared', async () => {
  const actual = await vi.importActual<typeof import('@figurecollecting/fc-shared')>(
    '@figurecollecting/fc-shared',
  );
  return {
    ...actual,
    getFigures: vi.fn().mockResolvedValue({
      success: true, data: [], count: 0, page: 1, pages: 0, total: 0,
    }),
    getFigureById: vi.fn().mockResolvedValue(null),
    searchFigures: vi.fn().mockResolvedValue([]),
  };
});

import { App } from '../app';
import { renderWithProviders } from '../test/testUtils';
import { useAuthStore } from '../stores/auth';

const AUTHENTICATED_ROUTES: Array<{ path: string; unique: RegExp | string }> = [
  { path: '/', unique: /collection/i },
  { path: '/discover', unique: /discover/i },
  { path: '/prices', unique: /price tracker/i },
  { path: '/profile', unique: /profile/i },
  { path: '/settings', unique: /settings/i },
  { path: '/analytics', unique: /analytics/i },
  { path: '/import', unique: /import/i },
  { path: '/export', unique: /export/i },
  { path: '/notifications', unique: /notifications/i },
  { path: '/calendar', unique: /calendar/i },
  { path: '/collection-dna', unique: /collection dna/i },
];

const PUBLIC_ROUTES: Array<{ path: string; unique: RegExp | string }> = [
  { path: '/login', unique: /welcome back/i },
  { path: '/register', unique: /create your account/i },
];

function signIn() {
  useAuthStore.setState({
    user: {
      _id: 'u1',
      username: 'tester',
      email: 'a@b.co',
      isAdmin: false,
      token: 'tok',
      tokenExpiresAt: Date.now() + 60_000,
    },
    isAuthenticated: true,
    lastActivity: Date.now(),
    twoFactorPending: null,
  });
  // Skip onboarding for this mount.
  localStorage.setItem('onboarding_complete', '1');
}

describe('routing reachability', () => {
  for (const { path, unique } of AUTHENTICATED_ROUTES) {
    it(`mounts ${path} as an authenticated route`, async () => {
      signIn();
      renderWithProviders(<App />, { initialPath: path });
      // We render the route's component; the matcher is intentionally loose —
      // we only care that something identifying the page appears, not its full
      // content.
      await waitFor(() => {
        expect(screen.getAllByText(unique).length).toBeGreaterThan(0);
      });
    });
  }

  for (const { path, unique } of PUBLIC_ROUTES) {
    it(`mounts ${path} as a public route`, async () => {
      // Make sure we're signed out so the AuthRedirect doesn't bounce us home.
      useAuthStore.setState({
        user: null,
        isAuthenticated: false,
        lastActivity: 0,
        twoFactorPending: null,
      });
      localStorage.setItem('onboarding_complete', '1');
      renderWithProviders(<App />, { initialPath: path });
      await waitFor(() => {
        expect(screen.getAllByText(unique).length).toBeGreaterThan(0);
      });
    });
  }

  it('mounts /2fa after login indicates 2FA required', async () => {
    // Needs the auth store to have a pending 2FA session so the page renders.
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      lastActivity: 0,
      twoFactorPending: { sessionId: 'sess-1', methods: ['totp'] },
    });
    localStorage.setItem('onboarding_complete', '1');
    renderWithProviders(<App />, { initialPath: '/2fa' });
    await waitFor(() => {
      expect(screen.getByText(/two-factor authentication/i)).toBeInTheDocument();
    });
  });
});

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
import { setFixtureMode } from '../dev-fixtures/fixtures';
import { useAuthStore } from '../stores/auth';

describe('dev fixture mode', () => {
  it('lands on the collection without an auth redirect or onboarding when signed out', async () => {
    // localStorage 'on' makes isFixtureMode() true even under MODE=test.
    setFixtureMode(true);
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      lastActivity: 0,
      twoFactorPending: null,
    });

    const { currentPath } = renderWithProviders(<App />, { initialPath: '/' });

    // Collection renders (onboarding gate skipped)…
    await waitFor(() => {
      expect(screen.getAllByText(/collection/i).length).toBeGreaterThan(0);
    });
    // …and AuthRedirect did not bounce us to /login.
    expect(currentPath()).toBe('/');
  });
});

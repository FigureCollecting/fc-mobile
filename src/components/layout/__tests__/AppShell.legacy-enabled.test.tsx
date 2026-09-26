import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/preact';

// Exercises the LEGACY_SCREENS_ENABLED=true escape hatch (src/config/features.ts) —
// the dev-only path that still wires up the no-backend screens.
vi.mock('../../../config/features', () => ({ LEGACY_SCREENS_ENABLED: true }));

vi.mock('framer-motion', () => import('../../../test/framerMotionMock'));

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return {
    ...actual,
    api: {
      get: vi.fn().mockResolvedValue({ data: {} }),
      post: vi.fn().mockResolvedValue({ data: {} }),
      put: vi.fn().mockResolvedValue({ data: {} }),
      delete: vi.fn().mockResolvedValue({ data: {} }),
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

import { AppShell } from '../AppShell';
import { renderWithProviders } from '../../../test/testUtils';
import { setFixtureMode } from '../../../dev-fixtures/fixtures';

describe('AppShell dead-screen routes (LEGACY_SCREENS_ENABLED true)', () => {
  it('renders the Sync page instead of redirecting', async () => {
    setFixtureMode(true);
    const { currentPath } = renderWithProviders(<AppShell />, { initialPath: '/sync' });
    await waitFor(() => expect(screen.getAllByText(/mfc sync/i).length).toBeGreaterThan(0));
    expect(currentPath()).toBe('/sync');
  });

  it('renders the Export page instead of redirecting', async () => {
    setFixtureMode(true);
    const { currentPath } = renderWithProviders(<AppShell />, { initialPath: '/export' });
    await waitFor(() => expect(currentPath()).toBe('/export'));
  });

  it('renders the Notifications page instead of redirecting', async () => {
    setFixtureMode(true);
    const { currentPath } = renderWithProviders(<AppShell />, { initialPath: '/notifications' });
    await waitFor(() => expect(currentPath()).toBe('/notifications'));
  });

  it.each([
    ['/prices', 'Price Tracker'],
    ['/prices/fig-1', 'Price Tracker'],
    ['/analytics', 'Analytics'],
    ['/calendar', 'Release Calendar'],
    ['/collection-dna', 'Collection DNA'],
  ])('renders the gated placeholder for %s instead of redirecting', async (path, label) => {
    setFixtureMode(true);
    const { currentPath } = renderWithProviders(<AppShell />, { initialPath: path });
    await waitFor(() => expect(screen.getByText(label)).toBeInTheDocument());
    expect(currentPath()).toBe(path);
  });
});

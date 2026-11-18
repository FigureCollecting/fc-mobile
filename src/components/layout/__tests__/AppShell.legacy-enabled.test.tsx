import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/preact';

// Exercises the LEGACY_SCREENS_ENABLED=true escape hatch (src/config/features.ts) —
// the dev-only path that still shows the gated placeholders of the no-backend screens.
vi.mock('../../../config/features', () => ({ LEGACY_SCREENS_ENABLED: true, OIDC_AUTH_ENABLED: false }));

vi.mock('framer-motion', () => import('../../../test/framerMotionMock'));

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
  // FLIP-LEGACY-REST: these three called the old REST client, which is gone, and their screens with it.
  it.each(['/sync', '/export', '/notifications'])('sends %s back to the collection: its screen is gone', async (path) => {
    setFixtureMode(true);
    const { currentPath } = renderWithProviders(<AppShell />, { initialPath: path });
    await waitFor(() => expect(currentPath()).toBe('/'));
    expect(screen.queryByText(/mfc sync/i)).not.toBeInTheDocument();
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

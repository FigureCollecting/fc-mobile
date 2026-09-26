import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

// Exercises the LEGACY_SCREENS_ENABLED=true escape hatch — MFC Sync reappears
// in the Add sheet once the flag opts back into the legacy backend.
vi.mock('../../../config/features', () => ({ LEGACY_SCREENS_ENABLED: true }));

vi.mock('framer-motion', () => import('../../../test/framerMotionMock'));
vi.mock('../../../api/client', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

import { TabBar } from '../TabBar';
import { renderWithProviders } from '../../../test/testUtils';

describe('TabBar (LEGACY_SCREENS_ENABLED=true)', () => {
  it('shows Sync from MFC in the Add sheet', async () => {
    const user = userEvent.setup();
    const { currentPath } = renderWithProviders(<TabBar />);
    await user.click(screen.getByRole('button', { name: /add figures/i }));
    await user.click(screen.getByText(/sync from mfc/i));
    expect(currentPath()).toBe('/sync');
  });
});

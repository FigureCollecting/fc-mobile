import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

vi.mock('framer-motion', () => import('../../../test/framerMotionMock'));
import { TabBar } from '../TabBar';
import { renderWithProviders } from '../../../test/testUtils';
import { useChromeStore } from '../../../stores/chrome';

beforeEach(() => useChromeStore.setState({ hidden: false }));

describe('TabBar', () => {
  it('renders the 4 tab slots and the docked Add action', () => {
    renderWithProviders(<TabBar />);
    for (const label of ['Collection', 'Search', 'Stats', 'Profile']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /add figures/i })).toBeInTheDocument();
  });

  it('navigates when a tab is pressed', async () => {
    const user = userEvent.setup();
    const { currentPath } = renderWithProviders(<TabBar />);
    await user.click(screen.getByRole('button', { name: 'Stats' }));
    expect(currentPath()).toBe('/stats');
  });

  it('opens the Add sheet with the import and the barcode lookup', async () => {
    const user = userEvent.setup();
    const { currentPath } = renderWithProviders(<TabBar />);
    await user.click(screen.getByRole('button', { name: /add figures/i }));
    // MFC Sync has no backend (src/config/features.ts) and is off by default.
    expect(screen.queryByText(/sync from mfc/i)).not.toBeInTheDocument();
    await user.click(screen.getByText(/import your mfc export/i));
    expect(currentPath()).toBe('/import');
    await user.click(screen.getByRole('button', { name: /add figures/i }));
    await user.click(screen.getByText(/look up a barcode/i));
    expect(currentPath()).toBe('/discover');
  });

  it('carries no notification badge: notifications have no backend', () => {
    const { container } = renderWithProviders(<TabBar />);
    expect(container.querySelector('.badge')).toBeNull();
  });

  it('slides away when chrome is hidden', () => {
    useChromeStore.setState({ hidden: true });
    const { container } = renderWithProviders(<TabBar />);
    expect(container.querySelector('.tab-bar--hidden')).not.toBeNull();
  });
});

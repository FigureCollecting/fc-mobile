import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

vi.mock('framer-motion', () => import('../../../test/framerMotionMock'));
vi.mock('../../../api/client', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

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

  it('opens the Add sheet with the sync and import flows', async () => {
    const user = userEvent.setup();
    const { currentPath } = renderWithProviders(<TabBar />);
    await user.click(screen.getByRole('button', { name: /add figures/i }));
    expect(screen.getByText(/sync from mfc/i)).toBeInTheDocument();
    expect(screen.getByText(/import from csv/i)).toBeInTheDocument();
    await user.click(screen.getByText(/import from csv/i));
    expect(currentPath()).toBe('/import');
  });

  it('slides away when chrome is hidden', () => {
    useChromeStore.setState({ hidden: true });
    const { container } = renderWithProviders(<TabBar />);
    expect(container.querySelector('.tab-bar--hidden')).not.toBeNull();
  });
});

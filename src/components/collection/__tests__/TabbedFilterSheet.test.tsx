import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

vi.mock('framer-motion', () => import('../../../test/framerMotionMock'));

import { TabbedFilterSheet } from '../TabbedFilterSheet';
import { renderWithProviders } from '../../../test/testUtils';
import { FIXTURE_FIGURES } from '../../../dev-fixtures/fixtures';
import { DEFAULT_CAT, DEFAULT_TYPE } from '../../../hooks/useFigureListParams';
import type { ListFilters } from '../../../hooks/useFigureListParams';

const BASE: ListFilters = {
  status: [], mfr: [], dist: [], scale: [], origin: [], cat: DEFAULT_CAT, type: DEFAULT_TYPE, tag: [],
};

function mount(overrides: Partial<Parameters<typeof TabbedFilterSheet>[0]> = {}) {
  const onApply = vi.fn();
  const onSort = vi.fn();
  const onClose = vi.fn();
  const utils = renderWithProviders(
    <TabbedFilterSheet
      open
      onClose={onClose}
      figures={FIXTURE_FIGURES}
      filters={BASE}
      sort="activity"
      order="asc"
      onApply={onApply}
      onSort={onSort}
      {...overrides}
    />,
  );
  return { onApply, onSort, onClose, ...utils };
}

describe('TabbedFilterSheet', () => {
  it('puts the tab strip at the bottom with Maker, Scale and Tags groups', () => {
    mount();
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Maker', 'Scale', 'Tags']);
    // Maker tab active by default: Manufacturer + Distributor facets visible
    expect(screen.getByText('Manufacturer')).toBeInTheDocument();
    expect(screen.getByText('Distributor')).toBeInTheDocument();
  });

  it('switches tabs: Scale+Origin, then the Tags placeholder facet', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('tab', { name: 'Scale' }));
    expect(screen.getByText('Scale', { selector: 'h3' })).toBeInTheDocument();
    expect(screen.getByText('Origin')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Tags' }));
    expect(screen.getByText(/more tags coming soon/i)).toBeInTheDocument();
  });

  it('shows a live result count on the apply button', async () => {
    const user = userEvent.setup();
    mount();
    expect(screen.getByRole('button', { name: /show 7/i })).toBeInTheDocument();
    // Narrow to a single maker → live count drops before applying
    await user.click(screen.getByRole('button', { name: 'Aniplex1' }));
    expect(screen.getByRole('button', { name: /show 1/i })).toBeInTheDocument();
  });

  it('applies the draft filters and closes', async () => {
    const user = userEvent.setup();
    const { onApply, onClose } = mount();
    await user.click(screen.getByRole('button', { name: /^Max Factory/ }));
    await user.click(screen.getByRole('button', { name: /show/i }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ mfr: ['Max Factory'] }));
    expect(onClose).toHaveBeenCalled();
  });

  it('routes sort changes through onSort', async () => {
    const user = userEvent.setup();
    const { onSort } = mount();
    await user.click(screen.getByRole('button', { name: 'Name' }));
    expect(onSort).toHaveBeenCalledWith('name', 'asc');
    await user.click(screen.getByRole('button', { name: /sort ascending/i }));
    expect(onSort).toHaveBeenCalledWith('activity', 'desc');
  });

  it('clears facet selections but keeps the default category/type', async () => {
    const user = userEvent.setup();
    const { onApply } = mount({ filters: { ...BASE, mfr: ['FREEing'], status: ['wished'] } });
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await user.click(screen.getByRole('button', { name: /show/i }));
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ mfr: [], status: [], cat: DEFAULT_CAT, type: DEFAULT_TYPE }),
    );
  });
});

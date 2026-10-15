import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/preact';
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
const DEFAULTS: ListFilters = { ...BASE, status: ['owned'] };
const HOLDINGS = { owned: 4, ordered: 1, wished: 2, former: 0 };

function mount(overrides: Partial<Parameters<typeof TabbedFilterSheet>[0]> = {}) {
  const onApply = vi.fn();
  const onSort = vi.fn();
  const onClose = vi.fn();
  const utils = renderWithProviders(
    <TabbedFilterSheet
      open
      onClose={onClose}
      figures={FIXTURE_FIGURES}
      filters={DEFAULTS}
      defaults={DEFAULTS}
      holdings={HOLDINGS}
      shown={5}
      total={7}
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

  it('shows the live count: what the grid shows of what the chosen holdings hold (SHEETS-FB1 2)', () => {
    mount({ shown: 312, total: 559 });
    expect(screen.getByText('312 of 559')).toBeInTheDocument();
  });

  it('applies a facet change at once, to the grid behind it: no Show button (SHEETS-FB1 2)', async () => {
    const user = userEvent.setup();
    const { onApply, onClose } = mount();
    await user.click(screen.getByRole('button', { name: /^Max Factory/ }));
    expect(onApply).toHaveBeenCalledWith({ ...DEFAULTS, mfr: ['Max Factory'] });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^show/i })).toBeNull();
  });

  it('a second tap on a chosen value takes it off at once', async () => {
    const user = userEvent.setup();
    const { onApply } = mount({ filters: { ...DEFAULTS, mfr: ['Max Factory'] } });
    await user.click(screen.getByRole('button', { name: /^Max Factory/ }));
    expect(onApply).toHaveBeenCalledWith({ ...DEFAULTS, mfr: [] });
  });

  it('holdings: Owned, Ordered, Wished, No longer owned with their counts, the chosen pressed; a tap adds or takes one off at once (SHEETS-FB1 3)', async () => {
    const user = userEvent.setup();
    const { onApply } = mount();
    const group = screen.getByRole('group', { name: 'Holding' });
    const choices = within(group).getAllByRole('button');
    expect(choices.map((c) => c.textContent)).toEqual(['Owned4', 'Ordered1', 'Wished2', 'No longer owned0']);
    expect(choices.map((c) => c.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false']);
    await user.click(choices[2]!);
    expect(onApply).toHaveBeenLastCalledWith({ ...DEFAULTS, status: ['owned', 'wished'] });
  });

  it('a tap takes a holding off while another stays chosen', async () => {
    const user = userEvent.setup();
    const { onApply } = mount({ filters: { ...DEFAULTS, status: ['owned', 'wished'] } });
    await user.click(within(screen.getByRole('group', { name: 'Holding' })).getByRole('button', { name: /^Owned/ }));
    expect(onApply).toHaveBeenLastCalledWith({ ...DEFAULTS, status: ['wished'] });
  });

  it('the last chosen holding cannot be taken off: the tap applies nothing and it stays pressed (no empty choice)', async () => {
    const user = userEvent.setup();
    const { onApply } = mount();
    const owned = within(screen.getByRole('group', { name: 'Holding' })).getByRole('button', { name: /^Owned/ });
    await user.click(owned);
    expect(onApply).not.toHaveBeenCalled();
    expect(owned).toHaveAttribute('aria-pressed', 'true');
  });

  it('Done closes the card and applies nothing more', async () => {
    const user = userEvent.setup();
    const { onApply, onClose } = mount();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('Clear puts every filter back to its default at once and keeps the card open', async () => {
    const user = userEvent.setup();
    const { onApply, onClose } = mount({ filters: { ...BASE, mfr: ['FREEing'], status: ['wished'], cat: [] } });
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onApply).toHaveBeenCalledWith(DEFAULTS);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('routes sort changes through onSort', async () => {
    const user = userEvent.setup();
    const { onSort } = mount();
    await user.click(screen.getByRole('button', { name: 'Name' }));
    expect(onSort).toHaveBeenCalledWith('name', 'asc');
    await user.click(screen.getByRole('button', { name: /sort ascending/i }));
    expect(onSort).toHaveBeenCalledWith('activity', 'desc');
  });
});

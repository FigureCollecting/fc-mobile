import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

import { AppliedChips } from '../AppliedChips';
import { renderWithProviders } from '../../../test/testUtils';
import { DEFAULT_CAT, DEFAULT_TYPE } from '../../../hooks/useFigureListParams';
import type { ListFilters } from '../../../hooks/useFigureListParams';

const BASE: ListFilters = {
  status: [], mfr: [], dist: [], scale: [], origin: [], cat: DEFAULT_CAT, type: DEFAULT_TYPE, tag: [],
};

const DEFAULTS: ListFilters = { ...BASE, status: ['owned'] };

/** Each chip by what it says: a removable one by its remove label, a fixed one by its name. */
const chips = () => screen.queryAllByRole('listitem').map((c) => c.getAttribute('aria-label') ?? c.textContent);

describe("AppliedChips: the page's filter row (SHEETS-FB1 3)", () => {
  it('nothing filtered (every filter its default, nothing hidden): no row at all', () => {
    const { container } = renderWithProviders(<AppliedChips filters={DEFAULTS} defaults={DEFAULTS} shown={7} total={7} onChange={() => {}} />);
    expect(container.querySelector('.applied-chips')).toBeNull();
  });

  it('a filter applied: every applied filter as a removable chip, and what shows of the total', () => {
    renderWithProviders(<AppliedChips filters={{ ...DEFAULTS, mfr: ['FREEing'] }} defaults={DEFAULTS} shown={2} total={7} onChange={() => {}} />);
    expect(chips()).toEqual(['Owned', 'Remove filter FREEing', 'Remove filter Prepainted', 'Remove filter Figures']);
    expect(screen.getByText('2 of 7')).toBeInTheDocument();
  });

  it('the defaults alone, when they hide figures, still show the row: what hides them stays removable', () => {
    renderWithProviders(<AppliedChips filters={DEFAULTS} defaults={DEFAULTS} shown={5} total={7} onChange={() => {}} />);
    expect(chips()).toEqual(['Owned', 'Remove filter Prepainted', 'Remove filter Figures']);
    expect(screen.getByText('5 of 7')).toBeInTheDocument();
  });

  it('a holding other than the default shows the row even with nothing hidden; holdings by their names', () => {
    renderWithProviders(<AppliedChips filters={{ ...DEFAULTS, status: ['wished', 'former'] }} defaults={DEFAULTS} shown={3} total={3} onChange={() => {}} />);
    expect(chips().slice(0, 2)).toEqual(['Remove filter Wished', 'Remove filter No longer owned']);
    expect(screen.getByText('3 of 3')).toBeInTheDocument();
  });

  it('removes a chip on tap: a holding, a facet, a default', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<AppliedChips filters={{ ...DEFAULTS, mfr: ['FREEing'] }} defaults={DEFAULTS} shown={2} total={7} onChange={onChange} />);
    await user.click(screen.getByRole('listitem', { name: /remove filter freeing/i }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULTS, mfr: [] });
    await user.click(screen.getByRole('listitem', { name: /remove filter prepainted/i }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULTS, mfr: ['FREEing'], cat: [] });
  });

  it('removes a holding while another stays chosen', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<AppliedChips filters={{ ...DEFAULTS, status: ['owned', 'wished'] }} defaults={DEFAULTS} shown={3} total={3} onChange={onChange} />);
    await user.click(screen.getByRole('listitem', { name: /remove filter owned/i }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULTS, status: ['wished'] });
  });

  it('the only chosen holding shows by name but cannot be removed (no empty choice): Refine or Clear changes it', () => {
    const { container } = renderWithProviders(<AppliedChips filters={{ ...DEFAULTS, status: ['ordered'] }} defaults={DEFAULTS} shown={1} total={1} onChange={() => {}} />);
    expect(chips()[0]).toBe('Ordered');
    expect(container.querySelector('.applied-chips__list button')).not.toHaveTextContent('Ordered');
  });

  it('labels a distributor and a tag by what they are', () => {
    renderWithProviders(<AppliedChips filters={{ ...DEFAULTS, dist: ['Crunchyroll'], tag: ['wings'] }} defaults={DEFAULTS} shown={1} total={7} onChange={() => {}} />);
    expect(chips()).toContain('Remove filter Dist: Crunchyroll');
    expect(chips()).toContain('Remove filter Tag: wings');
  });
});

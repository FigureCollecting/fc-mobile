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

describe('AppliedChips', () => {
  it('shows the preselected defaults as removable chips', () => {
    renderWithProviders(<AppliedChips filters={BASE} onChange={() => {}} />);
    expect(screen.getByRole('listitem', { name: /remove filter prepainted/i })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: /remove filter figures/i })).toBeInTheDocument();
  });

  it('removes a chip on tap — including a default', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(
      <AppliedChips filters={{ ...BASE, mfr: ['FREEing'] }} onChange={onChange} />,
    );
    await user.click(screen.getByRole('listitem', { name: /remove filter freeing/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mfr: [] }));

    await user.click(screen.getByRole('listitem', { name: /remove filter prepainted/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ cat: [] }));
  });

  it('renders nothing when no filters are applied at all', () => {
    const { container } = renderWithProviders(
      <AppliedChips filters={{ ...BASE, cat: [], type: [] }} onChange={() => {}} />,
    );
    expect(container.querySelector('.applied-chips')).toBeNull();
  });
});

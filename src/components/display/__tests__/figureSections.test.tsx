import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { FIGURE_SECTIONS, FigureRail, readySections } from '../figureSections';

// SIDE-RAIL-1: the figure (Info) card's sections on one right rail. Details and Copies are the card's today (the fields,
// and the "Copies and actions" way to the full page); Photos (GAL1) and Stores (prices by store, after ER-1b) have their
// slots in the registry and no content yet, so they do not show.

describe('the figure card\'s sections', () => {
  it('registers Details, Photos, Copies and Stores in that order, the later two with their slots and nothing built yet', () => {
    expect(FIGURE_SECTIONS.map((s) => s.id)).toEqual(['details', 'photos', 'copies', 'stores']);
    expect(FIGURE_SECTIONS.map((s) => [s.id, s.ready])).toEqual([
      ['details', true],
      ['photos', false],
      ['copies', true],
      ['stores', false],
    ]);
    expect(readySections().map((s) => s.id)).toEqual(['details', 'copies']);
  });
});

describe('FigureRail', () => {
  it('shows the sections that have content: Details and Copies, no Photos or Stores until they land', () => {
    render(<FigureRail detailsOpen={false} onDetails={() => {}} onCopies={() => {}} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Details', 'Copies']);
    expect(screen.queryByRole('button', { name: 'Photos' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stores' })).toBeNull();
  });

  it('Details is current while its fields show, and a tap on it is the card\'s to answer', () => {
    const onDetails = vi.fn();
    const { rerender } = render(<FigureRail detailsOpen={false} onDetails={onDetails} onCopies={() => {}} />);
    expect(screen.getByRole('button', { name: 'Details' })).not.toHaveAttribute('aria-current');
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(onDetails).toHaveBeenCalledTimes(1);
    rerender(<FigureRail detailsOpen onDetails={onDetails} onCopies={() => {}} />);
    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-current', 'true');
  });

  it('Copies opens what "Copies and actions" opens; a figure with no local item has none to open, so it is disabled', () => {
    const onCopies = vi.fn();
    const { rerender } = render(<FigureRail detailsOpen={false} onDetails={() => {}} onCopies={onCopies} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copies' }));
    expect(onCopies).toHaveBeenCalledTimes(1);
    rerender(<FigureRail detailsOpen={false} onDetails={() => {}} onCopies={null} />);
    expect(screen.getByRole('button', { name: 'Copies' })).toBeDisabled();
  });
});

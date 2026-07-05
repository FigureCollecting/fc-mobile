import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

import { FigureDetailContent } from '../FigureDetailContent';
import { renderWithProviders } from '../../../test/testUtils';
import { FIXTURE_FIGURES } from '../../../dev-fixtures/fixtures';

describe('FigureDetailContent (shared between the viewer sheet and the Fold dual-pane)', () => {
  it('shows the figure name, position counter, and badges', () => {
    const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
    renderWithProviders(<FigureDetailContent figure={rem} index={0} total={7} />);
    expect(screen.getByText('Rem')).toBeInTheDocument();
    expect(screen.getByText('1 of 7')).toBeInTheDocument();
    expect(screen.getByText('1/7')).toBeInTheDocument();
    expect(screen.getByText('Good Smile Company')).toBeInTheDocument();
    expect(screen.getByText(/owned/i)).toBeInTheDocument();
  });

  it('expands to show origin, distributor, and category on tap', async () => {
    const user = userEvent.setup();
    const dark = FIXTURE_FIGURES.find((f) => f._id === 'fx-dark-angel')!;
    renderWithProviders(<FigureDetailContent figure={dark} index={1} total={7} />);
    expect(screen.queryByText('Original Character')).toBeNull();
    await user.click(screen.getByRole('button', { name: /expand details/i }));
    expect(screen.getByText('Original Character')).toBeInTheDocument();
    expect(screen.getByText('Distributor')).toBeInTheDocument();
  });

  it('manages its own expand state independent of other mounted instances', async () => {
    const user = userEvent.setup();
    const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
    const { container } = renderWithProviders(
      <>
        <div data-testid="a"><FigureDetailContent figure={rem} index={0} total={7} /></div>
        <div data-testid="b"><FigureDetailContent figure={rem} index={0} total={7} /></div>
      </>,
    );
    const buttons = container.querySelectorAll('[aria-label="Expand details"]');
    expect(buttons).toHaveLength(2);
    await user.click(buttons[0]);
    const stillCollapsed = container.querySelectorAll('[aria-label="Expand details"]');
    const nowExpanded = container.querySelectorAll('[aria-label="Collapse details"]');
    expect(stillCollapsed).toHaveLength(1);
    expect(nowExpanded).toHaveLength(1);
  });
});

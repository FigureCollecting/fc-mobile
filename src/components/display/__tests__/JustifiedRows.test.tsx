import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

import { JustifiedRows } from '../JustifiedRows';
import { renderWithProviders } from '../../../test/testUtils';
import { FIXTURE_FIGURES } from '../../../dev-fixtures/fixtures';

describe('JustifiedRows (Display B)', () => {
  it('renders every figure with an accessible name', () => {
    renderWithProviders(<JustifiedRows figures={FIXTURE_FIGURES} density="compact" />);
    for (const f of FIXTURE_FIGURES) {
      expect(screen.getByRole('button', { name: f.name })).toBeInTheDocument();
    }
  });

  it('lays out fixed-height rows with native-aspect item widths', () => {
    const { container } = renderWithProviders(
      <JustifiedRows figures={FIXTURE_FIGURES} density="compact" />,
    );
    const rows = container.querySelectorAll('.jrows__row');
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect((row as HTMLElement).style.height).toMatch(/px$/);
    }
  });

  it('reports taps with the figure and its flat index', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderWithProviders(
      <JustifiedRows figures={FIXTURE_FIGURES} density="compact" onSelect={onSelect} />,
    );
    await user.click(screen.getByRole('button', { name: FIXTURE_FIGURES[4].name }));
    expect(onSelect).toHaveBeenCalledWith(FIXTURE_FIGURES[4], 4);
  });
});

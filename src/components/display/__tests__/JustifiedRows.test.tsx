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

  describe('nameplate labels (off by default)', () => {
    it('renders no captions when labels is not set', () => {
      const { container } = renderWithProviders(<JustifiedRows figures={FIXTURE_FIGURES} density="compact" />);
      expect(container.querySelector('.jrows__caption')).toBeNull();
    });

    it('renders no captions when labels is explicitly false', () => {
      const { container } = renderWithProviders(
        <JustifiedRows figures={FIXTURE_FIGURES} density="compact" labels={false} />,
      );
      expect(container.querySelector('.jrows__caption')).toBeNull();
    });

    it('shows a bottom-gradient caption with name + manufacturer when labels is on', () => {
      const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
      const { container } = renderWithProviders(
        <JustifiedRows figures={[rem]} density="compact" labels />,
      );
      const caption = container.querySelector('.jrows__caption')!;
      expect(caption).not.toBeNull();
      expect(caption.querySelector('.jrows__caption-name')!.textContent).toBe(rem.name);
      expect(caption.querySelector('.jrows__caption-mfr')!.textContent).toBe(rem.manufacturer);
    });

    it('keeps the caption out of the accessible name (aria-hidden, decorative)', () => {
      const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
      renderWithProviders(<JustifiedRows figures={[rem]} density="compact" labels />);
      expect(screen.getByRole('button', { name: rem.name })).toBeInTheDocument();
    });
  });
});

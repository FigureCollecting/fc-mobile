import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import type { Figure } from '@figurecollecting/fc-shared';

import { CaseShelf } from '../CaseShelf';
import { renderWithProviders } from '../../../test/testUtils';
import { FIXTURE_FIGURES, FIXTURE_META } from '../../../dev-fixtures/fixtures';

describe('CaseShelf (Display A — virtual cases)', () => {
  it('stands every figure on a shelf with an accessible name', () => {
    renderWithProviders(
      <CaseShelf figures={FIXTURE_FIGURES} motif="detolf-dark" density="compact" />,
    );
    for (const f of FIXTURE_FIGURES) {
      expect(screen.getByRole('button', { name: f.name })).toBeInTheDocument();
    }
  });

  it('applies the requested motif theme', () => {
    const { container } = renderWithProviders(
      <CaseShelf figures={FIXTURE_FIGURES} motif="glass-clear" density="compact" />,
    );
    expect(container.querySelector('.case')?.getAttribute('data-motif')).toBe('glass-clear');
  });

  it('positions each contact shadow from the manifest footprint scalars', () => {
    const { container } = renderWithProviders(
      <CaseShelf figures={[FIXTURE_FIGURES[0]]} motif="detolf-dark" density="compact" />,
    );
    const meta = FIXTURE_META['fx-rem'];
    const shadow = container.querySelector('.shelf-figure__shadow') as HTMLElement;
    const expectedWidth = meta.footprintWidth * 1.3 * 100;
    const expectedLeft = (meta.footprintCenterX - (meta.footprintWidth * 1.3) / 2) * 100;
    expect(parseFloat(shadow.style.width)).toBeCloseTo(expectedWidth, 1);
    expect(parseFloat(shadow.style.left)).toBeCloseTo(expectedLeft, 1);
  });

  it('widens the shadow into a synthetic base when the matte lost the real one', () => {
    const spike = FIXTURE_FIGURES.find((f) => f._id === 'fx-spike')!;
    const { container } = renderWithProviders(
      <CaseShelf figures={[spike]} motif="detolf-dark" density="compact" />,
    );
    const btn = container.querySelector('.shelf-figure') as HTMLElement;
    expect(btn.getAttribute('data-synthetic-base')).toBe('true');
    const meta = FIXTURE_META['fx-spike'];
    const shadow = container.querySelector('.shelf-figure__shadow') as HTMLElement;
    expect(parseFloat(shadow.style.width)).toBeCloseTo(meta.footprintWidth * 1.55 * 100, 1);
  });

  it('renders unmatted figures as framed pictures standing on the shelf', () => {
    const photo: Figure = {
      _id: 'real-1',
      name: 'Un-matted figure',
      manufacturer: 'Kotobukiya',
      scale: '1/7',
      imageUrl: 'https://example.com/photo.jpg',
      userId: 'u1',
      createdAt: '',
      updatedAt: '',
    } as Figure;
    const { container } = renderWithProviders(
      <CaseShelf figures={[photo]} motif="detolf-dark" density="compact" />,
    );
    expect(container.querySelector('.shelf-figure--framed')).not.toBeNull();
    expect(container.querySelector('.shelf-figure__frame')).not.toBeNull();
  });

  it('reports taps with the figure and its index in the result set', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderWithProviders(
      <CaseShelf figures={FIXTURE_FIGURES} motif="detolf-dark" density="compact" onSelect={onSelect} />,
    );
    await user.click(screen.getByRole('button', { name: FIXTURE_FIGURES[2].name }));
    expect(onSelect).toHaveBeenCalledWith(FIXTURE_FIGURES[2], 2);
  });

  it('carries the watermark slot with a placeholder wordmark by default', () => {
    const { container } = renderWithProviders(
      <CaseShelf figures={FIXTURE_FIGURES} motif="bookcase-wood" density="compact" />,
    );
    const mark = container.querySelector('.case__watermark');
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toMatch(/figurecollecting/i);
  });

  it('packs multiple shelf bays for a full collection at phone width', () => {
    const { container } = renderWithProviders(
      <CaseShelf figures={FIXTURE_FIGURES} motif="detolf-dark" density="compact" />,
    );
    expect(container.querySelectorAll('.case__bay').length).toBeGreaterThan(1);
  });

  describe('nameplate labels (off by default)', () => {
    it('renders no nameplates when labels is not set', () => {
      const { container } = renderWithProviders(
        <CaseShelf figures={FIXTURE_FIGURES} motif="detolf-dark" density="compact" />,
      );
      expect(container.querySelector('.shelf-figure__plate')).toBeNull();
    });

    it('renders no nameplates when labels is explicitly false', () => {
      const { container } = renderWithProviders(
        <CaseShelf figures={FIXTURE_FIGURES} motif="detolf-dark" density="compact" labels={false} />,
      );
      expect(container.querySelector('.shelf-figure__plate')).toBeNull();
    });

    it('shows a plaque under each figure with name + manufacturer when labels is on', () => {
      const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
      const { container } = renderWithProviders(
        <CaseShelf figures={[rem]} motif="detolf-dark" density="compact" labels />,
      );
      const plate = container.querySelector('.shelf-figure__plate')!;
      expect(plate).not.toBeNull();
      expect(plate.querySelector('.shelf-figure__plate-name')!.textContent).toBe(rem.name);
      expect(plate.querySelector('.shelf-figure__plate-mfr')!.textContent).toBe(rem.manufacturer);
    });

    it('keeps the plaque out of the accessible name (aria-hidden, decorative)', () => {
      const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
      renderWithProviders(
        <CaseShelf figures={[rem]} motif="detolf-dark" density="compact" labels />,
      );
      // Accessible name stays exactly the figure name — the plate doesn't
      // pollute it via duplicated text content.
      expect(screen.getByRole('button', { name: rem.name })).toBeInTheDocument();
    });

    it('omits the manufacturer line when the figure has none', () => {
      const noMfr: Figure = {
        _id: 'no-mfr',
        name: 'Mystery Figure',
        manufacturer: '',
        scale: '1/7',
        userId: 'u1',
        createdAt: '',
        updatedAt: '',
      } as Figure;
      const { container } = renderWithProviders(
        <CaseShelf figures={[noMfr]} motif="detolf-dark" density="compact" labels />,
      );
      expect(container.querySelector('.shelf-figure__plate-name')!.textContent).toBe('Mystery Figure');
      expect(container.querySelector('.shelf-figure__plate-mfr')).toBeNull();
    });
  });
});

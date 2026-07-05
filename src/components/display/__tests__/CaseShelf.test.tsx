import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import type { Figure } from '@figurecollecting/fc-shared';

import { CaseShelf, PLATE_ZONE_PX } from '../CaseShelf';
import { renderWithProviders } from '../../../test/testUtils';
import { FIXTURE_FIGURES, FIXTURE_META, getFixtureFigures } from '../../../dev-fixtures/fixtures';

/** Fake a real, bounded scroll viewport so the virtualizer measures a
 *  non-zero rect (@tanstack/virtual-core reads offsetWidth/offsetHeight,
 *  which jsdom always reports as 0 without real layout). */
function mockScrollViewport(heightPx: number) {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('app-content') ? heightPx : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('app-content') ? 360 : 0;
  });
}

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

    describe('shelf-edge mounting (Ross: plates must never climb over the figure base)', () => {
      it('mounts the plate bottom offset to exactly -PLATE_ZONE_PX, growing down from the figure edge', () => {
        const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
        const { container } = renderWithProviders(
          <CaseShelf figures={[rem]} motif="detolf-dark" density="compact" labels />,
        );
        const plate = container.querySelector('.shelf-figure__plate') as HTMLElement;
        expect(plate.style.bottom).toBe(`-${PLATE_ZONE_PX}px`);
      });

      it('grows the bay height by exactly PLATE_ZONE_PX when labels are on, vs. off', () => {
        const { container: withLabels } = renderWithProviders(
          <CaseShelf figures={FIXTURE_FIGURES} motif="detolf-dark" density="compact" labels />,
        );
        const { container: withoutLabels } = renderWithProviders(
          <CaseShelf figures={FIXTURE_FIGURES} motif="detolf-dark" density="compact" />,
        );
        const heightWith = parseFloat((withLabels.querySelector('.case__bay') as HTMLElement).style.height);
        const heightWithout = parseFloat((withoutLabels.querySelector('.case__bay') as HTMLElement).style.height);
        expect(heightWith - heightWithout).toBe(PLATE_ZONE_PX);
      });

      it('lifts the row padding-bottom (the figure baseline) by the same PLATE_ZONE_PX', () => {
        const { container } = renderWithProviders(
          <CaseShelf figures={FIXTURE_FIGURES} motif="detolf-dark" density="compact" labels />,
        );
        const row = container.querySelector('.case__row') as HTMLElement;
        expect(row.style.paddingBottom).toBe(`${13 + PLATE_ZONE_PX}px`);
      });

      it('keeps the shelf plane/lip anchored to the figure (unchanged) when labels are off', () => {
        const { container } = renderWithProviders(
          <CaseShelf figures={FIXTURE_FIGURES} motif="detolf-dark" density="compact" />,
        );
        const row = container.querySelector('.case__row') as HTMLElement;
        const plane = container.querySelector('.case__plane') as HTMLElement;
        const lip = container.querySelector('.case__lip') as HTMLElement;
        expect(row.style.paddingBottom).toBe('13px');
        expect(plane.style.bottom).toBe('8px');
        expect(lip.style.bottom).toBe('0px');
      });

      it('keeps the full, untruncated name in the DOM even when it will visually wrap/ellipsize', () => {
        // Truncation here is a CSS (line-clamp) concern, not a data one — the
        // text node itself must carry the complete name.
        const longest = FIXTURE_FIGURES.find((f) => f._id === 'fx-miku-deepsea')!;
        const { container } = renderWithProviders(
          <CaseShelf figures={[longest]} motif="detolf-dark" density="compact" labels />,
        );
        expect(container.querySelector('.shelf-figure__plate-name')!.textContent).toBe(longest.name);
      });
    });
  });

  describe('case depth cues (side walls + back-wall vignette)', () => {
    it('renders a depth overlay per case, decorative and non-interactive', () => {
      const { container } = renderWithProviders(
        <CaseShelf figures={FIXTURE_FIGURES} motif="detolf-dark" density="compact" />,
      );
      const depth = container.querySelector('.case__depth');
      expect(depth).not.toBeNull();
      expect(depth!.getAttribute('aria-hidden')).toBe('true');
    });

    it('renders the depth overlay for every motif', () => {
      for (const motif of ['detolf-dark', 'glass-clear', 'bookcase-wood'] as const) {
        const { container } = renderWithProviders(
          <CaseShelf figures={FIXTURE_FIGURES} motif={motif} density="compact" />,
        );
        expect(container.querySelector(`.case[data-motif="${motif}"] .case__depth`)).not.toBeNull();
      }
    });
  });

  describe('shelf-level virtualization (large collections)', () => {
    it('renders only a windowed subset of bays for a large collection with a real scroll container', async () => {
      mockScrollViewport(780);
      const many = getFixtureFigures(60);
      const { container } = renderWithProviders(
        <div class="app-content" style={{ height: '780px', overflow: 'auto' }}>
          <CaseShelf figures={many} motif="detolf-dark" density="compact" />
        </div>,
      );
      await waitFor(() => {
        const bays = container.querySelectorAll('.case__bay');
        expect(bays.length).toBeGreaterThan(0);
        expect(bays.length).toBeLessThan(40);
      });
    });

    it('renders every figure when no .app-content scroll ancestor is present (fallback)', () => {
      const many = getFixtureFigures(20);
      const { container } = renderWithProviders(
        <CaseShelf figures={many} motif="detolf-dark" density="compact" />,
      );
      expect(container.querySelectorAll('.shelf-figure')).toHaveLength(many.length);
    });
  });
});

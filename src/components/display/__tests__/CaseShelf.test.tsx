import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import type { Figure } from '@figurecollecting/fc-shared';

vi.mock('../alphaMargin', () => ({ useBottomMarginFrac: vi.fn(() => 0) }));

import { CaseShelf, PLATE_ZONE_PX } from '../CaseShelf';
import { renderWithProviders } from '../../../test/testUtils';
import { FIXTURE_FIGURES, FIXTURE_META, getFixtureFigures } from '../../../dev-fixtures/fixtures';
import { useBottomMarginFrac } from '../alphaMargin';
import { SHELF_BAND } from '../density';

const mockedUseBottomMarginFrac = vi.mocked(useBottomMarginFrac);

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

      it('keeps the row baseline at its unlabeled padding, and the floor top pinned to the bay height, when labels are off', () => {
        const { container } = renderWithProviders(
          <CaseShelf figures={FIXTURE_FIGURES} motif="detolf-dark" density="compact" />,
        );
        const row = container.querySelector('.case__row') as HTMLElement;
        const bay = container.querySelector('.case__bay') as HTMLElement;
        const floor = container.querySelector('.case__floor3d') as HTMLElement;
        expect(row.style.paddingBottom).toBe('13px');
        // The floor's hinge-fold sits at the bay's own bottom edge — its
        // inline `top` should exactly match the bay's own height.
        expect(floor.style.top).toBe(bay.style.height);
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

  describe('case depth cues (genuine CSS 3D interior — perspective + preserve-3d)', () => {
    it('renders a full 3D interior per bay: back wall, both side walls, floor, and plinth', () => {
      const { container } = renderWithProviders(
        <CaseShelf figures={FIXTURE_FIGURES} motif="detolf-dark" density="compact" />,
      );
      const bay3d = container.querySelector('.case__bay3d');
      expect(bay3d).not.toBeNull();
      expect(bay3d!.getAttribute('aria-hidden')).toBe('true');
      expect(container.querySelector('.case__back3d')).not.toBeNull();
      expect(container.querySelector('.case__wall-left3d')).not.toBeNull();
      expect(container.querySelector('.case__wall-right3d')).not.toBeNull();
      expect(container.querySelector('.case__floor3d')).not.toBeNull();
      expect(container.querySelector('.case__plinth3d')).not.toBeNull();
    });

    it('renders the 3D interior for every motif', () => {
      for (const motif of ['detolf-dark', 'glass-clear', 'bookcase-wood'] as const) {
        const { container } = renderWithProviders(
          <CaseShelf figures={FIXTURE_FIGURES} motif={motif} density="compact" />,
        );
        expect(container.querySelector(`.case[data-motif="${motif}"] .case__floor3d`)).not.toBeNull();
      }
    });

    it('gives the preserve-3d interior real depth via the shared --case-d custom property', () => {
      const { container } = renderWithProviders(
        <CaseShelf figures={FIXTURE_FIGURES} motif="detolf-dark" density="compact" />,
      );
      const caseEl = container.querySelector('.case') as HTMLElement;
      expect(caseEl.style.getPropertyValue('--case-d')).toMatch(/^\d+px$/);
    });

    it('never reintroduces per-figure reflections (frosted glass diffuses, it does not mirror)', () => {
      const { container } = renderWithProviders(
        <CaseShelf figures={FIXTURE_FIGURES} motif="glass-clear" density="compact" />,
      );
      expect(container.querySelector('.shelf-figure__reflection')).toBeNull();
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

    it('gives a bay whose tallest occupant is short a shorter bay than one whose tallest occupant is tall (dynamic per-row height)', async () => {
      // A narrow, controlled container width so two copies of the tall
      // figure exactly fill row 1 (forcing the short figure onto row 2
      // alone) — both figures are in the SAME displayed set throughout, so
      // the shared scale genuinely differentiates their heights (unlike
      // comparing two isolated single-figure renders, where each figure
      // would trivially be "the tallest" of its own singleton set).
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('case-host') ? 248 : 0;
      });
      const darkAngel = FIXTURE_FIGURES.find((f) => f._id === 'fx-dark-angel')!; // 260mm, tallest fixture
      const nendo = FIXTURE_FIGURES.find((f) => f._id === 'fx-miku-nendo')!; // 100mm, shortest fixture
      const { container } = renderWithProviders(
        <CaseShelf figures={[darkAngel, { ...darkAngel, _id: 'fx-dark-angel-2' }, nendo]} motif="detolf-dark" density="compact" />,
      );
      await waitFor(() => {
        const bays = Array.from(container.querySelectorAll('.case__bay')) as HTMLElement[];
        expect(bays.length).toBe(2);
      });
      const bays = Array.from(container.querySelectorAll('.case__bay')) as HTMLElement[];
      const [row1Height, row2Height] = bays.map((b) => parseFloat(b.style.height));
      // Not a shared constant anymore — a bay's height depends on what's
      // actually packed onto it, and the two rows here have different
      // tallest occupants.
      expect(row2Height).toBeLessThan(row1Height);
    });
  });

  describe('proportional physical-height sizing (relative to the displayed set, not a fixed per-figure default)', () => {
    it('fills the band for the tallest labeled figure in the set, and scales a shorter one down proportionally', () => {
      const darkAngel = FIXTURE_FIGURES.find((f) => f._id === 'fx-dark-angel')!; // 260mm — tallest fixture
      const nendo = FIXTURE_FIGURES.find((f) => f._id === 'fx-miku-nendo')!; // 100mm — shortest fixture
      const { container } = renderWithProviders(
        <CaseShelf figures={[darkAngel, nendo]} motif="detolf-dark" density="compact" />,
      );
      const buttons = Array.from(container.querySelectorAll('.shelf-figure')) as HTMLElement[];
      expect(parseFloat(buttons[0].style.height)).toBe(SHELF_BAND.compact);
      expect(parseFloat(buttons[1].style.height)).toBe(Math.round((100 / 260) * SHELF_BAND.compact));
    });

    it('recomputes the scale when the displayed set changes ("rolling", not frozen forever)', () => {
      const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!; // 230mm
      const nendo = FIXTURE_FIGURES.find((f) => f._id === 'fx-miku-nendo')!; // 100mm
      const darkAngel = FIXTURE_FIGURES.find((f) => f._id === 'fx-dark-angel')!; // 260mm
      const { container: pairOnly } = renderWithProviders(
        <CaseShelf figures={[rem, nendo]} motif="detolf-dark" density="compact" />,
      );
      const { container: withTaller } = renderWithProviders(
        <CaseShelf figures={[rem, nendo, darkAngel]} motif="detolf-dark" density="compact" />,
      );
      const nendoAlone = parseFloat((pairOnly.querySelectorAll('.shelf-figure')[1] as HTMLElement).style.height);
      const nendoWithTaller = parseFloat((withTaller.querySelectorAll('.shelf-figure')[1] as HTMLElement).style.height);
      // Same physical figure, smaller RELATIVE size once a taller figure
      // joins the displayed set — proof the scale isn't per-figure-fixed.
      expect(nendoWithTaller).toBeLessThan(nendoAlone);
    });
  });

  describe('per-figure alpha grounding (real measured feet, not the image edge)', () => {
    it('shifts the image down by its measured bottom-margin fraction of its own rendered height', () => {
      mockedUseBottomMarginFrac.mockReturnValue(0.1);
      const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
      const { container } = renderWithProviders(
        <CaseShelf figures={[rem]} motif="detolf-dark" density="compact" />,
      );
      const btn = container.querySelector('.shelf-figure') as HTMLElement;
      const img = container.querySelector('.shelf-figure__img') as HTMLImageElement;
      const h = parseFloat(btn.style.height);
      expect(img.style.transform).toBe(`translateY(${Math.round(0.1 * h)}px)`);
    });

    it('applies no transform when the measured margin is 0 — nothing to correct for', () => {
      mockedUseBottomMarginFrac.mockReturnValue(0);
      const rem = FIXTURE_FIGURES.find((f) => f._id === 'fx-rem')!;
      const { container } = renderWithProviders(
        <CaseShelf figures={[rem]} motif="detolf-dark" density="compact" />,
      );
      const img = container.querySelector('.shelf-figure__img') as HTMLImageElement;
      expect(img.style.transform).toBeFalsy();
    });

    it('never measures alpha for unmatted (framed-photo) figures — nothing to measure', () => {
      mockedUseBottomMarginFrac.mockReturnValue(0);
      mockedUseBottomMarginFrac.mockClear();
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
      renderWithProviders(<CaseShelf figures={[photo]} motif="detolf-dark" density="compact" />);
      expect(mockedUseBottomMarginFrac).toHaveBeenCalledWith(undefined);
    });
  });

  describe('caseMode / caseProfile (future-stub seam for the fixed-case fit-check feature)', () => {
    it('defaults to dynamic mode and renders normally with no caseMode prop', () => {
      const { container } = renderWithProviders(
        <CaseShelf figures={FIXTURE_FIGURES} motif="detolf-dark" density="compact" />,
      );
      expect(container.querySelectorAll('.shelf-figure')).toHaveLength(FIXTURE_FIGURES.length);
    });

    it('accepts caseMode="fixed" and a caseProfile without crashing (not fully wired yet)', () => {
      const profile = { name: 'IKEA Detolf', innerWidthMm: 340, innerDepthMm: 320, innerHeightMm: 330 };
      expect(() =>
        renderWithProviders(
          <CaseShelf figures={FIXTURE_FIGURES} motif="detolf-dark" density="compact" caseMode="fixed" caseProfile={profile} />,
        ),
      ).not.toThrow();
    });
  });
});

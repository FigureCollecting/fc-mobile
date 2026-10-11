import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene } from '../CabinetScene';
import { DEFAULT_CASE_PREFS } from '../casePrefs';
import { FIXTURE_FIGURES } from '../../../dev-fixtures/fixtures';
import type { AlphaMargins } from '../alphaMargin';

/** What the canvas read of each picture's alpha says, by URL; null while it is still measuring. */
const measured = vi.hoisted(() => ({ margins: new Map<string, AlphaMargins | null>(), fallback: null as AlphaMargins | null }));

vi.mock('../alphaMargin', async (importOriginal) => {
  const real = await importOriginal<typeof import('../alphaMargin')>();
  return {
    ...real,
    useMeasuredAlphaMargins: (url: string | undefined) => (url ? (measured.margins.has(url) ? measured.margins.get(url)! : measured.fallback) : { top: 0, bottom: 0 }),
    useContactBand: () => null,
  };
});

afterEach(() => {
  cleanup();
  measured.margins.clear();
  measured.fallback = null;
});

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  surface: number;
}

function figures(figs: Figure[], extra: Partial<Parameters<typeof CabinetScene>[0]> = {}) {
  const { container } = render(<CabinetScene figures={figs} onSelect={vi.fn()} prefs={DEFAULT_CASE_PREFS} {...extra} />);
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button.cab-figure')).map((b) => ({
    name: b.getAttribute('aria-label')!,
    tap: JSON.parse(b.dataset.world!) as Box,
    art: JSON.parse(b.dataset.artBox!) as Box,
    grounded: b.dataset.grounded,
  }));
}

describe('CabinetScene: figures at true scale (the transparent margin above the head counts too)', () => {
  it("each picture is as tall as its figure's labelled height over BOTH clear margins; its lowest opaque row stands on the surface", () => {
    measured.fallback = { top: 0.25, bottom: 0.05 };
    const rows = figures(FIXTURE_FIGURES);
    expect(rows).toHaveLength(FIXTURE_FIGURES.length);
    for (const r of rows) {
      const labelled = r.tap.y1 - r.tap.y0;
      const pictureH = r.art.y1 - r.art.y0;
      expect(pictureH * (1 - 0.25 - 0.05), r.name).toBeCloseTo(labelled, 3);
      expect(r.art.y0 + 0.05 * pictureH, r.name).toBeCloseTo(r.tap.surface, 3);
      // the head: the highest opaque row is the labelled height above the surface
      expect(r.art.y1 - 0.25 * pictureH, r.name).toBeCloseTo(r.tap.surface + labelled, 3);
      expect(r.grounded).toBe('1');
    }
  });

  it("the image list's measured bottom wins; the top is measured on the mask", () => {
    measured.fallback = { top: 0.2, bottom: 0.02 };
    const ref = (f: Figure) => ({ url: `/clean/${f._id}.png`, maskUrl: `/mask/${f._id}.png`, width: 600, height: 800, bottomMarginFrac: 0.1 });
    for (const r of figures(FIXTURE_FIGURES.slice(0, 3), { imageFor: ref })) {
      const pictureH = r.art.y1 - r.art.y0;
      expect(pictureH * (1 - 0.2 - 0.1), r.name).toBeCloseTo(r.tap.y1 - r.tap.y0, 3);
      expect(r.art.y0 + 0.1 * pictureH, r.name).toBeCloseTo(r.tap.surface, 3);
    }
  });

  it('not grounded until its margins are known (the e2e waits for it); drawn meanwhile on the margins it has', () => {
    const rows = figures(FIXTURE_FIGURES.slice(0, 2));
    for (const r of rows) {
      expect(r.grounded, r.name).toBe('0');
      expect(r.art.y1 - r.art.y0).toBeCloseTo(r.tap.y1 - r.tap.y0, 6);
    }
  });

  it('a picture without alpha (framed) or none (plate) is grounded at once, its box the figure', () => {
    const framed = { ...FIXTURE_FIGURES[0], _id: 'framed', imageUrl: '/plain.jpg' } as Figure;
    const plate = { ...FIXTURE_FIGURES[1], _id: 'plate', imageUrl: undefined } as Figure;
    for (const r of figures([framed, plate])) {
      expect(r.grounded, r.name).toBe('1');
      expect(r.art.y0).toBeCloseTo(r.tap.surface, 6);
      expect(r.art.y1 - r.art.y0).toBeCloseTo(r.tap.y1 - r.tap.y0, 6);
    }
  });
});

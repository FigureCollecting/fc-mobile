import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene } from '../CabinetScene';
import { DEFAULT_CASE_PREFS } from '../casePrefs';
import { FIXTURE_FIGURES } from '../../../dev-fixtures/fixtures';
import type { PictureMargins } from '../figureArt';
import { FIGURE_GAP_MM } from '../packCabinets';

/** What the canvas read of each picture's alpha says, by URL; null while it is still measuring. */
const measured = vi.hoisted(() => ({ margins: new Map<string, PictureMargins | null>(), fallback: null as PictureMargins | null }));

vi.mock('../alphaMargin', async (importOriginal) => {
  const real = await importOriginal<typeof import('../alphaMargin')>();
  return {
    ...real,
    // each picture of the list known once it is read; one still measuring is left out
    useAlphaMarginsOf: (urls: readonly string[]) =>
      new Map(urls.flatMap((u) => {
        const m = measured.margins.has(u) ? measured.margins.get(u)! : measured.fallback;
        return m ? [[u, m] as const] : [];
      })),
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
  return drawn(container);
}

function drawn(container: ParentNode) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button.cab-figure')).map((b) => ({
    name: b.getAttribute('aria-label')!,
    tap: JSON.parse(b.dataset.world!) as Box,
    art: JSON.parse(b.dataset.artBox!) as Box,
    grounded: b.dataset.grounded,
    picture: b.querySelector<HTMLElement>('.cab-figure__box')!,
  }));
}

describe('CabinetScene: figures at true scale (the transparent margin above the head counts too)', () => {
  it("each picture is as tall as its figure's labelled height over BOTH clear margins; its lowest opaque row stands on the surface", () => {
    // clear columns at the sides too, so each figure draws about as wide as its label and the seven share one cabinet
    measured.fallback = { top: 0.25, bottom: 0.05, left: 0.15, right: 0.15 };
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
      // drawn there: the picture rises above the tap box (the figure) by its clear top margin, 1 px per mm
      expect(parseFloat(r.picture.style.top), r.name).toBeCloseTo(-(r.art.y1 - r.tap.y1), 3);
      expect(parseFloat(r.picture.style.height), r.name).toBeCloseTo(pictureH, 3);
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

/** Neighbours on each surface, left to right, by what they draw: the picture's columns less its clear sides. */
function expectOpaqueApart(rows: ReturnType<typeof drawn>, sides: { left: number; right: number }) {
  const bySurface = new Map<number, typeof rows>();
  for (const r of rows) bySurface.set(r.tap.surface, [...(bySurface.get(r.tap.surface) ?? []), r]);
  let pairs = 0;
  for (const row of bySurface.values()) {
    // in the order they stand: by their tap boxes (their slots), not their pictures
    row.sort((a, b) => a.tap.x0 - b.tap.x0);
    for (let i = 1; i < row.length; i++) {
      const [a, b] = [row[i - 1], row[i]];
      const aRight = a.art.x1 - sides.right * (a.art.x1 - a.art.x0);
      const bLeft = b.art.x0 + sides.left * (b.art.x1 - b.art.x0);
      expect(bLeft, `${a.name} / ${b.name}`).toBeGreaterThanOrEqual(aRight - 1e-6);
      pairs++;
    }
  }
  expect(pairs).toBeGreaterThan(0);
}

const unlabelled = (f: Figure) => ({ ...f, dimensions: { heightMm: f.dimensions!.heightMm } }) as Figure;
const labelled = (widthMm: number) => (f: Figure) => ({ ...f, dimensions: { ...f.dimensions, widthMm } }) as Figure;

describe('CabinetScene: cut-out and masked art packed by what it draws at true scale, so no figure reaches over a neighbour', () => {
  // tall clear rows above the head and a little at each side: every picture draws wider than aspect x height
  const margins = { top: 0.3, bottom: 0.05, left: 0.04, right: 0.04 };
  const masked = (f: Figure) => ({ url: `/clean/${f._id}.png`, maskUrl: `/mask/${f._id}.png`, width: 600, height: 800 });

  it('an unlabelled cut-out: its opaque columns never meet a neighbour\'s', () => {
    measured.fallback = margins;
    expectOpaqueApart(figures(FIXTURE_FIGURES.map(unlabelled)), margins);
  });

  it('masked art without a label: the same, by its mask', () => {
    measured.fallback = margins;
    expectOpaqueApart(figures(FIXTURE_FIGURES.map(unlabelled), { imageFor: masked }), margins);
  });

  it('a label narrower than what the cut-out draws (as the real sign-off cut-outs have) is packed by what it draws', () => {
    measured.fallback = margins;
    expectOpaqueApart(figures(FIXTURE_FIGURES.map(labelled(20))), margins);
  });

  it('a label wider than what it draws is kept: neighbours stand a label apart', () => {
    measured.fallback = margins;
    const rows = figures(FIXTURE_FIGURES.slice(0, 3).map(labelled(400)));
    const centres = rows.map((r) => (r.tap.x0 + r.tap.x1) / 2).sort((a, b) => a - b);
    for (let i = 1; i < centres.length; i++) expect(centres[i] - centres[i - 1]).toBeGreaterThanOrEqual(400 + 10 - 1e-6);
  });

  it('a picture still measuring holds back only its own figure: it stands by its label, ungrounded; the rest are grounded and packed by what they draw', () => {
    const figs = FIXTURE_FIGURES.map(labelled(20));
    measured.fallback = margins;
    // Spike's picture is still being read
    measured.margins.set(figs[4].imageUrl!, null);
    const onSelect = vi.fn();
    const { container, rerender } = render(<CabinetScene figures={figs} onSelect={onSelect} prefs={DEFAULT_CASE_PREFS} />);
    const before = drawn(container);
    const spike = before.find((r) => r.name === figs[4].name)!;
    expect(spike.grounded).toBe('0');
    // by its 20 mm label: its tap box that and half the gap each side
    expect(spike.tap.x1 - spike.tap.x0).toBeCloseTo(20 + FIGURE_GAP_MM, 6);
    const others = before.filter((r) => r !== spike);
    expect(others.map((r) => r.grounded)).toEqual(others.map(() => '1'));
    expectOpaqueApart(others, margins);
    measured.margins.clear();
    rerender(<CabinetScene figures={figs} onSelect={onSelect} prefs={DEFAULT_CASE_PREFS} />);
    const after = drawn(container);
    expect(after.map((r) => r.grounded)).toEqual(after.map(() => '1'));
    expectOpaqueApart(after, margins);
  });
});

describe('CabinetScene: a figure off-centre in its picture stands centred on its slot (its opaque columns, not its picture)', () => {
  /** A face's world x where it starts and how wide it is: quadStyle puts its corner in matrix3d's translation, 1 px per mm. */
  const span = (el: HTMLElement) => ({ x: Number(el.style.transform.replace(/^matrix3d\(/, '').split(',')[12]), w: parseFloat(el.style.width) });

  for (const sides of [
    { left: 0.38, right: 0.02 },
    { left: 0.02, right: 0.38 },
    { left: 0.7, right: 0.1 },
  ]) {
    it(`clear ${sides.left} left, ${sides.right} right: the figure centred on its tap box, never over a neighbour; its shadow under it`, () => {
      measured.fallback = { top: 0.2, bottom: 0.03, ...sides };
      const { container } = render(<CabinetScene figures={FIXTURE_FIGURES.map(unlabelled)} onSelect={vi.fn()} prefs={DEFAULT_CASE_PREFS} />);
      const rows = drawn(container);
      expect(rows).toHaveLength(FIXTURE_FIGURES.length);
      for (const r of rows) {
        const w = r.art.x1 - r.art.x0;
        const figure = { x0: r.art.x0 + sides.left * w, x1: r.art.x1 - sides.right * w };
        const slotCx = (r.tap.x0 + r.tap.x1) / 2;
        expect((figure.x0 + figure.x1) / 2, r.name).toBeCloseTo(slotCx, 5);
        // the picture is drawn there: its box starts where its art box does, relative to the tap box
        expect(parseFloat(r.picture.style.left), r.name).toBeCloseTo(r.art.x0 - r.tap.x0, 5);
        // the shadow, with no contact band known, lies under the figure
        const shadow = span(r.picture.closest('button')!.previousElementSibling as HTMLElement);
        expect(shadow.x + shadow.w / 2, r.name).toBeCloseTo(slotCx, 5);
      }
      expectOpaqueApart(rows, sides);
    });
  }

  it("a contact band from the image list moves with the picture: the shadow stays under the figure's base", () => {
    measured.fallback = { top: 0.2, bottom: 0.03, left: 0.7, right: 0.1 };
    // the figure stands in columns 0.7..0.9 of its picture, its base centred under it
    const ref = (f: Figure) => ({ url: `/clean/${f._id}.png`, maskUrl: `/mask/${f._id}.png`, width: 600, height: 800, contactBand: { centerXFrac: 0.8, widthFrac: 0.15 } });
    const { container } = render(<CabinetScene figures={FIXTURE_FIGURES.slice(0, 3).map(unlabelled)} onSelect={vi.fn()} prefs={DEFAULT_CASE_PREFS} imageFor={ref} />);
    for (const r of drawn(container)) {
      const shadow = span(r.picture.closest('button')!.previousElementSibling as HTMLElement);
      expect(shadow.x + shadow.w / 2, r.name).toBeCloseTo((r.tap.x0 + r.tap.x1) / 2, 5);
    }
  });
});

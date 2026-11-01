import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene } from '../CabinetScene';
import { LEGACY_PREFS } from '../../../test/legacyPrefs';
import { FIXTURE_FIGURES } from '../../../dev-fixtures/fixtures';
import type { PictureMargins } from '../figureArt';
import { FIGURE_BUDGET_VIEWPORTS } from '../caseCull';

/** What the canvas read of each picture's alpha says, by URL; null while it is still measuring. */
const measured = vi.hoisted(() => ({ margins: new Map<string, PictureMargins | null>(), fallback: null as PictureMargins | null, loaded: [] as string[] }));

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
    alphaPictureLoaded: (url: string) => measured.loaded.push(url),
  };
});

afterEach(() => {
  cleanup();
  measured.margins.clear();
  measured.fallback = null;
  measured.loaded.length = 0;
});

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  surface: number;
}

function figures(figs: Figure[], extra: Partial<Parameters<typeof CabinetScene>[0]> = {}) {
  const { container } = render(<CabinetScene figures={figs} onSelect={vi.fn()} prefs={LEGACY_PREFS} {...extra} />);
  return drawn(container);
}

/** A length the scene draws, in mm: its px over the scene's px per mm (MOB-NAV-2 texelScale). */
function mmOf(el: Element, px: string): number {
  return parseFloat(px) / Number(el.closest<HTMLElement>('.cabinet-scene')!.dataset.pxPerMm);
}

/** A face's width in the world (mm), whether its element is that width at the scene's px per mm or a texel grid its matrix stretches. */
function widthMm(el: HTMLElement): number {
  const m = el.style.transform.replace(/^matrix3d\(|\)$/g, '').split(',').map(Number);
  return mmOf(el, el.style.width) * Math.hypot(m[0], m[1], m[2]);
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
      // drawn there: the picture rises above the tap box (the figure) by its clear top margin, at the scene's px per mm
      expect(mmOf(r.picture, r.picture.style.top), r.name).toBeCloseTo(-(r.art.y1 - r.tap.y1), 3);
      expect(mmOf(r.picture, r.picture.style.height), r.name).toBeCloseTo(pictureH, 3);
    }
  });

  it("each picture is clipped to the figure in it, its opaque rows and columns: its clear margins cost the figure's layer no px", () => {
    measured.fallback = { top: 0.25, bottom: 0.05, left: 0.15, right: 0.2 };
    const rows = figures(FIXTURE_FIGURES);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.grounded, r.name).toBe('1');
      // top right bottom left, of the picture box
      expect(r.picture.style.clipPath, r.name).toBe('inset(25% 20% 5% 15%)');
    }
    // a framed copy is an opaque box: nothing clipped
    cleanup();
    const framed = figures(FIXTURE_FIGURES.map((f) => ({ ...f, _id: `framed-${f._id}` })));
    expect(framed.length).toBeGreaterThan(0);
    for (const r of framed) {
      expect(r.picture.closest('button')!.dataset.art, r.name).toBe('framed');
      expect(r.picture.style.clipPath, r.name).toBe('');
    }
  });

  it('the figures\' budget counts the clipped pictures: where their whole pictures would overrun it and the clipped ones do not, every figure is drawn at the scene\'s px per mm', () => {
    measured.fallback = { top: 0.25, bottom: 0.05, left: 0.4, right: 0.4 };
    const spike = FIXTURE_FIGURES.find((f) => f._id === 'fx-spike')!;
    // copies of the fixture (fx-spike-xN): matted cut-outs, as getDisplayMeta resolves them
    const wall = Array.from({ length: 600 }, (_, i) => ({ ...spike, _id: `fx-spike-x${i + 2}` }));
    let binding = 0;
    for (const view of ['wall', 'cabinet', 'shelf'] as const) {
      for (const frame of [{ width: 870, height: 400 }, { width: 443, height: 454 }, { width: 616, height: 245 }]) {
        const { container } = render(<CabinetScene figures={wall} onSelect={vi.fn()} prefs={{ ...LEGACY_PREFS, view }} frameFallback={frame} />);
        const host = container.querySelector<HTMLElement>('.cabinet-scene')!;
        const s = Number(host.dataset.pxPerMm);
        const buttons = Array.from(host.querySelectorAll<HTMLElement>('button.cab-figure'));
        let whole = 0;
        let clipped = 0;
        for (const b of buttons) {
          const box = b.querySelector<HTMLElement>('.cab-figure__box')!;
          const k = Number(b.style.getPropertyValue('--s'));
          // each at the scene's px per mm
          const [l, t, w, h] = ['left', 'top', 'width', 'height'].map((x) => (parseFloat(box.style.getPropertyValue(x)) * s) / k);
          const [bw, bh] = [(parseFloat(b.style.width) * s) / k, (parseFloat(b.style.height) * s) / k];
          whole += (Math.max(bw, l + w) - Math.min(0, l)) * (Math.max(bh, t + h) - Math.min(0, t));
          clipped += (Math.max(bw, l + 0.6 * w) - Math.min(0, l + 0.4 * w)) * (Math.max(bh, t + 0.95 * h) - Math.min(0, t + 0.25 * h));
        }
        const budget = FIGURE_BUDGET_VIEWPORTS * frame.width * frame.height;
        if (whole > budget && clipped <= budget) {
          binding++;
          for (const b of buttons) expect(b.style.getPropertyValue('--s'), `${view} ${frame.width}`).toBe(String(s));
        }
        cleanup();
      }
    }
    expect(binding).toBeGreaterThan(0);
  }, 30_000);

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
/**
 * The fixtures a stock KLINGSBO shelf takes (all but the 260 mm Dark Angel Olivia): with her, CASE-FB2b keeps the
 * top for her and the wide cut-outs stand one to a shelf, so no two would be neighbours to compare.
 */
const SHELF_FIXTURES = FIXTURE_FIGURES.filter((f) => f.dimensions!.heightMm! <= 256);
const labelled = (widthMm: number) => (f: Figure) => ({ ...f, dimensions: { ...f.dimensions, widthMm } }) as Figure;

describe('CabinetScene: cut-out and masked art packed by what it draws at true scale, so no figure reaches over a neighbour', () => {
  // tall clear rows above the head and a little at each side: every picture draws wider than aspect x height
  const margins = { top: 0.3, bottom: 0.05, left: 0.04, right: 0.04 };
  const masked = (f: Figure) => ({ url: `/clean/${f._id}.png`, maskUrl: `/mask/${f._id}.png`, width: 600, height: 800 });

  it('an unlabelled cut-out: its opaque columns never meet a neighbour\'s', () => {
    measured.fallback = margins;
    expectOpaqueApart(figures(SHELF_FIXTURES.map(unlabelled)), margins);
  });

  it('masked art without a label: the same, by its mask', () => {
    measured.fallback = margins;
    expectOpaqueApart(figures(FIXTURE_FIGURES.map(unlabelled), { imageFor: masked }), margins);
  });

  it('a label narrower than what the cut-out draws (as the real sign-off cut-outs have) is packed by what it draws', () => {
    measured.fallback = margins;
    expectOpaqueApart(figures(SHELF_FIXTURES.map(labelled(20))), margins);
  });

  it('a label wider than what it draws is kept: neighbours stand a label apart', () => {
    measured.fallback = margins;
    const rows = figures(FIXTURE_FIGURES.slice(0, 3).map(labelled(400)));
    const centres = rows.map((r) => (r.tap.x0 + r.tap.x1) / 2).sort((a, b) => a - b);
    for (let i = 1; i < centres.length; i++) expect(centres[i] - centres[i - 1]).toBeGreaterThanOrEqual(400 + 10 - 1e-6);
  });

  it('a picture still measuring holds back only its own figure: it stands as its plate on its label, ungrounded; the rest are grounded and packed by what they draw', () => {
    const figs = SHELF_FIXTURES.map(labelled(20));
    measured.fallback = margins;
    // Spike's picture is still being read
    const spikeAt = figs.findIndex((f) => f._id === 'fx-spike');
    measured.margins.set(figs[spikeAt].imageUrl!, null);
    const onSelect = vi.fn();
    const { container, rerender } = render(<CabinetScene figures={figs} onSelect={onSelect} prefs={LEGACY_PREFS} />);
    const before = drawn(container);
    const spike = before.find((r) => r.name === figs[spikeAt].name)!;
    expect(spike.grounded).toBe('0');
    // packed by its 20 mm label: its plate that wide, and the plate takes its taps
    expect(spike.tap.x1 - spike.tap.x0).toBeCloseTo(20, 6);
    expect(spike.art.x1 - spike.art.x0).toBeCloseTo(20, 6);
    const others = before.filter((r) => r !== spike);
    expect(others.map((r) => r.grounded)).toEqual(others.map(() => '1'));
    expectOpaqueApart(others, margins);
    measured.margins.clear();
    rerender(<CabinetScene figures={figs} onSelect={onSelect} prefs={LEGACY_PREFS} />);
    const after = drawn(container);
    expect(after.map((r) => r.grounded)).toEqual(after.map(() => '1'));
    expectOpaqueApart(after, margins);
  });
});

describe('CabinetScene: a picture not read yet is never drawn: its plate stands in its place, within the footprint it is packed by', () => {
  const margins = { top: 0.3, bottom: 0.05, left: 0.04, right: 0.04 };
  const masked = (f: Figure) => ({ url: `/clean/${f._id}.png`, maskUrl: `/mask/${f._id}.png`, width: 600, height: 800 });
  const LABEL_MM = 20;

  for (const [branch, imageFor] of [
    ['cut-out', undefined],
    ['masked', masked],
  ] as const) {
    it(`${branch}: the plate (its name) on the surface, no wider than its label, the picture loading hidden; once read, that same picture and no plate`, () => {
      const figs = FIXTURE_FIGURES.map(labelled(LABEL_MM));
      measured.fallback = margins;
      // Spike's picture is still being read
      const spikeUrl = imageFor ? imageFor(figs[4]).maskUrl : figs[4].imageUrl!;
      measured.margins.set(spikeUrl, null);
      const onSelect = vi.fn();
      const { container, rerender } = render(<CabinetScene figures={figs} onSelect={onSelect} prefs={LEGACY_PREFS} imageFor={imageFor} />);
      const rows = drawn(container);
      const spike = rows.find((r) => r.name === figs[4].name)!;
      expect(spike.grounded).toBe('0');
      const plate = spike.picture.querySelector<HTMLElement>('.cab-figure__plate');
      expect(plate?.textContent).toBe(figs[4].name);
      const art = spike.picture.querySelector<HTMLElement>('.cab-figure__art')!;
      expect(art.style.visibility).toBe('hidden');
      // an opaque box standing on the surface, the figure's height, within the label it is packed by
      expect(spike.art.x1 - spike.art.x0).toBeLessThanOrEqual(LABEL_MM + 1e-6);
      expect(mmOf(spike.picture, spike.picture.style.width)).toBeLessThanOrEqual(LABEL_MM + 1e-6);
      expect(spike.art.y0).toBeCloseTo(spike.tap.surface, 6);
      expect(spike.art.y1 - spike.art.y0).toBeCloseTo(spike.tap.y1 - spike.tap.y0, 6);
      expect((spike.art.x0 + spike.art.x1) / 2).toBeCloseTo((spike.tap.x0 + spike.tap.x1) / 2, 6);
      // the others draw their pictures
      for (const r of rows.filter((x) => x !== spike)) {
        expect(r.picture.querySelector('.cab-figure__plate'), r.name).toBeNull();
        expect(r.picture.querySelector<HTMLElement>('.cab-figure__art')!.style.visibility, r.name).toBe('');
      }
      measured.margins.clear();
      rerender(<CabinetScene figures={figs} onSelect={onSelect} prefs={LEGACY_PREFS} imageFor={imageFor} />);
      const read = drawn(container).find((r) => r.name === figs[4].name)!;
      expect(read.grounded).toBe('1');
      expect(read.picture.querySelector('.cab-figure__plate')).toBeNull();
      // the same element, loaded meanwhile: shown at once
      expect(read.picture.querySelector('.cab-figure__art')).toBe(art);
      expect(art.style.visibility).toBe('');
    });
  }

  it("a cut-out's own picture, loading hidden while it is read, tells the reads when it has loaded (a read of it out of time goes again at once); a framed copy, never read, tells nothing", () => {
    const figs = FIXTURE_FIGURES.slice(0, 3);
    const { container } = render(<CabinetScene figures={figs} onSelect={vi.fn()} prefs={LEGACY_PREFS} />);
    const cutouts = Array.from(container.querySelectorAll<HTMLImageElement>('img.cab-figure__art--cutout'));
    expect(cutouts).toHaveLength(3);
    // (by figure: the case stands them in its arrangement, PACK1)
    const cutoutOf = (f: Figure) => container.querySelector<HTMLImageElement>(`button.cab-figure[aria-label="${f.name}"] img.cab-figure__art--cutout`)!;
    fireEvent.load(cutoutOf(figs[1]));
    fireEvent.load(cutoutOf(figs[2]));
    expect(measured.loaded).toEqual([figs[1].imageUrl, figs[2].imageUrl]);
    cleanup();
    measured.loaded.length = 0;
    const framed = { ...FIXTURE_FIGURES[0], _id: 'framed', imageUrl: '/plain.jpg' } as Figure;
    const scene = render(<CabinetScene figures={[framed]} onSelect={vi.fn()} prefs={LEGACY_PREFS} />);
    fireEvent.load(scene.container.querySelector('.cab-figure__frame img')!);
    expect(measured.loaded).toEqual([]);
  });

  it('the plate a figure stands as while its picture is read is the plate of a figure without a picture: the same box on the surface, the same shadow under it', () => {
    // a wide label, and an image list that says where the bottom and the base are: none of it is drawn before the read
    const wide = (f: Figure) => ({ ...f, dimensions: { ...f.dimensions, widthMm: 300 } }) as Figure;
    const reading = wide(FIXTURE_FIGURES[4]);
    const bare = { ...wide(FIXTURE_FIGURES[4]), _id: 'bare', name: 'No picture', imageUrl: undefined } as Figure;
    const ref = (f: Figure) => (f._id === reading._id ? { url: '/clean/r.png', maskUrl: '/mask/r.png', width: 400, height: 800, bottomMarginFrac: 0.1, contactBand: { centerXFrac: 0.2, widthFrac: 0.4 } } : undefined);
    measured.margins.set('/mask/r.png', null);
    const { container } = render(<CabinetScene figures={[reading, bare]} onSelect={vi.fn()} prefs={LEGACY_PREFS} imageFor={ref} />);
    const rows = drawn(container);
    const [a, b] = [rows.find((r) => r.name === reading.name)!, rows.find((r) => r.name === 'No picture')!];
    expect(a.grounded).toBe('0');
    const box = (r: typeof a) => ({ w: r.art.x1 - r.art.x0, h: r.art.y1 - r.art.y0, below: r.tap.surface - r.art.y0, off: (r.art.x0 + r.art.x1) / 2 - (r.tap.x0 + r.tap.x1) / 2 });
    expect(box(a)).toEqual(box(b));
    expect(box(a).below).toBe(0);
    // the plate's own shape, narrower than the label and the picture's
    expect(box(a).w).toBeCloseTo(0.75 * box(a).h, 6);
    const shadowOf = (r: typeof a) => {
      const el = r.picture.closest('button')!.previousElementSibling as HTMLElement;
      const w = widthMm(el);
      return { w, centre: mmOf(el, el.style.transform.replace(/^matrix3d\(/, '').split(',')[12]) + w / 2 - (r.art.x0 + r.art.x1) / 2 };
    };
    expect(shadowOf(a).w).toBeCloseTo(shadowOf(b).w, 4);
    expect(shadowOf(a).centre).toBeCloseTo(0, 4);
  });
});

describe('CabinetScene: a figure off-centre in its picture stands centred on its slot (its opaque columns, not its picture)', () => {
  /** A face's world x where it starts and how wide it is: quadStyle puts its corner in matrix3d's translation, at the scene's px per mm. */
  const span = (el: HTMLElement) => ({ x: mmOf(el, el.style.transform.replace(/^matrix3d\(/, '').split(',')[12]), w: widthMm(el) });

  for (const sides of [
    { left: 0.38, right: 0.02 },
    { left: 0.02, right: 0.38 },
    { left: 0.7, right: 0.1 },
  ]) {
    it(`clear ${sides.left} left, ${sides.right} right: the figure centred on its tap box, never over a neighbour; its shadow under it`, () => {
      measured.fallback = { top: 0.2, bottom: 0.03, ...sides };
      const { container } = render(<CabinetScene figures={FIXTURE_FIGURES.map(unlabelled)} onSelect={vi.fn()} prefs={LEGACY_PREFS} />);
      const rows = drawn(container);
      expect(rows).toHaveLength(FIXTURE_FIGURES.length);
      for (const r of rows) {
        const w = r.art.x1 - r.art.x0;
        const figure = { x0: r.art.x0 + sides.left * w, x1: r.art.x1 - sides.right * w };
        const slotCx = (r.tap.x0 + r.tap.x1) / 2;
        expect((figure.x0 + figure.x1) / 2, r.name).toBeCloseTo(slotCx, 5);
        // the picture is drawn there: its box starts where its art box does, relative to the tap box
        expect(mmOf(r.picture, r.picture.style.left), r.name).toBeCloseTo(r.art.x0 - r.tap.x0, 5);
        // the shadow, with no contact band known, lies under the figure
        const shadow = span(r.picture.closest('button')!.previousElementSibling as HTMLElement);
        expect(shadow.x + shadow.w / 2, r.name).toBeCloseTo(slotCx, 4);
      }
      expectOpaqueApart(rows, sides);
    });
  }

  it("a contact band from the image list moves with the picture: the shadow stays under the figure's base", () => {
    measured.fallback = { top: 0.2, bottom: 0.03, left: 0.7, right: 0.1 };
    // the figure stands in columns 0.7..0.9 of its picture, its base centred under it
    const ref = (f: Figure) => ({ url: `/clean/${f._id}.png`, maskUrl: `/mask/${f._id}.png`, width: 600, height: 800, contactBand: { centerXFrac: 0.8, widthFrac: 0.15 } });
    const { container } = render(<CabinetScene figures={FIXTURE_FIGURES.slice(0, 3).map(unlabelled)} onSelect={vi.fn()} prefs={LEGACY_PREFS} imageFor={ref} />);
    for (const r of drawn(container)) {
      const shadow = span(r.picture.closest('button')!.previousElementSibling as HTMLElement);
      expect(shadow.x + shadow.w / 2, r.name).toBeCloseTo((r.tap.x0 + r.tap.x1) / 2, 4);
    }
  });
});

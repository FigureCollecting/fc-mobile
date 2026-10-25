// LAYOUT-STABLE-1 (Ross 10-18, a first launch: the larger figures "flash into and out of place while it works out what goes
// where"). With steadyLayout the case lays out from a held basis (layoutBasis.ts): nothing is drawn until the first layout,
// a picture that arrives after it draws in the place its figure already has (when it fits), and the wall is laid out again
// only for an explicit change or once everything has arrived.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene } from '../CabinetScene';
import { DEFAULT_CASE_PREFS } from '../casePrefs';
import type { FigureImageRef } from '../figureArt';
import type { AlphaMargins } from '../alphaMargin';
import { HUSH_MS, REVEAL_MAX_MS } from '../layoutBasis';

/** What the canvas read of each picture's alpha says, by URL; a picture not in it is still being measured. */
const measured = vi.hoisted(() => ({ margins: new Map<string, { top: number; bottom: number; left: number; right: number }>(), last: null as null | { key: string; map: Map<string, unknown> } }));

vi.mock('../alphaMargin', async (importOriginal) => {
  const real = await importOriginal<typeof import('../alphaMargin')>();
  return {
    ...real,
    // each picture known once it is read; the same Map while nothing new has been read, as the real hook gives
    useAlphaMarginsOf: (urls: readonly string[]) => {
      const known = urls.filter((u) => measured.margins.has(u));
      const key = known.map((u) => `${u}=${JSON.stringify(measured.margins.get(u))}`).join('|');
      if (measured.last?.key !== key) measured.last = { key, map: new Map(known.map((u) => [u, measured.margins.get(u)!])) };
      return measured.last.map as ReadonlyMap<string, AlphaMargins>;
    },
    useContactBand: () => null,
    alphaPictureLoaded: () => undefined,
  };
});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  measured.margins.clear();
  measured.last = null;
  vi.useRealTimers();
});

const figure = (n: number): Figure =>
  ({ _id: `f${n}`, name: `Figure ${n}`, manufacturer: 'M', scale: '1/7', userId: 'u', createdAt: '', updatedAt: '', dimensions: { heightMm: 200 } }) as Figure;
const FIGURES = [0, 1, 2, 3, 4, 5].map(figure);

const maskOf = (f: Figure) => `/mask-${f._id}.png`;
/** The image list's answer for each figure in `has`: a masked picture 550 x 800 (aspect 0.69). */
const listFor = (has: ReadonlySet<string>) => (f: Figure): FigureImageRef | undefined =>
  has.has(f._id) ? { url: `/c-${f._id}.png`, maskUrl: maskOf(f), width: 550, height: 800 } : undefined;
/** A clear-sided cut-out: draws about 0.28 of its height wide, far inside the 0.75 a plate packs by. */
const NARROW = { top: 0, bottom: 0, left: 0.3, right: 0.3 };
/** An opaque-sided one: draws its whole 0.69 of its height wide... plus nothing clear: wider than 0.5 but inside a plate's 0.75. */
const SOLID = { top: 0, bottom: 0, left: 0, right: 0 };

const buttons = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLButtonElement>('button.cab-figure'));
/** Where each figure stands: its centre, its base and its surface (a tap box narrows with a picture; the place does not). */
const places = (root: ParentNode) =>
  Object.fromEntries(
    buttons(root).map((b) => {
      const w = JSON.parse(b.dataset.world!) as { x0: number; x1: number; y0: number; surface: number };
      return [b.getAttribute('aria-label')!, [Math.round(((w.x0 + w.x1) / 2) * 1000) / 1000, Math.round(w.y0 * 1000) / 1000, Math.round(w.surface * 1000) / 1000]];
    }),
  );
const arts = (root: ParentNode) => Object.fromEntries(buttons(root).map((b) => [b.getAttribute('aria-label')!, b.dataset.art!]));
const host = (root: ParentNode) => root.querySelector<HTMLElement>('.cabinet-scene')!;

type SceneProps = Partial<Parameters<typeof CabinetScene>[0]>;
const props = (extra: SceneProps = {}): Parameters<typeof CabinetScene>[0] => ({
  figures: FIGURES,
  onSelect: vi.fn(),
  prefs: DEFAULT_CASE_PREFS,
  steadyLayout: true,
  ...extra,
});
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe('CabinetScene, steadyLayout: nothing is drawn until the first layout', () => {
  it('draws no figure while the pictures there are are still being measured, and lays out at the deadline with what it has', () => {
    const imageFor = listFor(new Set(FIGURES.map((f) => f._id)));
    const { container } = render(<CabinetScene {...props({ imageFor })} />);
    expect(buttons(container)).toHaveLength(0);
    expect(host(container).dataset.laidOut).toBe('0');
    wait(REVEAL_MAX_MS);
    expect(buttons(container)).toHaveLength(FIGURES.length);
    expect(host(container).dataset.laidOut).toBe('1');
  });

  it('lays out in the very first render when everything is known: no frame without its figures', () => {
    const imageFor = listFor(new Set(FIGURES.map((f) => f._id)));
    for (const f of FIGURES) measured.margins.set(maskOf(f), NARROW);
    const { container } = render(<CabinetScene {...props({ imageFor, imagesComplete: true })} />);
    expect(buttons(container)).toHaveLength(FIGURES.length);
    expect(host(container).dataset.laidOut).toBe('1');
  });

  it('is off unless asked for: the figures are drawn at once and the wall moves as pictures arrive, as it did', () => {
    const imageFor = listFor(new Set(FIGURES.map((f) => f._id)));
    const { container, rerender } = render(<CabinetScene {...props({ imageFor, steadyLayout: undefined })} />);
    expect(buttons(container)).toHaveLength(FIGURES.length);
    const before = places(container);
    for (const f of FIGURES) measured.margins.set(maskOf(f), NARROW);
    rerender(<CabinetScene {...props({ imageFor, steadyLayout: undefined })} />);
    expect(places(container)).not.toEqual(before);
  });
});

describe('CabinetScene, steadyLayout: after the first layout the wall holds', () => {
  /** Laid out at the deadline with no picture yet: every figure a plate. */
  const laidOutAsPlates = () => {
    const out = render(<CabinetScene {...props({ imageFor: listFor(new Set()), imagesComplete: false })} />);
    wait(REVEAL_MAX_MS);
    expect(buttons(out.container)).toHaveLength(FIGURES.length);
    return out;
  };

  it('a picture that arrives changes nobody\'s place, and draws in its own when it fits', () => {
    const { container, rerender } = laidOutAsPlates();
    const placed = places(container);
    expect(Object.values(arts(container)).every((k) => k === 'plate')).toBe(true);
    // pictures arrive one after another, each narrow: they fit the plate's footprint it was packed by
    const has = new Set<string>();
    for (const f of FIGURES) {
      has.add(f._id);
      measured.margins.set(maskOf(f), NARROW);
      rerender(<CabinetScene {...props({ imageFor: listFor(new Set(has)), imagesComplete: false })} />);
      expect(places(container), `after ${f._id} arrived`).toEqual(placed);
    }
    expect(Object.values(arts(container)).every((k) => k === 'masked')).toBe(true);
  });

  it('a picture that would draw wider than its place stays a plate there, and no other figure moves for it', () => {
    const { container, rerender } = laidOutAsPlates();
    const placed = places(container);
    // an opaque-sided 4:1 picture draws 4 x its height wide, far past the 0.75 a plate packs by
    const wide = (f: Figure): FigureImageRef | undefined => (f._id === 'f2' ? { url: '/c.png', maskUrl: maskOf(f), width: 3200, height: 800 } : undefined);
    measured.margins.set(maskOf(FIGURES[2]), SOLID);
    rerender(<CabinetScene {...props({ imageFor: wide, imagesComplete: false })} />);
    expect(places(container)).toEqual(placed);
    expect(arts(container)['Figure 2']).toBe('plate');
  });

  it('lays out again at once for an explicit change: a new filter or order', () => {
    const { container, rerender } = laidOutAsPlates();
    for (const f of FIGURES) measured.margins.set(maskOf(f), NARROW);
    const imageFor = listFor(new Set(FIGURES.map((f) => f._id)));
    rerender(<CabinetScene {...props({ imageFor, imagesComplete: false })} />);
    const held = places(container);
    // the user changes the sort: laid out by what is known now, in the very render
    rerender(<CabinetScene {...props({ imageFor, imagesComplete: false, filterKey: 'sorted by name', figures: [...FIGURES].reverse() })} />);
    expect(places(container)).not.toEqual(held);
  });

  it('lays out once more when everything has arrived (the pictures all kept, none unmeasured), and then holds again', () => {
    const { container, rerender } = laidOutAsPlates();
    const plates = places(container);
    for (const f of FIGURES) measured.margins.set(maskOf(f), NARROW);
    const imageFor = listFor(new Set(FIGURES.map((f) => f._id)));
    rerender(<CabinetScene {...props({ imageFor, imagesComplete: false })} />);
    expect(places(container)).toEqual(plates);
    // the sync completes: the one tidy-up, packed by what the pictures draw
    rerender(<CabinetScene {...props({ imageFor, imagesComplete: true })} />);
    const tidy = places(container);
    expect(tidy).not.toEqual(plates);
    // and it holds: nothing further arrives, nothing further moves
    wait(60_000);
    expect(places(container)).toEqual(tidy);
  });
});

// LAYOUT-FINAL: the scene says when the wall it holds is the one it settles on, so an e2e walk can start on that wall
describe('CabinetScene, steadyLayout: data-layout-final', () => {
  it('reads 0 while the wall is laid out from what has arrived so far, and 1 once the tidy-up has laid it out by everything', () => {
    const { container, rerender } = render(<CabinetScene {...props({ imageFor: listFor(new Set()), imagesComplete: false })} />);
    expect(host(container).dataset.layoutFinal).toBe('0');
    wait(REVEAL_MAX_MS);
    expect(host(container).dataset.laidOut).toBe('1');
    expect(host(container).dataset.layoutFinal).toBe('0');
    for (const f of FIGURES) measured.margins.set(maskOf(f), NARROW);
    const imageFor = listFor(new Set(FIGURES.map((f) => f._id)));
    rerender(<CabinetScene {...props({ imageFor, imagesComplete: false })} />);
    expect(host(container).dataset.layoutFinal).toBe('0');
    rerender(<CabinetScene {...props({ imageFor, imagesComplete: true })} />);
    expect(host(container).dataset.layoutFinal).toBe('1');
  });

  it('reads 1 from the start when steadyLayout is off: the wall is always laid out by what it has', () => {
    const { container } = render(<CabinetScene {...props({ imageFor: listFor(new Set()), imagesComplete: false, steadyLayout: undefined })} />);
    expect(host(container).dataset.layoutFinal).toBe('1');
  });
});

describe('CabinetScene, steadyLayout: cards (a figure is as tall as its card says)', () => {
  const withCard = (f: Figure, heightMm: number, hasCard: boolean) => ({ ...f, dimensions: { heightMm }, local: { hasCard } }) as unknown as Figure;
  const uncarded = FIGURES.map((f) => withCard(f, 200, false));
  const carded = FIGURES.map((f) => withCard(f, 330, true));

  it('the launch draws what the device has, with no card: laid out after the hush, never held for cards that may not come', () => {
    const { container } = render(<CabinetScene {...props({ figures: uncarded, imagesComplete: false })} />);
    expect(buttons(container)).toHaveLength(0);
    wait(HUSH_MS);
    expect(buttons(container)).toHaveLength(FIGURES.length);
  });

  it('cards that arrive after the layout redraw it at once, as an explicit change', () => {
    const { container, rerender } = render(<CabinetScene {...props({ figures: uncarded })} />);
    expect(buttons(container)).toHaveLength(FIGURES.length);
    const before = places(container);
    rerender(<CabinetScene {...props({ figures: carded })} />);
    expect(places(container)).not.toEqual(before);
  });

  it('cards arriving before the first layout put it off by a hush, so the batch is laid out once, not each card', () => {
    const { container, rerender } = render(<CabinetScene {...props({ figures: uncarded, imagesComplete: false })} />);
    wait(HUSH_MS - 100);
    // a card comes in: the quiet starts again
    rerender(<CabinetScene {...props({ figures: [withCard(FIGURES[0], 330, true), ...uncarded.slice(1)], imagesComplete: false })} />);
    wait(HUSH_MS - 100);
    expect(buttons(container)).toHaveLength(0);
    wait(100);
    expect(buttons(container)).toHaveLength(FIGURES.length);
  });
});

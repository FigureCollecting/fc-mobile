// FIT1 (Ross 10-19): a listed width wins over the photo. The case draws a cut-out wider than its listing smaller, to fit it, and
// flags a photo more than 15 % off the listed width: the figure's button says so (data-photo-fit) and the Info card's Size row
// reads the same flag (usePhotoFit), which goes with the case.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene } from '../CabinetScene';
import { LEGACY_PREFS } from '../../../test/legacyPrefs';
import type { FigureImageRef } from '../figureArt';
import type { AlphaMargins } from '../alphaMargin';
import { getPhotoFits, setPhotoFits } from '../photoFit';

/** What the canvas read of each picture's alpha says, by URL. */
const measured = vi.hoisted(() => ({ margins: new Map<string, { top: number; bottom: number; left: number; right: number }>(), last: null as null | { key: string; map: Map<string, unknown> } }));

vi.mock('../alphaMargin', async (importOriginal) => {
  const real = await importOriginal<typeof import('../alphaMargin')>();
  return {
    ...real,
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

afterEach(() => {
  cleanup();
  measured.margins.clear();
  measured.last = null;
  setPhotoFits(new Map());
});

const figure = (id: string, dimensions?: Figure['dimensions']): Figure =>
  ({ _id: id, name: id, manufacturer: 'M', scale: '', userId: 'u', createdAt: '', updatedAt: '', ...(dimensions ? { dimensions } : {}) }) as Figure;
// Kato Megumi (a8df0a43): listed H360 W227; her photo's figure fills a 280 x 360 picture
const MEGUMI = figure('megumi', { heightMm: 360, widthMm: 227, depthMm: 160 });
const NARROW = figure('narrow', { heightMm: 360, widthMm: 227 });
const PLAIN = figure('plain');
const FIGURES = [MEGUMI, NARROW, PLAIN];
const FILLS = { top: 0, bottom: 0, left: 0, right: 0 };
const maskOf = (f: Figure) => `/mask-${f._id}.png`;
const SIZES: Record<string, [number, number]> = { megumi: [280, 360], narrow: [180, 360], plain: [280, 360] };
const imageFor = (f: Figure): FigureImageRef => ({ url: `/c-${f._id}.png`, maskUrl: maskOf(f), width: SIZES[f._id]![0], height: SIZES[f._id]![1] });

const scene = () => {
  for (const f of FIGURES) measured.margins.set(maskOf(f), FILLS);
  return render(<CabinetScene figures={FIGURES} onSelect={vi.fn()} prefs={LEGACY_PREFS} imageFor={imageFor} />);
};
const button = (root: ParentNode, name: string) => root.querySelector<HTMLButtonElement>(`button.cab-figure[aria-label="${name}"]`)!;
const worldHeight = (b: HTMLElement) => {
  const w = JSON.parse(b.dataset.world!) as { y0: number; y1: number };
  return w.y1 - w.y0;
};

describe('CabinetScene: a listed width wins over the photo (FIT1)', () => {
  it('draws Megumi to her listing (227 wide, 292 tall, not 280 x 360) and flags her photo 23 % wider', () => {
    const { container } = scene();
    const b = button(container, 'megumi');
    expect(b.dataset.photoFit).toBe('wider:23');
    expect(worldHeight(b)).toBeCloseTo((360 * 227) / 280, 1);
  });

  it('a photo narrower than the listing is drawn at the listed height and flagged narrower', () => {
    const { container } = scene();
    const b = button(container, 'narrow');
    expect(b.dataset.photoFit).toBe('narrower:21');
    expect(worldHeight(b)).toBeCloseTo(360, 1);
  });

  it('a figure with no listed width carries no flag', () => {
    const { container } = scene();
    expect(button(container, 'plain').dataset.photoFit).toBeUndefined();
  });

  it('publishes the flags for the Info card, and takes them away with the case', () => {
    const { unmount } = scene();
    expect([...getPhotoFits()]).toEqual([
      ['megumi', { dir: 'wider', pct: 23 }],
      ['narrow', { dir: 'narrower', pct: 21 }],
    ]);
    unmount();
    expect(getPhotoFits().size).toBe(0);
  });
});

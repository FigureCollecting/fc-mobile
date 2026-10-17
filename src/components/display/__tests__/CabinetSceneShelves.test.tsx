import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene } from '../CabinetScene';
import { DEFAULT_CASE_PREFS } from '../casePrefs';
import { IKEA_DETOLF, IKEA_KLINGSBO } from '../cabinetPresets';
import { liftOutShelves } from '../cabinetProfile';
import { __clearAlphaMarginCache } from '../alphaMargin';

// CASE-FB2b: a cabinet with glass shelves taken out for tall figures is drawn as it stands: no glass where a shelf
// came out, the tall figures standing in the tier it made, the cabinet saying which shelves are out.

beforeEach(() => __clearAlphaMarginCache());
afterEach(() => cleanup());

const sized = (i: number, heightMm: number, widthMm: number): Figure => ({ _id: `s${i}`, name: `Figure ${i}`, dimensions: { heightMm, widthMm } }) as Figure;

/**
 * Short figures with a run of taller ones among them, more than the tops hold: in a KLINGSBO 1/6 (270 mm) and 1/4
 * (425 mm) figures; in a Detolf, whose compartments are taller, 450 mm ones and 780 mm ones over what its top's room leaves (757.6 mm).
 */
const wall = (tall: readonly [number, number]): Figure[] => [
  ...Array.from({ length: 20 }, (_, i) => sized(i, 200, 100)),
  ...Array.from({ length: 10 }, (_, i) => sized(20 + i, tall[i % 2], i % 2 === 0 ? 120 : 160)),
  ...Array.from({ length: 16 }, (_, i) => sized(30 + i, 200, 100)),
];
const TALL: Record<string, readonly [number, number]> = { [IKEA_KLINGSBO.id]: [270, 425], [IKEA_DETOLF.id]: [450, 780] };

function scene(figures: Figure[], pattern: string) {
  const { container } = render(
    <CabinetScene figures={figures} onSelect={vi.fn()} prefs={{ ...DEFAULT_CASE_PREFS, pattern, view: 'wall' }} frameFallback={{ width: 870, height: 900 }} />,
  );
  return container.querySelector('.cabinet-scene') as HTMLElement;
}

describe('CASE-FB2b: a cabinet with shelves out, drawn as it stands', () => {
  for (const profile of [IKEA_KLINGSBO, IKEA_DETOLF]) {
    it(`${profile.id}: the glass shelves taken out are not drawn; the cabinet names them; its tall figures stand in the tier`, () => {
      const host = scene(wall(TALL[profile.id]), profile.id);
      const cabs = Array.from(host.querySelectorAll<HTMLElement>('.cab'));
      const opened = cabs.filter((c) => c.dataset.removed !== undefined);
      expect(opened.length).toBeGreaterThan(0);
      const glassShelves = liftOutShelves(profile).length;
      for (const c of cabs) {
        const removed = c.dataset.removed ? c.dataset.removed.split(',').map(Number) : [];
        expect(removed.every((i) => liftOutShelves(profile).includes(i))).toBe(true);
        expect(c.querySelectorAll('.cab-shelf--glass'), `cabinet ${c.dataset.index}`).toHaveLength(glassShelves - removed.length);
      }
      // the tall figures (over the stock tallest compartment) stand inside, on the surfaces of the tiers
      const stockTallest = Math.max(...profile.surfaces.slice(0, -1).map((x, i) => profile.surfaces[i + 1].topMm - profile.surfaces[i + 1].thicknessMm - x.topMm));
      const top = profile.surfaces[profile.surfaces.length - 1].topMm;
      const tallInside = Array.from(host.querySelectorAll<HTMLElement>('button.cab-figure'))
        .map((b) => JSON.parse(b.dataset.world!) as { y0: number; y1: number; surface: number })
        .filter((w) => w.y1 - w.y0 > stockTallest && w.surface !== top);
      expect(tallInside.length).toBeGreaterThan(0);
    });
  }

  it('the scene says what every cabinet holds, drawn or not: figures inside, on its top, the shelves it stands without', () => {
    const figures = wall(TALL[IKEA_KLINGSBO.id]);
    const host = scene(figures, IKEA_KLINGSBO.id);
    const held = JSON.parse(host.dataset.held!) as [number, number, number[]][];
    expect(held).toHaveLength(JSON.parse(host.dataset.wall!).length);
    expect(held.reduce((n, [inside, top]) => n + inside + top, 0)).toBe(figures.length);
    for (const c of Array.from(host.querySelectorAll<HTMLElement>('.cab'))) {
      expect(held[Number(c.dataset.index)][2].join(',')).toBe(c.dataset.removed ?? '');
    }
  });

  it('a wall with no figure too tall for a stock shelf takes no shelf out', () => {
    const host = scene(Array.from({ length: 40 }, (_, i) => sized(i, 200, 100)), IKEA_KLINGSBO.id);
    expect(host.querySelectorAll('.cab[data-removed]')).toHaveLength(0);
    expect(host.querySelector('.cab')!.querySelectorAll('.cab-shelf--glass')).toHaveLength(4);
  });
});

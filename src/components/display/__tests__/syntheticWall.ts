import type { Figure } from '@figurecollecting/fc-shared';
import type { CaseFigure } from '../packCabinets';

/**
 * A seeded synthetic collection (no real data) for the case packer's tests and timings: series of a few figures, a
 * 1/7-heavy scale mix like a collector's, each figure's size estimated (depth 0.65 x width).
 */
export function synthetic(n: number, seed: number): { figures: Figure[]; items: CaseFigure[] } {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const SCALES: [string, number, number, number][] = [
    ['1/7', 230, 260, 40],
    ['1/6', 260, 320, 15],
    ['1/4', 380, 480, 15],
    ['', 170, 230, 15],
    ['Non-scale', 90, 110, 8],
    ['1/3', 450, 700, 7],
  ];
  const total = SCALES.reduce((a, x) => a + x[3], 0);
  const figures: Figure[] = [];
  const items: CaseFigure[] = [];
  let series = 0;
  while (figures.length < n) {
    const size = Math.max(1, Math.round(rnd() * rnd() * 14));
    series++;
    for (let j = 0; j < size && figures.length < n; j++) {
      let r = rnd() * total;
      const [scale, lo, hi] = SCALES.find((x) => (r -= x[3]) <= 0) ?? SCALES[0];
      const h = lo + rnd() * (hi - lo);
      const w = h * (0.35 + rnd() * 0.65);
      const i = figures.length;
      const day = String(1 + Math.floor(rnd() * 28)).padStart(2, '0');
      const figure = { _id: `id${String(i).padStart(4, '0')}`, name: `Figure ${Math.floor(rnd() * 900)}`, origin: `Series ${series}`, scale, createdAt: `2026-0${1 + (i % 9)}-${day}T00:00:00Z` } as Figure;
      figures.push(figure);
      items.push({ figure, index: i, heightMm: h, widthMm: w, billboardWidthMm: w, depthMm: 0.65 * w, heightEstimated: true });
    }
  }
  return { figures, items };
}

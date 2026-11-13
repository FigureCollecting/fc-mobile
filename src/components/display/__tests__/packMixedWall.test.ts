import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createHash } from 'node:crypto';
import type { Figure } from '@figurecollecting/fc-shared';
import { IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../cabinetPresets';
import { FIT_EPSILON_MM, withClearance, type CabinetProfile } from '../cabinetProfile';
import { arrangeOrder, CASE_ARRANGEMENTS, type CaseArrangement } from '../caseArrangement';
import { FIGURE_GAP_MM, fitCheck, packCabinets, PACK_RULES, surfaceSlots, type CaseFigure, type PackedCabinet, type PackResult } from '../packCabinets';

/**
 * PACK-KIND-1 (Ross 11-13): on the wall of KLINGSBOs with the Detolf and the open steel rack alongside, a figure is
 * judged by the cabinet it lands in, not by the one the shelf cursor is in. A KLINGSBO's compartments (with 1 in of
 * clearance) are about 230 mm, a Detolf's about 360 mm, so a 1/7 figure is tall for a KLINGSBO and a plain shelf figure
 * for a Detolf or the rack: the KLINGSBO's tiers and top are kept for it, and the Detolf never takes glass out for it.
 */

const CLEARANCE_MM = 25.4;
const CEILING_MM = 2438.4;
const K = withClearance(IKEA_KLINGSBO, CLEARANCE_MM);
const D = withClearance(IKEA_DETOLF, CLEARANCE_MM);
const R = withClearance(OPEN_STEEL_RACK, CLEARANCE_MM);
const WALL = [K, D, R];
const STOCK: Record<string, CabinetProfile> = { [K.id]: K, [D.id]: D, [R.id]: R };

function fig(index: number, heightMm: number, widthMm: number, group = 'g'): CaseFigure {
  return {
    figure: { _id: `f${index}`, name: `f${index}`, origin: group } as Figure,
    index,
    heightMm,
    widthMm,
    billboardWidthMm: widthMm,
    depthMm: 0.65 * widthMm,
    heightEstimated: true,
  };
}

const pack = (items: CaseFigure[], groups?: string[], pattern: CabinetProfile[] = WALL) => packCabinets(items, pattern, CEILING_MM, PACK_RULES, groups);
const isTall = (profile: CabinetProfile, item: CaseFigure) => {
  const v = fitCheck(profile, item, CEILING_MM, true).verdict;
  return v === 'needs-tier' || v === 'top-only';
};
const stockOf = (c: PackedCabinet) => STOCK[c.profile.id];
/** The tallest compartment the cabinet has with every shelf in: a slot taller than that is a tier (shelves out). */
const stockMax = (p: CabinetProfile) => Math.max(...surfaceSlots(p, CEILING_MM).filter((s) => !s.isTop).map((s) => s.maxHeightMm));
const isTier = (c: PackedCabinet, k: number) => !c.surfaces[k].slot.isTop && c.surfaces[k].slot.maxHeightMm > stockMax(stockOf(c)) + FIT_EPSILON_MM;
const fitsAlone = (c: PackedCabinet, k: number, item: CaseFigure) =>
  item.heightMm <= c.surfaces[k].slot.maxHeightMm + FIT_EPSILON_MM && item.widthMm <= c.surfaces[k].slot.widthMm + FIT_EPSILON_MM;
const countOf = (r: PackResult) => r.cabinets.reduce((n, c) => n + c.surfaces.reduce((m, s) => m + s.items.length, 0), 0) + r.violators.length;

// fixture a: 1/7-like figures, 245 mm tall and 150 mm wide: tall in a KLINGSBO, a shelf figure in a Detolf and the rack
const fixtureA = () => Array.from({ length: 30 }, (_, i) => fig(i, 245, 150, `s${Math.floor(i / 3)}`));
// fixture b: twelve 200 mm prizes (a shelf figure everywhere), then twelve 300 mm figures (tall in a KLINGSBO only)
const fixtureB = () => [...Array.from({ length: 12 }, (_, i) => fig(i, 200, 140, 'g0')), ...Array.from({ length: 12 }, (_, i) => fig(12 + i, 300, 160, 'g1'))];
const groupsOf = (items: CaseFigure[]) => items.map((x) => (x.figure as Figure).origin as string);

/** Every empty tier or top of a cabinet while a figure tall for that cabinet, and fitting there, stands on a plain shelf of a later one. */
function strandedHeld(r: PackResult): string[] {
  const out: string[] = [];
  for (const c of r.cabinets) {
    c.surfaces.forEach((s, k) => {
      if (s.items.length > 0 || !(s.slot.isTop || isTier(c, k))) return;
      for (const later of r.cabinets.slice(c.index + 1)) {
        later.surfaces.forEach((ls, lk) => {
          if (ls.slot.isTop || isTier(later, lk)) return;
          for (const p of ls.items) {
            if (isTall(stockOf(c), p.item) && fitsAlone(c, k, p.item)) out.push(`cab ${c.index} slot ${k} empty; f${p.item.index} on cab ${later.index} slot ${lk}`);
          }
        });
      }
    });
  }
  return out;
}

describe('PACK-KIND-1: the mixed wall judges each figure by the cabinet it lands in', () => {
  it('T1: thirty 1/7 figures fill one KLINGSBO, one Detolf and one rack (3 cabinets, not 5), ungrouped and grouped by threes', () => {
    const items = fixtureA();
    for (const groups of [undefined, groupsOf(items)]) {
      const r = pack(items, groups);
      expect(r.violators).toEqual([]);
      expect(countOf(r)).toBe(items.length);
      expect(r.cabinets.map((c) => c.profile.id)).toEqual([K.id, D.id, R.id]);
    }
  });

  it('T2: no Detolf takes its glass out for figures its stock compartments hold', () => {
    const items = fixtureA();
    for (const groups of [undefined, groupsOf(items)]) {
      const r = pack(items, groups);
      for (const c of r.cabinets.filter((x) => x.profile.id === D.id)) {
        expect(c.profile.layout?.removed ?? []).toEqual([]);
      }
    }
  });

  it('T2: across mixed walls, a figure the stock Detolf or rack holds never stands in a tier one of them made', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ h: fc.integer({ min: 120, max: 720 }), w: fc.integer({ min: 50, max: 330 }) }), { minLength: 1, maxLength: 40 }), (specs) => {
        const r = pack(specs.map((s, i) => fig(i, s.h, s.w)));
        for (const c of r.cabinets.filter((x) => x.profile.id !== K.id)) {
          c.surfaces.forEach((s, k) => {
            if (!isTier(c, k)) return;
            for (const p of s.items) expect(fitCheck(stockOf(c), p.item, CEILING_MM, false).verdict).not.toBe('fits');
          });
        }
      }),
      { numRuns: 150, seed: 1113 },
    );
  });

  it("T3: fixture b, ungrouped: the first KLINGSBO's tiers and top that a 300 mm figure fits each hold one", () => {
    const items = fixtureB();
    const r = pack(items);
    const k0 = r.cabinets[0];
    expect(k0.profile.id).toBe(K.id);
    const big = items[12];
    const room = k0.surfaces.map((_, k) => k).filter((k) => (k0.surfaces[k].slot.isTop || isTier(k0, k)) && fitsAlone(k0, k, big));
    expect(room.length).toBeGreaterThan(0);
    for (const k of room) expect(k0.surfaces[k].items.length, `K0 slot ${k}`).toBeGreaterThan(0);
    expect(strandedHeld(r)).toEqual([]);
  });

  it('T4: no tier or top stays empty while a figure tall for its cabinet, and fitting it, stands on a shelf of a later cabinet (one series)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ h: fc.integer({ min: 120, max: 720 }), w: fc.integer({ min: 50, max: 330 }) }), { minLength: 1, maxLength: 45 }),
        fc.boolean(),
        (specs, oneSeries) => {
          const items = specs.map((s, i) => fig(i, s.h, s.w));
          const r = pack(items, oneSeries ? items.map(() => 'g') : undefined);
          expect(countOf(r)).toBe(items.length);
          expect(strandedHeld(r)).toEqual([]);
        },
      ),
      { numRuns: 300, seed: 1311 },
    );
  });

  it('any mix of the three, any sizes, grouped or not, every rule set: each figure placed once or listed, no row over its surface', () => {
    const RULE_SETS = [PACK_RULES, { tallOnOpenedTops: true, shelfRemoval: false }, { tallOnOpenedTops: false, shelfRemoval: false }] as const;
    fc.assert(
      fc.property(
        fc.array(fc.record({ h: fc.integer({ min: 30, max: 1700 }), w: fc.integer({ min: 15, max: 800 }), d: fc.integer({ min: 10, max: 520 }), next: fc.boolean() }), { minLength: 1, maxLength: 40 }),
        fc.constantFrom([K, D, R], [D, K, R], [R, K], [K, D], [D, R, K], [K, K, D]),
        fc.constantFrom(...RULE_SETS),
        fc.boolean(),
        (specs, pattern, rules, grouped) => {
          let g = 0;
          const items = specs.map((s, i) => ({ ...fig(i, s.h, s.w), depthMm: s.d }));
          const groups = grouped ? specs.map((s) => `g${(g += s.next ? 1 : 0)}`) : undefined;
          const r = packCabinets(items, pattern, CEILING_MM, rules, groups);
          const seen = [...r.cabinets.flatMap((c) => c.surfaces.flatMap((s) => s.items.map((p) => p.item.index))), ...r.violators.map((v) => v.item.index)];
          expect(seen.sort((a, b) => a - b)).toEqual(items.map((x) => x.index));
          for (const c of r.cabinets) {
            for (const s of c.surfaces) {
              const used = s.items.reduce((w, p) => w + p.item.widthMm, 0) + FIGURE_GAP_MM * Math.max(0, s.items.length - 1);
              expect(used).toBeLessThanOrEqual(s.slot.widthMm + FIT_EPSILON_MM);
              for (const p of s.items) expect(p.item.heightMm).toBeLessThanOrEqual(s.slot.maxHeightMm + FIT_EPSILON_MM);
            }
          }
        },
      ),
      { numRuns: 400, seed: 2026 },
    );
  });
});

/** A seeded synthetic collection (no real data): series of a few figures, a 1/7-heavy scale mix like a collector's. */
function synthetic(n: number, seed: number): { figures: Figure[]; items: CaseFigure[] } {
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

/** Where every figure stands, and how each cabinet stands (shelves out), as one digest. */
function digestOf(r: PackResult): string {
  const shape = {
    cabinets: r.cabinets.map((c) => [c.profile.id, c.profile.layout?.removed ?? [], c.surfaces.map((s) => s.items.map((p) => [p.item.index, p.xMm.toFixed(6), p.zMm.toFixed(6), p.tooDeep]))]),
    violators: r.violators.map((v) => [v.item.index, v.reason]),
  };
  return createHash('sha256').update(JSON.stringify(shape)).digest('hex').slice(0, 16);
}

function packArranged(arrangement: CaseArrangement, pattern: CabinetProfile[], n = 622, seed = 7): PackResult {
  const { figures, items } = synthetic(n, seed);
  const { order, groups } = arrangeOrder(figures, arrangement);
  return packCabinets(order.map((i) => items[i]), pattern, CEILING_MM, PACK_RULES, groups);
}

// recorded on 363ba92 (before PACK-KIND-1): a wall of one profile packs exactly as it did
const GOLDEN: Record<string, string> = {
  'ikea-klingsbo name': '603a19ce9b436697',
  'ikea-klingsbo date-added': '158ad4345d4d8980',
  'ikea-detolf name': '618a5009b98a4616',
  'ikea-detolf date-added': '6639d85f6e1a8e9e',
  'open-steel-rack name': '05203b8147a86ec3',
  'open-steel-rack date-added': '7839352f527c44ab',
};

// and every arrangement, 300 figures of another seed
const GOLDEN_ALL: Record<string, string> = {
  'ikea-klingsbo series-scale-name': '40ce1a4e2283deca',
  'ikea-klingsbo scale-series-name': '72e7d6d15a098f9d',
  'ikea-klingsbo series-name': 'ad4037efa62fe27a',
  'ikea-klingsbo scale-name': 'c37f5f3c585c50fd',
  'ikea-klingsbo name': '749a5c23b0e722ac',
  'ikea-klingsbo date-added': '02cf6372463dd6c5',
  'ikea-detolf series-scale-name': '7d453af7cca75c32',
  'ikea-detolf scale-series-name': '95c6a4bf40438a2f',
  'ikea-detolf series-name': '020fc5e4961dee62',
  'ikea-detolf scale-name': '03163bf335f24024',
  'ikea-detolf name': 'c8bb8d4d18d1beb6',
  'ikea-detolf date-added': 'ed890d3e4ef91d13',
  'open-steel-rack series-scale-name': 'a381364327f8a68c',
  'open-steel-rack scale-series-name': '958a37de25bb5dad',
  'open-steel-rack series-name': '8333b1c73cf78204',
  'open-steel-rack scale-name': '84df2319dfe2473e',
  'open-steel-rack name': 'e9816975b0f5e778',
  'open-steel-rack date-added': '57332256d12a18af',
};

describe('PACK-KIND-1: a wall of one profile packs exactly as before', () => {
  for (const p of [K, D, R]) {
    for (const arrangement of ['name', 'date-added'] as const) {
      it(`${p.id}, ${arrangement}: 622 synthetic figures, the placements unchanged`, () => {
        const r = packArranged(arrangement, [p]);
        expect(countOf(r)).toBe(622);
        expect(digestOf(r)).toBe(GOLDEN[`${p.id} ${arrangement}`]);
      });
    }
  }

  it('every arrangement on a wall of one profile: the same placements as before (series orders too)', () => {
    const got = Object.fromEntries([K, D, R].flatMap((p) => CASE_ARRANGEMENTS.map((a) => [`${p.id} ${a}`, digestOf(packArranged(a, [p], 300, 42))])));
    expect(got).toEqual(GOLDEN_ALL);
  });
});


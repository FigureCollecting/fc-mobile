import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createHash } from 'node:crypto';
import type { Figure } from '@figurecollecting/fc-shared';
import { IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../cabinetPresets';
import { FIT_EPSILON_MM, withClearance, type CabinetProfile } from '../cabinetProfile';
import { arrangeOrder, CASE_ARRANGEMENTS, type CaseArrangement } from '../caseArrangement';
import { FIGURE_GAP_MM, fitCheck, packCabinets, PACK_RULES, surfaceSlots, type CaseFigure, type PackedCabinet, type PackOptions, type PackResult } from '../packCabinets';
import { synthetic } from './syntheticWall';

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

const pack = (items: CaseFigure[], groups?: string[], pattern: CabinetProfile[] = WALL, options: PackOptions = {}) =>
  packCabinets(items, pattern, CEILING_MM, PACK_RULES, groups, options);
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

/**
 * Every empty tier or top of a cabinet while a figure tall for that cabinet, and fitting there, stands on a plain shelf
 * of a later one (`tops`: or on a later one's top).
 */
function strandedHeld(r: PackResult, tops = false): string[] {
  const out: string[] = [];
  for (const c of r.cabinets) {
    c.surfaces.forEach((s, k) => {
      if (s.items.length > 0 || !(s.slot.isTop || isTier(c, k))) return;
      for (const later of r.cabinets.slice(c.index + 1)) {
        later.surfaces.forEach((ls, lk) => {
          if ((ls.slot.isTop && !tops) || isTier(later, lk)) return;
          for (const p of ls.items) {
            if (isTall(stockOf(c), p.item) && fitsAlone(c, k, p.item)) out.push(`cab ${c.index} slot ${k} empty; f${p.item.index} on cab ${later.index} slot ${lk}`);
          }
        });
      }
    });
  }
  return out;
}

/** Every figure the stock profile holds standing in a tier a cabinet of that profile made (its glass out for nothing). */
const shelfFigureInTier = (r: PackResult) =>
  r.cabinets.flatMap((c) =>
    c.surfaces.flatMap((s, k) => (isTier(c, k) ? s.items.filter((p) => fitCheck(stockOf(c), p.item, CEILING_MM, false).verdict === 'fits').map((p) => `f${p.item.index} in ${c.profile.id} ${c.index} tier ${k}`) : [])),
  );
const emptyOf = (r: PackResult) => r.cabinets.filter((c) => c.surfaces.every((s) => s.items.length === 0)).length;
/** A packing's cost to compare: its cabinets, then those standing empty. */
const costOf = (r: PackResult) => [r.cabinets.length, emptyOf(r)] as const;
const noWorse = (a: PackResult, b: PackResult) => a.cabinets.length < b.cabinets.length || (a.cabinets.length === b.cabinets.length && emptyOf(a) <= emptyOf(b));

/** A fixture as the challenger printed it: `f4:222x148x96/g1 ...` (index: height x width x depth mm / group). */
function parse(spec: string): { items: CaseFigure[]; groups: string[] } {
  const items: CaseFigure[] = [];
  const groups: string[] = [];
  for (const tok of spec.split(' ')) {
    const [, i, h, w, d, g] = /^f(\d+):(\d+)x(\d+)x(\d+)(?:\/(.+))?$/.exec(tok)!;
    items.push({ ...fig(Number(i), Number(h), Number(w), g ?? 'g'), depthMm: Number(d) });
    groups.push(g ?? 'g');
  }
  return { items, groups };
}
const wallAt = (clearanceMm: number, ...ids: ('K' | 'D' | 'R')[]) =>
  ids.map((x) => withClearance({ K: IKEA_KLINGSBO, D: IKEA_DETOLF, R: OPEN_STEEL_RACK }[x], clearanceMm));

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

  it('T4: no tier or top stays empty while a figure tall for its cabinet, and fitting it, stands on a shelf or top of a later cabinet (one series)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ h: fc.integer({ min: 120, max: 720 }), w: fc.integer({ min: 50, max: 330 }) }), { minLength: 1, maxLength: 45 }),
        fc.boolean(),
        (specs, oneSeries) => {
          const items = specs.map((s, i) => fig(i, s.h, s.w));
          // (the packing with a shelf figure first taking the places kept for it; the packer may keep the one without
          // when that stands in fewer cabinets, below)
          const r = pack(items, oneSeries ? items.map(() => 'g') : undefined, WALL, { deviate: true });
          expect(countOf(r)).toBe(items.length);
          expect(strandedHeld(r, true)).toEqual([]);
        },
      ),
      { numRuns: 400, seed: 1311 },
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

// The challenger's shrunk walls (round 1), as it printed them: f<index>:<height>x<width>x<depth> mm/<group>
// a rack, then a KLINGSBO, by series: f36 (244 mm) is a shelf figure for the rack and tall for the KLINGSBO
const HELD_IN_SEARCH = 'f4:222x148x96/g1 f5:298x92x60/g1 f6:547x214x139/g1 f7:246x150x98/g2 f8:541x113x73/g2 f9:205x66x43/g2 f11:236x106x69/g2 f16:549x179x116/g3 f32:272x106x69/g6 f33:288x134x87/g6 f36:244x122x79/g7 f37:216x206x134/g7 f38:252x141x92/g7 f39:218x137x89/g7 f107:270x132x86/g21 f108:273x189x123/g22 f109:401x205x133/g22';
// a rack, then a KLINGSBO, no series: f83 (440 mm) is a shelf figure for the rack, f48 (587 mm) needs its tier
const RACK_TIER = 'f6:243x127x82 f7:242x166x108 f12:258x113x74 f15:433x251x163 f17:437x218x141 f18:97x49x32 f22:244x130x85 f23:454x296x193 f25:107x50x32 f26:282x114x74 f27:247x151x98 f28:479x439x285 f29:249x238x155 f30:258x166x108 f33:247x92x60 f34:470x170x110 f37:186x93x61 f38:172x114x74 f39:306x279x181 f40:223x215x140 f48:587x494x321 f49:239x93x60 f53:256x183x119 f54:204x151x98 f55:235x151x98 f57:285x200x130 f58:425x377x245 f59:449x172x112 f60:293x159x103 f61:285x222x144 f62:173x114x74 f63:237x100x65 f64:107x95x62 f65:239x194x126 f66:433x293x191 f67:255x169x110 f68:426x219x142 f69:246x105x68 f70:246x151x98 f71:266x149x97 f73:289x246x160 f74:237x104x68 f75:248x238x155 f76:253x156x102 f77:235x142x92 f78:110x77x50 f79:259x176x114 f80:246x169x110 f81:182x168x109 f82:216x144x94 f83:440x238x155';
// a KLINGSBO, then a rack, by series: f5 (587 mm) stands on the KLINGSBO's top, within 1 mm of its height
const ROOM_BOUND = 'f4:290x214x139/g1 f5:587x210x137/g1 f6:236x156x101/g1 f9:203x157x102/g2 f10:243x144x94/g3 f11:248x77x50/g3 f12:495x209x136/g3 f14:218x202x131/g3 f15:297x121x79/g3 f17:217x162x105/g4 f18:316x204x133/g4 f21:398x144x94/g5 f22:408x66x43/g5 f23:249x151x98/g5 f24:429x119x77/g5';
// K-D-R, no series: f12 (300 mm, tall for a KLINGSBO) could take the KLINGSBO's top that f15 (495 mm, tall for the Detolf too) needs
const STARVED = 'f1:300x160x104 f2:548x188x122 f3:180x124x81 f4:300x160x104 f5:180x106x69 f6:300x160x104 f7:180x126x82 f8:180x116x75 f9:300x160x104 f10:180x127x83 f11:180x130x84 f12:300x160x104 f15:495x221x144';
// K-D-R at 2 in of clearance, one scale: 1/4 figures tall for a KLINGSBO and a Detolf, then three 458 mm wide ones only a rack holds
const CROWDED = 'f543:415x319x208/scale:4 f583:415x319x208/scale:4 f109:380x257x167/scale:4 f149:380x257x167/scale:4 f189:380x257x167/scale:4 f229:380x257x167/scale:4 f269:380x257x167/scale:4 f309:380x257x167/scale:4 f349:380x257x167/scale:4 f389:380x257x167/scale:4 f429:380x257x167/scale:4 f469:380x257x167/scale:4 f509:380x257x167/scale:4 f549:380x257x167/scale:4 f589:380x257x167/scale:4 f32:480x408x265/scale:4 f101:429x199x130/scale:4 f141:429x199x130/scale:4 f181:429x199x130/scale:4 f221:429x199x130/scale:4 f261:429x199x130/scale:4 f301:429x199x130/scale:4 f341:429x199x130/scale:4 f381:429x199x130/scale:4 f421:429x199x130/scale:4 f611:456x188x122/scale:4 f104:397x236x153/scale:4 f144:397x236x153/scale:4 f184:397x236x153/scale:4 f224:397x236x153/scale:4 f264:397x236x153/scale:4 f304:397x236x153/scale:4 f344:397x236x153/scale:4 f384:397x236x153/scale:4 f424:397x236x153/scale:4 f464:397x236x153/scale:4 f504:397x236x153/scale:4 f544:397x236x153/scale:4 f92:465x458x297/scale:4 f132:465x458x297/scale:4 f172:465x458x297/scale:4';
// the same wall's twelve (shrunk from it by this round's builder): the waiting 1/4 figures stand on the rack's top
const RACK_TOP = 'f371:456x188x122/scale:4 f411:456x188x122/scale:4 f451:456x188x122/scale:4 f464:397x236x153/scale:4 f504:397x236x153/scale:4 f544:397x236x153/scale:4 f584:397x236x153/scale:4 f13:412x187x122/scale:4 f92:465x458x297/scale:4 f132:465x458x297/scale:4 f334:256x211x137/scale:7 f374:256x211x137/scale:7';
// a Detolf and a KLINGSBO, no series (the challenger's case 1591): the packing without the step was clean at the first
// lean, so the later lean where the step stands them in six was never tried
const LEAN_CUT = 'f1:334x147x96 f2:233x172x112 f3:440x142x92 f4:240x104x68 f5:308x203x132 f6:555x129x84 f7:287x106x69 f8:225x119x77 f9:499x127x83 f10:457x197x128 f11:286x205x133 f13:479x62x40 f14:219x194x126 f15:294x139x90 f17:213x169x110 f19:259x184x120 f20:253x97x63 f22:200x195x127 f23:267x73x47 f24:535x219x142 f25:597x122x79 f26:206x121x79 f27:306x130x85 f28:593x147x96 f29:253x78x51 f30:288x172x112 f31:551x106x69 f32:247x115x75 f33:495x107x70 f34:262x73x47 f35:228x76x49 f36:209x73x47 f37:228x220x143 f38:299x111x72 f39:221x118x77 f40:245x84x55 f41:329x174x113 f42:453x169x110 f43:425x121x79 f44:254x139x90 f45:285x115x75 f46:265x103x67 f47:245x215x140 f48:286x88x57 f49:263x172x112 f50:232x91x59 f51:208x136x88 f52:257x66x43 f53:384x168x109 f54:292x69x45 f55:252x93x60 f56:215x191x124 f57:214x137x89 f58:247x171x111 f59:272x140x91 f60:281x118x77 f61:211x210x137 f62:563x189x123';

describe('PACK-KIND-1 round 1: walls the challenger shrank', () => {
  it("a shelf search takes a held tier or top for a figure tall for that cabinet: f36 on the KLINGSBO's top, not the next rack's", () => {
    const { items, groups } = parse(HELD_IN_SEARCH);
    const r = pack(items, groups, wallAt(25.4, 'R', 'K'));
    expect(r.cabinets.map((c) => c.profile.id)).toEqual([R.id, K.id, R.id]);
    expect(r.cabinets[1].surfaces[0].items.map((p) => p.item.index)).toContain(36);
    expect(strandedHeld(r, true)).toEqual([]);
  });

  it("a figure the rack's shelves hold never stands in the tier it makes for one that needs it", () => {
    const { items } = parse(RACK_TIER);
    for (const deviate of [undefined, true, false]) {
      const r = pack(items, undefined, wallAt(25.4, 'R', 'K'), { deviate });
      expect(shelfFigureInTier(r), `deviate ${deviate}`).toEqual([]);
    }
  });

  it("the room bound passes by no cabinet a figure could stand in: 587 mm on the KLINGSBO's 588 mm top, two cabinets", () => {
    const { items, groups } = parse(ROOM_BOUND);
    const r = pack(items, groups, wallAt(25.4, 'K', 'R'));
    expect(r.cabinets).toHaveLength(2);
    expect(r.cabinets[0].surfaces[0].items.map((p) => p.item.index)).toContain(5);
  });

  it('SHOULD 1: a shelf figure taking a KLINGSBO top a later figure needs costs no cabinet: two, as without that step', () => {
    const { items } = parse(STARVED);
    expect(pack(items, undefined, wallAt(25.4, 'K', 'D', 'R'), { deviate: false }).cabinets).toHaveLength(2);
    expect(pack(items, undefined, wallAt(25.4, 'K', 'D', 'R'), { deviate: true }).cabinets).toHaveLength(3);
    expect(pack(items, undefined, wallAt(25.4, 'K', 'D', 'R')).cabinets).toHaveLength(2);
  });

  it('SHOULD 2: the waiting figures never crowd out the rack-only figure a rack was opened for: ten cabinets at most (as on 363ba92), none empty (twelve, two empty, at 7b820fa)', () => {
    const { items, groups } = parse(CROWDED);
    const r = pack(items, groups, wallAt(50.8, 'K', 'D', 'R'));
    expect(r.violators).toEqual([]);
    expect(r.cabinets.length).toBeLessThanOrEqual(10);
    expect(emptyOf(r)).toBe(0);
  });

  it("NOTE 4: a waiting shelf figure takes the first place with room, the rack's top first: three cabinets (four with the top passed by)", () => {
    const { items, groups } = parse(RACK_TOP);
    const r = pack(items, groups, wallAt(50.8, 'K', 'D', 'R'));
    expect(r.cabinets).toHaveLength(3);
    expect(r.cabinets[2].surfaces[0].items.length).toBeGreaterThan(1);
  });

  it('SHOULD 1: each way is tried at every lean it would be alone: a Detolf and a KLINGSBO hold these 58 in six, as the step alone does (seven before this fix)', () => {
    const { items } = parse(LEAN_CUT);
    const wall = wallAt(25.4, 'D', 'K');
    expect(costOf(pack(items, undefined, wall, { deviate: true }))).toEqual([6, 0]);
    expect(costOf(pack(items, undefined, wall))).toEqual([6, 0]);
  });

  it('SHOULD 1: on any mixed wall, the packing is never worse (cabinets, then empty) than without the step, nor than with it alone', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ h: fc.integer({ min: 120, max: 720 }), w: fc.integer({ min: 50, max: 330 }), next: fc.boolean() }), { minLength: 1, maxLength: 45 }),
        fc.constantFrom(WALL, [D, K, R], [R, K], [K, D], [K, K, D]),
        fc.boolean(),
        (specs, pattern, grouped) => {
          let g = 0;
          const items = specs.map((s, i) => fig(i, s.h, s.w));
          const groups = grouped ? specs.map((s) => `g${(g += s.next ? 1 : 0)}`) : undefined;
          const r = pack(items, groups, pattern);
          for (const deviate of [false, true]) {
            const alt = pack(items, groups, pattern, { deviate });
            expect(noWorse(r, alt), `deviate ${deviate}: ${costOf(r)} against ${costOf(alt)}`).toBe(true);
          }
        },
      ),
      { numRuns: 300, seed: 1114 },
    );
  });

  it('SHOULD 2: every reachable K-D-R wall (6 orders x 5 clearances x 4 seeds, 622 figures) stands in no more cabinets, and no more empty, than on 363ba92', () => {
    const worse: string[] = [];
    let cabinets = 0;
    let empty = 0;
    for (const clear of [0, 12.7, 25.4, 38.1, 50.8]) {
      const wall = wallAt(clear, 'K', 'D', 'R');
      for (const arrangement of CASE_ARRANGEMENTS) {
        for (const seed of [1, 8, 9, 10]) {
          const { figures, items } = synthetic(622, seed);
          const { order, groups } = arrangeOrder(figures, arrangement);
          const r = packCabinets(order.map((i) => items[i]), wall, CEILING_MM, PACK_RULES, groups);
          const [baseCabs, baseEmpty] = BASE_363BA92[`${clear} ${arrangement} ${seed}`];
          if (r.cabinets.length > baseCabs || emptyOf(r) > baseEmpty) worse.push(`${clear} ${arrangement} ${seed}: ${costOf(r)} against ${baseCabs},${baseEmpty}`);
          cabinets += r.cabinets.length;
          empty += emptyOf(r);
        }
      }
    }
    expect(worse).toEqual([]);
    // all 120 walls: 12,824 cabinets, 2,460 empty on 363ba92; no more than PACK-KIND-1 round 1 stands them in (a figure only
    // a rack holds placed when one opens, not left for the wall's end: 9,720 and 536 without; those a cabinet alone holds
    // given its places first: 9,052 and 161 without)
    expect({ cabinets, empty }).toEqual({ cabinets: Math.min(cabinets, 9_049), empty: Math.min(empty, 160) });
  }, 60_000);
});

// cabinets and empty cabinets of each reachable wall packed by 363ba92 (before PACK-KIND-1), same synthetic walls
const BASE_363BA92: Record<string, readonly [number, number]> = {
  '0 series-scale-name 1': [96, 17],
  '0 series-scale-name 8': [103, 21],
  '0 series-scale-name 9': [97, 17],
  '0 series-scale-name 10': [117, 23],
  '0 scale-series-name 1': [87, 15],
  '0 scale-series-name 8': [72, 3],
  '0 scale-series-name 9': [81, 4],
  '0 scale-series-name 10': [111, 27],
  '0 series-name 1': [102, 25],
  '0 series-name 8': [108, 24],
  '0 series-name 9': [133, 54],
  '0 series-name 10': [114, 27],
  '0 scale-name 1': [87, 15],
  '0 scale-name 8': [69, 1],
  '0 scale-name 9': [87, 5],
  '0 scale-name 10': [111, 27],
  '0 name 1': [99, 14],
  '0 name 8': [82, 4],
  '0 name 9': [93, 6],
  '0 name 10': [138, 45],
  '0 date-added 1': [102, 15],
  '0 date-added 8': [81, 1],
  '0 date-added 9': [100, 10],
  '0 date-added 10': [129, 30],
  '12.7 series-scale-name 1': [96, 16],
  '12.7 series-scale-name 8': [108, 21],
  '12.7 series-scale-name 9': [94, 16],
  '12.7 series-scale-name 10': [123, 23],
  '12.7 scale-series-name 1': [90, 20],
  '12.7 scale-series-name 8': [72, 2],
  '12.7 scale-series-name 9': [84, 4],
  '12.7 scale-series-name 10': [117, 29],
  '12.7 series-name 1': [93, 10],
  '12.7 series-name 8': [96, 17],
  '12.7 series-name 9': [133, 45],
  '12.7 series-name 10': [120, 21],
  '12.7 scale-name 1': [93, 22],
  '12.7 scale-name 8': [75, 3],
  '12.7 scale-name 9': [88, 7],
  '12.7 scale-name 10': [117, 30],
  '12.7 name 1': [108, 22],
  '12.7 name 8': [87, 6],
  '12.7 name 9': [97, 5],
  '12.7 name 10': [123, 26],
  '12.7 date-added 1': [111, 20],
  '12.7 date-added 8': [90, 7],
  '12.7 date-added 9': [100, 9],
  '12.7 date-added 10': [141, 42],
  '25.4 series-scale-name 1': [95, 12],
  '25.4 series-scale-name 8': [112, 27],
  '25.4 series-scale-name 9': [112, 34],
  '25.4 series-scale-name 10': [117, 15],
  '25.4 scale-series-name 1': [99, 23],
  '25.4 scale-series-name 8': [87, 8],
  '25.4 scale-series-name 9': [90, 6],
  '25.4 scale-series-name 10': [129, 34],
  '25.4 series-name 1': [98, 13],
  '25.4 series-name 8': [102, 14],
  '25.4 series-name 9': [130, 44],
  '25.4 series-name 10': [111, 10],
  '25.4 scale-name 1': [99, 21],
  '25.4 scale-name 8': [84, 4],
  '25.4 scale-name 9': [96, 14],
  '25.4 scale-name 10': [129, 33],
  '25.4 name 1': [105, 13],
  '25.4 name 8': [93, 14],
  '25.4 name 9': [100, 2],
  '25.4 name 10': [105, 13],
  '25.4 date-added 1': [108, 22],
  '25.4 date-added 8': [96, 14],
  '25.4 date-added 9': [94, 4],
  '25.4 date-added 10': [123, 23],
  '38.1 series-scale-name 1': [104, 14],
  '38.1 series-scale-name 8': [103, 22],
  '38.1 series-scale-name 9': [109, 29],
  '38.1 series-scale-name 10': [159, 51],
  '38.1 scale-series-name 1': [99, 21],
  '38.1 scale-series-name 8': [93, 15],
  '38.1 scale-series-name 9': [97, 12],
  '38.1 scale-series-name 10': [135, 42],
  '38.1 series-name 1': [102, 16],
  '38.1 series-name 8': [102, 21],
  '38.1 series-name 9': [99, 18],
  '38.1 series-name 10': [174, 56],
  '38.1 scale-name 1': [102, 28],
  '38.1 scale-name 8': [90, 14],
  '38.1 scale-name 9': [100, 10],
  '38.1 scale-name 10': [132, 40],
  '38.1 name 1': [105, 12],
  '38.1 name 8': [93, 12],
  '38.1 name 9': [100, 3],
  '38.1 name 10': [153, 52],
  '38.1 date-added 1': [108, 16],
  '38.1 date-added 8': [93, 7],
  '38.1 date-added 9': [100, 7],
  '38.1 date-added 10': [159, 56],
  '50.8 series-scale-name 1': [111, 31],
  '50.8 series-scale-name 8': [104, 20],
  '50.8 series-scale-name 9': [96, 2],
  '50.8 series-scale-name 10': [162, 53],
  '50.8 scale-series-name 1': [108, 34],
  '50.8 scale-series-name 8': [93, 15],
  '50.8 scale-series-name 9': [97, 9],
  '50.8 scale-series-name 10': [135, 41],
  '50.8 series-name 1': [111, 25],
  '50.8 series-name 8': [108, 26],
  '50.8 series-name 9': [117, 30],
  '50.8 series-name 10': [174, 60],
  '50.8 scale-name 1': [108, 32],
  '50.8 scale-name 8': [93, 16],
  '50.8 scale-name 9': [85, 0],
  '50.8 scale-name 10': [135, 40],
  '50.8 name 1': [105, 14],
  '50.8 name 8': [93, 14],
  '50.8 name 9': [100, 8],
  '50.8 name 10': [156, 59],
  '50.8 date-added 1': [108, 15],
  '50.8 date-added 8': [99, 17],
  '50.8 date-added 9': [90, 0],
  '50.8 date-added 10': [156, 55],
};

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


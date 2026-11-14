import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createHash } from 'node:crypto';
import type { Figure } from '@figurecollecting/fc-shared';
import { IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../cabinetPresets';
import { CEILING_DEFAULT_MM, FIT_EPSILON_MM, withClearance, type CabinetProfile } from '../cabinetProfile';
import { arrangeOrder, CASE_ARRANGEMENTS, type CaseArrangement } from '../caseArrangement';
import { WALL_PATTERNS, wallPatternProfiles } from '../casePrefs';
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
    const [, i, h, w, d, g] = /^f(\d+):([\d.]+)x([\d.]+)x([\d.]+)(?:\/(.+))?$/.exec(tok)!;
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

  it('SHOULD 2: every reachable K-D-R wall (6 orders x 5 clearances x 4 seeds, 622 figures; sizes estimated, and labeled) stands in no more cabinets, and no more empty, than on 363ba92, no figure overhanging', () => {
    const worse: string[] = [];
    const unfaithful: string[] = [];
    const total = { estimated: [0, 0], labeled: [0, 0] };
    let skipped = 0;
    for (const labeled of [false, true]) {
      for (const clear of [0, 12.7, 25.4, 38.1, 50.8]) {
        const wall = wallAt(clear, 'K', 'D', 'R');
        for (const arrangement of CASE_ARRANGEMENTS) {
          for (const seed of [1, 8, 9, 10]) {
            const { figures, items } = synthetic(622, seed, labeled);
            const { order, groups } = arrangeOrder(figures, arrangement);
            const r = packCabinets(order.map((i) => items[i]), wall, CEILING_MM, PACK_RULES, groups);
            const key = `${clear} ${arrangement} ${seed}`;
            // every wall: no cabinet empty with shelves out, no figure overhanging its surface
            unfaithful.push(...emptyShelvesOut(r).map((x) => `${key}: ${x} empty, shelves out`), ...overhangs(r).map((x) => `${key}: ${x} overhangs`));
            const sum = total[labeled ? 'labeled' : 'estimated'];
            sum[0] += r.cabinets.length;
            sum[1] += emptyOf(r);
            // (a wall 363ba92 packed only by standing a figure over its surface's edge is no measure; with labeled depths it
            // overhangs on 117 of the 120, and none stands in more cabinets, nor more empty, here even so)
            if (!labeled && BASE_OVERHANGS.includes(key)) {
              skipped++;
              continue;
            }
            const [baseCabs, baseEmpty] = (labeled ? BASE_363BA92_LABELED : BASE_363BA92)[key];
            if (r.cabinets.length > baseCabs || emptyOf(r) > baseEmpty) worse.push(`${labeled ? 'labeled' : 'estimated'} ${key}: ${costOf(r)} against ${baseCabs},${baseEmpty}`);
          }
        }
      }
    }
    expect(unfaithful).toEqual([]);
    expect({ worse, skipped }).toEqual({ worse: [], skipped: BASE_OVERHANGS.length });
    // all 120 walls each way, on 363ba92: 12,824 cabinets, 2,460 empty (estimated); 13,218 and 2,571 (labeled). No more
    // than PACK-KIND-1 stands them in (round 3: 9,049 and 30; 9,167 and 6)
    const [ec, ee] = total.estimated;
    const [lc, le] = total.labeled;
    expect(total).toEqual({ estimated: [Math.min(ec, 9_049), Math.min(ee, 30)], labeled: [Math.min(lc, 9_167), Math.min(le, 6)] });
  }, 120_000);
});

// the reachable walls 363ba92 packed with a figure overhanging its surface (none of the 360, seeds 1-12: the comparison skips 0)
const BASE_OVERHANGS: readonly string[] = [];

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

// the same walls with labeled depths (estimates off), packed by 363ba92: cabinets, empty cabinets (most with a figure overhanging)
const BASE_363BA92_LABELED: Record<string, readonly [number, number]> = {
  '0 series-scale-name 1': [99, 14],
  '0 series-scale-name 8': [111, 27],
  '0 series-scale-name 9': [111, 15],
  '0 series-scale-name 10': [102, 16],
  '0 scale-series-name 1': [93, 24],
  '0 scale-series-name 8': [75, 6],
  '0 scale-series-name 9': [114, 34],
  '0 scale-series-name 10': [96, 16],
  '0 series-name 1': [96, 15],
  '0 series-name 8': [102, 24],
  '0 series-name 9': [138, 46],
  '0 series-name 10': [117, 31],
  '0 scale-name 1': [93, 20],
  '0 scale-name 8': [72, 3],
  '0 scale-name 9': [120, 27],
  '0 scale-name 10': [99, 16],
  '0 name 1': [108, 17],
  '0 name 8': [90, 6],
  '0 name 9': [106, 16],
  '0 name 10': [123, 25],
  '0 date-added 1': [96, 11],
  '0 date-added 8': [84, 3],
  '0 date-added 9': [120, 16],
  '0 date-added 10': [126, 30],
  '12.7 series-scale-name 1': [99, 20],
  '12.7 series-scale-name 8': [111, 20],
  '12.7 series-scale-name 9': [117, 19],
  '12.7 series-scale-name 10': [114, 22],
  '12.7 scale-series-name 1': [93, 22],
  '12.7 scale-series-name 8': [75, 5],
  '12.7 scale-series-name 9': [117, 31],
  '12.7 scale-series-name 10': [105, 19],
  '12.7 series-name 1': [111, 29],
  '12.7 series-name 8': [102, 17],
  '12.7 series-name 9': [132, 34],
  '12.7 series-name 10': [117, 23],
  '12.7 scale-name 1': [96, 24],
  '12.7 scale-name 8': [75, 5],
  '12.7 scale-name 9': [126, 33],
  '12.7 scale-name 10': [105, 19],
  '12.7 name 1': [108, 17],
  '12.7 name 8': [96, 9],
  '12.7 name 9': [117, 22],
  '12.7 name 10': [123, 24],
  '12.7 date-added 1': [111, 23],
  '12.7 date-added 8': [87, 7],
  '12.7 date-added 9': [126, 17],
  '12.7 date-added 10': [129, 31],
  '25.4 series-scale-name 1': [99, 17],
  '25.4 series-scale-name 8': [111, 21],
  '25.4 series-scale-name 9': [126, 28],
  '25.4 series-scale-name 10': [117, 18],
  '25.4 scale-series-name 1': [105, 27],
  '25.4 scale-series-name 8': [87, 8],
  '25.4 scale-series-name 9': [132, 34],
  '25.4 scale-series-name 10': [117, 25],
  '25.4 series-name 1': [108, 22],
  '25.4 series-name 8': [102, 14],
  '25.4 series-name 9': [135, 32],
  '25.4 series-name 10': [114, 21],
  '25.4 scale-name 1': [102, 23],
  '25.4 scale-name 8': [87, 7],
  '25.4 scale-name 9': [126, 28],
  '25.4 scale-name 10': [96, 10],
  '25.4 name 1': [102, 13],
  '25.4 name 8': [93, 3],
  '25.4 name 9': [111, 13],
  '25.4 name 10': [129, 32],
  '25.4 date-added 1': [93, 6],
  '25.4 date-added 8': [87, 8],
  '25.4 date-added 9': [126, 18],
  '25.4 date-added 10': [138, 38],
  '38.1 series-scale-name 1': [98, 16],
  '38.1 series-scale-name 8': [103, 21],
  '38.1 series-scale-name 9': [126, 37],
  '38.1 series-scale-name 10': [144, 39],
  '38.1 scale-series-name 1': [108, 33],
  '38.1 scale-series-name 8': [93, 15],
  '38.1 scale-series-name 9': [126, 35],
  '38.1 scale-series-name 10': [123, 34],
  '38.1 series-name 1': [102, 14],
  '38.1 series-name 8': [105, 25],
  '38.1 series-name 9': [135, 35],
  '38.1 series-name 10': [141, 35],
  '38.1 scale-name 1': [108, 33],
  '38.1 scale-name 8': [93, 16],
  '38.1 scale-name 9': [132, 36],
  '38.1 scale-name 10': [123, 34],
  '38.1 name 1': [105, 18],
  '38.1 name 8': [99, 11],
  '38.1 name 9': [120, 18],
  '38.1 name 10': [132, 38],
  '38.1 date-added 1': [87, 0],
  '38.1 date-added 8': [90, 6],
  '38.1 date-added 9': [129, 22],
  '38.1 date-added 10': [138, 39],
  '50.8 series-scale-name 1': [112, 25],
  '50.8 series-scale-name 8': [105, 22],
  '50.8 series-scale-name 9': [144, 47],
  '50.8 series-scale-name 10': [119, 19],
  '50.8 scale-series-name 1': [111, 34],
  '50.8 scale-series-name 8': [93, 15],
  '50.8 scale-series-name 9': [120, 25],
  '50.8 scale-series-name 10': [123, 34],
  '50.8 series-name 1': [105, 21],
  '50.8 series-name 8': [101, 14],
  '50.8 series-name 9': [141, 26],
  '50.8 series-name 10': [120, 20],
  '50.8 scale-name 1': [108, 30],
  '50.8 scale-name 8': [93, 17],
  '50.8 scale-name 9': [114, 14],
  '50.8 scale-name 10': [123, 32],
  '50.8 name 1': [99, 9],
  '50.8 name 8': [102, 12],
  '50.8 name 9': [111, 17],
  '50.8 name 10': [114, 18],
  '50.8 date-added 1': [114, 21],
  '50.8 date-added 8': [87, 6],
  '50.8 date-added 9': [135, 27],
  '50.8 date-added 10': [138, 40],
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

/** The cabinets standing empty with shelves taken out (an empty cabinet stands as it was bought). */
const emptyShelvesOut = (r: PackResult) =>
  r.cabinets.filter((c) => c.surfaces.every((s) => s.items.length === 0) && (c.profile.layout?.removed.length ?? 0) > 0).map((c) => `${c.profile.id} ${c.index}`);
/** The figures standing deeper than their surface (overhanging it). */
const overhangs = (r: PackResult) => r.cabinets.flatMap((c) => c.surfaces.flatMap((s) => s.items.filter((p) => p.tooDeep).map((p) => `f${p.item.index} on ${c.profile.id} ${c.index}`)));

// round 2 (the challenger's walls): K-D-R by series, 1 in of clearance: five 800-1,000 mm statues only a KLINGSBO's tier
// takes (thirteen cabinets whatever stands between them), and figures tall for a KLINGSBO, a shelf figure in a Detolf or rack
const STATUES = 'f0:892.9950493387878x299.4643338024616x334.91765120159835/g0 f1:849.753696937114x251.84354004450142x333.0462355534546/g0 f2:300x160x104/g1 f3:300x160x104/g2 f4:300x160x104/g3 f5:300x160x104/g4 f6:180x92.26647728122771x59.97321023279801/g4 f7:880.4614904336631x273.18993965163827x334.29076175182126/g4 f8:245x172.6198336109519x112.20289184711874/g5 f9:180x123.79674034193158x80.46788122225553/g6 f10:245x127.38845311105251x82.80249452218413/g7 f11:245x130.8069495111704x85.02451718226075/g7 f12:300x160x104/g7 f13:300x160x104/g7 f14:838.5078973602504x263.01924029830843x333.0043096607551/g8 f15:180x127.89445543661714x83.13139603380114/g8 f16:816.6208393871784x260.1348247611895x333.7965496981051/g8 f17:531.9895398453809x269.971371057909x175.48139118764084/g9';
// K-D-R by series, 1 in: a KLINGSBO opened for a 664 mm figure that a rack's tier takes instead
const GLASS_OUT = 'f47:471x464x301/series-15 f50:223x80x52/series-15 f59:664x478x311/series-16 f58:232x217x141/series-16 f57:233x172x112/series-16 f56:109x87x56/series-16 f60:523x330x214/series-17 f65:556x497x323/series-18 f100:314x265x172/series-33';
// D-K-R by series, 1 in: a KLINGSBO opened with a tier for the 1,200 mm figure a Detolf's tier takes
const SHELVES_OUT = 'f2:87x457x393/g1 f3:361x267x281/g1 f6:152x180x481/g1 f17:1200x238x190/g3';
// K-D-R by series, 1 in: series g5 starts on a KLINGSBO shelf of its own, below g1's; its 605 mm figure in that KLINGSBO's
// tier could fill an empty Detolf, but the KLINGSBO standing again with its shelves would run g5 onto g1's shelf
const OWN_SHELF = 'f0:180x109.9579896312207x71.47269326029345/g1 f1:180x106.96002161130309x69.52401404734701/g1 f2:604.6812810702249x280.31111885793507x182.2022272576578/g2 f3:845.2740258071572x298.6810020636767x333.8411399219185/g3 f4:300x160x104/g4 f5:300x160x104/g4 f6:953.7538511212915x281.95249253185466x334.59733526804484/g5 f7:875.7554921787232x284.9577867425978x334.78274276363663/g5 f8:180x92.13572996668518x59.888224478345364/g5 f9:180x127.70476944744587x83.00810014083982/g5 f10:300x160x104/g5';
// K-D-R, 1 in: a 939 mm statue only a KLINGSBO's tier takes; the Detolf's only figure steps on to the rack, the KLINGSBO's
// last shelf figure to the Detolf (363ba92: two cabinets empty; one without the step)
const CHAIN = 'f4:198x133x86.45 f5:171x102x66.3 f6:254x125x81.25 f7:939x251x334';
// K-D-R by series, 2 in: the rack's only figure (f6) could step on to the empty rack after it, but series g4's f5 may not
// follow it past g5, so neither moves
const NO_STEP = 'f5:199x98x86/g4 f6:193x104x122/g5 f7:903x257x321/g5 f8:266x156x42/g5 f9:520x241x251/g5 f10:798x270x69/g5 f11:829x269x332/g5 f21:907x250x316/g8';
// 52 figures of a K-D-R app wall (series, scale, name; seed 7; no clearance): a KLINGSBO opened with tiers whose only figure
// steps on takes a figure from before it on its top, standing with its stock shelves
const RESTOCKED = 'f0:319x251x163/series-1 f1:91x91x59/series-1 f7:418x228x148/series-2 f9:278x249x162/series-2 f4:257x101x66/series-2 f5:251x209x136/series-2 f12:182x78x51/series-3 f17:256x204x133/series-4 f14:236x177x115/series-4 f16:239x214x139/series-4 f13:244x148x96/series-4 f20:247x182x118/series-4 f38:245x95x62/series-10 f39:236x132x86/series-10 f45:605x483x314/series-11 f82:250x233x152/series-20 f84:253x237x154/series-21 f89:679x562x365/series-23 f91:238x230x149/series-24 f97:238x213x138/series-25 f103:253x179x117/series-27 f105:280x266x173/series-28 f109:380x320x208/series-29 f115:233x152x99/series-31 f114:208x182x118/series-31 f118:432x221x143/series-32 f117:235x197x128/series-32 f126:243x217x141/series-36 f138:388x240x156/series-37 f143:257x173x112/series-40 f145:212x85x55/series-41 f146:254x126x82/series-42 f147:309x224x146/series-43 f148:223x90x59/series-43 f155:403x378x246/series-44 f156:288x236x154/series-44 f153:320x301x195/series-44 f157:451x408x265/series-45 f167:251x192x125/series-46 f161:239x218x141/series-46 f162:245x209x136/series-46 f178:439x342x222/series-49 f172:244x198x129/series-49 f176:246x241x156/series-49 f174:194x184x120/series-49 f179:298x213x138/series-50 f183:252x240x156/series-51 f185:472x455x296/series-52 f184:244x174x113/series-52 f312:531x374x243/series-81 f330:425x411x267/series-85 f349:471x281x182/series-92';
// K-R by series, 1 in: a KLINGSBO opened with a tier for the 1,060 mm figure the next KLINGSBO's tier takes
const FIRST_EMPTY = 'f4:465x611x187/g2 f12:1060x89x306/g3';
// D-K-R by series, 1 in: the 383 mm figure in the Detolf's tier, tall for a Detolf, may not leave the Detolf's top empty for
// the KLINGSBO's top
const OWN_TOP = 'f0:759x88x250/g1 f7:383x16x114/g2 f13:317x213x451/g3';
// D-R-K by series, 1 in: standing a KLINGSBO otherwise with as many shelves out is no fewer out (one empty cabinet, not two)
const SAME_OUT = 'f1:1489x377x290/g1 f3:497x578x430/g1 f4:491x741x412/g2 f7:563x285x394/g3 f10:349x769x348/g3 f11:405x400x84/g3 f12:618x651x334/g3 f16:321x227x446/g6 f18:674x453x22/g8 f19:145x163x455/g9 f20:363x572x264/g9 f21:1144x122x325/g9 f24:555x203x309/g10 f31:355x218x87/g12';
// 55 figures of a K-D-R app wall (series, scale, name; seed 6; 1 in): the figures the fill could move would each leave a
// top or tier behind them empty that they are tall for
const NO_STRAND = 'f101:315x205x133/series-33 f100:314x265x172/series-33 f288:195x89x58/series-93 f292:172x165x107/series-94 f295:271x174x113/series-96 f294:315x162x105/series-96 f298:212x184x119/series-97 f299:245x154x100/series-98 f300:251x230x150/series-98 f305:251x146x95/series-100 f307:252x147x95/series-101 f309:188x121x79/series-101 f315:466x323x210/series-103 f312:316x211x137/series-103 f313:244x162x105/series-103 f316:303x134x87/series-104 f317:268x189x123/series-105 f318:257x190x123/series-106 f319:232x214x139/series-106 f321:194x144x94/series-106 f324:237x225x147/series-107 f323:109x89x58/series-107 f327:218x115x75/series-107 f325:188x85x55/series-107 f330:629x517x336/series-108 f331:457x450x293/series-108 f329:460x186x121/series-108 f339:405x254x165/series-108 f336:256x91x59/series-108 f338:258x111x72/series-108 f332:255x252x164/series-108 f337:110x76x49/series-108 f333:203x111x72/series-108 f334:188x89x58/series-108 f335:210x86x56/series-108 f341:298x130x84/series-109 f340:314x189x123/series-109 f342:239x152x99/series-109 f343:251x199x129/series-109 f347:232x204x133/series-112 f354:208x117x76/series-113 f348:222x148x96/series-113 f352:214x188x122/series-113 f349:227x201x131/series-113 f353:211x140x91/series-113 f356:405x242x157/series-114 f357:238x217x141/series-114 f355:237x132x86/series-114 f358:520x456x296/series-115 f360:243x192x125/series-115 f362:240x141x92/series-115 f574:464x286x186/series-184 f572:414x252x164/series-184 f573:443x186x121/series-184 f613:450x322x210/series-190';
// K-D-R, 1 in: a 406 mm deep figure only the rack's top is deep enough for (363ba92 stood it on a KLINGSBO's 400 mm deep top)
const DEEP = 'f5:433x397x406 f7:387x289x363';
// round 3 (the challenger's walls), labeled depths. The app's K-D-R wall at 1 in, by scale: a 310 mm deep figure a Detolf
// holds only on its 330 mm deep bottom shelf (or its 370 mm top), never on a 290 mm shelf
const OVERHANG = 'f25:442x248x227/scale:4 f176:401x320x255/scale:4 f45:477x311x177/scale:4 f141:445x302x328/scale:4 f165:299x298x310/scale:6';
const OVERHANG_EXACT =
  'f25:441.8124008178711x248.173382562607x226.92585794403396/scale:4 f176:401.2135672569275x319.98539359021794x254.78289526610246/scale:4 f45:477.19483852386475x310.93586343209637x176.61789396988308/scale:4 f141:444.94436264038086x301.694734368858x327.6704795339632/scale:4 f165:298.53363037109375x297.55467616269016x309.86024652757226/scale:6';
// K-D-R by series, 1 in (case 786 of the 2,400): a 436 mm deep figure only a rack's 457 mm top holds, never a KLINGSBO's 400 mm one
const DEEP_TOP = 'f0:712x578x48/g1 f8:760x642x293/g2 f22:51x688x11/g5 f24:78x606x55/g5 f25:427x518x363/g5 f26:135x660x394/g5 f29:361x348x415/g6 f32:379x593x357/g6 f34:268x576x60/g6 f35:393x522x122/g7 f37:465x408x436/g7';

describe('PACK-KIND-1 round 2: no cabinet stands empty where 363ba92 filled it', () => {
  it("the app's K-D-R wall, 2 in of clearance: 24 figures of a 622-figure collection stand in 12 cabinets, none empty, as on 363ba92 (12, 2 to 4 empty at e02fdc9)", () => {
    const ids = [333, 373, 413, 453, 493, 533, 573, 613, 516, 556, 29, 83, 123, 163, 203, 243, 283, 323, 363, 403, 443, 483, 523, 563];
    const { figures, items } = synthetic(622, 9);
    const sub = ids.map((i) => figures[i]);
    const subItems = ids.map((i, j) => ({ ...items[i], index: j }));
    const id = WALL_PATTERNS.find((p) => p.profiles.length > 1)!.id;
    const wall = wallPatternProfiles(id).map((p) => withClearance(p, 50.8));
    for (const arrangement of ['scale-name', 'name', 'date-added'] as CaseArrangement[]) {
      const { order, groups } = arrangeOrder(sub, arrangement);
      const r = packCabinets(order.map((i) => subItems[i]), wall, CEILING_DEFAULT_MM, PACK_RULES, groups);
      expect(r.violators, arrangement).toEqual([]);
      expect(r.cabinets.length, arrangement).toBeLessThanOrEqual(12);
      expect(emptyOf(r), arrangement).toBe(0);
    }
  });

  it('five statues force thirteen cabinets: no more stand empty than on 363ba92 (6; 7 at e02fdc9)', () => {
    const { items, groups } = parse(STATUES);
    const r = pack(items, groups, wallAt(25.4, 'K', 'D', 'R'));
    expect(r.cabinets).toHaveLength(13);
    expect(emptyOf(r)).toBeLessThanOrEqual(6);
  });

  it('a cabinet left empty stands with its stock shelves (a KLINGSBO opened for a figure the rack took; a KLINGSBO opened for the Detolf’s)', () => {
    for (const [spec, wall] of [
      [GLASS_OUT, wallAt(25.4, 'K', 'D', 'R')],
      [SHELVES_OUT, wallAt(25.4, 'D', 'K', 'R')],
    ] as const) {
      const { items, groups } = parse(spec);
      for (const deviate of [undefined, true, false]) {
        const r = pack(items, groups, [...wall], { deviate });
        expect(emptyShelvesOut(r), `${spec.slice(0, 12)} deviate ${deviate}`).toEqual([]);
      }
    }
  });

  it('PACK1: filling an empty cabinet never runs a series onto the shelf of the one before (g1 and g5 keep a shelf each)', () => {
    const { items, groups } = parse(OWN_SHELF);
    const r = pack(items, groups, wallAt(25.4, 'K', 'D', 'R'));
    // the first KLINGSBO's rows below its top, in reading order: its tier (f2), g1's shelf, g5's shelf
    expect(r.cabinets[0].surfaces.flatMap((s) => (s.slot.isTop || s.items.length === 0 ? [] : [s.items.map((p) => p.item.index)]))).toEqual([[2], [0, 1], [8, 9]]);
    // (no more empty than on 363ba92: 5)
    expect(emptyOf(r)).toBeLessThanOrEqual(5);
  });

  it('PACK1: filling an empty cabinet never moves a shelf figure past a figure of a later series (packGroups counterexample)', () => {
    // series a's 20 mm cube on a KLINGSBO shelf; series c's figure just over the KLINGSBO's 335 mm on its deeper top; one 430 mm wide
    const items = [{ ...fig(0, 40, 20), depthMm: 20 }, { ...fig(1, 40, 20), depthMm: 335.00000100000005 }, { ...fig(2, 40, 430.00000100000005), depthMm: 20 }];
    const groups = ['a', 'c', null];
    const r = packCabinets(items, [IKEA_KLINGSBO, IKEA_DETOLF, OPEN_STEEL_RACK], CEILING_DEFAULT_MM, PACK_RULES, groups);
    const cabOf = (i: number) => r.cabinets.findIndex((c) => c.surfaces.some((s) => s.items.some((p) => p.item.index === i)));
    expect(cabOf(1)).toBeGreaterThanOrEqual(cabOf(0));
  });

  it('a cabinet whose only figure fills the one after it is filled in turn from before it, in order: four cabinets, none empty', () => {
    const { items } = parse(CHAIN);
    const r = pack(items, undefined, wallAt(25.4, 'K', 'D', 'R'));
    expect(costOf(r)).toEqual([4, 0]);
    expect(r.cabinets.map((c) => c.surfaces.flatMap((s) => s.items.map((p) => p.item.index)))).toEqual([[6], [4], [5], [7]]);
  });

  it('a step that cannot be filled in turn moves nothing: the rack’s only figure keeps its place', () => {
    const { items, groups } = parse(NO_STEP);
    const r = pack(items, groups, wallAt(50.8, 'K', 'D', 'R'));
    expect(costOf(r)).toEqual([7, 1]);
    const cabOf = (i: number) => r.cabinets.findIndex((c) => c.surfaces.some((s) => s.items.some((p) => p.item.index === i)));
    expect(cabOf(6)).toBe(2);
  });

  it('a cabinet its only figure steps out of stands with its stock shelves for the figure that fills it in turn', () => {
    const { items, groups } = parse(RESTOCKED);
    const wall = wallPatternProfiles(WALL_PATTERNS.find((p) => p.profiles.length > 1)!.id).map((p) => withClearance(p, 0));
    const r = pack(items, groups, wall);
    const k = r.cabinets.find((c) => c.surfaces.some((s) => s.items.some((p) => p.item.index === 183)))!;
    expect(k.profile.layout?.removed ?? []).toEqual([]);
    expect(costOf(r)).toEqual([12, 0]);
  });

  it('the first cabinet too stands with its stock shelves when it is left empty', () => {
    const { items, groups } = parse(FIRST_EMPTY);
    const r = pack(items, groups, wallAt(25.4, 'K', 'R'));
    expect(emptyShelvesOut(r)).toEqual([]);
  });

  it('filling an empty cabinet strands no figure: none leaves a top or tier it is tall for, and fits, empty behind it', () => {
    const own = parse(OWN_TOP);
    expect(strandedHeld(pack(own.items, own.groups, wallAt(25.4, 'D', 'K', 'R')), true)).toEqual([]);
    // (by series, a place a later series' start passes stays empty until PACK-GAP: the count before the fill, not none)
    const app = parse(NO_STRAND);
    const wall = wallPatternProfiles(WALL_PATTERNS.find((p) => p.profiles.length > 1)!.id).map((p) => withClearance(p, 25.4));
    expect(strandedHeld(pack(app.items, app.groups, wall), true).length).toBeLessThanOrEqual(50);
  });

  it('a cabinet a figure leaves stands with fewer shelves out, never as many otherwise: one cabinet empty, not two', () => {
    const { items, groups } = parse(SAME_OUT);
    expect(emptyOf(pack(items, groups, wallAt(25.4, 'D', 'R', 'K')))).toBe(1);
  });

  it('CASE-FAITH: no figure overhangs its surface: the 406 mm deep figure stands on the rack, three cabinets (363ba92: two, overhanging)', () => {
    const { items } = parse(DEEP);
    const r = pack(items, undefined, wallAt(25.4, 'K', 'D', 'R'));
    expect(overhangs(r)).toEqual([]);
    expect(r.cabinets.map((c) => c.profile.id)).toEqual([K.id, D.id, R.id]);
    expect(r.cabinets[2].surfaces.flatMap((s) => s.items.map((p) => p.item.index))).toContain(5);
  });
});

describe('PACK-KIND-1 round 3: every place a figure takes is as deep as the figure', () => {
  it('a 310 mm deep figure stands on no 290 mm Detolf shelf: two cabinets, none overhanging (as on 363ba92), integer and exact sizes', () => {
    const wall = wallPatternProfiles(WALL_PATTERNS.find((p) => p.profiles.length > 1)!.id).map((p) => withClearance(p, 25.4));
    for (const spec of [OVERHANG, OVERHANG_EXACT]) {
      const { items, groups } = parse(spec);
      const r = pack(items, groups, wall);
      expect(overhangs(r), spec.slice(0, 30)).toEqual([]);
      expect(costOf(r)).toEqual([2, 0]);
    }
  });

  it('a 436 mm deep figure no KLINGSBO top holds stands on a rack top, not a KLINGSBO’s (case 786)', () => {
    const { items, groups } = parse(DEEP_TOP);
    const r = pack(items, groups, wallAt(25.4, 'K', 'D', 'R'));
    expect(overhangs(r)).toEqual([]);
    const at = r.cabinets.find((c) => c.surfaces.some((s) => s.items.some((p) => p.item.index === 37)))!;
    expect(at.profile.id).toBe(R.id);
    // (no more cabinets, nor empty, than 363ba92's fifteen and ten)
    expect(r.cabinets.length).toBeLessThanOrEqual(15);
    expect(emptyOf(r)).toBeLessThanOrEqual(10);
  });
});

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


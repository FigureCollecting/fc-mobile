import { describe, it, expect } from 'vitest';
import {
  CABINET_PRESETS,
  DEFAULT_CABINET_PROFILE,
  DEFAULT_CABINET_PROFILE_ID,
  IKEA_DETOLF,
  OPEN_STEEL_RACK,
  UNIT_A,
  getCabinetPreset,
} from '../cabinetPresets';
import {
  checkCabinetProfile,
  checkCabinetRegistry,
  clearHeightsMm,
  fitsOnTop,
  fixedModeCompartmentMm,
  framingHeadroomMm,
  stackSumMm,
  topClearanceMm,
  topClearanceRawMm,
  unverifiedFields,
} from '../cabinetProfile';

const GOLDEN_EPS = 1e-6;
const IN = 25.4;

function placeholderSurfaces(id: string): string[] {
  const profile = getCabinetPreset(id)!;
  return profile.surfaces.filter((s) => s.provenance.kind === 'placeholder').map((s) => s.name);
}

/** case-cabinet-design-v3 order_v3, ranks 1-7; Ross's further presets come after the rack (rank 8 on). */
const V3_ORDER = [
  'ikea-detolf',
  'open-bookcase',
  'glass-cabinet-legs',
  'unit-a',
  'wide-custom',
  'short-pitch',
  'open-steel-rack',
];

describe('preset registry (case-cabinet-design-v3 preset_library)', () => {
  it('lists the presets most preferred first: ranks strictly ascending, the Detolf first', () => {
    const ranks = CABINET_PRESETS.map((p) => p.preferenceRank);
    ranks.slice(1).forEach((rank, i) => expect(rank).toBeGreaterThan(ranks[i]));
    expect(CABINET_PRESETS[0]).toBe(IKEA_DETOLF);
  });

  it('ranks the v3 presets 1-7 in v3 order, so further presets can follow the rack as data only', () => {
    expect(V3_ORDER.map((id) => getCabinetPreset(id)?.preferenceRank)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(CABINET_PRESETS.slice(0, V3_ORDER.length).map((p) => p.id)).toEqual(V3_ORDER);
  });

  it('defaults to the IKEA Detolf (Ross CC3), the most preferred preset', () => {
    expect(DEFAULT_CABINET_PROFILE_ID).toBe('ikea-detolf');
    expect(DEFAULT_CABINET_PROFILE).toBe(IKEA_DETOLF);
    expect(getCabinetPreset(DEFAULT_CABINET_PROFILE_ID)).toBe(IKEA_DETOLF);
    expect(Math.min(...CABINET_PRESETS.map((p) => p.preferenceRank))).toBe(IKEA_DETOLF.preferenceRank);
  });

  it("keeps the open steel rack at LOW preference (Ross CC3: Ross's own rack stays a preset)", () => {
    const otherV3Ranks = V3_ORDER.filter((id) => id !== OPEN_STEEL_RACK.id).map((id) => getCabinetPreset(id)!.preferenceRank);
    expect(OPEN_STEEL_RACK.preferenceRank).toBeGreaterThan(Math.max(...otherV3Ranks));
  });

  it('looks presets up by id', () => {
    expect(getCabinetPreset('unit-a')).toBe(UNIT_A);
    expect(getCabinetPreset('no-such-cabinet')).toBeUndefined();
  });

  it('has unique ids and ranks and contains the default', () => {
    expect(checkCabinetRegistry(CABINET_PRESETS, DEFAULT_CABINET_PROFILE_ID)).toEqual([]);
  });

  // G19: a preset added as data only is covered here without a new test.
  it.each(CABINET_PRESETS.map((p) => [p.id, p] as const))('%s passes every invariant check', (_id, profile) => {
    expect(checkCabinetProfile(profile)).toEqual([]);
  });

  it('marks every preset value that is not measured or cited (sources are never empty)', () => {
    for (const profile of CABINET_PRESETS) {
      for (const flag of unverifiedFields(profile)) {
        expect(flag.source.length).toBeGreaterThan(0);
      }
    }
  });

  it("CC5: only adjustable profiles offer 'fit shelves to figures'; the Detolf and Unit-A are fixed", () => {
    const adjustable = CABINET_PRESETS.filter((p) => p.shelves.mode === 'adjustable').map((p) => p.id);
    expect(adjustable).toEqual(['open-bookcase', 'glass-cabinet-legs', 'wide-custom', 'short-pitch', 'open-steel-rack']);
  });

  it('gives a glass thickness exactly to the presets with glass walls or doors', () => {
    for (const profile of CABINET_PRESETS) {
      const { sides, back, front } = profile.materials;
      const hasGlassPanes = sides === 'glass' || back === 'glass' || front === 'glassDoor';
      expect(profile.glassMm !== null).toBe(hasGlassPanes);
    }
  });
});

describe('G18 IKEA Detolf (detolf-facts.json, DETOLF-VERIFY 2026-09-30)', () => {
  it('keeps the IKEA outer size 430 x 370 x 1630 mm', () => {
    expect(IKEA_DETOLF.outer).toEqual({ widthMm: 430, depthMm: 370, heightMm: 1630 });
    expect(IKEA_DETOLF.provenance.outer.kind).toBe('cited');
  });

  it('stacks 35 + 396 + 4 + 387 + 4 + 387 + 4 + 378 + 35 = 1630', () => {
    expect(IKEA_DETOLF.surfaces.map((s) => s.topMm)).toEqual([35, 435, 826, 1217, 1630]);
    expect(IKEA_DETOLF.surfaces.map((s) => s.thicknessMm)).toEqual([35, 4, 4, 4, 35]);
    expect(clearHeightsMm(IKEA_DETOLF)).toEqual([396, 387, 387, 378]);
    expect(stackSumMm(IKEA_DETOLF)).toBe(1630);
    expect(IKEA_DETOLF.base).toEqual({ style: 'none', heightMm: 0 });
  });

  it('has 3 fixed glass shelves on the base floor, a 389 x 330 interior and a 383 x 290 plate', () => {
    expect(IKEA_DETOLF.surfaces.map((s) => s.material)).toEqual(['wood', 'glass', 'glass', 'glass', 'wood']);
    expect(IKEA_DETOLF.shelves).toEqual({ mode: 'fixed' });
    expect(IKEA_DETOLF.interior).toEqual({ widthMm: 389, depthMm: 330 });
    expect(IKEA_DETOLF.plate).toEqual({ widthMm: 383, depthMm: 290, frontInsetMm: 20 });
    expect(IKEA_DETOLF.materials).toEqual({ sides: 'glass', back: 'glass', front: 'glassDoor' });
  });

  it("uses 4 mm glass (glass shops), not v3's 5 mm", () => {
    expect(IKEA_DETOLF.glassMm).toBe(4);
  });

  it('carries the IKEA 3.5 kg per glass shelf; base floor and top loads are not published', () => {
    expect(IKEA_DETOLF.surfaces.map((s) => s.maxLoadKg)).toEqual([null, 3.5, 3.5, 3.5, null]);
    expect(IKEA_DETOLF.provenance.loads?.kind).toBe('cited');
  });

  it('flags the derived interior layout on screen (verify), not the IKEA or tape values', () => {
    const fields = unverifiedFields(IKEA_DETOLF).map((f) => `${f.field}=${f.kind}`);
    expect(fields).toEqual([
      'panels=placeholder',
      'boards=derived',
      'base=derived',
      'glass=placeholder',
      'plate=derived',
      'surface:base floor=derived',
      'surface:glass shelf 2=derived',
      'surface:glass shelf 3=derived',
      'surface:glass shelf 4=derived',
    ]);
  });

  it('G17 on the preset: clearance 609.6 mm (the cap binds; the room allows 808.4)', () => {
    expect(Math.abs(topClearanceMm(IKEA_DETOLF) - 609.6)).toBeLessThanOrEqual(GOLDEN_EPS);
    expect(Math.abs(topClearanceRawMm(IKEA_DETOLF, Number.MAX_VALUE) - 609.6)).toBeLessThanOrEqual(GOLDEN_EPS);
    expect(Math.abs(2438.4 - IKEA_DETOLF.outer.heightMm - 808.4)).toBeLessThanOrEqual(GOLDEN_EPS);
    expect(fitsOnTop(IKEA_DETOLF, 609.6)).toBe(true);
    expect(fitsOnTop(IKEA_DETOLF, 610.6)).toBe(false);
    // a user ceiling of 1800 mm leaves 170 mm on top (CC9: the ceiling becomes a user setting)
    expect(fitsOnTop(IKEA_DETOLF, 170, 1800)).toBe(true);
    expect(fitsOnTop(IKEA_DETOLF, 300, 1800)).toBe(false);
    expect(framingHeadroomMm(IKEA_DETOLF, null)).toBe(300);
    expect(Math.abs(framingHeadroomMm(IKEA_DETOLF, 600) - 609.6)).toBeLessThanOrEqual(GOLDEN_EPS);
  });

  it('feeds the fixed-mode adapter its smallest compartment, 378 mm', () => {
    expect(fixedModeCompartmentMm(IKEA_DETOLF)).toBe(378);
  });
});

describe("v2 golden: Ross's open steel rack (36 x 18 x 72 in, inch-native, never rounded)", () => {
  it('stores exact mm: 914.4 x 457.2 x 1828.8, not 914 x 457 x 1829', () => {
    expect(OPEN_STEEL_RACK.outer).toEqual({ widthMm: 914.4, depthMm: 457.2, heightMm: 1828.8 });
    expect(OPEN_STEEL_RACK.frame).toBe('open-rack');
    expect(OPEN_STEEL_RACK.materials).toEqual({ sides: 'open', back: 'open', front: 'open' });
  });

  it('has surfaces 6.5 / 12 / 24 / 47 / 72 in = 165.1 / 304.8 / 609.6 / 1193.8 / 1828.8 mm', () => {
    const tops = OPEN_STEEL_RACK.surfaces.map((s) => s.topMm);
    expect(tops).toEqual([165.1, 304.8, 609.6, 1193.8, 1828.8]);
    expect(tops.map(Math.round)).toEqual([165, 305, 610, 1194, 1829]);
    [6.5, 12, 24, 47, 72].forEach((inches, i) => {
      expect(Math.abs(tops[i] - inches * IN)).toBeLessThanOrEqual(GOLDEN_EPS);
    });
  });

  it('keeps shelves 1, 2 and 4 marked as placeholders; shelf 3 and the top are Ross-measured', () => {
    expect(placeholderSurfaces('open-steel-rack')).toEqual(['shelf 1', 'shelf 2', 'shelf 4']);
    const measured = OPEN_STEEL_RACK.surfaces.filter((s) => s.provenance.kind === 'measured').map((s) => s.name);
    expect(measured).toEqual(['shelf 3', 'top']);
  });

  it('models 1.75 in beams on 1.5 in posts and a 2 in keyhole pitch, all estimates', () => {
    expect(OPEN_STEEL_RACK.rack).toEqual({ postMm: 38.1, beamMm: 44.45 });
    expect(OPEN_STEEL_RACK.surfaces.every((s) => s.thicknessMm === 44.45)).toBe(true);
    expect(OPEN_STEEL_RACK.shelves).toEqual({ mode: 'adjustable', pinPitchMm: 50.8 });
    expect(OPEN_STEEL_RACK.base).toEqual({ style: 'posts', heightMm: 120.65 });
    const flagged = unverifiedFields(OPEN_STEEL_RACK).map((f) => f.field);
    expect(flagged).toEqual(
      expect.arrayContaining(['boards', 'shelves', 'base', 'rack', 'surface:shelf 1', 'surface:shelf 2', 'surface:shelf 4']),
    );
    expect(flagged).not.toContain('outer');
  });

  it('G17 on the preset: clearance exactly 24 in (96 - 72), and the CC9 headroom golden', () => {
    expect(Math.abs(topClearanceRawMm(OPEN_STEEL_RACK) - 609.6)).toBeLessThanOrEqual(GOLDEN_EPS);
    expect(Math.abs(topClearanceMm(OPEN_STEEL_RACK) - 609.6)).toBeLessThanOrEqual(GOLDEN_EPS);
    expect(fitsOnTop(OPEN_STEEL_RACK, 609.6)).toBe(true);
    expect(Math.abs(framingHeadroomMm(OPEN_STEEL_RACK, 417.2) - 457.2)).toBeLessThanOrEqual(GOLDEN_EPS);
  });
});

describe('v2 golden: Unit-A custom wood (commissioned model, 36 x 72 x 18 in, 3/4 in stock)', () => {
  it('has tops 95 / 529 / 962 / 1395 / 1829 mm, stored exact from 3.75 / 20.8125 / 37.875 / 54.9375 / 72 in', () => {
    const tops = UNIT_A.surfaces.map((s) => s.topMm);
    expect(tops.map(Math.round)).toEqual([95, 529, 962, 1395, 1829]);
    [3.75, 20.8125, 37.875, 54.9375, 72].forEach((inches, i) => {
      expect(Math.abs(tops[i] - inches * IN)).toBeLessThanOrEqual(GOLDEN_EPS);
    });
  });

  it('opens four equal 16.3125 in compartments on a 3 in plinth', () => {
    for (const clear of clearHeightsMm(UNIT_A)) {
      expect(Math.abs(clear - 16.3125 * IN)).toBeLessThanOrEqual(GOLDEN_EPS);
    }
    expect(clearHeightsMm(UNIT_A)).toHaveLength(4);
    expect(UNIT_A.base).toEqual({ style: 'plinth', heightMm: 76.2 });
    expect(Math.abs(stackSumMm(UNIT_A) - 1828.8)).toBeLessThanOrEqual(GOLDEN_EPS);
  });

  it('has the 914.4 x 457.2 x 1828.8 outer box and a 34.5 in interior', () => {
    expect(UNIT_A.outer).toEqual({ widthMm: 914.4, depthMm: 457.2, heightMm: 1828.8 });
    expect(UNIT_A.interior.widthMm).toBe(876.3);
    expect(UNIT_A.shelves).toEqual({ mode: 'fixed' });
  });
});

describe('v1 presets kept until Ross sends his sizes (marked placeholder)', () => {
  it.each(['open-bookcase', 'glass-cabinet-legs', 'wide-custom', 'short-pitch'])(
    '%s marks its whole geometry as placeholder',
    (id) => {
      const profile = getCabinetPreset(id)!;
      expect(profile.provenance.outer.kind).toBe('placeholder');
      expect(placeholderSurfaces(id)).toEqual(profile.surfaces.map((s) => s.name));
    },
  );

  it('keeps the v1 outer sizes', () => {
    const outer = (id: string) => getCabinetPreset(id)!.outer;
    expect(outer('open-bookcase')).toEqual({ widthMm: 800, depthMm: 300, heightMm: 1800 });
    expect(outer('glass-cabinet-legs')).toEqual({ widthMm: 610, depthMm: 400, heightMm: 1830 });
    expect(outer('wide-custom')).toEqual({ widthMm: 900, depthMm: 450, heightMm: 1950 });
  });

  it('gives the short-pitch unit 8 compartments at a 200-230 mm pitch', () => {
    const shortPitch = getCabinetPreset('short-pitch')!;
    const tops = shortPitch.surfaces.map((s) => s.topMm);
    expect(clearHeightsMm(shortPitch)).toHaveLength(8);
    for (let i = 1; i < tops.length; i++) {
      expect(tops[i] - tops[i - 1]).toBeGreaterThanOrEqual(200);
      expect(tops[i] - tops[i - 1]).toBeLessThanOrEqual(230);
    }
  });

  it('gives the wide custom cabinet 6 short compartments on 100 mm legs', () => {
    const wide = getCabinetPreset('wide-custom')!;
    expect(clearHeightsMm(wide)).toHaveLength(6);
    expect(wide.base.style).toBe('legs');
    expect(wide.base.heightMm).toBe(100);
  });
});

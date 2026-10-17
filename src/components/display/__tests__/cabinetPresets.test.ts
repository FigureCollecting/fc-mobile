import { describe, it, expect } from 'vitest';
import {
  CABINET_PRESETS,
  DEFAULT_CABINET_PROFILE,
  DEFAULT_CABINET_PROFILE_ID,
  IKEA_DETOLF,
  IKEA_KLINGSBO,
  OPEN_STEEL_RACK,
  byPreferenceRank,
  getCabinetPreset,
} from '../cabinetPresets';
import {
  adjacencyGapMm,
  buyLink,
  checkCabinetProfile,
  checkCabinetRegistry,
  clearHeightsMm,
  fitsOnTop,
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

/** Ross 2026-10-11: THREE profiles only, KLINGSBO the default, the Detolf second, his rack low preference. */
const ORDER = ['ikea-klingsbo', 'ikea-detolf', 'open-steel-rack'];

describe('preset registry (Ross 2026-10-11: three profiles)', () => {
  it('holds exactly KLINGSBO, Detolf and the rack, most preferred first', () => {
    expect(CABINET_PRESETS.map((p) => p.id)).toEqual(ORDER);
    expect(CABINET_PRESETS.map((p) => p.preferenceRank)).toEqual([1, 2, 3]);
  });

  it('defaults to the IKEA KLINGSBO (Ross 10-11, superseding CC16 Detolf-default)', () => {
    expect(DEFAULT_CABINET_PROFILE_ID).toBe('ikea-klingsbo');
    expect(DEFAULT_CABINET_PROFILE).toBe(IKEA_KLINGSBO);
    expect(getCabinetPreset(DEFAULT_CABINET_PROFILE_ID)).toBe(IKEA_KLINGSBO);
  });

  it("keeps the open steel rack at the lowest preference (Ross CC3: his own rack stays a preset)", () => {
    expect(OPEN_STEEL_RACK.preferenceRank).toBe(Math.max(...CABINET_PRESETS.map((p) => p.preferenceRank)));
  });

  it('sorts by preference rank into a new list, so the order presets are listed in does not matter', () => {
    const listed = [OPEN_STEEL_RACK, IKEA_KLINGSBO, IKEA_DETOLF];
    expect(byPreferenceRank(listed).map((p) => p.id)).toEqual(ORDER);
    expect(listed.map((p) => p.id)).toEqual(['open-steel-rack', 'ikea-klingsbo', 'ikea-detolf']);
  });

  it('looks presets up by id; the retired v1 placeholders are gone', () => {
    expect(getCabinetPreset('ikea-detolf')).toBe(IKEA_DETOLF);
    for (const id of ['open-bookcase', 'glass-cabinet-legs', 'unit-a', 'wide-custom', 'short-pitch', 'ikea-milsbo', 'no-such-cabinet']) {
      expect(getCabinetPreset(id)).toBeUndefined();
    }
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

  it("CC5: only adjustable profiles offer 'fit shelves to figures'; both IKEA cabinets are fixed", () => {
    const adjustable = CABINET_PRESETS.filter((p) => p.shelves.mode === 'adjustable').map((p) => p.id);
    expect(adjustable).toEqual(['open-steel-rack']);
  });

  it('gives a glass thickness exactly to the presets with glass walls or doors', () => {
    for (const profile of CABINET_PRESETS) {
      const { sides, back, front } = profile.materials;
      const hasGlassPanes = sides === 'glass' || back === 'glass' || front === 'glassDoor';
      expect(profile.glassMm !== null).toBe(hasGlassPanes);
    }
  });

  it('never offers a buy link: both IKEA cabinets are discontinued and the rack is Ross\'s own', () => {
    expect(IKEA_KLINGSBO.discontinued).toBe(true);
    expect(IKEA_DETOLF.discontinued).toBe(true);
    expect(OPEN_STEEL_RACK.discontinued).toBe(false);
    for (const profile of CABINET_PRESETS) expect(buyLink(profile)).toBeNull();
  });

  it('records where every IKEA size came from: an exact URL and a snapshot or fetch date', () => {
    for (const profile of [IKEA_KLINGSBO, IKEA_DETOLF]) {
      expect(profile.sources.length).toBeGreaterThan(0);
      for (const src of profile.sources) {
        expect(src.url).toMatch(/^(https:\/\/web\.archive\.org\/web\/\d{14}\/)?https:\/\/www\.ikea\.com\//);
        expect(src.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(src.facts.length).toBeGreaterThan(0);
      }
    }
    expect(OPEN_STEEL_RACK.sources).toEqual([]);
  });
});

describe('IKEA KLINGSBO (Wayback snapshots of the discontinued product page, measurement illustration, assembly PDF)', () => {
  it('keeps the IKEA outer size 45 x 40 x 180 cm (US 17 3/4 x 15 3/4 x 70 7/8 in)', () => {
    expect(IKEA_KLINGSBO.outer).toEqual({ widthMm: 450, depthMm: 400, heightMm: 1800 });
    expect(IKEA_KLINGSBO.provenance.outer.kind).toBe('cited');
    expect(IKEA_KLINGSBO.maker).toBe('IKEA');
  });

  it('stands on splayed legs: a 54.5 x 45 cm footprint, feet 50 mm in front of the body', () => {
    expect(IKEA_KLINGSBO.base).toEqual({ style: 'legs', heightMm: 155, leg: { sectionMm: 33, splay: true } });
    expect(IKEA_KLINGSBO.footprint).toEqual({ widthMm: 545, depthMm: 450, frontOverhangMm: 50 });
    expect(IKEA_KLINGSBO.provenance.footprint?.kind).toBe('cited');
  });

  it('has an open shelf near the floor, the glass case above it with 4 glass shelves, and an open top', () => {
    expect(IKEA_KLINGSBO.surfaces.map((s) => s.name)).toEqual([
      'open shelf',
      'cabinet floor',
      'glass shelf 2',
      'glass shelf 3',
      'glass shelf 4',
      'glass shelf 5',
      'top',
    ]);
    expect(IKEA_KLINGSBO.surfaces.map((s) => s.topMm)).toEqual([176, 421, 694, 969, 1243, 1519, 1800]);
    expect(IKEA_KLINGSBO.surfaces.map((s) => s.thicknessMm)).toEqual([21, 25, 17, 17, 17, 17, 28]);
    expect(IKEA_KLINGSBO.top).toEqual({ usable: true });
    expect(IKEA_KLINGSBO.shelves).toEqual({ mode: 'fixed' });
    expect(IKEA_KLINGSBO.materials).toEqual({ sides: 'glass', back: 'glass', front: 'glassDoor' });
  });

  it('opens 22 cm above the open shelf (IKEA) and about 25.6 cm per glass compartment (drawing)', () => {
    expect(clearHeightsMm(IKEA_KLINGSBO)).toEqual([220, 256, 258, 257, 259, 253]);
    expect(stackSumMm(IKEA_KLINGSBO)).toBe(1800);
  });

  it('draws figures on a 359 x 314 glass plate inside a 382 x 335 interior; the cabinet floor spans the interior', () => {
    expect(IKEA_KLINGSBO.interior).toEqual({ widthMm: 382, depthMm: 335 });
    expect(IKEA_KLINGSBO.plate).toEqual({ widthMm: 359, depthMm: 314, frontInsetMm: 12 });
    expect(IKEA_KLINGSBO.surfaces.filter((s) => s.plate).map((s) => s.name)).toEqual([
      'glass shelf 2',
      'glass shelf 3',
      'glass shelf 4',
      'glass shelf 5',
    ]);
  });

  it('carries the IKEA 7 kg (15 lb) per glass shelf; the open shelf, floor and top loads are not published', () => {
    expect(IKEA_KLINGSBO.surfaces.map((s) => s.maxLoadKg)).toEqual([null, null, 7, 7, 7, 7, null]);
    expect(IKEA_KLINGSBO.provenance.loads?.kind).toBe('cited');
  });

  it('flags the values read off the drawing on screen (verify) and the glass it does not publish', () => {
    const fields = unverifiedFields(IKEA_KLINGSBO).map((f) => `${f.field}=${f.kind}`);
    expect(fields).toEqual([
      'interior=derived',
      'panels=derived',
      'boards=derived',
      'shelves=derived',
      'glass=placeholder',
      'plate=derived',
      'surface:open shelf=derived',
      'surface:cabinet floor=derived',
      'surface:glass shelf 2=derived',
      'surface:glass shelf 3=derived',
      'surface:glass shelf 4=derived',
      'surface:glass shelf 5=derived',
    ]);
  });

  it('G17: the top takes what the room leaves (the 96 in room leaves 638.4 mm, less 2 in of hand room: 587.6 mm)', () => {
    expect(Math.abs(topClearanceMm(IKEA_KLINGSBO) - 587.6)).toBeLessThanOrEqual(GOLDEN_EPS);
    expect(Math.abs(topClearanceRawMm(IKEA_KLINGSBO, 2438.4 + 1000) - 1587.6)).toBeLessThanOrEqual(GOLDEN_EPS);
    expect(fitsOnTop(IKEA_KLINGSBO, 587.6)).toBe(true);
    expect(fitsOnTop(IKEA_KLINGSBO, 588.6)).toBe(false);
    expect(Math.min(...clearHeightsMm(IKEA_KLINGSBO))).toBe(220);
  });

  it('keeps two KLINGSBOs 95 mm apart (their feet meet); next to a Detolf or the rack 47.5 mm', () => {
    expect(adjacencyGapMm(IKEA_KLINGSBO, IKEA_KLINGSBO)).toBe(95);
    expect(adjacencyGapMm(IKEA_KLINGSBO, IKEA_DETOLF)).toBe(47.5);
    expect(adjacencyGapMm(OPEN_STEEL_RACK, IKEA_KLINGSBO)).toBe(47.5);
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

  it('G17 on the preset: clearance 757.6 mm (the room allows 808.4, less 2 in of hand room; no 24 in cap)', () => {
    expect(Math.abs(topClearanceMm(IKEA_DETOLF) - 757.6)).toBeLessThanOrEqual(GOLDEN_EPS);
    expect(Math.abs(topClearanceRawMm(IKEA_DETOLF, 2438.4) - 757.6)).toBeLessThanOrEqual(GOLDEN_EPS);
    expect(Math.abs(2438.4 - IKEA_DETOLF.outer.heightMm - 808.4)).toBeLessThanOrEqual(GOLDEN_EPS);
    expect(fitsOnTop(IKEA_DETOLF, 757.6)).toBe(true);
    expect(fitsOnTop(IKEA_DETOLF, 758.6)).toBe(false);
    // a user ceiling of 1800 mm leaves 119.2 mm on top (CC9: the ceiling becomes a user setting)
    expect(fitsOnTop(IKEA_DETOLF, 119.2, 1800)).toBe(true);
    expect(fitsOnTop(IKEA_DETOLF, 300, 1800)).toBe(false);
    expect(framingHeadroomMm(IKEA_DETOLF, null)).toBe(300);
    expect(Math.abs(framingHeadroomMm(IKEA_DETOLF, 600) - 609.6)).toBeLessThanOrEqual(GOLDEN_EPS);
  });

  it('butts Detolfs together (adjacency gap 0: owners line them up touching); the glass shelves are its plate', () => {
    expect(IKEA_DETOLF.footprint).toBeUndefined();
    expect(adjacencyGapMm(IKEA_DETOLF, IKEA_DETOLF)).toBe(0);
    expect(adjacencyGapMm(IKEA_DETOLF, OPEN_STEEL_RACK)).toBe(0);
    expect(IKEA_DETOLF.surfaces.map((s) => s.plate === true)).toEqual([false, true, true, true, false]);
  });

  it('cites the last IKEA page before it was withdrawn (the live page now redirects to the catalogue)', () => {
    expect(IKEA_DETOLF.sources.map((s) => s.url)).toContain(
      'https://web.archive.org/web/20231111035309/https://www.ikea.com/us/en/p/detolf-glass-door-cabinet-black-brown-10119206/',
    );
    expect(IKEA_DETOLF.preferenceRank).toBe(2);
  });

  it('its smallest compartment is the top one, 378 mm', () => {
    expect(Math.min(...clearHeightsMm(IKEA_DETOLF))).toBe(378);
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
    expect(OPEN_STEEL_RACK.shelves).toEqual({ mode: 'adjustable', pinPitchMm: 50.8, topMoves: true });
    expect(OPEN_STEEL_RACK.base).toEqual({ style: 'posts', heightMm: 120.65 });
    const flagged = unverifiedFields(OPEN_STEEL_RACK).map((f) => f.field);
    expect(flagged).toEqual(
      expect.arrayContaining(['boards', 'shelves', 'base', 'rack', 'surface:shelf 1', 'surface:shelf 2', 'surface:shelf 4']),
    );
    expect(flagged).not.toContain('outer');
  });

  it('G17 on the preset: clearance 24 in (96 - 72) less 2 in of hand room, and the CC9 headroom golden', () => {
    expect(Math.abs(topClearanceRawMm(OPEN_STEEL_RACK) - 558.8)).toBeLessThanOrEqual(GOLDEN_EPS);
    expect(Math.abs(topClearanceMm(OPEN_STEEL_RACK) - 558.8)).toBeLessThanOrEqual(GOLDEN_EPS);
    expect(fitsOnTop(OPEN_STEEL_RACK, 558.8)).toBe(true);
    expect(Math.abs(framingHeadroomMm(OPEN_STEEL_RACK, 417.2) - 457.2)).toBeLessThanOrEqual(GOLDEN_EPS);
  });
});

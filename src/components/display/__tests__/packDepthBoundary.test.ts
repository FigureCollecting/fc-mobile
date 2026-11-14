import { describe, it, expect } from 'vitest';
import type { Figure } from '@figurecollecting/fc-shared';
import { IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../cabinetPresets';
import { withClearance, type CabinetProfile } from '../cabinetProfile';
import { packCabinets, PACK_RULES, surfaceSlots, type CaseFigure, type PackResult } from '../packCabinets';

/**
 * PACK-KIND-1 round 4: on a wall of more than one profile a figure exactly as deep as its only place stands there. FIT-CHECK
 * calls it a fit by the same `within` the placing uses; were the placing stricter at the boundary, the figure would wait
 * for a cabinet that never takes it and the wall would open cabinets for it without end. (Its own file: a runaway here
 * never hides the other packer tests' results.)
 */

const CEILING_MM = 2438.4;
const K = withClearance(IKEA_KLINGSBO, 25.4);
const D = withClearance(IKEA_DETOLF, 25.4);
const R = withClearance(OPEN_STEEL_RACK, 25.4);

const deepest = (p: CabinetProfile, top: boolean) => Math.max(...surfaceSlots(p, CEILING_MM).filter((s) => s.isTop === top).map((s) => s.depthMm));
const stockMax = (p: CabinetProfile) => Math.max(...surfaceSlots(p, CEILING_MM).filter((s) => !s.isTop).map((s) => s.maxHeightMm));
const one = (heightMm: number, widthMm: number, depthMm: number): CaseFigure => ({
  figure: { _id: 'f0', name: 'f0' } as Figure,
  index: 0,
  heightMm,
  widthMm,
  billboardWidthMm: widthMm,
  depthMm,
  heightEstimated: false,
});
const placeOf = (r: PackResult) => {
  for (const c of r.cabinets) for (const s of c.surfaces) if (s.items.length > 0) return { id: c.profile.id, slot: s.slot, turned: !!s.items[0].item.turned };
  return null;
};

describe('PACK-KIND-1: a figure exactly as deep as its only place', () => {
  it('stands on the rack’s 457.2 mm deep top (K-D-R; 500 mm wide, too wide for the other tops, too deep turned), never in “Doesn’t fit”', () => {
    const rackTop = deepest(R, true);
    const r = packCabinets([one(300, 500, rackTop)], [K, D, R], CEILING_MM, PACK_RULES);
    expect(r.violators).toEqual([]);
    expect(placeOf(r)).toMatchObject({ id: R.id, slot: { isTop: true, depthMm: rackTop }, turned: false });
  });

  it('stands in a KLINGSBO’s 335 mm deep tier (a 939 mm statue, K-D-R), never in “Doesn’t fit”', () => {
    const tierDepth = deepest(K, false);
    const r = packCabinets([one(939, 251, tierDepth)], [K, D, R], CEILING_MM, PACK_RULES);
    expect(r.violators).toEqual([]);
    const at = placeOf(r)!;
    expect(at).toMatchObject({ id: K.id, slot: { isTop: false, depthMm: tierDepth }, turned: false });
    expect(at.slot.maxHeightMm).toBeGreaterThan(stockMax(K));
  });
});

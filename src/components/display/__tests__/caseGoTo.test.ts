import { describe, it, expect } from 'vitest';
import type { Figure } from '@figurecollecting/fc-shared';
import { goToFigure, type GoToScene } from '../caseGoTo';
import { frameCase } from '../caseFraming';
import { frameMargins } from '../caseCamera';
import { CEILING_DEFAULT_MM, HEADROOM_MIN_MM } from '../cabinetProfile';
import { measureCaseFigure, packCabinets, surfaceSlots, wallLayout, type PackedCabinet } from '../packCabinets';
import { wallPatternProfiles } from '../casePrefs';
import { getDisplayMeta } from '../displayMeta';

// CARD-VIEW-1 part 3 (Ross 10-25: "a go to button on card view ... it takes you to that figure"): the one place that says
// where the case goes for a figure: the one-shelf view (TOP1) of its shelf, the figure centred as far as that framing allows

const COVER = { width: 443, height: 454 };
const DESKTOP = { width: 1536, height: 730 };

const sized = (i: number, heightMm: number, widthMm: number): Figure => ({ _id: `s${i}`, name: `Figure ${i}`, dimensions: { heightMm, widthMm } }) as Figure;

/** A wall packed as the case packs it (CabinetScene): `figures` on the pattern's cabinets. */
function wallOf(figures: Figure[], pattern = 'ikea-detolf', frame = COVER): GoToScene {
  const measured = figures.map((f, i) => measureCaseFigure(f, i, getDisplayMeta(f)));
  const packed = packCabinets(measured, wallPatternProfiles(pattern), CEILING_DEFAULT_MM);
  const wall = wallLayout(packed.cabinets.map((c) => c.profile));
  return { frame, wall, cabinets: packed.cabinets, headroomMm: wall.cabinets.map(() => HEADROOM_MIN_MM), ceilingMm: CEILING_DEFAULT_MM };
}

/** Where the case put a figure: its cabinet, its surface's slot and its centre along the wall. */
function placeOf(scene: GoToScene, id: string) {
  for (const [ci, cab] of (scene.cabinets as PackedCabinet[]).entries()) {
    for (const surf of cab.surfaces) {
      for (const placed of surf.items) {
        if (placed.item.figure._id !== id) continue;
        const slot = scene.wall.cabinets[ci];
        return { ci, surf, cx: slot.centerMm - surf.slot.widthMm / 2 + placed.xMm + placed.item.widthMm / 2 };
      }
    }
  }
  throw new Error(`${id} is on no shelf`);
}

/** How far either side of the camera the frame shows the cabinets' front plane, inside its margins. */
function halfSeenMm(target: NonNullable<ReturnType<typeof goToFigure>>) {
  const { camera, look } = target.framing;
  return ((camera.frame.width / 2 - frameMargins(camera.frame).x) * (camera.z - look[2])) / camera.focalPx;
}

const FORTY = Array.from({ length: 40 }, (_, i) => sized(i, 200, 100));

describe('goToFigure', () => {
  it('a figure on no shelf (not in the case) has nowhere to go', () => {
    expect(goToFigure('nobody', wallOf(FORTY))).toBeNull();
    expect(goToFigure('s0', { ...wallOf(FORTY), cabinets: [null] })).toBeNull();
  });

  it('goes to the figure\'s cabinet and shelf: the one-shelf view of that level, as the arrows frame it (TOP1)', () => {
    const scene = wallOf(FORTY);
    for (const id of ['s0', 's9', 's23', 's39']) {
      const place = placeOf(scene, id);
      const target = goToFigure(id, scene)!;
      expect(target.focus, id).toBe(place.ci);
      const levels = surfaceSlots(scene.wall.cabinets[place.ci].profile, scene.ceilingMm, true);
      expect(levels[target.shelf].surfaceIndex, id).toBe(place.surf.slot.surfaceIndex);
      expect(levels[target.shelf].isTop).toBe(place.surf.slot.isTop);
      // the shelf view's own framing of that level: straight on, at that band's height, at that distance
      const top1 = frameCase({ frame: scene.frame, wall: scene.wall, headroomMm: scene.headroomMm, view: 'shelf', focus: target.focus, shelf: target.shelf, ceilingMm: scene.ceilingMm });
      expect(target.framing.camera.pitch).toBe(0);
      expect(target.framing.camera.y).toBeCloseTo(top1.camera.y);
      expect(target.framing.camera.z).toBeCloseTo(top1.camera.z);
      expect(target.framing.page).toEqual([target.focus]);
      // in the frame, whatever slide the framing allows
      expect(Math.abs(place.cx - target.framing.camera.x)).toBeLessThanOrEqual(halfSeenMm(target));
    }
  });

  it('a figure on the top goes to the top step (0)', () => {
    // wider than a Detolf's inside, narrower than its top: the top is the one place it stands
    const wide = [...FORTY.slice(0, 8), sized(98, 300, 420)];
    const scene = wallOf(wide);
    const place = placeOf(scene, 's98');
    expect(place.surf.slot.isTop).toBe(true);
    expect(goToFigure('s98', scene)!.shelf).toBe(0);
  });

  it('never slides farther than the framing allows: within the gap between the shelf\'s width and the frame\'s, every figure, every panel', () => {
    for (const frame of [COVER, DESKTOP, { width: 870, height: 475 }]) {
      const scene = wallOf(FORTY, 'ikea-detolf', frame);
      for (let i = 0; i < 40; i++) {
        const target = goToFigure(`s${i}`, scene)!;
        const slot = scene.wall.cabinets[target.focus];
        const half = slot.profile.outer.widthMm / 2;
        const seen = halfSeenMm(target);
        const slid = target.framing.camera.x - slot.centerMm;
        expect(Math.abs(slid), `s${i} at ${frame.width}`).toBeLessThanOrEqual(Math.abs(seen - half) + 1e-6);
        // and the figure is in the frame
        expect(Math.abs(placeOf(scene, `s${i}`).cx - target.framing.camera.x)).toBeLessThanOrEqual(seen);
        expect(target.walkX === null ? 0 : target.walkX - slot.centerMm).toBeCloseTo(target.walkX === null ? 0 : slid);
      }
    }
  });

  it('a slide too small to see is none: the framing TOP1 has, no walk (and no Reset view chip for nothing)', () => {
    const scene = wallOf(FORTY, 'ikea-detolf', COVER);
    // the middle one of three on a shelf stands at its middle
    const target = goToFigure('s5', scene)!;
    expect(Math.abs(placeOf(scene, 's5').cx - scene.wall.cabinets[target.focus].centerMm)).toBeLessThan(0.5);
    expect(target.walkX).toBeNull();
    expect(target.framing.camera.x).toBe(scene.wall.cabinets[target.focus].centerMm);
  });

  for (const id of ['s0', 's4']) it(`on a wide panel, the camera slides toward the figure as far as the shelf stays whole in the frame (${id}, first on its shelf)`, () => {
    const scene = wallOf(FORTY, 'ikea-detolf', DESKTOP);
    // the first figure on a shelf stands at its left end
    const place = placeOf(scene, id);
    const target = goToFigure(id, scene)!;
    const slot = scene.wall.cabinets[target.focus];
    const half = slot.profile.outer.widthMm / 2;
    const seen = halfSeenMm(target);
    expect(seen, 'the desktop frame shows more than the shelf across').toBeGreaterThan(half + 50);
    expect(place.cx).toBeLessThan(slot.centerMm);
    expect(target.walkX).not.toBeNull();
    expect(target.framing.camera.x).toBe(target.walkX);
    // toward the figure: nearer to it than the cabinet's middle is
    expect(Math.abs(place.cx - target.framing.camera.x)).toBeLessThan(Math.abs(place.cx - slot.centerMm));
    // and no farther than leaves the shelf whole: its right side still in the frame
    expect(target.framing.camera.x + seen).toBeGreaterThanOrEqual(slot.centerMm + half - 1e-6);
    // where the figure itself can come to the middle, it does
    if (slot.centerMm - place.cx <= seen - half) expect(target.framing.camera.x).toBeCloseTo(place.cx);
  });

  it('a figure the shelf\'s slack can centre stands in the middle', () => {
    const scene = wallOf(FORTY, 'ikea-detolf', DESKTOP);
    const target0 = goToFigure('s0', scene)!;
    const slot = scene.wall.cabinets[target0.focus];
    // the figure nearest its cabinet's middle on that shelf
    const shelf = (scene.cabinets[target0.focus] as PackedCabinet).surfaces.find((s) => s.items.some((p) => p.item.figure._id === 's0'))!;
    const cxOf = (p: (typeof shelf.items)[number]) => slot.centerMm - shelf.slot.widthMm / 2 + p.xMm + p.item.widthMm / 2;
    const middle = shelf.items.reduce((a, b) => (Math.abs(cxOf(a) - slot.centerMm) <= Math.abs(cxOf(b) - slot.centerMm) ? a : b));
    const target = goToFigure(middle.item.figure._id, scene)!;
    expect(target.framing.camera.x).toBeCloseTo(cxOf(middle));
  });

  it('a figure listed twice (owned and wished) goes to the first place it stands', () => {
    const twice = [sized(0, 200, 100), ...FORTY.slice(1, 30), sized(0, 200, 100)];
    const scene = wallOf(twice);
    expect(goToFigure('s0', scene)!.focus).toBe(placeOf(scene, 's0').ci);
  });
});

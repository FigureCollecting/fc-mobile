/**
 * CARD-VIEW-1 part 3 (Ross 10-25: "a go to button on card view so if viewing one from tap or flipping through them, it takes
 * you to that figure"): the ONE place that says where the case goes for a figure. Today that is the one-shelf view (TOP1,
 * frameShelf) of the shelf the figure stands on, in its cabinet, the camera slid toward the figure as far as that framing
 * allows; the Free camera slice replaces this body with its animated go-to, and the cards that call it stay as they are.
 * Pure maths: no DOM.
 */
import { frameMargins, type Frame } from './caseCamera';
import { atX, frameCase, shelfSteps, type Framing, type FramingInput } from './caseFraming';
import { surfaceSlots, type PackedCabinet, type WallLayout } from './packCabinets';

/** What the case stands now: the inputs of its framing, and where the packer put every figure. */
export interface GoToScene {
  readonly frame: Frame;
  readonly wall: WallLayout;
  /** The packed cabinets, by wall index (null where the wall stands an empty one). */
  readonly cabinets: readonly (PackedCabinet | null)[];
  readonly headroomMm: readonly number[];
  readonly ceilingMm: number;
  readonly lensMm?: number;
}

/** Where the case goes: the cabinet in focus, the shelf view's step, and the camera's walk along the wall (null: none). */
export interface GoToFraming {
  readonly focus: number;
  readonly shelf: number;
  readonly walkX: number | null;
  /** The framing that makes: the one-shelf view of that step, walked to walkX. */
  readonly framing: Framing;
}

/** A slide shorter than this (mm along the wall) is none: the shelf's own framing, with nothing for Reset view to undo. */
const NO_SLIDE_MM = 0.5;

/** Where the figure stands: its cabinet (wall index), its surface's step in the shelf view, its middle along the wall; null when on no shelf. */
function placeOf(figureId: string, scene: GoToScene): { focus: number; level: number; cx: number } | null {
  for (const [focus, cab] of scene.cabinets.entries()) {
    if (!cab) continue;
    const slot = scene.wall.cabinets[focus];
    for (const surf of cab.surfaces) {
      const placed = surf.items.find((p) => p.item.figure._id === figureId);
      if (!placed) continue;
      // the shelf view's steps are every level the cabinet has, the storage shelf among them (levelBand)
      const levels = surfaceSlots(slot.profile, scene.ceilingMm, true);
      const level = levels.findIndex((s) => s.surfaceIndex === surf.slot.surfaceIndex && s.isTop === surf.slot.isTop);
      const cx = slot.centerMm - surf.slot.widthMm / 2 + placed.xMm + placed.item.widthMm / 2;
      return { focus, level: Math.max(0, level), cx };
    }
  }
  return null;
}

/**
 * Where the case goes for `figureId`: the one-shelf view of its shelf in its cabinet (the framing the arrows give it, TOP1),
 * the camera walked toward the figure as far as that framing allows: on a frame wider than the shelf, until the shelf's far
 * side meets the frame's margin (the shelf stays whole); on one narrower, until the frame's edge meets the shelf's. A figure
 * on no shelf (not in the case: goods and media, or one that does not fit) has nowhere to go: null.
 */
export function goToFigure(figureId: string, scene: GoToScene): GoToFraming | null {
  const place = placeOf(figureId, scene);
  if (place === null) return null;
  const input: FramingInput = {
    frame: scene.frame,
    wall: scene.wall,
    headroomMm: scene.headroomMm,
    view: 'shelf',
    focus: place.focus,
    shelf: place.level,
    ceilingMm: scene.ceilingMm,
    lensMm: scene.lensMm,
  };
  const shelf = Math.min(place.level, shelfSteps(input) - 1);
  const top1 = frameCase({ ...input, shelf });
  const { camera, look } = top1;
  const centre = scene.wall.cabinets[place.focus].centerMm;
  const half = scene.wall.cabinets[place.focus].profile.outer.widthMm / 2;
  // how far either side of the camera the frame shows the fronts, inside its margins
  const seen = ((camera.frame.width / 2 - frameMargins(camera.frame).x) * (camera.z - look[2])) / camera.focalPx;
  const slack = Math.abs(seen - half);
  const x = Math.min(centre + slack, Math.max(centre - slack, place.cx));
  const walkX = Math.abs(x - centre) < NO_SLIDE_MM ? null : x;
  return { focus: place.focus, shelf, walkX, framing: walkX === null ? top1 : atX(top1, walkX) };
}

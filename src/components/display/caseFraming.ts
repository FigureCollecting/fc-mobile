/**
 * Where the case camera stands for each view (Ross 2026-09-27: three views,
 * each setting its defaults; 2026-10-09 CC15, CC4a, CC4b, CC4), in the
 * millimetre world of caseCamera: x along the wall, y up from the floor, z
 * toward the viewer, every cabinet's front at z = 0. Pure maths, no DOM.
 *
 *  - cabinet: one cabinet, feet to headroom, tilted at its middle from the
 *    CC15 start height; its neighbours stay true, wherever they fall (CC4a).
 *  - wall: the same distance, centred on a PAGE of cabinets: as many side by
 *    side as that distance shows, so wide screens show several.
 *  - shelf: level at one surface's band, its full width and height in view;
 *    at the top, whose height is open, the camera steps back up to 3 in past
 *    the width fit to show a tall top figure (CC4b = a).
 *
 * The screen only picks the distance and how many cabinets share a page;
 * the cabinets, their shelves and the figures never change (Ross 09-26).
 */
import { HEADROOM_MIN_MM, sideOverhangMm, CEILING_DEFAULT_MM } from './cabinetProfile';
import {
  IN_MM,
  boxCorners,
  fitDistance,
  frameMargins,
  lensFocalPx,
  project,
  startCameraY,
  type Camera,
  type Frame,
  type Vec3,
} from './caseCamera';
import { surfaceSlots, type WallLayout, type WallSlot } from './packCabinets';
import type { CaseView } from './casePrefs';

/** CC4b: how far past the width fit the camera may step back at a cabinet's top. */
export const STEP_BACK_MAX_MM = 3 * IN_MM;
/** Two pages fit "at the same distance" within this much. */
const SAME_DISTANCE_MM = 1;

export interface FramingInput {
  readonly frame: Frame;
  readonly wall: WallLayout;
  /** Framing headroom above each cabinet (framingHeadroomMm of its top figures), by wall index. */
  readonly headroomMm: readonly number[];
  readonly view: CaseView;
  /** The cabinet in focus, by wall index. */
  readonly focus: number;
  /** The shelf view's surface, in reading order (0 = the top, then the shelves top to bottom). */
  readonly shelf: number;
  readonly ceilingMm?: number;
  readonly lensMm?: number;
}

export interface Framing {
  readonly camera: Camera;
  /** The point the camera aims at, on the cabinets' front plane. */
  readonly look: Vec3;
  /** The cabinets this view frames, by wall index. */
  readonly page: readonly number[];
}

export interface Box {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly z0: number;
  readonly z1: number;
}

/** One cabinet's room: its body (and splayed feet) from the floor up to the framing headroom above its top. */
export function cabinetBox(slot: WallSlot, headroomMm: number): Box {
  const overhang = sideOverhangMm(slot.profile);
  return {
    x0: slot.leftMm - overhang,
    x1: slot.rightMm + overhang,
    y0: 0,
    y1: slot.profile.outer.heightMm + headroomMm,
    z0: -slot.profile.outer.depthMm,
    z1: slot.profile.footprint?.frontOverhangMm ?? 0,
  };
}

const headroomOf = (input: FramingInput, i: number) => input.headroomMm[i] ?? HEADROOM_MIN_MM;

/** The tilted CC15 framing of these cabinets: aimed at the middle of the tallest, centred on their bodies. */
function fitCabinets(input: FramingInput, members: readonly number[]): Framing {
  const boxes = members.map((i) => cabinetBox(input.wall.cabinets[i], headroomOf(input, i)));
  const union: Box = {
    x0: Math.min(...boxes.map((b) => b.x0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y0: 0,
    y1: Math.max(...boxes.map((b) => b.y1)),
    z0: Math.min(...boxes.map((b) => b.z0)),
    z1: Math.max(...boxes.map((b) => b.z1)),
  };
  const first = input.wall.cabinets[members[0]];
  const last = input.wall.cabinets[members[members.length - 1]];
  const look: Vec3 = [(first.leftMm + last.rightMm) / 2, union.y1 / 2, 0];
  const { camera } = fitDistance({
    frame: input.frame,
    camY: startCameraY(look[1]),
    look,
    tilt: true,
    corners: boxCorners(union.x0, union.x1, union.y0, union.y1, union.z0, union.z1),
    lensMm: input.lensMm,
  });
  return { camera, look, page: members };
}

const distanceOf = (f: Framing) => f.camera.z - f.look[2];

/**
 * The wall cut into pages left to right: each page takes the next cabinet
 * while the page still fits no farther back than its farthest single
 * cabinet needs (so a narrow screen pages one cabinet at a time).
 */
export function wallPages(input: FramingInput): number[][] {
  const n = input.wall.cabinets.length;
  const single = Array.from({ length: n }, (_, i) => distanceOf(fitCabinets(input, [i])));
  const pages: number[][] = [];
  let i = 0;
  while (i < n) {
    const page = [i];
    let limit = single[i];
    let j = i + 1;
    while (j < n) {
      const nextLimit = Math.max(limit, single[j]);
      if (distanceOf(fitCabinets(input, [...page, j])) > nextLimit + SAME_DISTANCE_MM) break;
      page.push(j);
      limit = nextLimit;
      j++;
    }
    pages.push(page);
    i = j;
  }
  return pages;
}

function frameShelf(input: FramingInput, focus: number): Framing {
  const slot = input.wall.cabinets[focus];
  const { profile } = slot;
  const slots = surfaceSlots(profile, input.ceilingMm ?? CEILING_DEFAULT_MM);
  const s = slots[Math.min(Math.max(0, Math.trunc(input.shelf)), slots.length - 1)];
  const surface = profile.surfaces[s.surfaceIndex];
  const lo = surface.topMm - surface.thicknessMm;
  const hi = s.isTop ? profile.outer.heightMm + headroomOf(input, focus) : profile.surfaces[s.surfaceIndex + 1].topMm;
  const look: Vec3 = [slot.centerMm, (lo + hi) / 2, 0];
  const focalPx = lensFocalPx(input.frame, input.lensMm);
  const m = frameMargins(input.frame);
  const widthFit = (focalPx * profile.outer.widthMm) / 2 / (input.frame.width / 2 - m.x);
  const heightFit = (focalPx * (hi - lo)) / 2 / (input.frame.height / 2 - m.y);
  const d = s.isTop ? Math.max(widthFit, Math.min(heightFit, widthFit + STEP_BACK_MAX_MM)) : Math.max(widthFit, heightFit);
  return {
    camera: { x: look[0], y: look[1], z: look[2] + d, pitch: 0, focalPx, frame: input.frame },
    look,
    page: [focus],
  };
}

/** The camera for the view, the focus cabinet and (in the shelf view) its surface. */
export function frameCase(input: FramingInput): Framing {
  const n = input.wall.cabinets.length;
  if (n === 0) throw new RangeError('frameCase needs at least one cabinet on the wall');
  const focus = Math.min(Math.max(0, Math.trunc(input.focus)), n - 1);
  if (input.view === 'shelf') return frameShelf(input, focus);
  if (input.view === 'cabinet') return fitCabinets(input, [focus]);
  const page = wallPages(input).find((p) => p.includes(focus)) as number[];
  return fitCabinets(input, page);
}

/**
 * CC4, camera mode: a sideways swipe of dxPx walks the camera (and its aim)
 * along the wall, by the distance those pixels span at the cabinets' front,
 * opposite to the finger, never past the first or the last cabinet.
 */
export function swipeCamera(framing: Framing, wall: WallLayout, dxPx: number): Framing {
  const { camera, look } = framing;
  const perPx = (camera.z - look[2]) / camera.focalPx;
  const first = wall.cabinets[0].centerMm;
  const last = wall.cabinets[wall.cabinets.length - 1].centerMm;
  const x = Math.min(last, Math.max(first, camera.x - dxPx * perPx));
  return { ...framing, camera: { ...camera, x }, look: [x, look[1], look[2]] };
}

/**
 * CC4, pan mode: how far (CSS px) the drawn picture may slide, left
 * (negative) and right, so the wall's ends never leave the frame margins.
 * [0, 0] when the whole wall already sits inside them.
 */
export function panLimitsPx(framing: Framing, wall: WallLayout): [number, number] {
  const { camera, look } = framing;
  const m = frameMargins(camera.frame);
  const left = project(camera, [wall.leftMm, look[1], 0]).x;
  const right = project(camera, [wall.rightMm, look[1], 0]).x;
  // a wall narrower than the frame may still start or end off screen: it slides in, never past its ends
  return [Math.min(0, camera.frame.width - m.x - right), Math.max(0, m.x - left)];
}

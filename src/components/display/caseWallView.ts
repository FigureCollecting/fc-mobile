/**
 * NAV-EMPTY (Ross 11-22: at the room's top or bottom, after a "zoom away", "everything just becomes the backcolor/empty
 * room until I switch to card view and back"): how much of the wall the Free camera's frame still holds, and how far a
 * Look may turn before it holds less. The drives (useFreeCamera's jogOk) and the Look's cone (lookCone, into casePose's
 * spansOf) ask here, so neither takes the wall out of a frame that shows it. Pure maths, no DOM.
 */
import type { Camera } from './caseCamera';
import { frontShown } from './caseCull';
import { PITCH, type PitchCap } from './casePose';
import type { WallLayout } from './packCabinets';

/**
 * A frame holds the wall well when a cabinet front reaches this share of the frame's width and height in from its
 * edges: at the limit a band an eighth of the frame deep still shows cabinets, not a line of one at the very edge (the
 * lowest figures stand a little above a cabinet's feet, so a front's edge alone can show none).
 */
export const WALL_KEEP_FRAME = 1 / 8;

/** How close pitchCap finds the furthest pitch that still shows the wall (radians). */
export const PITCH_CAP_STEP = (0.25 * Math.PI) / 180;

/**
 * Some cabinet's front (frontShown: feet to top, on the fronts' plane) shows in this camera's frame, `inset` of the
 * frame's width and height in from each edge (0: anywhere in the frame).
 */
export function wallShown(camera: Camera, wall: WallLayout, inset = 0): boolean {
  const { width, height } = camera.frame;
  const middle = { x0: width * inset, x1: width * (1 - inset), y0: height * inset, y1: height * (1 - inset) };
  const view = { camera, panPx: 0 };
  return wall.cabinets.some((slot) => frontShown(view, slot, middle));
}

/**
 * How well this camera's frame holds the wall, as the inset to keep to (wallShown's): WALL_KEEP_FRAME where a front
 * reaches that far in; 0 where one only shows nearer an edge (a swipe's or a fold's view: it is kept from going, never
 * pulled in); undefined where none shows (nothing to keep, so nothing is ever trapped out there).
 */
export function wallKept(camera: Camera, wall: WallLayout): number | undefined {
  if (wallShown(camera, wall, WALL_KEEP_FRAME)) return WALL_KEEP_FRAME;
  return wallShown(camera, wall) ? 0 : undefined;
}

/**
 * How far a Look from this camera may rest up (lo) and down (hi) and hold the wall as well as it does (wallKept): each
 * way, where the soft limit (PITCH) does not, the furthest pitch from the camera's toward it that does, by halving to
 * PITCH_CAP_STEP. A side whose soft limit still holds it, or that the camera is at or past already, is left out
 * (PITCH's stands); so is everything where the camera shows no front as it is.
 */
export function pitchCap(camera: Camera, wall: WallLayout): PitchCap | undefined {
  const inset = wallKept(camera, wall);
  if (inset === undefined) return undefined;
  const shows = (pitch: number) => wallShown({ ...camera, pitch }, wall, inset);
  const side = (limit: number): number | undefined => {
    const past = limit > 0 ? camera.pitch >= limit : camera.pitch <= limit;
    if (past || shows(limit)) return undefined;
    let last = camera.pitch;
    let gone = limit;
    while (Math.abs(gone - last) > PITCH_CAP_STEP) {
      const mid = (last + gone) / 2;
      if (shows(mid)) last = mid;
      else gone = mid;
    }
    return last;
  };
  const lo = side(-PITCH.upSoft);
  const hi = side(PITCH.downSoft);
  if (lo === undefined && hi === undefined) return undefined;
  return { ...(lo === undefined ? {} : { lo }), ...(hi === undefined ? {} : { hi }) };
}

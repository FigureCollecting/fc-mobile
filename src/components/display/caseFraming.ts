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
 *  - shelf: level at one shelf level's band (the band all the wall's cabinets
 *    span there), its full width and height in view, whichever dictates the
 *    distance and the other showing more; at the top, whose height is open, the
 *    band runs from its board up to the ceiling as set (TOP1, Ross 10-18:
 *    TOP_BAND_MAX_MM, FRAME_CEILING_MAX_MM), which replaced CC4b's step-back cap.
 *
 * The screen only picks the distance and how many cabinets share a page;
 * the cabinets, their shelves and the figures never change (Ross 09-26).
 *
 * MOB-NAV-2 (Ross 12:1xC: at least 3 full and 2 partial, up to 5 full, on
 * every panel): no view frames the fronts of more cabinets than the case
 * draws (its drawCap), wherever the camera walks or the photo slides.
 *
 * CASE-FB1 (Ross, Fold8 10-14): the wall and cabinet views are full height,
 * from a strip of floor in front of the feet (FLOOR_STRIP_MM) to the top of
 * what stands on the tallest top, and the whole wall shares ONE camera height,
 * distance and tilt (wallCamera): a walk, a pan, a page or a new focus moves
 * only x, so nothing jumps up or down. CF1 (a, close-out 1): on a wide or
 * short panel the case draws as many cabinets as that frame shows fronts (up
 * to DRAWN_CABINETS_LIMIT), so the wall spans the panel; only past the limit
 * is the frame cropped narrower (CC2: crop FOV, the lens unchanged), never the
 * camera stepped in: never a cropped height. The shelf view stands one camera
 * per shelf level for the whole wall too (frameShelf). An up/down drag raises or lowers
 * the camera with its aim (camera mode, liftLimitsMm) or slides the photo
 * (pan mode, panYLimitsPx), between the floor and the ceiling.
 */
import { HEADROOM_MIN_MM, sideOverhangMm, CEILING_DEFAULT_MM, type CabinetProfile } from './cabinetProfile';
import {
  IN_MM,
  boxCorners,
  fitDistance,
  frameMargins,
  lensFocalPx,
  pitchToward,
  project,
  startCameraY,
  unprojectToPlaneZ,
  type Camera,
  type Frame,
  type Vec3,
} from './caseCamera';
import { surfaceSlots, type WallLayout, type WallSlot } from './packCabinets';
import type { CaseView } from './casePrefs';
import { DRAWN_CABINETS_LIMIT, MAX_DRAWN_CABINETS, NEAR_MM, clipConvex } from './caseCull';

/** TOP1 (Ross 10-18): the most the top step shows above a top surface. Ross gave 72 to 96 in; this is the one value to tune. */
export const TOP_BAND_MAX_MM = 84 * IN_MM;
/** TOP1: the highest the top step shows up to, however high the ceiling is set. */
export const FRAME_CEILING_MAX_MM = 192 * IN_MM;
/** CASE-FB1 item 1: the floor the full-height views keep in sight in front of the cabinets' feet (about a foot). */
export const FLOOR_STRIP_MM = 300;
/** A corner within this much of a side margin is inside it. */
const SAME_PX = 1e-6;

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
  /** CC4 pan mode: how far (CSS px) the photo may slide either way before it is retaken (panFraming); panSlideMaxPx when not given. */
  readonly slideMaxPx?: number;
  /** CF1 (a): the most cabinets the case draws for this panel and wall, every view alike (wallCamera). */
  readonly drawCap: number;
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

/** The room the cabinets stand in: floor to the highest headroom, the deepest back to the farthest front (splayed feet). */
export function roomSpan(wall: WallLayout, headroomMm: readonly number[]): RoomSpan {
  return {
    y0: 0,
    y1: Math.max(...wall.cabinets.map((c, i) => c.profile.outer.heightMm + (headroomMm[i] ?? HEADROOM_MIN_MM))),
    z0: -Math.max(...wall.cabinets.map((c) => c.profile.outer.depthMm)),
    z1: Math.max(...wall.cabinets.map((c) => c.profile.footprint?.frontOverhangMm ?? 0)),
  };
}

/**
 * The nearest and farthest depth (mm along the camera's axis) at which the frame shows any of the room: its side
 * (floor to top, back to front) cut by the near plane and the frame's top and bottom edges, which cut it the same
 * all along the wall. null when the frame shows none of it.
 */
export function seenDepthsMm(camera: Camera, room: RoomSpan): [number, number] | null {
  const sin = Math.sin(camera.pitch);
  const cos = Math.cos(camera.pitch);
  const f = camera.focalPx;
  const half = camera.frame.height / 2;
  const up = (y: number, z: number) => (y - camera.y) * cos - (z - camera.z) * sin;
  const depth = (y: number, z: number) => -(y - camera.y) * sin - (z - camera.z) * cos;
  let side: (readonly [number, number])[] = [
    [room.y0, room.z0],
    [room.y1, room.z0],
    [room.y1, room.z1],
    [room.y0, room.z1],
  ];
  for (const inside of [
    (y: number, z: number) => depth(y, z) - NEAR_MM,
    (y: number, z: number) => half * depth(y, z) - f * up(y, z),
    (y: number, z: number) => f * up(y, z) + half * depth(y, z),
  ]) {
    side = clipConvex(side, inside);
    if (side.length === 0) return null;
  }
  const depths = side.map(([y, z]) => depth(y, z));
  return [Math.min(...depths), Math.max(...depths)];
}

/**
 * How long a stretch of the wall (mm) the frame (unslid: a slide is capped by capSlidePx) shows any of the room
 * along: at depth d it spans d w / f, over the depths it sees. 0 when it sees none of the room.
 */
export function frameSpanMm(camera: Camera, room: RoomSpan): number {
  const seen = seenDepthsMm(camera, room);
  if (seen === null) return 0;
  return (camera.frame.width * Math.max(seen[0], seen[1])) / camera.focalPx;
}

/** How far short of the run to the fifth cabinet on the frame's stretch stays (a front only touched is not shown). */
const CAP_SLACK_MM = 1;

/**
 * The longest stretch of the wall a frame may show and still show the fronts of no more than `cap` cabinets wherever
 * along it it stands: short of the narrowest run between a cabinet and the one `cap` after it (splayed feet
 * included), which a stretch must span to touch both. Infinity on a wall of no more.
 */
export function capSpanMm(wall: WallLayout, cap: number = MAX_DRAWN_CABINETS): number {
  const boxes = wall.cabinets.map((slot) => cabinetBox(slot, 0));
  let span = Infinity;
  for (let i = 0; i + cap < boxes.length; i++) span = Math.min(span, boxes[i + cap].x0 - boxes[i].x1);
  return span - CAP_SLACK_MM;
}

/** What every framing of one wall shares: the cabinets' fronts (floor to the highest headroom), the most cabinets drawn, and the longest stretch of their fronts a frame may show. */
interface WallCap {
  readonly fronts: RoomSpan;
  readonly cap: number;
  readonly span: number;
}

function wallCap(input: FramingInput, cap: number): WallCap {
  const room = roomSpan(input.wall, input.headroomMm);
  return { fronts: { y0: room.y0, y1: room.y1, z0: 0, z1: 0 }, cap, span: capSpanMm(input.wall, cap) };
}

/** The nearest a capped camera stands to its look-at, and how close the step in is found. */
const CAP_NEAREST_MM = 50;
const CAP_TOLERANCE_MM = 0.5;

/**
 * The distance the camera `at(distance)` stands at: `fit` when the frame there shows no longer a stretch of the
 * fronts than the cap allows (unslid), else the farthest that does, within CAP_TOLERANCE_MM (stepping in along the
 * line of sight, the stretch shrinks with the distance).
 */
function capDistance(at: (distance: number) => Camera, fit: number, cap: WallCap): number {
  if (frameSpanMm(at(fit), cap.fronts) <= cap.span) return fit;
  let lo = CAP_NEAREST_MM;
  let hi = fit;
  while (hi - lo > CAP_TOLERANCE_MM) {
    const mid = (lo + hi) / 2;
    if (frameSpanMm(at(mid), cap.fronts) <= cap.span) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * CC4 pan mode under the cap: how far (CSS px) the photo may slide either way and still show no longer a stretch
 * of the fronts than `span`. Up to half the frame the stretch stays what it is unslid; past it the frame's far edge
 * looks along the fronts at a graze, and the stretch grows by the depth the fronts span in view (a level camera
 * sees them all at one depth: no limit).
 */
export function capSlidePx(camera: Camera, fronts: RoomSpan, span: number): number {
  const seen = seenDepthsMm(camera, fronts);
  if (seen === null || !(seen[1] > seen[0])) return Infinity;
  const half = camera.frame.width / 2;
  return Math.max(0, (camera.focalPx * span - half * (seen[0] + seen[1])) / (seen[1] - seen[0]));
}

/** The framing with the slide its cap allows the photo in pan mode (capSlidePx, at most panSlideMaxPx). */
function withSlide(framing: Framing, cap: WallCap): Framing {
  return { ...framing, slideMaxPx: Math.min(panSlideMaxPx(framing.camera), capSlidePx(framing.camera, cap.fronts, cap.span)) };
}

/** The top of the wall: the highest cabinet top plus its framing headroom (what stands on it). */
function wallTopMm(input: FramingInput): number {
  return Math.max(...input.wall.cabinets.map((c, i) => c.profile.outer.heightMm + headroomOf(input, i)));
}

/** The wall view's and the cabinet view's camera, at x = 0, the height it aims at, and the most cabinets drawn (wallCamera). */
interface WallCamera {
  readonly camera: Camera;
  readonly lookY: number;
  readonly drawCap: number;
}

/**
 * The deepest a front of the cabinets lies in view, at any height the camera may be raised or lowered to with its
 * tilt kept (liftLimitsMm): a front point at height y lies (camera.y - y) sin(pitch) + camera.z cos(pitch) deep, deepest
 * at the lowest the frame shows; raised, the frame shows lower fronts, down to where its bottom row meets the
 * fronts' plane. So: the depth there, never less than the camera's own distance (a level camera).
 */
function deepestFrontMm(camera: Camera): number {
  const bottom = unprojectToPlaneZ(camera, camera.frame.width / 2, camera.frame.height, 0);
  const deepest = bottom === null ? Infinity : project(camera, bottom).depth;
  return Math.max(camera.z * Math.cos(camera.pitch), deepest);
}

/**
 * CASE-FB1: the one camera the wall and cabinet views share. Aimed at the middle of the wall's top (wallTopMm) from
 * the CC15 start height; as far back as the widest of its cabinets needs to stand whole in the frame margins, centred,
 * from a FLOOR_STRIP_MM strip of floor in front of its feet to the wall's top. CF1 (a): the case draws as many
 * cabinets as that frame shows fronts, at any height the camera may be raised to (the least cap, from
 * MAX_DRAWN_CABINETS, whose capSpanMm it spans no more of), up to DRAWN_CABINETS_LIMIT; past the limit the frame is
 * cropped to the width that spans no more (whole px), its height and the lens kept.
 */
export function wallCamera(input: FramingInput): WallCamera {
  const { camera, lookY, needs } = fullHeightFrame(input);
  const drawCap = Math.min(DRAWN_CABINETS_LIMIT, capFor(input.wall, needs));
  const width = Math.floor((capSpanMm(input.wall, drawCap) * camera.focalPx) / deepestFrontMm(camera));
  return { camera: width < input.frame.width ? { ...camera, frame: { width, height: input.frame.height } } : camera, lookY, drawCap };
}

/**
 * G2: how many cabinets the panel's uncropped full-height frame shows fronts of (wallCamera), with no limit: the
 * least cap, from MAX_DRAWN_CABINETS, whose capSpanMm it never passes at any height the camera may be raised to (a
 * wall of fewer cabinets: all of them). DRAWN_CABINETS_LIMIT is the most of it on the Fold8's panels.
 */
export function fullHeightCap(input: FramingInput): number {
  return capFor(input.wall, fullHeightFrame(input).needs);
}

/** The least cap, from MAX_DRAWN_CABINETS, whose capSpanMm spans `needs` (mm of the fronts). */
function capFor(wall: WallLayout, needs: number): number {
  let cap = MAX_DRAWN_CABINETS;
  while (capSpanMm(wall, cap) < needs) cap++;
  return cap;
}

/** The full-height camera over the whole panel (wallCamera before its crop), its aim, and the stretch of the fronts it spans at its deepest. */
function fullHeightFrame(input: FramingInput): { camera: Camera; lookY: number; needs: number } {
  const top = wallTopMm(input);
  const lookY = top / 2;
  const camY = startCameraY(lookY);
  let distance = 0;
  const fitted = new Set<string>();
  for (const slot of input.wall.cabinets) {
    const b = cabinetBox(slot, 0);
    // a cabinet's fit depends only on its box about its centre
    const key = `${b.x1 - b.x0}|${b.z0}|${b.z1}`;
    if (fitted.has(key)) continue;
    fitted.add(key);
    const corners = [
      ...boxCorners(b.x0, b.x1, 0, top, b.z0, b.z1),
      [slot.centerMm, 0, b.z1 + FLOOR_STRIP_MM] as Vec3,
    ];
    distance = Math.max(distance, fitDistance({ frame: input.frame, camY, look: [slot.centerMm, lookY, 0], tilt: true, corners, lensMm: input.lensMm }).distance);
  }
  const camera: Camera = {
    x: 0,
    y: camY,
    z: distance,
    pitch: pitchToward(camY, distance, lookY, 0),
    focalPx: lensFocalPx(input.frame, input.lensMm),
    frame: input.frame,
  };
  // the stretch of the fronts the whole frame spans at its deepest
  return { camera, lookY, needs: (input.frame.width * deepestFrontMm(camera)) / camera.focalPx };
}

/** The shared camera centred on these cabinets (by wall index, left to right). */
function centredOn(input: FramingInput, wc: WallCamera, members: readonly number[]): Framing {
  const x = (input.wall.cabinets[members[0]].leftMm + input.wall.cabinets[members[members.length - 1]].rightMm) / 2;
  return { camera: { ...wc.camera, x }, look: [x, wc.lookY, 0], page: members, drawCap: wc.drawCap };
}

/** Whether these cabinets stand whole across the framing's frame, splayed feet and all, floor to the wall's top, back to front, inside its side margins. */
function standAcross(framing: Framing, input: FramingInput, members: readonly number[]): boolean {
  const { camera } = framing;
  const m = frameMargins(camera.frame);
  const top = wallTopMm(input);
  return members.every((i) => {
    const b = cabinetBox(input.wall.cabinets[i], 0);
    return boxCorners(b.x0, b.x1, 0, top, b.z0, b.z1).every((c) => {
      const p = project(camera, c);
      return p.depth > NEAR_MM && p.x >= m.x - SAME_PX && p.x <= camera.frame.width - m.x + SAME_PX;
    });
  });
}

/**
 * The wall cut into pages left to right: each page takes the next cabinet while the page, centred, still stands whole
 * across the shared camera's frame (wallCamera: so a narrow screen pages one cabinet at a time) and holds no more
 * than the case draws at a time (its drawCap).
 */
export function wallPages(input: FramingInput): number[][] {
  const n = input.wall.cabinets.length;
  if (n === 0) return [];
  const wc = wallCamera(input);
  const pages: number[][] = [];
  let i = 0;
  while (i < n) {
    const page = [i];
    let j = i + 1;
    while (j < n && page.length < wc.drawCap && standAcross(centredOn(input, wc, [...page, j]), input, [...page, j])) {
      page.push(j);
      j++;
    }
    pages.push(page);
    i = j;
  }
  return pages;
}

/**
 * TOP1: the height the top step shows up to above a cabinet `heightMm` tall: the ceiling as set (at most
 * FRAME_CEILING_MAX_MM), but no more than TOP_BAND_MAX_MM above the top, and never under the top itself.
 */
export function topBandTopMm(heightMm: number, ceilingMm: number): number {
  return Math.min(heightMm + TOP_BAND_MAX_MM, Math.max(heightMm, Math.min(ceilingMm, FRAME_CEILING_MAX_MM)));
}

/** One cabinet's band at a shelf level (reading order, clamped to its lowest): its surface up to the one above, or its top up to the ceiling (topBandTopMm). */
function levelBand(profile: CabinetProfile, level: number, ceilingMm: number): { lo: number; hi: number } {
  const slots = surfaceSlots(profile, ceilingMm);
  const s = slots[Math.min(Math.max(0, Math.trunc(level)), slots.length - 1)];
  const surface = profile.surfaces[s.surfaceIndex];
  const hi = s.isTop ? topBandTopMm(profile.outer.heightMm, ceilingMm) : profile.surfaces[s.surfaceIndex + 1].topMm;
  return { lo: surface.topMm - surface.thicknessMm, hi };
}

/** The band every cabinet of the wall spans at a shelf level: the lowest surface to the highest top of any. */
function wallBand(input: FramingInput, level: number): { lo: number; hi: number } {
  const ceiling = input.ceilingMm ?? CEILING_DEFAULT_MM;
  const bands = input.wall.cabinets.map((c) => levelBand(c.profile, level, ceiling));
  return { lo: Math.min(...bands.map((b) => b.lo)), hi: Math.max(...bands.map((b) => b.hi)) };
}

/**
 * The shelf steps the wall offers (the shelf view's camera is per wall level, CASE-FB1): as many as the most slots any
 * cabinet has, less the levels at the bottom whose wall band is the one above's (a cabinet with a shelf out has fewer
 * levels, and its last stands for the rest: stepping down to them would show the same picture).
 */
export function shelfSteps(input: FramingInput): number {
  const ceiling = input.ceilingMm ?? CEILING_DEFAULT_MM;
  let steps = Math.max(1, ...input.wall.cabinets.map((c) => surfaceSlots(c.profile, ceiling).length));
  while (steps > 1) {
    const a = wallBand(input, steps - 1);
    const b = wallBand(input, steps - 2);
    if (a.lo !== b.lo || a.hi !== b.hi) break;
    steps--;
  }
  return steps;
}

/**
 * The shelf view (F2, close-out 1): one camera per shelf level for the whole wall, so a walk or a new focus moves
 * only x. Level, at the middle of the band every cabinet's own band at that level spans (levelBand); as far back as
 * its height or the widest cabinet's width needs, whichever dictates, to show the band whole in the margins, the
 * other showing more (TOP1: no cap on the step back at the top, whose band runs up to the ceiling); stepped in where
 * that frame would show more fronts than the case draws.
 */
function frameShelf(input: FramingInput, focus: number, cap: WallCap): Framing {
  const { lo, hi } = wallBand(input, input.shelf);
  const look: Vec3 = [input.wall.cabinets[focus].centerMm, (lo + hi) / 2, 0];
  const focalPx = lensFocalPx(input.frame, input.lensMm);
  const m = frameMargins(input.frame);
  const heightFit = (focalPx * (hi - lo)) / 2 / (input.frame.height / 2 - m.y);
  const widthFit = (focalPx * Math.max(...input.wall.cabinets.map((slot) => slot.profile.outer.widthMm))) / 2 / (input.frame.width / 2 - m.x);
  const at = (d: number): Camera => ({ x: look[0], y: look[1], z: look[2] + d, pitch: 0, focalPx, frame: input.frame });
  return { camera: at(capDistance(at, Math.max(widthFit, heightFit), cap)), look, page: [focus], drawCap: cap.cap };
}

/** The camera for the view, the focus cabinet and (in the shelf view) its surface. */
export function frameCase(input: FramingInput): Framing {
  const n = input.wall.cabinets.length;
  if (n === 0) throw new RangeError('frameCase needs at least one cabinet on the wall');
  const focus = Math.min(Math.max(0, Math.trunc(input.focus)), n - 1);
  const wc = wallCamera(input);
  const cap = wallCap(input, wc.drawCap);
  if (input.view === 'shelf') return withSlide(frameShelf(input, focus, cap), cap);
  if (input.view === 'cabinet') return withSlide(centredOn(input, wc, [focus]), cap);
  const page = wallPages(input).find((p) => p.includes(focus)) as number[];
  return withSlide(standWhole(centredOn(input, wc, page), input.wall, page), cap);
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

/** Ross 12:1xC (desk MN2 a): a settled walk stands at least this many cabinets whole across the frame. */
export const WHOLE_MIN = 3;

/**
 * The cabinets (by wall index) whose body stands whole across the frame, the picture slid panPx: side to side, on the
 * front plane at the height `lookY` the frame aims at, inside the frame.
 */
export function wholeCabinets(camera: Camera, wall: WallLayout, lookY: number, panPx = 0): number[] {
  return wall.cabinets.flatMap((slot, i) =>
    [slot.leftMm, slot.rightMm].every((x) => {
      const p = project(camera, [x, lookY, 0]).x + panPx;
      return p >= 0 && p <= camera.frame.width;
    })
      ? [i]
      : [],
  );
}

/** The cabinet (by wall index) whose centre is nearest x: the focus a walk leaves (the first of two as near). */
export function nearestCabinet(wall: WallLayout, x: number): number {
  let nearest = 0;
  wall.cabinets.forEach((c, i) => {
    if (Math.abs(c.centerMm - x) < Math.abs(wall.cabinets[nearest].centerMm - x)) nearest = i;
  });
  return nearest;
}

/**
 * The wall x the frame centre shows, on the cabinets' front at the height it aims at, the picture slid panPx: the
 * camera's, less the slide over the px per mm there (a picture retaken farther along shows the same).
 */
export function frameCentreX(framing: Framing, panPx = 0): number {
  const { camera, look } = framing;
  return camera.x - (panPx * project(camera, look).depth) / camera.focalPx;
}

/**
 * The page the pager pages from (close-out 4, ruling 32): the one holding the cabinet whose centre is nearest what the
 * frame centres on, wherever a press opened, a walk settled or a pan slid the picture; so Next opens a page farther
 * along than the picture stands and Prev one nearer, never where it already is or back past it.
 */
export function pageInView(pages: readonly (readonly number[])[], wall: WallLayout, framing: Framing, panPx = 0): number {
  const at = nearestCabinet(wall, frameCentreX(framing, panPx));
  return pages.findIndex((p) => p.includes(at));
}

/** The framing with the camera, and its aim, moved along the wall to x. */
export const atX = (framing: Framing, x: number): Framing => ({ ...framing, camera: { ...framing.camera, x }, look: [x, framing.look[1], framing.look[2]] });

/** Where a walk may settle: a cabinet's centre or halfway between two, wall index order. */
function stopXs(wall: WallLayout): number[] {
  const centres = wall.cabinets.map((c) => c.centerMm);
  return centres.flatMap((x, i) => (i + 1 < centres.length ? [x, (x + centres[i + 1]) / 2] : [x]));
}

/** A place a walk of the wall view settles: the camera at x, the focus the cabinet nearest it, the cabinets it stands whole. */
export interface WalkStop {
  readonly x: number;
  readonly focus: number;
  readonly whole: readonly number[];
}

/**
 * The stops of a wall view's walk (Ross 12:1xC, desk MN2 a; close-out 3, ruling 27), left to right. Each is seen as
 * the scene shows it once settled: from the wall's one camera (wallCamera). The stops are those where at least
 * WHOLE_MIN cabinets stand whole (on a wall where none does, the most any does); the wall's two ends, where a swipe
 * stops (the first and the last cabinet's centre); and, for a cabinet whole at none of those, the stop that stands it
 * whole beside the most others (reachability wins over the count).
 */
export function walkStops(input: FramingInput): WalkStop[] {
  const { wall } = input;
  const wc = wallCamera(input);
  const all = stopXs(wall).map((x): WalkStop => {
    const focus = nearestCabinet(wall, x);
    return { x, focus, whole: wholeCabinets({ ...wc.camera, x }, wall, wc.lookY) };
  });
  // a cabinet always stands whole at its own centre: its page fits it whole there
  return pickStops(all, wall.cabinets.length);
}

/**
 * Of the places a swipe may settle, left to right: those where at least WHOLE_MIN of the n cabinets stand whole (or
 * the most any does), the first and the last (the wall's ends), and, for a cabinet whole at none of those, the place
 * that stands it whole beside the most others (the first of those), if any does.
 */
function pickStops<T extends { readonly whole: readonly number[] }>(all: readonly T[], n: number): T[] {
  const need = Math.min(WHOLE_MIN, Math.max(...all.map((s) => s.whole.length)));
  const keep = new Set<T | undefined>(all.filter((s, k) => s.whole.length >= need || k === 0 || k === all.length - 1));
  for (let i = 0; i < n; i++) {
    if ([...keep].some((s) => s?.whole.includes(i))) continue;
    // none stands it whole: nothing to add
    keep.add(all.reduce<T | undefined>((best, s) => (s.whole.includes(i) && s.whole.length > (best?.whole.length ?? 0) ? s : best), undefined));
  }
  return all.filter((s) => keep.has(s));
}

/** The stop at `ats` index nearest `to` among those past `from` toward it; none (-1) when none lies that way. */
function nextStop(ats: readonly number[], from: number, to: number): number {
  let best = -1;
  ats.forEach((x, k) => {
    if ((x - from) * (to - from) > 0 && (best < 0 || Math.abs(x - to) < Math.abs(ats[best] - to))) best = k;
  });
  return best;
}

/** NOTE 30: a walk steps on to a stop only once the finger has moved this many px net, at the least. */
export const WALK_MIN_PX = 40;

/** How far (px) a finger must move net before the walk steps on: a quarter of the width the cabinet nearest the camera shows, at least WALK_MIN_PX. */
export function walkDeadPx(framing: Framing, wall: WallLayout): number {
  const { camera, look } = framing;
  const perPx = (camera.z - look[2]) / camera.focalPx;
  return Math.max(WALK_MIN_PX, wall.cabinets[nearestCabinet(wall, camera.x)].profile.outer.widthMm / 4 / perPx);
}

/**
 * CC4, camera mode, once a walk of dxPx from `walked` settles (Ross 12:1xC, desk MN2 a): the stop nearest where the
 * swipe walked the camera to, among those past where it started, so a short swipe still moves on a stop. None (the
 * picture stays) when the finger moved less than walkDeadPx net or no stop lies that way (the wall's end).
 */
export function settleWalk(walked: Framing, wall: WallLayout, stops: readonly WalkStop[], dxPx: number): WalkStop | null {
  if (Math.abs(dxPx) < walkDeadPx(walked, wall)) return null;
  const k = nextStop(
    stops.map((s) => s.x),
    walked.camera.x,
    swipeCamera(walked, wall, dxPx).camera.x,
  );
  return k < 0 ? null : stops[k];
}

/** A place a pan of the wall view settles (NOTE 31): the photo slid panPx, the cabinets it stands whole. */
export interface PanStop {
  readonly panPx: number;
  readonly whole: readonly number[];
}

/**
 * The stops of a wall view's pan (NOTE 31), left to right, as for a walk where the photo can slide to them: the
 * slides to the wall's two ends (panLimitsPx), and between them each slide that draws a walk stop's place (a
 * cabinet's centre or halfway between two) at the frame centre, picked as a walk's are (pickStops). Past the slide
 * the photo is retaken farther along (panFraming), which draws the line it aims along (the front plane at the look-at's
 * height, all at one depth) exactly where the slid photo would: so the cabinets whole there are those of the slid photo.
 */
export function panStops(framing: Framing, wall: WallLayout): PanStop[] {
  const { camera, look } = framing;
  const [lo, hi] = panLimitsPx(framing, wall);
  const between = stopXs(wall)
    .map((x) => camera.frame.width / 2 - project(camera, [x, look[1], 0]).x)
    .filter((p) => p > lo && p < hi);
  const all = [...new Set([lo, ...between, hi])]
    .sort((a, b) => a - b)
    .map((panPx): PanStop => ({ panPx, whole: wholeCabinets(camera, wall, look[1], panPx) }));
  return pickStops(all, wall.cabinets.length);
}

/**
 * CC4, pan mode, once a pan of dxPx from fromPan settles (NOTE 31): the stop nearest where the photo was slid to,
 * among those past where it started (past the wall's end, the end); none (the photo stays) when the finger moved less
 * than walkDeadPx net or no stop lies that way.
 */
export function settlePan(framing: Framing, wall: WallLayout, stops: readonly PanStop[], fromPan: number, dxPx: number): PanStop | null {
  if (Math.abs(dxPx) < walkDeadPx(panFraming(framing, fromPan).framing, wall)) return null;
  const k = nextStop(
    stops.map((s) => s.panPx),
    fromPan,
    fromPan + dxPx,
  );
  return k < 0 ? null : stops[k];
}

/**
 * The wall view as it opens on a page (Ross 12:1xC, desk MN2 a; close-out 3, ruling 27): centred on the page; where
 * fewer than WHOLE_MIN cabinets stand whole there, moved to the stop within the page (so no two pages open on one
 * camera) that keeps the whole page whole and stands the most whole, up to WHOLE_MIN (the nearest the centre of
 * those), if that is more. A stop nearest a cabinet of another page is not the page's (close-out 4, ruling 32): a
 * walk settling there pages from that cabinet's page, and Next would open the camera where it already stands.
 */
function standWhole(framing: Framing, wall: WallLayout, page: readonly number[]): Framing {
  const { camera, look } = framing;
  const here = wholeCabinets(camera, wall, look[1]).length;
  if (here >= WHOLE_MIN) return framing;
  const lo = wall.cabinets[page[0]].leftMm;
  const hi = wall.cabinets[page[page.length - 1]].rightMm;
  const ok = stopXs(wall)
    .filter((x) => x > lo && x < hi && page.includes(nearestCabinet(wall, x)))
    .map((x) => ({ x, whole: wholeCabinets({ ...camera, x }, wall, look[1]) }))
    .filter((s) => page.every((i) => s.whole.includes(i)));
  const most = Math.max(here, ...ok.map((s) => s.whole.length));
  if (most === here) return framing;
  const best = ok.filter((s) => s.whole.length >= Math.min(WHOLE_MIN, most));
  return atX(framing, best.reduce((a, b) => (Math.abs(b.x - camera.x) < Math.abs(a.x - camera.x) ? b : a)).x);
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

/**
 * CC4, pan mode: the photo slides at most until the frame's far edge looks
 * this far off the camera's axis (tan; 2 = 63 deg). Past it a photo of a
 * long wall is all shear: the frame looks through dozens of cabinets at a
 * graze, and drawing them all ran the phone's compositor out of tile memory
 * (MOB-NAV-1, Fold8).
 */
export const PAN_EDGE_TAN_MAX = 2;

/** CC4, pan mode: how far (CSS px) the picture itself may slide either way (PAN_EDGE_TAN_MAX). */
export function panSlideMaxPx(camera: Camera): number {
  return Math.max(0, camera.focalPx * PAN_EDGE_TAN_MAX - camera.frame.width / 2);
}

/**
 * CC4, pan mode: the picture for a pan of panPx (within panLimitsPx). Up to
 * panSlideMaxPx the photo slides and the camera stays; past it the photo is
 * retaken from farther along the wall, the camera and its aim moved by the
 * rest, so the line the camera aims along (the look point's height, on the
 * cabinets' front) still draws exactly where the slid photo would put it.
 */
export function panFraming(framing: Framing, panPx: number): { framing: Framing; panPx: number } {
  const max = framing.slideMaxPx ?? panSlideMaxPx(framing.camera);
  const slid = Math.min(max, Math.max(-max, panPx));
  if (slid === panPx) return { framing, panPx };
  const { camera, look } = framing;
  const dx = ((slid - panPx) * project(camera, look).depth) / camera.focalPx;
  return { framing: { ...framing, camera: { ...camera, x: camera.x + dx }, look: [look[0] + dx, look[1], look[2]] }, panPx: slid };
}

/**
 * CASE-FB3a item 3 (Ross 10-17): how far under the ceiling the camera stays at the top of its lift. At the ceiling's own
 * height the ceiling plane is edge-on, every point of it draws on the horizon, and the frame above the wall's top is
 * blank; under it, the ceiling is overhead and fills that band to the frame's top once the frame's top ray meets it past
 * the near plane (NEAR_MM, 10 mm: the ray meets it about twice the clearance along the axis on the Fold8's panels).
 * 50 mm leaves room.
 */
export const CEILING_CLEARANCE_MM = 50;

/**
 * CASE-FB1 item 5, camera mode: how far (mm) the camera may be raised (positive) or lowered with its aim, x, distance
 * and tilt kept, so that neither it nor the point it aims at on the cabinets' front leaves the floor..ceiling (the
 * camera staying CEILING_CLEARANCE_MM under the ceiling); never a range that moves it where it stands (a camera
 * already past a bound stays until it moves back).
 */
export function liftLimitsMm(framing: Framing, ceilingMm: number): [number, number] {
  const lo = Math.min(framing.camera.y, framing.look[1]);
  const up = Math.min(ceilingMm - CEILING_CLEARANCE_MM - framing.camera.y, ceilingMm - framing.look[1]);
  return [Math.min(0, -lo), Math.max(0, up)];
}

/** The lift (liftLimitsMm) nearest `liftMm` that stays within the floor..ceiling. */
export function clampLift(framing: Framing, ceilingMm: number, liftMm: number): number {
  const [lo, hi] = liftLimitsMm(framing, ceilingMm);
  return Math.min(hi, Math.max(lo, liftMm));
}

/**
 * The lift (mm) for an up/down drag of dyPx: a finger moving down raises the camera so the point it aims at draws
 * exactly dyPx lower (the picture follows the finger, as a walk does sideways). Infinity (either way) for a drag the
 * aim cannot follow (it would pass the horizon): as far as the limits allow.
 */
export function liftForDragMm(framing: Framing, dyPx: number): number {
  const { camera, look } = framing;
  const depth = project(camera, look).depth;
  const across = camera.focalPx * Math.cos(camera.pitch) - dyPx * Math.sin(camera.pitch);
  if (!(across > 0)) return dyPx > 0 ? Infinity : -Infinity;
  return (dyPx * depth) / across;
}

/** The framing with the camera and its aim raised liftMm (lowered when negative). */
export function lifted(framing: Framing, liftMm: number): Framing {
  if (liftMm === 0) return framing;
  const { camera, look } = framing;
  return { ...framing, camera: { ...camera, y: camera.y + liftMm }, look: [look[0], look[1] + liftMm, look[2]] };
}

/**
 * CASE-FB1 item 5, pan mode: how far (CSS px) the photo may slide up (negative) and down. Down until the ceiling over
 * the cabinets' front draws at the frame's top; up until the floor line under the feet's front draws at its bottom;
 * a bound already passed allows no slide that way.
 */
export function panYLimitsPx(framing: Framing, wall: WallLayout, ceilingMm: number): [number, number] {
  const { camera } = framing;
  const feet = Math.max(0, ...wall.cabinets.map((c) => c.profile.footprint?.frontOverhangMm ?? 0));
  const floorY = project(camera, [camera.x, 0, feet]).y;
  const ceilingY = project(camera, [camera.x, ceilingMm, 0]).y;
  return [Math.min(0, camera.frame.height - floorY), Math.max(0, -ceilingY)];
}

/** CASE-FB1 item 3: the room the cabinets stand in, as drawn: its back wall from the floor to the ceiling, its floor and ceiling out toward the viewer. */
export interface RoomBox {
  readonly x0: number;
  readonly x1: number;
  /** The ceiling (casePrefs.ceilingMm). */
  readonly y1: number;
  /** The back wall, 450 mm behind the deepest cabinet. */
  readonly zBack: number;
  /** How far toward the viewer the floor and ceiling run. */
  readonly zFront: number;
}

/** How far the room runs past each end of the wall, behind the deepest cabinet, and out from its back wall. */
const ROOM_SIDE_MM = 6000;
const ROOM_BACK_GAP_MM = 450;
const ROOM_DEPTH_MM = 6500;

export function roomBox(wall: WallLayout, ceilingMm: number): RoomBox {
  const zBack = -Math.max(...wall.cabinets.map((c) => c.profile.outer.depthMm)) - ROOM_BACK_GAP_MM;
  return { x0: wall.leftMm - ROOM_SIDE_MM, x1: wall.rightMm + ROOM_SIDE_MM, y1: ceilingMm, zBack, zFront: zBack + ROOM_DEPTH_MM };
}

/** The room the cabinets stand in, mm: floor to ceiling, the deepest back to the farthest front (splayed feet). */
export interface RoomSpan {
  readonly y0: number;
  readonly y1: number;
  readonly z0: number;
  readonly z1: number;
}

/**
 * The stretch of the wall (world x, mm) whose points can draw into the frame
 * when the picture is slid panPx: at depth d along the camera's axis the
 * frame spans x from camera.x + (-w/2 - pan) d / f to camera.x + (w/2 - pan) d / f,
 * so over the room's nearest and farthest depths (its corners; at least
 * 1 mm) the ends are reached at one of the two. Padded by marginMm for what
 * hangs past a cabinet's box (pictures' clear margins, plates, shadows).
 */
export function wallReachMm(camera: Camera, panPx: number, room: RoomSpan, marginMm: number): [number, number] {
  const sin = Math.sin(camera.pitch);
  const cos = Math.cos(camera.pitch);
  const depths = [room.y0, room.y1].flatMap((y) => [room.z0, room.z1].map((z) => (camera.y - y) * sin + (camera.z - z) * cos));
  const near = Math.max(1, Math.min(...depths));
  const far = Math.max(1, ...depths);
  const left = (-camera.frame.width / 2 - panPx) / camera.focalPx;
  const right = (camera.frame.width / 2 - panPx) / camera.focalPx;
  return [camera.x + Math.min(left * near, left * far) - marginMm, camera.x + Math.max(right * near, right * far) + marginMm];
}

/** The wall's cabinets (by index) whose box, splayed feet included, reaches into the stretch [lo, hi] (wallReachMm). */
export function cabinetsInReach(wall: WallLayout, [lo, hi]: readonly [number, number]): number[] {
  return wall.cabinets.flatMap((slot, i) => {
    const feet = sideOverhangMm(slot.profile);
    return slot.rightMm + feet >= lo && slot.leftMm - feet <= hi ? [i] : [];
  });
}


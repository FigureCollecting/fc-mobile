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
 *
 * MOB-NAV-2 (Ross 12:1xC: at least 3 full and 2 partial, up to 5 full, on
 * every panel): no view frames the fronts of more cabinets than the case
 * draws (MAX_DRAWN_CABINETS), wherever the camera walks or the photo slides.
 * On a wide or short panel, where the fit would show more, the camera steps
 * in along its line of sight until the frame spans no more of the fronts
 * than the narrowest run from a cabinet to the fifth after it (capSpanMm),
 * and the photo slides no farther than keeps it so; the cabinets' tops and
 * feet may then run past the frame.
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
import { MAX_DRAWN_CABINETS, NEAR_MM, clipConvex } from './caseCull';

/** CC4b: how far past the width fit the camera may step back at a cabinet's top. */
export const STEP_BACK_MAX_MM = 3 * IN_MM;
/** Two pages fit "at the same distance" within this much. */
const SAME_DISTANCE_MM = 1;
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
 * The longest stretch of the wall a frame may show and still show the fronts of no more than MAX_DRAWN_CABINETS
 * cabinets wherever along it it stands: short of the narrowest run between a cabinet and the one
 * MAX_DRAWN_CABINETS after it (splayed feet included), which a stretch must span to touch both. Infinity on a wall
 * of no more.
 */
export function capSpanMm(wall: WallLayout): number {
  const boxes = wall.cabinets.map((slot) => cabinetBox(slot, 0));
  let span = Infinity;
  for (let i = 0; i + MAX_DRAWN_CABINETS < boxes.length; i++) span = Math.min(span, boxes[i + MAX_DRAWN_CABINETS].x0 - boxes[i].x1);
  return span - CAP_SLACK_MM;
}

/** What every framing of one wall shares: the cabinets' fronts (floor to the highest headroom) and the longest stretch of them a frame may show. */
interface WallCap {
  readonly fronts: RoomSpan;
  readonly span: number;
}

function wallCap(input: FramingInput): WallCap {
  const room = roomSpan(input.wall, input.headroomMm);
  return { fronts: { y0: room.y0, y1: room.y1, z0: 0, z1: 0 }, span: capSpanMm(input.wall) };
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

/** The tilted CC15 framing of these cabinets: aimed at the middle of the tallest, centred on their bodies, stepped in to the cap. */
function fitCabinets(input: FramingInput, members: readonly number[], cap: WallCap): Framing {
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
  const camY = startCameraY(look[1]);
  const { distance, camera } = fitDistance({
    frame: input.frame,
    camY,
    look,
    tilt: true,
    corners: boxCorners(union.x0, union.x1, union.y0, union.y1, union.z0, union.z1),
    lensMm: input.lensMm,
  });
  // stepping in along the line of sight: the camera keeps its tilt and nears the look-at
  const at = (d: number): Camera => ({ ...camera, y: look[1] + ((camY - look[1]) * d) / distance, z: look[2] + d });
  const d = capDistance(at, distance, cap);
  return { camera: d === distance ? camera : at(d), look, page: members };
}

/**
 * Whether these cabinets' bodies stand whole across the frame at the height it aims at, back to front, inside its
 * side margins (a capped frame may cut their tops and feet).
 */
function standAcross(framing: Framing, input: FramingInput, members: readonly number[]): boolean {
  const { camera, look } = framing;
  const m = frameMargins(camera.frame);
  return members.every((i) => {
    const slot = input.wall.cabinets[i];
    return [slot.leftMm, slot.rightMm].every((x) =>
      [-slot.profile.outer.depthMm, 0].every((z) => {
        const p = project(camera, [x, look[1], z]);
        return p.depth > NEAR_MM && p.x >= m.x - SAME_PX && p.x <= camera.frame.width - m.x + SAME_PX;
      }),
    );
  });
}

const distanceOf = (f: Framing) => f.camera.z - f.look[2];

/**
 * The wall cut into pages left to right: each page takes the next cabinet
 * while the page still fits no farther back than its farthest single
 * cabinet needs (so a narrow screen pages one cabinet at a time) and, where
 * the cap steps the camera in, still stands whole across the frame; and
 * holds no more than the case draws at a time (MAX_DRAWN_CABINETS).
 */
export function wallPages(input: FramingInput): number[][] {
  const n = input.wall.cabinets.length;
  const cap = wallCap(input);
  const single = Array.from({ length: n }, (_, i) => distanceOf(fitCabinets(input, [i], cap)));
  const pages: number[][] = [];
  let i = 0;
  while (i < n) {
    const page = [i];
    let limit = single[i];
    let j = i + 1;
    while (j < n && page.length < MAX_DRAWN_CABINETS) {
      const nextLimit = Math.max(limit, single[j]);
      const grown = fitCabinets(input, [...page, j], cap);
      if (distanceOf(grown) > nextLimit + SAME_DISTANCE_MM || !standAcross(grown, input, [...page, j])) break;
      page.push(j);
      limit = nextLimit;
      j++;
    }
    pages.push(page);
    i = j;
  }
  return pages;
}

function frameShelf(input: FramingInput, focus: number, cap: WallCap): Framing {
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
  const fit = s.isTop ? Math.max(widthFit, Math.min(heightFit, widthFit + STEP_BACK_MAX_MM)) : Math.max(widthFit, heightFit);
  const at = (d: number): Camera => ({ x: look[0], y: look[1], z: look[2] + d, pitch: 0, focalPx, frame: input.frame });
  return { camera: at(capDistance(at, fit, cap)), look, page: [focus] };
}

/** The camera for the view, the focus cabinet and (in the shelf view) its surface. */
export function frameCase(input: FramingInput): Framing {
  const n = input.wall.cabinets.length;
  if (n === 0) throw new RangeError('frameCase needs at least one cabinet on the wall');
  const focus = Math.min(Math.max(0, Math.trunc(input.focus)), n - 1);
  const cap = wallCap(input);
  if (input.view === 'shelf') return withSlide(frameShelf(input, focus, cap), cap);
  if (input.view === 'cabinet') return withSlide(fitCabinets(input, [focus], cap), cap);
  const page = wallPages(input).find((p) => p.includes(focus)) as number[];
  return withSlide(standWhole(fitCabinets(input, page, cap), input.wall, page), cap);
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
 * the scene shows it once settled: from its focus cabinet's page distance. The stops are those where at least
 * WHOLE_MIN cabinets stand whole (on a wall where none does, the most any does); the wall's two ends, where a swipe
 * stops (the first and the last cabinet's centre); and, for a cabinet whole at none of those, the stop that stands it
 * whole beside the most others (reachability wins over the count).
 */
export function walkStops(input: FramingInput): WalkStop[] {
  const { wall } = input;
  const cap = wallCap(input);
  const pages = wallPages(input);
  const fits = pages.map((page) => fitCabinets(input, page, cap));
  const all = stopXs(wall).map((x): WalkStop => {
    const focus = nearestCabinet(wall, x);
    const fit = fits[pages.findIndex((p) => p.includes(focus))];
    return { x, focus, whole: wholeCabinets({ ...fit.camera, x }, wall, fit.look[1]) };
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
 * the photo is retaken farther along (panFraming), which keeps the line it aims along where the slid photo draws it.
 */
export function panStops(framing: Framing, wall: WallLayout): PanStop[] {
  const { camera, look } = framing;
  const [lo, hi] = panLimitsPx(framing, wall);
  const between = stopXs(wall)
    .map((x) => camera.frame.width / 2 - project(camera, [x, look[1], 0]).x)
    .filter((p) => p > lo && p < hi);
  const all = [...new Set([lo, ...between, hi])].sort((a, b) => a - b).map((panPx): PanStop => {
    const r = panFraming(framing, panPx);
    return { panPx, whole: wholeCabinets(r.framing.camera, wall, look[1], r.panPx) };
  });
  return pickStops(all, wall.cabinets.length);
}

/**
 * CC4, pan mode, once a pan of dxPx from fromPan settles (NOTE 31): the stop nearest where the photo was slid to
 * (within its limits), among those past where it started; none (the photo stays) when the finger moved less than
 * walkDeadPx net or no stop lies that way.
 */
export function settlePan(framing: Framing, wall: WallLayout, stops: readonly PanStop[], fromPan: number, dxPx: number): PanStop | null {
  if (Math.abs(dxPx) < walkDeadPx(panFraming(framing, fromPan).framing, wall)) return null;
  const to = Math.min(stops[stops.length - 1].panPx, Math.max(stops[0].panPx, fromPan + dxPx));
  const k = nextStop(
    stops.map((s) => s.panPx),
    fromPan,
    to,
  );
  return k < 0 ? null : stops[k];
}

/**
 * The wall view as it opens on a page (Ross 12:1xC, desk MN2 a; close-out 3, ruling 27): centred on the page; where
 * fewer than WHOLE_MIN cabinets stand whole there, moved to the stop within the page (so no two pages open on one
 * camera) that keeps the whole page whole and stands the most whole, up to WHOLE_MIN (the nearest the centre of
 * those), if that is more.
 */
function standWhole(framing: Framing, wall: WallLayout, page: readonly number[]): Framing {
  const { camera, look } = framing;
  const here = wholeCabinets(camera, wall, look[1]).length;
  if (here >= WHOLE_MIN) return framing;
  const lo = wall.cabinets[page[0]].leftMm;
  const hi = wall.cabinets[page[page.length - 1]].rightMm;
  const ok = stopXs(wall)
    .filter((x) => x > lo && x < hi)
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


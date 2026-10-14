/**
 * What the case draws (MOB-NAV-2, Ross 2026-10-13: "realistically, we could
 * limit to probably 4 or 5 cabinets drawn at a time"). Chrome rasters every
 * face of the scene, a layer under a perspective, at no less than the
 * device pixel ratio per element pixel and well past what shows, so the
 * phone's GPU tile budget is spent by what the DOM holds, not by what the
 * screen shows: the Fold8 ghosted its whole chrome when the case held some
 * hundred viewports of faces. So the case draws at most five cabinets, the
 * ones nearest the frame centre; inside them only what draws into the frame
 * and half a viewport round it (each face cut to it, nothing hidden under a
 * board); every face at the px per mm the screen shows it; and it re-culls
 * on a camera change, the margin absorbing small moves. Pure maths, no DOM.
 */
import { project, unprojectToPlaneZ, type Camera, type Frame, type Vec3 } from './caseCamera';
import type { RoomSpan } from './caseFraming';
import { sideOverhangMm } from './cabinetProfile';
import type { WallLayout, WallSlot } from './packCabinets';

/** Ross 2026-10-13: the most cabinets drawn at a time (and so on one wall page). */
export const MAX_DRAWN_CABINETS = 5;
/** What the case draws past the frame on each side, as a share of the frame: half a viewport. */
export const CULL_MARGIN = 0.5;
/** A drawn cabinet keeps its place until another draws nearer the frame centre by this share of the frame width. */
export const CABINET_HYSTERESIS = 0.1;
/** The case re-culls once the picture has moved this share of the frame width since it last did (half the margin). */
export const RECULL_SHARE = 0.25;
/** Nothing nearer the camera than this (mm along its axis) is drawn. */
export const NEAR_MM = 10;
/** The coarsest px per mm a face is drawn at. */
const TEXEL_SCALE_MIN = 1 / 64;
/** Ross 2026-10-12 (12:2xC): the most figures drawn at a time. */
export const MAX_DRAWN_FIGURES = 250;
/**
 * What the figures' layers may cost together, element px, as a share of the frame's area: their pictures, at the
 * scene's px per mm, are what fills the tile budget (a 35 mm figure's picture is some 150 mm wide), and stepping the
 * camera in raises that px per mm; the faces, on their texel grids, cost a fraction of a viewport.
 */
export const FIGURE_BUDGET_VIEWPORTS = 1.5;

/** A face's own element size in px, when it is not its size in the world at the scene's px per mm. */
export interface TexelGrid {
  readonly u: number;
  readonly v: number;
}

/**
 * A face of one flat colour (steel, wood, a rod, a glass edge or fill) looks the same at any resolution, so it is
 * drawn on this grid and its matrix stretches it onto the face: it costs 16 px whatever its size or slant.
 */
export const FLAT_GRID: TexelGrid = { u: 4, v: 4 };
/** A face of a smooth gradient (a contact shadow, a rack's board): this grid, stretched the same way. */
export const GRADIENT_GRID: TexelGrid = { u: 16, v: 16 };

/** A picture: the camera and how far (CSS px) the drawn photo is slid (CC4 pan). */
export interface CullView {
  readonly camera: Camera;
  readonly panPx: number;
}

/** A rectangle in the frame's CSS px. */
export interface Rect {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

/** The part [s0, s1] x [t0, t1] of a face a + s u + t v (s, t in [0, 1]). */
export interface Trim {
  readonly s0: number;
  readonly s1: number;
  readonly t0: number;
  readonly t1: number;
}

/** The frame and `margin` of its size round it. */
export function cullRect(frame: Frame, margin: number = CULL_MARGIN): Rect {
  return { x0: -frame.width * margin, x1: frame.width * (1 + margin), y0: -frame.height * margin, y1: frame.height * (1 + margin) };
}

/**
 * The conditions (each >= 0) for a world point to draw inside `rect`, in front of the near plane: affine in the
 * point, as the camera's frustum planes are planes.
 */
function frustum(view: CullView, rect: Rect): ((p: Vec3) => number)[] {
  const { camera, panPx } = view;
  const sin = Math.sin(camera.pitch);
  const cos = Math.cos(camera.pitch);
  const f = camera.focalPx;
  const cx = camera.frame.width / 2 + panPx;
  const cy = camera.frame.height / 2;
  const parts = (p: Vec3) => {
    const dx = p[0] - camera.x;
    const dy = p[1] - camera.y;
    const dz = p[2] - camera.z;
    return { dx, up: dy * cos - dz * sin, depth: -dy * sin - dz * cos };
  };
  return [
    (p) => parts(p).depth - NEAR_MM,
    (p) => {
      const q = parts(p);
      return f * q.dx + (cx - rect.x0) * q.depth;
    },
    (p) => {
      const q = parts(p);
      return (rect.x1 - cx) * q.depth - f * q.dx;
    },
    (p) => {
      const q = parts(p);
      return (cy - rect.y0) * q.depth - f * q.up;
    },
    (p) => {
      const q = parts(p);
      return f * q.up + (rect.y1 - cy) * q.depth;
    },
  ];
}

type St = readonly [number, number];

/** Sutherland-Hodgman: the part of a convex polygon where the affine l(s, t) >= 0. */
export function clipConvex(poly: readonly St[], l: (s: number, t: number) => number): St[] {
  const out: St[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const lp = l(p[0], p[1]);
    const lq = l(q[0], q[1]);
    if (lp >= 0) out.push(p);
    if (lp >= 0 !== lq >= 0) {
      const k = lp / (lp - lq);
      out.push([p[0] + k * (q[0] - p[0]), p[1] + k * (q[1] - p[1])]);
    }
  }
  return out;
}

const at = (a: Vec3, u: Vec3, v: Vec3, s: number, t: number): Vec3 => [a[0] + s * u[0] + t * v[0], a[1] + s * u[1] + t * v[1], a[2] + s * u[2] + t * v[2]];

/**
 * The part of the flat face a + s u + t v that draws inside `rect` in front of the near plane: the face cut by
 * the camera's frustum through `rect` (exact, the planes meeting the face in lines), as the bounding box of what
 * is left in (s, t); null when nothing of it does.
 */
export function trimFace(view: CullView, a: Vec3, u: Vec3, v: Vec3, rect: Rect): Trim | null {
  let poly: St[] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  for (const plane of frustum(view, rect)) {
    const l0 = plane(a);
    const ls = plane(at(a, u, v, 1, 0)) - l0;
    const lt = plane(at(a, u, v, 0, 1)) - l0;
    poly = clipConvex(poly, (s, t) => l0 + s * ls + t * lt);
    if (poly.length === 0) return null;
  }
  const ss = poly.map((p) => p[0]);
  const ts = poly.map((p) => p[1]);
  const s0 = Math.max(0, Math.min(...ss));
  const s1 = Math.min(1, Math.max(...ss));
  const t0 = Math.max(0, Math.min(...ts));
  const t1 = Math.min(1, Math.max(...ts));
  if (!(s1 > s0) || !(t1 > t0)) return null;
  return { s0, s1, t0, t1 };
}

/**
 * The cabinets drawn (by wall index, ascending): at most `cap`, those whose box (floor to top, back to the
 * front of the feet) draws nearest the frame centre: first every one whose front (feet to top, on the front
 * plane) the frame shows, then every other one it shows (seen through the glass at its edge), then the rest, each
 * by how far its span on screen lies from the centre, then by its middle. One drawn before counts `hysteresis` of
 * the frame width nearer, so a small move never swaps two cabinets back and forth. One behind the camera comes
 * last.
 */
export function nearestCabinets(
  view: CullView,
  wall: WallLayout,
  previous: readonly number[],
  cap: number = MAX_DRAWN_CABINETS,
  hysteresis: number = CABINET_HYSTERESIS,
): number[] {
  const { camera, panPx } = view;
  const kept = new Set(previous);
  const bonus = hysteresis * camera.frame.width;
  const centre = camera.frame.width / 2;
  const frame = { x0: 0, x1: camera.frame.width, y0: 0, y1: camera.frame.height };
  const ranked = wall.cabinets.map((slot, i) => {
    const p = slot.profile;
    const feet = sideOverhangMm(p);
    const xs: number[] = [];
    for (const x of [slot.leftMm - feet, slot.rightMm + feet]) {
      for (const y of [0, p.outer.heightMm]) {
        for (const z of [-p.outer.depthMm, p.footprint?.frontOverhangMm ?? 0]) {
          const q = project(camera, [x, y, z]);
          if (q.depth > NEAR_MM) xs.push(q.x + panPx);
        }
      }
    }
    if (xs.length === 0) return { i, front: false, shown: false, d: Infinity, mid: Infinity };
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const shown = x1 >= 0 && x0 <= camera.frame.width;
    const front = shown && trimFace(view, [slot.leftMm - feet, 0, 0], [slot.rightMm - slot.leftMm + 2 * feet, 0, 0], [0, p.outer.heightMm, 0], frame) !== null;
    const off = x1 < centre ? centre - x1 : x0 > centre ? x0 - centre : 0;
    return { i, front, shown, d: kept.has(i) ? off - bonus : off, mid: Math.abs((x0 + x1) / 2 - centre) };
  });
  ranked.sort((x, y) => Number(y.front) - Number(x.front) || Number(y.shown) - Number(x.shown) || x.d - y.d || x.mid - y.mid || x.i - y.i);
  return ranked
    .slice(0, cap)
    .map((r) => r.i)
    .sort((x, y) => x - y);
}

/**
 * The picture the case culls for: the last one it culled for while the new one only walks the camera along the
 * wall or slides the photo by less than `share` of the frame width (the margin still covers the frame), else
 * the new one.
 */
export function stickyView(previous: CullView | null, next: CullView, share: number = RECULL_SHARE): CullView {
  if (previous === null) return next;
  const a = previous.camera;
  const b = next.camera;
  if (a.y !== b.y || a.z !== b.z || a.pitch !== b.pitch || a.focalPx !== b.focalPx || a.frame.width !== b.frame.width || a.frame.height !== b.frame.height) {
    return next;
  }
  // the point on the cabinets' front the old picture drew at the frame centre, and how far the new one moved it
  const centre = unprojectToPlaneZ(a, a.frame.width / 2 - previous.panPx, a.frame.height / 2, 0);
  if (centre === null) return next;
  const moved = project(b, centre).x + next.panPx - b.frame.width / 2;
  return Math.abs(moved) < share * b.frame.width ? previous : next;
}

/**
 * The px per mm the faces are drawn at: what the screen shows at the nearest point of `span` (the cabinets'
 * room: floor to headroom, back to the front of their feet), rounded up to a quarter octave so a camera
 * walking the wall keeps it and nothing is drawn coarser than it shows; at most 1 (the world's own mm), at
 * least 1/64.
 */
export function texelScale(camera: Camera, span: RoomSpan): number {
  const sin = Math.sin(camera.pitch);
  const cos = Math.cos(camera.pitch);
  const depths = [span.y0, span.y1].flatMap((y) => [span.z0, span.z1].map((z) => (camera.y - y) * sin + (camera.z - z) * cos));
  const nearest = Math.max(NEAR_MM, Math.min(...depths));
  const shown = camera.focalPx / nearest;
  if (shown >= 1) return 1;
  return Math.max(TEXEL_SCALE_MIN, 2 ** (Math.ceil(4 * Math.log2(shown)) / 4));
}

/** An opaque horizontal board: x0..x1 along the wall, z0..z1 back to front, its underside y0 and its top y1. */
export interface Board {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly z0: number;
  readonly z1: number;
}

/**
 * Whether the board hides the flat figure with these corners from the camera: the camera above the board and
 * the figure under it (or the camera under it and the figure above), every ray from the camera to a corner
 * through the board's face. Exact for a flat convex figure: what the rays to its corners meet bounds what the
 * rays to all of it do.
 */
export function hiddenUnder(camera: Camera, corners: readonly Vec3[], board: Board): boolean {
  const above = camera.y > board.y1;
  const below = camera.y < board.y0;
  if (!above && !below) return false;
  const face = above ? board.y1 : board.y0;
  return corners.every((p) => {
    if (above ? p[1] > board.y0 : p[1] < board.y1) return false;
    const t = (camera.y - face) / (camera.y - p[1]);
    const x = camera.x + t * (p[0] - camera.x);
    const z = camera.z + t * (p[2] - camera.z);
    return x >= board.x0 && x <= board.x1 && z >= board.z0 && z <= board.z1;
  });
}

/** A cabinet's opaque boards (wood shelves and tops, a rack's boards): what may hide a figure under or over it. */
export function opaqueBoards(slot: WallSlot): Board[] {
  const p = slot.profile;
  const D = p.outer.depthMm;
  if (p.frame === 'open-rack') {
    const post = p.rack?.postMm ?? 38;
    return p.surfaces.map((x) => ({ x0: slot.leftMm + post / 2, x1: slot.rightMm - post / 2, y0: x.topMm - x.thicknessMm, y1: x.topMm, z0: -D + post / 2, z1: -post / 2 }));
  }
  return p.surfaces
    .filter((x) => x.material === 'wood')
    .map((x) => ({ x0: slot.leftMm, x1: slot.rightMm, y0: x.topMm - x.thicknessMm, y1: x.topMm, z0: -D, z1: 0 }));
}

/** A figure as the cull sees it: its cabinet (wall index) and the flat box it stands in (x0..x1, y0..y1 at z). */
export interface FigureBox {
  readonly cab: number;
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly z: number;
  /** What else the figure draws at its px per mm (its name plate, SHOULD 29), mm2: it spends the same budget. */
  readonly plateMm2?: number;
}

/** The figures (their indices) nearest the frame centre on screen first, by their box's middle; one behind the camera last. */
export function byFrameCentre(view: CullView, figures: readonly FigureBox[]): number[] {
  const { camera, panPx } = view;
  const d = figures.map((f) => {
    const q = project(camera, [(f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2, f.z]);
    return q.depth > NEAR_MM ? Math.hypot(q.x + panPx - camera.frame.width / 2, q.y - camera.frame.height / 2) : Infinity;
  });
  return figures.map((_, i) => i).sort((a, b) => d[a] - d[b] || a - b);
}

/**
 * The figures drawn (their indices in `figures`, ascending): those of a drawn cabinet whose box draws into `rect`
 * and that no board of their cabinet hides from the camera, at most `cap` of them, the nearest the frame centre;
 * and how many a board hid.
 */
export function figuresToDraw(
  view: CullView,
  rect: Rect,
  figures: readonly FigureBox[],
  drawn: ReadonlySet<number>,
  boards: (cab: number) => readonly Board[],
  cap: number = MAX_DRAWN_FIGURES,
): { shown: number[]; hidden: number } {
  const shown: number[] = [];
  let hidden = 0;
  figures.forEach((f, i) => {
    if (!drawn.has(f.cab)) return;
    if (!trimFace(view, [f.x0, f.y0, f.z], [f.x1 - f.x0, 0, 0], [0, f.y1 - f.y0, 0], rect)) return;
    const corners: Vec3[] = [
      [f.x0, f.y0, f.z],
      [f.x1, f.y0, f.z],
      [f.x0, f.y1, f.z],
      [f.x1, f.y1, f.z],
    ];
    if (boards(f.cab).some((b) => hiddenUnder(view.camera, corners, b))) {
      hidden++;
      return;
    }
    shown.push(i);
  });
  if (shown.length <= cap) return { shown, hidden };
  const nearest = byFrameCentre(view, shown.map((i) => figures[i])).slice(0, cap);
  return { shown: nearest.map((k) => shown[k]).sort((a, b) => a - b), hidden };
}

/**
 * The px per mm each figure is drawn at, so that together they cost at most `budgetPx` element px (each its box's
 * area and its name plate's at its px per mm), wherever the camera stands: the nearest the frame centre first
 * (byFrameCentre), each at the scene's `s` while the budget holds, then a whole octave coarser at a time, never finer
 * than a nearer one, down to the coarsest a face is drawn at; one the budget cannot hold even there is drawn there
 * all the same.
 */
export function figureScales(view: CullView, figures: readonly FigureBox[], s: number, budgetPx: number): number[] {
  const scales: number[] = new Array<number>(figures.length);
  let octave = 0;
  let spent = 0;
  for (const i of byFrameCentre(view, figures)) {
    const f = figures[i];
    const area = (f.x1 - f.x0) * (f.y1 - f.y0) + (f.plateMm2 ?? 0);
    while (s / 2 ** (octave + 1) >= TEXEL_SCALE_MIN && spent + area * (s / 2 ** octave) ** 2 > budgetPx) octave++;
    scales[i] = s / 2 ** octave;
    spent += area * scales[i] ** 2;
  }
  return scales;
}

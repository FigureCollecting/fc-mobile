/**
 * NAV-1A (b), Ross 10-28: what the Free camera's scene would cost the GPU at a pose, before it is drawn there, so a look
 * stops short of the scene's ceiling where holding the sharpness the turn left yaw 0 at (freeTexelScale, a) is not
 * enough. Chrome gives every composited scene layer its own element px (e2e/case-free-camera's budget, read layer by
 * layer against the DOM: a figure its tap box at its px per mm, its contact shadow 16 x 16, a mesh shelf its trimmed area
 * at the mesh's px per mm, the room's faces 64 x 256, every other face of a cabinet a few px, the scene's controls a little),
 * so the projection is those, summed for what the cull at that pose would draw (the same pure rules the scene draws
 * by), over the screen. NAV-DOLLY (Ross 11-22): the projection also picks the px per mm the scene is drawn at there
 * (sceneFit: coarser where what the eye asks would pass the ceiling), so the camera is not stopped for the budget.
 * Pure maths, no DOM.
 */
import type { Camera, Vec3 } from './caseCamera';
import { frameCap, type RoomSpan } from './caseFraming';
import {
  FIGURE_BUDGET_VIEWPORTS,
  GRADIENT_GRID,
  TEXEL_SCALE_MIN,
  cullRect,
  figureCap,
  figureScales,
  figuresToDraw,
  freeTexelScale,
  nearestCabinets,
  trimFace,
  type Board,
  type FigureBox,
} from './caseCull';
import type { WallLayout, WallSlot } from './packCabinets';

/** The most the scene's composited layers may cost, in viewports of the screen's pixels (e2e/case-budget). */
export const SCENE_CEILING_VIEWPORTS = 3;

/** NAV-1A (b): a projected cost fits the ceiling at it or under it. */
export function fitsCeiling(vp: number): boolean {
  return vp <= SCENE_CEILING_VIEWPORTS;
}
/**
 * The scene's own controls (Reset, the look ring; NAV-JOG retired the Free camera's arrows), in viewports: measured on
 * the Fold8's four panels at the hard yaw (e2e/case-free-camera's budget, layer by layer), at most 0.293 (the ring).
 */
export const CONTROLS_VIEWPORTS = 0.3;
/**
 * A drawn cabinet's faces on their texel grids (steel, wood, glass edges, a rack's boards), px: at most this, whatever
 * of it the frame shows (the KLINGSBO draws some 80 faces of 16 px).
 */
export const CABINET_FACES_PX = 2048;
/** A figure's contact shadow, on its gradient grid. */
export const SHADOW_PX = GRADIENT_GRID.u * GRADIENT_GRID.v;
/**
 * NAV-DOLLY (Ross 11-22): the most the open mesh shelves may cost together, in viewports. Close in and below the
 * framing's height the KLINGSBO's mesh shelves alone cost 1.7 viewports of the Fold8's cover at the scene's px per mm,
 * which took the walk in over the ceiling 450 mm short of the doors; a flat pattern, they are drawn coarser first.
 */
export const MESH_BUDGET_VIEWPORTS = 0.6;

/** A figure as the scene draws it: its layer box (figureLayerBox, the figures' budget), its tap box's width and its plate. */
export interface BudgetFigure extends FigureBox {
  /** The tap box's width (mm): the figure's layer is it by its height (y1 - y0) at its px per mm. */
  readonly tapMm: number;
  /** Its name plate where labels are on, a layer of its own at the figure's px per mm. */
  readonly plate: { readonly a: Vec3; readonly u: Vec3; readonly v: Vec3 } | null;
}

/** What the projection needs of the scene: its wall, framing and figures (listed only when a pose is first asked). */
export interface BudgetScene {
  /** The cabinets' room (floor to headroom, back to the front of their feet): texelScale's span (freeTexelScale). */
  readonly span: RoomSpan;
  readonly wall: WallLayout;
  readonly fronts: RoomSpan;
  /** The framing's drawn cap, which frameCap raises for a turned frame. */
  readonly cap: number;
  /** What each cabinet holds, and its kind (figureCap). */
  readonly counts: readonly number[];
  readonly kinds: readonly string[];
  readonly boards: (cab: number) => readonly Board[];
  readonly figures: () => readonly BudgetFigure[];
  /** The room's faces (a, u, v), each `roomFacePx` drawn. */
  readonly room: readonly (readonly [Vec3, Vec3, Vec3])[];
  readonly roomFacePx: number;
  /** The screen's px (CSS): what a viewport of the ceiling is. */
  readonly viewportPx: number;
}

/** What a pose's scene costs, element px by kind, and what it draws. */
export interface SceneCost {
  /** The px per mm the scene is drawn at there (sceneCost's fit). */
  readonly s: number;
  /** The px per mm its open mesh shelves are drawn at: `s`, or whole octaves under it (meshScale). */
  readonly meshS: number;
  readonly drawn: readonly number[];
  readonly figuresDrawn: number;
  readonly figures: number;
  readonly shadows: number;
  readonly mesh: number;
  readonly room: number;
  readonly faces: number;
}

const len = (u: Vec3) => Math.hypot(u[0], u[1], u[2]);

/** The faces a cabinet draws at the scene's px per mm, off any grid: its open mesh shelves (CabinetScene's Surfaces). */
export function meshFaces(slot: WallSlot): [Vec3, Vec3, Vec3][] {
  const p = slot.profile;
  if (p.frame === 'open-rack') return [];
  const D = p.outer.depthMm;
  const post = p.panels.sideMm;
  const last = p.surfaces.length - 1;
  const ix0 = slot.leftMm + post;
  const ix1 = slot.rightMm - post;
  return p.surfaces.flatMap((s, i): [Vec3, Vec3, Vec3][] => {
    if (i === last || s.material === 'wood' || (s.plate && p.plate)) return [];
    if (!s.outsideDoor && s.material === 'glass') return [];
    return [[[ix0, s.topMm, -D + post], [ix1 - ix0, 0, 0], [0, 0, D - 2 * post]]];
  });
}

/**
 * The element px of what the scene would draw with the camera at this pose, unzoomed and unswiped: the cull's cabinets
 * (frameCap's nearest), their figures (figuresToDraw, figureScales at the scene's px per mm: sceneFit's, from what the
 * eye asks, held from `unturned`, where the turn left yaw 0: freeTexelScale), every figure's shadow, its plate where it
 * draws, each side of a figure's or plate's layer rounded up to whole px; the mesh shelves' trimmed area at their own px
 * per mm (meshScale); the room's faces in view; CABINET_FACES_PX a cabinet.
 */
export function sceneCost(camera: Camera, scene: BudgetScene, figures: readonly BudgetFigure[], unturned?: Camera): SceneCost {
  return sceneFit(camera, scene, figures, unturned).cost;
}

/** A pose's projected cost: in viewports of the screen, its controls included, and its parts. */
export interface Projected {
  readonly vp: number;
  readonly cost: SceneCost;
}

/** What the cull at a pose draws, whatever px per mm it is drawn at. */
interface Culled {
  readonly view: { readonly camera: Camera; readonly panPx: number };
  readonly drawn: readonly number[];
  readonly boxes: readonly (BudgetFigure & { readonly plateMm2: number })[];
  readonly plates: readonly (BudgetFigure['plate'] | null)[];
  /** The mesh shelves' trimmed area, mm2. */
  readonly meshMm2: number;
  readonly room: number;
}

function cullOf(camera: Camera, scene: BudgetScene, figures: readonly BudgetFigure[]): Culled {
  const view = { camera, panPx: 0 };
  const rect = cullRect(camera.frame);
  const drawn = nearestCabinets(view, scene.wall, [], frameCap(camera, scene.wall, scene.fronts, scene.cap));
  const set = new Set(drawn);
  const inDrawn = figures.filter((f) => set.has(f.cab));
  const { shown } = figuresToDraw(view, rect, inDrawn, set, scene.boards, figureCap(scene.counts, scene.kinds, drawn));
  const plates = shown.map((i) => {
    const p = inDrawn[i].plate;
    return p && trimFace(view, p.a, p.u, p.v, rect) ? p : null;
  });
  const boxes = shown.map((i, n) => ({ ...inDrawn[i], plateMm2: plates[n] ? len(plates[n].u) * len(plates[n].v) : 0 }));
  let meshMm2 = 0;
  for (const i of drawn) {
    for (const [a, u, v] of meshFaces(scene.wall.cabinets[i])) {
      const cut = trimFace(view, a, u, v, rect);
      if (cut) meshMm2 += len(u) * (cut.s1 - cut.s0) * len(v) * (cut.t1 - cut.t0);
    }
  }
  const room = scene.room.filter(([a, u, v]) => trimFace(view, a, u, v, rect) !== null).length * scene.roomFacePx;
  return { view, drawn, boxes, plates, meshMm2, room };
}

/** What `c` costs drawn at `s` px per mm: the mesh shelves at meshScale's, within their budget and what the rest leaves under the ceiling. */
function costOf(c: Culled, scene: BudgetScene, s: number): Projected {
  const { frame } = c.view.camera;
  const scales = figureScales(c.view, c.boxes, s, FIGURE_BUDGET_VIEWPORTS * frame.width * frame.height);
  let figures = 0;
  c.boxes.forEach((f, n) => {
    const k = scales[n];
    figures += Math.ceil(f.tapMm * k) * Math.ceil((f.y1 - f.y0) * k);
    const p = c.plates[n];
    if (p) figures += Math.ceil(len(p.u) * k) * Math.ceil(len(p.v) * k);
  });
  const shadows = SHADOW_PX * c.boxes.length;
  const faces = CABINET_FACES_PX * c.drawn.length;
  const vpOf = (mesh: number) => (figures + shadows + mesh + c.room + faces) / scene.viewportPx + CONTROLS_VIEWPORTS;
  const meshPx = (k: number) => c.meshMm2 * k * k;
  const inBudget = (k: number) => meshPx(k) <= MESH_BUDGET_VIEWPORTS * scene.viewportPx;
  let meshS = s;
  if (sized(scene)) {
    meshS = meshScale(s, (k) => inBudget(k) && fitsCeiling(vpOf(meshPx(k))));
    // over the ceiling even at its coarsest: the mesh at its own budget alone, not drawn softer for nothing
    if (!fitsCeiling(vpOf(meshPx(meshS)))) meshS = meshScale(s, inBudget);
  }
  const mesh = meshPx(meshS);
  return { vp: vpOf(mesh), cost: { s, meshS, drawn: c.drawn, figuresDrawn: c.boxes.length, figures, shadows, mesh, room: c.room, faces } };
}

/**
 * NAV-DOLLY: the px per mm the mesh shelves are drawn at in a scene drawn at `s`: `s` where that `fits`, else whole
 * octaves under it to the first that does (a figure's layer steps the same way: figureScales), never under the coarsest
 * a face is drawn at.
 */
export function meshScale(s: number, fits: (k: number) => boolean): number {
  let k = s;
  while (!fits(k) && k / 2 >= TEXEL_SCALE_MIN) k /= 2;
  return k;
}

/**
 * NAV-DOLLY: the px per mm a scene asked for at `s` is drawn at: `s` where that `fits`, else the first quarter octave
 * under it (texelScale's notches, down to the coarsest a face is drawn at) that does; none, `s` itself: a scene over
 * the ceiling at every notch is not drawn softer for nothing (the dolly's budget holds the eye there).
 */
export function fitScale(s: number, fits: (k: number) => boolean): number {
  if (fits(s)) return s;
  for (let q = Math.ceil(4 * Math.log2(s) - 1e-9) - 1; ; q--) {
    const k = Math.max(TEXEL_SCALE_MIN, 2 ** (q / 4));
    if (fits(k)) return k;
    if (!(k > TEXEL_SCALE_MIN)) return s;
  }
}

/** The cost of the scene at this pose drawn at `s` px per mm, whether or not that fits the ceiling (sceneFit picks the `s`). */
export function sceneCostAt(camera: Camera, scene: BudgetScene, figures: readonly BudgetFigure[], s: number): Projected {
  return costOf(cullOf(camera, scene, figures), scene, s);
}

/**
 * NAV-DOLLY (Ross 11-22): the scene at this pose as it is drawn, and what that costs. The scene coarsens to fit the
 * ceiling, so the camera is never stopped for it: first its mesh shelves (meshScale: their own budget, and what the rest
 * of the scene leaves under the ceiling), the figures as sharp as the eye asks; still over, the whole scene a quarter
 * octave at a time (fitScale) from the px per mm the eye asks (freeTexelScale, held from `unturned`). A pose nothing
 * fits is drawn as the eye asks (its mesh at its own budget) and its cost told as it is: dollyStep holds the eye. The render draws
 * at this `s` and `meshS` (CabinetScene), so the cost projected for a pose is the cost of the scene drawn there.
 */
export function sceneFit(camera: Camera, scene: BudgetScene, figures: readonly BudgetFigure[], unturned?: Camera): Projected {
  const c = cullOf(camera, scene, figures);
  let last: { s: number; at: Projected } | null = null;
  const at = (s: number): Projected => {
    if (last?.s !== s) last = { s, at: costOf(c, scene, s) };
    return last.at;
  };
  return at(fitScale(freeTexelScale(camera, scene.span, unturned), (s) => !sized(scene) || fitsCeiling(at(s).vp)));
}

/** A window with no size yet (0 px) has no ceiling to fit: nothing is drawn coarser for it. */
const sized = (scene: BudgetScene) => scene.viewportPx > 0;

export type Projector = (camera: Camera, unturned?: Camera) => Projected;

/** The scene's cost at a pose (its px per mm held from `unturned`: sceneFit); the figures listed once. */
export function projector(scene: BudgetScene): Projector {
  let figures: readonly BudgetFigure[] | null = null;
  return (camera, unturned) => {
    figures ??= scene.figures();
    return sceneFit(camera, scene, figures, unturned);
  };
}

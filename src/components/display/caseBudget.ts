/**
 * NAV-1A (b), Ross 10-28: what the Free camera's scene would cost the GPU at a pose, before it is drawn there, so a look
 * stops short of the scene's ceiling where holding the sharpness the turn left yaw 0 at (freeTexelScale, a) is not
 * enough. Chrome gives every composited scene layer its own element px (e2e/case-free-camera's budget, read layer by
 * layer against the DOM: a figure its tap box at its px per mm, its contact shadow 16 x 16, a mesh shelf its trimmed area
 * at the scene's px per mm, the room's faces 64 x 256, every other face of a cabinet a few px, the scene's controls a little),
 * so the projection is those, summed for what the cull at that pose would draw (the same pure rules the scene draws
 * by), over the screen. Pure maths, no DOM.
 */
import type { Camera, Vec3 } from './caseCamera';
import { frameCap, type RoomSpan } from './caseFraming';
import {
  FIGURE_BUDGET_VIEWPORTS,
  GRADIENT_GRID,
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
  readonly s: number;
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
 * (frameCap's nearest), their figures (figuresToDraw, figureScales at the scene's px per mm, held from `unturned`, where
 * the turn left yaw 0: freeTexelScale), every figure's shadow, its plate where it draws, each side of a figure's or
 * plate's layer rounded up to whole px; the mesh shelves' trimmed area; the room's faces in view; CABINET_FACES_PX a
 * cabinet.
 */
export function sceneCost(camera: Camera, scene: BudgetScene, figures: readonly BudgetFigure[], unturned?: Camera): SceneCost {
  const view = { camera, panPx: 0 };
  const rect = cullRect(camera.frame);
  const s = freeTexelScale(camera, scene.span, unturned);
  const drawn = nearestCabinets(view, scene.wall, [], frameCap(camera, scene.wall, scene.fronts, scene.cap));
  const set = new Set(drawn);
  const inDrawn = figures.filter((f) => set.has(f.cab));
  const { shown } = figuresToDraw(view, rect, inDrawn, set, scene.boards, figureCap(scene.counts, scene.kinds, drawn));
  const plates = shown.map((i) => {
    const p = inDrawn[i].plate;
    return p && trimFace(view, p.a, p.u, p.v, rect) ? p : null;
  });
  const boxes = shown.map((i, n) => ({ ...inDrawn[i], plateMm2: plates[n] ? len(plates[n].u) * len(plates[n].v) : 0 }));
  const scales = figureScales(view, boxes, s, FIGURE_BUDGET_VIEWPORTS * camera.frame.width * camera.frame.height);
  let figurePx = 0;
  boxes.forEach((f, n) => {
    const k = scales[n];
    figurePx += Math.ceil(f.tapMm * k) * Math.ceil((f.y1 - f.y0) * k);
    const p = plates[n];
    if (p) figurePx += Math.ceil(len(p.u) * k) * Math.ceil(len(p.v) * k);
  });
  let mesh = 0;
  for (const i of drawn) {
    for (const [a, u, v] of meshFaces(scene.wall.cabinets[i])) {
      const cut = trimFace(view, a, u, v, rect);
      if (cut) mesh += len(u) * (cut.s1 - cut.s0) * s * len(v) * (cut.t1 - cut.t0) * s;
    }
  }
  const room = scene.room.filter(([a, u, v]) => trimFace(view, a, u, v, rect) !== null).length * scene.roomFacePx;
  return { s, drawn, figuresDrawn: shown.length, figures: figurePx, shadows: SHADOW_PX * shown.length, mesh, room, faces: CABINET_FACES_PX * drawn.length };
}

/** A pose's projected cost: in viewports of the screen, its controls included, and its parts. */
export type Projector = (camera: Camera, unturned?: Camera) => { vp: number; cost: SceneCost };

/** The scene's cost at a pose (its px per mm held from `unturned`: sceneCost); the figures listed once. */
export function projector(scene: BudgetScene): Projector {
  let figures: readonly BudgetFigure[] | null = null;
  return (camera, unturned) => {
    figures ??= scene.figures();
    const cost = sceneCost(camera, scene, figures, unturned);
    const px = cost.figures + cost.shadows + cost.mesh + cost.room + cost.faces;
    return { vp: px / scene.viewportPx + CONTROLS_VIEWPORTS, cost };
  };
}

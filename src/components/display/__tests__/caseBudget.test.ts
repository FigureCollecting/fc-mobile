import { describe, it, expect, vi } from 'vitest';
import { IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../cabinetPresets';
import type { Camera, Vec3 } from '../caseCamera';
import { frameCap, frameCase, frontsOf, roomBox } from '../caseFraming';
import { GRADIENT_GRID, cullRect, figureCap, figuresToDraw, freeTexelScale, nearestCabinets, opaqueBoards, texelScale, trimFace } from '../caseCull';
import { wallLayout } from '../packCabinets';
import {
  CABINET_FACES_PX,
  CONTROLS_VIEWPORTS,
  SCENE_CEILING_VIEWPORTS,
  SHADOW_PX,
  meshFaces,
  projector,
  sceneCost,
  type BudgetFigure,
  type BudgetScene,
} from '../caseBudget';

// NAV-1A (b), Ross 10-28: what the Free camera's scene would cost the GPU at a pose, before it is drawn there: each
// composited layer's own element px (a figure's tap box and plate at its px per mm, its 16 x 16 shadow, a mesh shelf's
// trimmed area at the scene's px per mm, the room's 64 x 256 faces, a bound for every other face of a cabinet), over the
// screen, plus the scene's controls.

const DEG = Math.PI / 180;
const OPEN = { width: 870, height: 475 };
const WALL = wallLayout(Array.from({ length: 30 }, () => IKEA_KLINGSBO));
const HEADROOM = WALL.cabinets.map(() => 300);
const FRONTS = frontsOf(WALL, HEADROOM);
const SPAN = { y0: 0, y1: 2100, z0: -420, z1: 60 };
const FRAMING = frameCase({ frame: OPEN, wall: WALL, headroomMm: HEADROOM, view: 'wall', focus: 15, shelf: 0, level: true });
const len = (u: Vec3) => Math.hypot(u[0], u[1], u[2]);

/** Every cabinet's surfaces, `perSurface` 17 mm figures on each, 30 mm apart, labelled when `plates`. */
function figuresOf(perSurface: number, plates = false): BudgetFigure[] {
  return WALL.cabinets.flatMap((slot, cab) =>
    slot.profile.surfaces.flatMap((surface) =>
      Array.from({ length: perSurface }, (_, i) => {
        const x0 = slot.leftMm + 40 + i * 30;
        return {
          cab,
          x0,
          x1: x0 + 17,
          y0: surface.topMm,
          y1: surface.topMm + 90,
          z: -150,
          tapMm: 17,
          plate: plates ? { a: [x0, surface.topMm, 5] as Vec3, u: [17, 0, 0] as Vec3, v: [0, -9, 0] as Vec3 } : null,
        };
      }),
    ),
  );
}

function sceneOf(figures: BudgetFigure[], patch: Partial<BudgetScene> = {}): BudgetScene {
  const room = roomBox(WALL, 2400);
  const w = room.x1 - room.x0;
  const d = room.zFront - room.zBack;
  return {
    span: SPAN,
    wall: WALL,
    fronts: FRONTS,
    cap: FRAMING.drawCap,
    counts: WALL.cabinets.map((_, cab) => figures.filter((f) => f.cab === cab).length),
    kinds: WALL.cabinets.map((c) => c.profile.id),
    boards: (cab) => opaqueBoards(WALL.cabinets[cab]),
    figures: () => figures,
    room: [
      [[room.x0, room.y1, room.zBack], [w, 0, 0], [0, -room.y1, 0]],
      [[room.x0, 0, room.zBack], [w, 0, 0], [0, 0, d]],
      [[room.x0, room.y1, room.zBack], [w, 0, 0], [0, 0, d]],
      [[room.x0, room.y1, room.zBack], [0, 0, d], [0, -room.y1, 0]],
      [[room.x1, room.y1, room.zBack], [0, 0, d], [0, -room.y1, 0]],
    ],
    roomFacePx: 64 * 256,
    viewportPx: 870 * 600,
    ...patch,
  };
}

const turned = (yaw: number, patch: Partial<Camera> = {}): Camera => ({ ...FRAMING.camera, yaw: yaw * DEG, ...patch });

describe('constants', () => {
  it('the 3-viewport ceiling (e2e/case-budget); a shadow is its 16 x 16 grid; the controls and a cabinet\'s other faces, bounds measured', () => {
    expect(SCENE_CEILING_VIEWPORTS).toBe(3);
    expect(SHADOW_PX).toBe(GRADIENT_GRID.u * GRADIENT_GRID.v);
    expect(CONTROLS_VIEWPORTS).toBeGreaterThan(0.29);
    expect(CABINET_FACES_PX).toBeGreaterThanOrEqual(80 * 16);
  });
});

describe('meshFaces: the faces a cabinet draws at the scene\'s px per mm (its open mesh shelves), as Surfaces draws them', () => {
  it('the KLINGSBO: a mesh floor on every steel-framed shelf inside its posts; its glass top none', () => {
    const slot = WALL.cabinets[0];
    const faces = meshFaces(slot);
    const p = slot.profile;
    const inside = p.surfaces.slice(0, -1).filter((s) => s.material !== 'wood' && !(s.plate && p.plate) && (s.outsideDoor || s.material !== 'glass'));
    expect(faces).toHaveLength(inside.length);
    expect(faces.length).toBeGreaterThan(0);
    const post = p.panels.sideMm;
    for (const [a, u, v] of faces) {
      expect(a[0]).toBe(slot.leftMm + post);
      expect(u).toEqual([slot.rightMm - slot.leftMm - 2 * post, 0, 0]);
      expect(v).toEqual([0, 0, p.outer.depthMm - 2 * post]);
    }
  });

  it('a Detolf (glass shelves) and an open rack (boards on a grid) draw none', () => {
    const wall = wallLayout([IKEA_DETOLF, OPEN_STEEL_RACK]);
    expect(meshFaces(wall.cabinets[0])).toEqual([]);
    expect(meshFaces(wall.cabinets[1])).toEqual([]);
  });
});

describe('sceneCost: the element px of what the cull at a pose draws', () => {
  const figures = figuresOf(8, true);
  const scene = sceneOf(figures);

  it('the cabinets and figures the scene would draw there: frameCap\'s nearest, figuresToDraw\'s figures', () => {
    const camera = turned(30);
    const cost = sceneCost(camera, scene, figures);
    const view = { camera, panPx: 0 };
    const drawn = nearestCabinets(view, WALL, [], frameCap(camera, WALL, FRONTS, FRAMING.drawCap));
    const set = new Set(drawn);
    const inDrawn = figures.filter((f) => set.has(f.cab));
    const { shown } = figuresToDraw(view, cullRect(camera.frame), inDrawn, set, scene.boards, figureCap(scene.counts, scene.kinds, drawn));
    expect(cost.drawn).toEqual(drawn);
    expect(cost.figuresDrawn).toBe(shown.length);
    expect(cost.shadows).toBe(SHADOW_PX * shown.length);
    expect(cost.faces).toBe(CABINET_FACES_PX * drawn.length);
  });

  it('turned, at the unturned view\'s px per mm (a): the mesh shelves cost their trimmed area at it, not at the turned view\'s need', () => {
    const camera = turned(40);
    const cost = sceneCost(camera, scene, figures);
    const s = freeTexelScale(camera, SPAN);
    expect(s).toBe(texelScale({ ...camera, yaw: 0 }, SPAN));
    expect(cost.s).toBe(s);
    const rect = cullRect(camera.frame);
    let mesh = 0;
    for (const i of cost.drawn) {
      for (const [a, u, v] of meshFaces(WALL.cabinets[i])) {
        const cut = trimFace({ camera, panPx: 0 }, a, u, v, rect);
        if (cut) mesh += len(u) * (cut.s1 - cut.s0) * s * len(v) * (cut.t1 - cut.t0) * s;
      }
    }
    expect(mesh).toBeGreaterThan(0);
    expect(cost.mesh).toBeCloseTo(mesh, 6);
    // what the turned view would have asked for costs more
    const asked = texelScale(camera, SPAN, [WALL.leftMm - 1000, WALL.rightMm + 1000]);
    expect(asked).toBeGreaterThan(s);
  });

  it('a figure costs its tap box and its plate at its px per mm, each side rounded up to whole px (a layer\'s size)', () => {
    const one = [figures[Math.floor(figures.length / 2)]];
    const solo = sceneOf(one, { counts: WALL.cabinets.map((_, cab) => (cab === one[0].cab ? 1 : 0)) });
    const camera = FRAMING.camera;
    const cost = sceneCost(camera, solo, one);
    expect(cost.figuresDrawn).toBe(1);
    const k = cost.s;
    const plate = one[0].plate!;
    expect(cost.figures).toBe(Math.ceil(17 * k) * Math.ceil(90 * k) + Math.ceil(len(plate.u) * k) * Math.ceil(len(plate.v) * k));
    // no plate (labels off): the tap box only
    const bare = [{ ...one[0], plate: null }];
    expect(sceneCost(camera, { ...solo, figures: () => bare }, bare).figures).toBe(Math.ceil(17 * k) * Math.ceil(90 * k));
  });

  it('a plate outside the frame and its margin costs nothing (the scene does not draw it)', () => {
    const one = [{ ...figures[0], plate: { a: [WALL.rightMm + 50_000, 1000, 5] as Vec3, u: [17, 0, 0] as Vec3, v: [0, -9, 0] as Vec3 } }];
    const solo = sceneOf(one, { counts: WALL.cabinets.map((_, cab) => (cab === one[0].cab ? 1 : 0)) });
    const camera: Camera = { ...FRAMING.camera, x: WALL.cabinets[0].centerMm };
    const cost = sceneCost(camera, solo, one);
    expect(cost.figuresDrawn).toBe(1);
    expect(cost.figures).toBe(Math.ceil(17 * cost.s) * Math.ceil(90 * cost.s));
  });

  it('the room: each of its faces in view costs its grid; turned toward a wall\'s end, a side wall comes in', () => {
    const straight = sceneCost(FRAMING.camera, scene, figures);
    expect(straight.room).toBe(3 * 64 * 256);
    const end: Camera = { ...FRAMING.camera, x: WALL.rightMm - 200, yaw: 45 * DEG };
    expect(sceneCost(end, scene, figures).room).toBe(4 * 64 * 256);
  });
});

describe('projector: the scene\'s cost at a pose in viewports of the screen, the controls added', () => {
  it('px over the screen, plus the controls; its parts with it', () => {
    const figures = figuresOf(8);
    const scene = sceneOf(figures);
    const at = projector(scene)(turned(20));
    const c = sceneCost(turned(20), scene, figures);
    const px = c.figures + c.shadows + c.mesh + c.room + c.faces;
    expect(at.vp).toBeCloseTo(px / scene.viewportPx + CONTROLS_VIEWPORTS, 12);
    expect(at.cost).toEqual(c);
  });

  it('turning toward a dense wall costs more; a smaller screen, more viewports', () => {
    const scene = sceneOf(figuresOf(12));
    const project = projector(scene);
    expect(project(turned(35)).vp).toBeGreaterThan(project(turned(0)).vp);
    const small = projector({ ...scene, viewportPx: scene.viewportPx / 2 });
    expect(small(turned(35)).vp - CONTROLS_VIEWPORTS).toBeCloseTo(2 * (project(turned(35)).vp - CONTROLS_VIEWPORTS), 9);
  });

  it('lists the figures once, however many poses it is asked', () => {
    const figures = figuresOf(4);
    const list = vi.fn(() => figures);
    const project = projector(sceneOf(figures, { figures: list }));
    expect(list).not.toHaveBeenCalled();
    for (const yaw of [0, 10, 20, 30, -30]) project(turned(yaw));
    expect(list).toHaveBeenCalledTimes(1);
  });
});

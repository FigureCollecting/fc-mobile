import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../cabinetPresets';
import type { Camera, Vec3 } from '../caseCamera';
import { frameCap, frameCase, frontsOf, roomBox } from '../caseFraming';
import { FIGURE_BUDGET_VIEWPORTS, GRADIENT_GRID, cullRect, figureCap, figuresToDraw, freeTexelScale, nearestCabinets, opaqueBoards, texelScale, trimFace } from '../caseCull';
import { wallLayout } from '../packCabinets';
import {
  CABINET_FACES_PX,
  CONTROLS_VIEWPORTS,
  MESH_BUDGET_VIEWPORTS,
  SCENE_CEILING_VIEWPORTS,
  SHADOW_PX,
  fitScale,
  meshFaces,
  meshScale,
  projector,
  sceneCost,
  sceneCostAt,
  type BudgetFigure,
  type BudgetScene,
  type Projector,
} from '../caseBudget';
import { EYE_MARGIN_MM, poseOf, withPose } from '../casePose';
import type { FreeScene } from '../useFreeCamera';
import { COVER, COVER_PX, KLINGSBO_WALL, freeSceneOf } from './freeDrivesScene';

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
    // the controls: over the most measured (0.293, the cover at the hard yaw), and a tight bound (no more than 0.35)
    expect(CONTROLS_VIEWPORTS).toBeGreaterThan(0.293);
    expect(CONTROLS_VIEWPORTS).toBeLessThanOrEqual(0.35);
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

  it('turned after a move toward the fronts, held from where the turn left yaw 0 (a): never the moved eye\'s sharper need', () => {
    const moved = turned(30, { z: FRAMING.camera.z - 900 });
    expect(texelScale({ ...moved, yaw: 0 }, SPAN)).toBeGreaterThan(texelScale(FRAMING.camera, SPAN));
    const held = sceneCost(moved, scene, figures, FRAMING.camera);
    expect(held.s).toBe(texelScale(FRAMING.camera, SPAN));
    // no reference known: the moved eye unturned (and so a sharper scene that costs more)
    const free = sceneCost(moved, scene, figures);
    expect(free.s).toBe(texelScale({ ...moved, yaw: 0 }, SPAN));
    expect(free.mesh).toBeGreaterThan(held.mesh);
    // the projector hands the reference on
    expect(projector(scene)(moved, FRAMING.camera).cost).toEqual(held);
  });

  it('where the figures\' budget binds, they cost about it: an octave coarser at a time, never past it but by whole-px rounding', () => {
    // a close eye (the finest px per mm) over a wall of large figures: at that px per mm they would cost many budgets
    const big: BudgetFigure[] = WALL.cabinets.flatMap((slot, cab) =>
      slot.profile.surfaces.flatMap((surface) => [0, 1, 2].map((i) => ({ cab, x0: slot.leftMm + 40 + i * 120, x1: slot.leftMm + 140 + i * 120, y0: surface.topMm, y1: surface.topMm + 200, z: -150, tapMm: 100, plate: null }))),
    );
    const near: Camera = { ...FRAMING.camera, z: FRAMING.camera.z - 2000 };
    const cost = sceneCost(near, sceneOf(big), big);
    const budget = FIGURE_BUDGET_VIEWPORTS * near.frame.width * near.frame.height;
    expect(cost.figuresDrawn).toBeGreaterThan(20);
    expect(cost.figuresDrawn * 100 * 200 * cost.s ** 2).toBeGreaterThan(2 * budget);
    expect(cost.figures).toBeLessThanOrEqual(budget * 1.1);
    expect(cost.figures).toBeGreaterThan(budget * 0.6);
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

// NAV-DOLLY (Ross 11-22: "I hit the rack and stop... cannot move closer"): the scene coarsens to fit the ceiling, so the
// camera is never stopped for it. The open mesh shelves take the coarsening first (their own budget, whole octaves under
// the scene's px per mm); only what is still over coarsens the scene itself, a quarter octave at a time.
/** The walks below project some 400 poses each (Vitest's default is 5 s; under coverage on a loaded runner they took 6 s). */
const HEAVY_MS = 30_000;

describe('NAV-DOLLY: the scene fits the ceiling at every depth of the walk in', () => {
  const SIZES = {
    cover: { frame: COVER, viewportPx: COVER_PX },
    'cover PWA': { frame: { width: 444, height: 561 }, viewportPx: 444 * 701 },
  };
  /** Every 5 mm from the framing to the shelves' margin, the eye `dy` off the framing's height. */
  function walkIn(scene: FreeScene, dy: number, each: (at: ReturnType<Projector>, camera: Camera) => void) {
    const project = projector(scene.budget);
    const p0 = poseOf(scene.base);
    const margin = Math.max(...scene.boxes.map((b) => b.z1)) + EYE_MARGIN_MM;
    for (let z = Math.round(p0.z); z >= margin; z -= 5) {
      const camera = withPose(scene.base, { ...p0, y: p0.y + dy, z });
      each(project(camera), camera);
    }
  }

  for (const [name, size] of Object.entries(SIZES)) {
    const scene = freeSceneOf({ wall: KLINGSBO_WALL, figures: 622, real: true, ...size });

    it.each([0, -100, -200])(`${name}, 622 real figures on 7 KLINGSBOs, the eye %i mm off the framing's height: no depth is over the ceiling`, (dy) => {
      let peak = 0;
      const over: number[] = [];
      walkIn(scene, dy, ({ vp }, camera) => {
        peak = Math.max(peak, vp);
        if (vp > SCENE_CEILING_VIEWPORTS) over.push(camera.z);
      });
      expect({ peak: Math.round(peak * 1000) / 1000, band: over.length ? [over[0], over[over.length - 1]] : null }).toEqual({ peak: expect.any(Number), band: null });
      expect(peak).toBeLessThanOrEqual(SCENE_CEILING_VIEWPORTS);
    }, HEAVY_MS);

    it(`${name}: the mesh shelves take it (at most their budget, whole octaves under the scene's px per mm); the figures stay as sharp as the eye asks`, () => {
      let coarsened = 0;
      for (const dy of [0, -100, -200]) {
        walkIn(scene, dy, ({ cost }, camera) => {
          // the scene's px per mm is the level one: nothing but the mesh gave way
          expect(cost.s).toBe(freeTexelScale(camera, scene.budget.span));
          expect(cost.mesh).toBeLessThanOrEqual(MESH_BUDGET_VIEWPORTS * scene.budget.viewportPx);
          const octaves = Math.log2(cost.s / cost.meshS);
          expect(octaves).toBe(Math.round(octaves));
          expect(octaves).toBeGreaterThanOrEqual(0);
          if (octaves > 0) coarsened++;
        });
      }
      expect(coarsened).toBeGreaterThan(0);
      // far off (the framing) the mesh costs little: drawn at the scene's own px per mm
      const far = projector(scene.budget)(scene.base).cost;
      expect(far.meshS).toBe(far.s);
      expect(far.mesh).toBeGreaterThan(0);
    }, HEAVY_MS);
  }

  it('the mesh costs its trimmed area at its own px per mm', () => {
    const scene = freeSceneOf({ wall: KLINGSBO_WALL, figures: 622, real: true, frame: COVER, viewportPx: COVER_PX });
    const p0 = poseOf(scene.base);
    const camera = withPose(scene.base, { ...p0, y: p0.y - 200, z: 430 });
    const { cost } = projector(scene.budget)(camera);
    expect(cost.meshS).toBeLessThan(cost.s);
    const view = { camera, panPx: 0 };
    let mm2 = 0;
    for (const i of cost.drawn) {
      for (const [a, u, v] of meshFaces(KLINGSBO_WALL.cabinets[i])) {
        const cut = trimFace(view, a, u, v, cullRect(camera.frame));
        if (cut) mm2 += len(u) * (cut.s1 - cut.s0) * len(v) * (cut.t1 - cut.t0);
      }
    }
    expect(cost.mesh).toBeCloseTo(mm2 * cost.meshS ** 2, 6);
    // and an octave finer would be over its budget
    expect(mm2 * (2 * cost.meshS) ** 2).toBeGreaterThan(MESH_BUDGET_VIEWPORTS * COVER_PX);
  });

  it('where the rest of the scene leaves the mesh less than its budget, the mesh gives way further before the figures do', () => {
    // a screen smaller than the cover: the figures, shadows, room and controls leave under 0.6 viewports
    const scene = freeSceneOf({ wall: KLINGSBO_WALL, figures: 622, real: true, frame: COVER, viewportPx: 443 * 400 });
    const p0 = poseOf(scene.base);
    const camera = withPose(scene.base, { ...p0, y: p0.y - 200, z: 430 });
    const { vp, cost } = projector(scene.budget)(camera);
    const rest = (cost.figures + cost.shadows + cost.room + cost.faces) / scene.budget.viewportPx + CONTROLS_VIEWPORTS;
    expect(SCENE_CEILING_VIEWPORTS - rest).toBeLessThan(MESH_BUDGET_VIEWPORTS);
    expect(SCENE_CEILING_VIEWPORTS - rest).toBeGreaterThan(0);
    expect(vp).toBeLessThanOrEqual(SCENE_CEILING_VIEWPORTS);
    expect(cost.s).toBe(freeTexelScale(camera, scene.budget.span));
    expect(cost.mesh).toBeGreaterThan(0);
  });

  it('still over with the mesh at its coarsest: the scene itself a quarter octave coarser at a time, to the first that fits', () => {
    // the frame is the whole of a small screen: the figures' budget, their shadows and the room pass the ceiling alone
    const scene = freeSceneOf({ wall: KLINGSBO_WALL, figures: 622, real: true, frame: COVER, viewportPx: 443 * 300 });
    const p0 = poseOf(scene.base);
    const camera = withPose(scene.base, { ...p0, z: 600 });
    const level = freeTexelScale(camera, scene.budget.span);
    const { vp, cost } = projector(scene.budget)(camera);
    expect(vp).toBeLessThanOrEqual(SCENE_CEILING_VIEWPORTS);
    const notches = 4 * Math.log2(level / cost.s);
    expect(notches).toBeCloseTo(Math.round(notches), 9);
    expect(Math.round(notches)).toBeGreaterThanOrEqual(1);
    // the first that fits: a notch finer is over
    expect(sceneCostAt(camera, scene.budget, scene.budget.figures(), cost.s * 2 ** 0.25).vp).toBeGreaterThan(SCENE_CEILING_VIEWPORTS);
    expect(sceneCostAt(camera, scene.budget, scene.budget.figures(), cost.s).vp).toBe(vp);
  });

  it('a screen nothing fits (its controls and room alone are over): the coarsest scene, its cost told as it is', () => {
    const scene = freeSceneOf({ wall: KLINGSBO_WALL, figures: 622, real: true, frame: COVER, viewportPx: 20_000 });
    const { vp, cost } = projector(scene.budget)(scene.base);
    expect(cost.s).toBe(1 / 64);
    expect(cost.meshS).toBe(1 / 64);
    expect(vp).toBeGreaterThan(SCENE_CEILING_VIEWPORTS);
  });

  it('property: any eye before the shelves (off the framing sideways, up or down, turned or not) on any of the Fold8\'s screens fits the ceiling, the scene never sharper than the eye asks, the mesh never sharper than the scene', () => {
    const scenes = [
      ...Object.values(SIZES),
      { frame: { width: 616, height: 217 }, viewportPx: 616 * 357 },
      { frame: { width: 870, height: 335 }, viewportPx: 870 * 475 },
    ].map((size) => freeSceneOf({ wall: KLINGSBO_WALL, figures: 622, real: true, ...size }));
    const projectors = scenes.map((scene) => projector(scene.budget));
    fc.assert(
      fc.property(
        fc.record({
          at: fc.nat({ max: scenes.length - 1 }),
          dx: fc.integer({ min: -400, max: 400 }),
          dy: fc.integer({ min: -500, max: 200 }),
          depth: fc.double({ min: 0, max: 1, noNaN: true }),
          yaw: fc.oneof(fc.constant(0), fc.double({ min: -0.6, max: 0.6, noNaN: true })),
        }),
        ({ at, dx, dy, depth, yaw }) => {
          const scene = scenes[at];
          const p0 = poseOf(scene.base);
          const margin = Math.max(...scene.boxes.map((b) => b.z1)) + EYE_MARGIN_MM;
          const unturned = withPose(scene.base, { ...p0, x: p0.x + dx, y: p0.y + dy, z: margin + depth * (p0.z - margin) });
          const camera = { ...unturned, yaw };
          const { vp, cost } = projectors[at](camera, unturned);
          expect(vp).toBeLessThanOrEqual(SCENE_CEILING_VIEWPORTS);
          expect(cost.s).toBeLessThanOrEqual(freeTexelScale(camera, scene.budget.span, unturned));
          expect(cost.meshS).toBeLessThanOrEqual(cost.s);
          expect(cost.mesh).toBeLessThanOrEqual(MESH_BUDGET_VIEWPORTS * scene.budget.viewportPx);
        },
      ),
      { numRuns: 300, seed: 1122 },
    );
  }, HEAVY_MS);

  it('a window with no size yet (0 px, or no number) coarsens nothing: the scene and its mesh at the px per mm the eye asks', () => {
    for (const viewportPx of [0, Number.NaN, -1]) {
      const scene = freeSceneOf({ wall: KLINGSBO_WALL, figures: 622, real: true, frame: COVER, viewportPx });
      const p0 = poseOf(scene.base);
      const camera = withPose(scene.base, { ...p0, y: p0.y - 200, z: 430 });
      const { vp, cost } = projector(scene.budget)(camera);
      expect(cost.s).toBe(freeTexelScale(camera, scene.budget.span));
      expect(cost.meshS).toBe(cost.s);
      // and its cost is no number that fits (the dolly's and the look's own guard, as before)
      expect(vp <= SCENE_CEILING_VIEWPORTS && vp > 0).toBe(false);
    }
  });

  it('turned, never sharper than the px per mm held from where the turn left yaw 0', () => {
    const scene = freeSceneOf({ wall: KLINGSBO_WALL, figures: 622, real: true, frame: COVER, viewportPx: COVER_PX });
    const p0 = poseOf(scene.base);
    const turnedIn = withPose(scene.base, { ...p0, z: 500, yaw: 20 * DEG });
    const { vp, cost } = projector(scene.budget)(turnedIn, scene.base);
    expect(cost.s).toBeLessThanOrEqual(texelScale(scene.base, scene.budget.span));
    expect(vp).toBeLessThanOrEqual(SCENE_CEILING_VIEWPORTS);
  });
});

describe('NAV-DOLLY: fitScale and meshScale', () => {
  it('fitScale: the px per mm itself where it fits; else the first quarter octave under it that does; none, the coarsest', () => {
    expect(fitScale(0.5, () => true)).toBe(0.5);
    const asked: number[] = [];
    const s = fitScale(1, (k) => {
      asked.push(k);
      return k <= 0.6;
    });
    expect(s).toBe(2 ** (-3 / 4));
    expect(asked).toEqual([1, 2 ** (-1 / 4), 2 ** (-2 / 4), 2 ** (-3 / 4)]);
    // on the quarter-octave grid whatever it was given (a held px per mm between notches)
    expect(fitScale(0.9, (k) => k < 0.9)).toBe(2 ** (-1 / 4));
    expect(fitScale(1, () => false)).toBe(1 / 64);
    expect(fitScale(1 / 64, () => false)).toBe(1 / 64);
  });

  it('meshScale: the scene\'s px per mm where it fits; else whole octaves under it to the first that does; none, the coarsest', () => {
    expect(meshScale(0.7, () => true)).toBe(0.7);
    expect(meshScale(0.7, (k) => k < 0.2)).toBe(0.7 / 4);
    expect(meshScale(1, () => false)).toBe(1 / 64);
    // never under the coarsest a face is drawn at
    expect(meshScale(0.05, () => false)).toBe(0.025);
    expect(0.0125).toBeLessThan(1 / 64);
  });
});

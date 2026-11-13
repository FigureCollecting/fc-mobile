/**
 * NAV-DEPTH-2: a Free camera scene for the drives' tests, built from the same pure pieces CabinetScene builds its
 * FreeScene from (frameCase, cabinetBox, eyeSpace, roomBox, frontsOf), with `count` synthetic figures spread over the
 * shelves for the budget, and a hand-driven requestAnimationFrame.
 */
import { vi } from 'vitest';
import { IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../cabinetPresets';
import type { Frame, Vec3 } from '../caseCamera';
import { cabinetBox, frameCase, frontsOf, roomBox } from '../caseFraming';
import { opaqueBoards, texelScale } from '../caseCull';
import { eyeSpace } from '../casePose';
import { wallLayout, type WallLayout } from '../packCabinets';
import type { BudgetFigure, BudgetScene } from '../caseBudget';
import type { FreeDom, FreeScene } from '../useFreeCamera';

export const CEILING_MM = 2438.4;
export const OPEN: Frame = { width: 870, height: 475 };
/** Ross's 11-13 profile: the KLINGSBO with the Detolf and the open steel rack alongside, repeated. */
export const ROSS_WALL = wallLayout([IKEA_KLINGSBO, IKEA_DETOLF, OPEN_STEEL_RACK, IKEA_KLINGSBO, IKEA_DETOLF, OPEN_STEEL_RACK, IKEA_KLINGSBO]);
/** A wall longer than the case draws at once: the Classic cap engages. */
export const LONG_WALL = wallLayout(Array.from({ length: 40 }, () => IKEA_KLINGSBO));

/** `count` 17 x 90 mm figures, dealt round the wall's surfaces in turn, 30 mm apart along each. */
export function figuresOn(wall: WallLayout, count: number): BudgetFigure[] {
  const surfaces = wall.cabinets.flatMap((slot, cab) => slot.profile.surfaces.map((surface) => ({ slot, cab, top: surface.topMm })));
  return Array.from({ length: count }, (_, i) => {
    const { slot, cab, top } = surfaces[i % surfaces.length];
    const along = Math.floor(i / surfaces.length);
    const x0 = slot.leftMm + 40 + ((along * 30) % Math.max(30, slot.rightMm - slot.leftMm - 100));
    return { cab, x0, x1: x0 + 17, y0: top, y1: top + 90, z: -150, tapMm: 17, plate: null };
  });
}

export interface SceneOpts {
  readonly wall?: WallLayout;
  readonly frame?: Frame;
  readonly focus?: number;
  readonly figures?: number;
  /** The screen's px: what a viewport of the ceiling is (smaller: the budget binds sooner). */
  readonly viewportPx?: number;
}

/** A FreeScene as CabinetScene builds one (wall view, level, 300 mm headroom a cabinet). */
export function freeSceneOf(opts: SceneOpts = {}): FreeScene {
  const wall = opts.wall ?? ROSS_WALL;
  const frame = opts.frame ?? OPEN;
  const headroom = wall.cabinets.map(() => 300);
  const fronts = frontsOf(wall, headroom);
  const framing = frameCase({ frame, wall, headroomMm: headroom, view: 'wall', focus: opts.focus ?? 0, shelf: 0, level: true, ceilingMm: CEILING_MM });
  const room = roomBox(wall, CEILING_MM);
  const span = {
    y0: 0,
    y1: Math.max(...wall.cabinets.map((c, i) => c.profile.outer.heightMm + headroom[i])),
    z0: -Math.max(...wall.cabinets.map((c) => c.profile.outer.depthMm)),
    z1: Math.max(...wall.cabinets.map((c) => c.profile.footprint?.frontOverhangMm ?? 0)),
  };
  const figures = figuresOn(wall, opts.figures ?? 0);
  const roomW = room.x1 - room.x0;
  const roomD = room.zFront - room.zBack;
  const budget: BudgetScene = {
    span,
    wall,
    fronts,
    cap: framing.drawCap,
    counts: wall.cabinets.map((_, cab) => figures.filter((f) => f.cab === cab).length),
    kinds: wall.cabinets.map((c) => c.profile.id),
    boards: (cab) => opaqueBoards(wall.cabinets[cab]),
    figures: () => figures,
    room: [
      [[room.x0, room.y1, room.zBack], [roomW, 0, 0], [0, -room.y1, 0]],
      [[room.x0, 0, room.zBack], [roomW, 0, 0], [0, 0, roomD]],
      [[room.x0, room.y1, room.zBack], [roomW, 0, 0], [0, 0, roomD]],
      [[room.x0, room.y1, room.zBack], [0, 0, roomD], [0, -room.y1, 0]],
      [[room.x1, room.y1, room.zBack], [0, 0, roomD], [0, -room.y1, 0]],
    ] as (readonly [Vec3, Vec3, Vec3])[],
    roomFacePx: 64 * 256,
    viewportPx: opts.viewportPx ?? frame.width * frame.height,
  };
  return {
    base: framing.camera,
    s: texelScale(framing.camera, span),
    wall,
    fronts,
    drawn: wall.cabinets.map((_, i) => i),
    boxes: wall.cabinets.map((slot, i) => cabinetBox(slot, headroom[i])),
    space: eyeSpace(room, CEILING_MM),
    zBack: room.zBack,
    dimmed: null,
    lookHoldMs: 500,
    jogMax: 2,
    reducedMotion: false,
    budget,
  };
}

/** The scene's DOM: a host holding the root the writer transforms. */
export function freeDom(): FreeDom & { readonly hostEl: HTMLElement; readonly rootEl: HTMLElement } {
  const hostEl = document.createElement('div');
  const rootEl = document.createElement('div');
  const ringEl = document.createElement('div');
  hostEl.append(rootEl, ringEl);
  return { host: { current: hostEl }, root: { current: rootEl }, ring: { current: ringEl }, hostEl, rootEl };
}

/** requestAnimationFrame by hand: `tick(ms)` runs the frames asked for, at the clock moved on by ms. */
export function handFrames(start = 1000) {
  const asked = new Map<number, FrameRequestCallback>();
  let id = 0;
  let now = start;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    asked.set(++id, cb);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((h) => {
    asked.delete(h);
  });
  return {
    tick(ms: number) {
      now += ms;
      const due = [...asked.values()];
      asked.clear();
      for (const cb of due) cb(now);
    },
    pending: () => asked.size,
  };
}

/**
 * NAV-DEPTH-2: a Free camera scene for the drives' tests, built from the same pure pieces CabinetScene builds its
 * FreeScene from (frameCase, cabinetBox, eyeSpace, roomBox, frontsOf), with `count` synthetic figures spread over the
 * shelves for the budget, and a hand-driven requestAnimationFrame.
 */
import { vi } from 'vitest';
import { IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../cabinetPresets';
import { boxCorners, type Frame, type Vec3 } from '../caseCamera';
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

/** The Fold8's cover as the browser lays the case out on it: the camera's frame, inside its window. */
export const COVER: Frame = { width: 443, height: 418 };
export const COVER_PX = 443 * 558;
/** Seven KLINGSBOs: every shelf inside them an open mesh shelf. */
export const KLINGSBO_WALL = wallLayout(Array.from({ length: 7 }, () => IKEA_KLINGSBO));

/**
 * NAV-DOLLY: up to `count` figures of real sizes (45 to 110 mm wide, 90 to 250 mm tall, no taller than their shelf's
 * clearance), packed 10 mm apart in three rows deep on every surface, the front row labelled; the same every run.
 */
export function realFiguresOn(wall: WallLayout, count: number): BudgetFigure[] {
  let seed = 7;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const figures: BudgetFigure[] = [];
  for (const [cab, slot] of wall.cabinets.entries()) {
    const post = slot.profile.panels.sideMm;
    const surfaces = slot.profile.surfaces;
    for (const [i, surface] of surfaces.entries()) {
      const clear = i + 1 < surfaces.length ? surfaces[i + 1].topMm - surface.topMm - 30 : 300;
      for (let row = 0; row < 3; row++) {
        for (let x = slot.leftMm + post + 5 + (row % 2) * 25; figures.length < count; ) {
          const w = 45 + random() * 65;
          if (x + w > slot.rightMm - post) break;
          const h = Math.min(clear, 90 + random() * 160);
          const plate = row === 0 ? { a: [x, surface.topMm, 10] as Vec3, u: [w, 0, 0] as Vec3, v: [0, -17.2, 0] as Vec3 } : null;
          figures.push({ cab, x0: x, x1: x + w, y0: surface.topMm, y1: surface.topMm + h, z: -60 - row * 110, tapMm: w, plate });
          x += w + 10;
        }
      }
    }
  }
  return figures;
}

export interface SceneOpts {
  readonly wall?: WallLayout;
  readonly frame?: Frame;
  readonly focus?: number;
  readonly figures?: number;
  /** The figures are realFiguresOn's, not the 17 x 90 mm stand-ins. */
  readonly real?: boolean;
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
  const figures = (opts.real ? realFiguresOn : figuresOn)(wall, opts.figures ?? 0);
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
    reach: boxCorners(room.x0, room.x1, 0, room.y1, room.zBack, room.zFront),
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

/**
 * requestAnimationFrame by hand: `tick(ms)` runs the frames asked for, at the clock moved on by ms. `clock`: that clock
 * is performance.now() too (a lift's ease back is timed from it), and `wait(ms)` moves it on with no frame run.
 */
export function handFrames(start = 1000, clock = false) {
  const asked = new Map<number, FrameRequestCallback>();
  let id = 0;
  let now = start;
  if (clock) vi.spyOn(performance, 'now').mockImplementation(() => now);
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
    wait(ms: number) {
      now += ms;
    },
    pending: () => asked.size,
  };
}

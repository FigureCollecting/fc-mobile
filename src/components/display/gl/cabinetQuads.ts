/**
 * CASE-GL: the room and the cabinets as flat coloured faces, world mm, the
 * very faces the classic view draws (CabinetScene's Box, Edges, Panes,
 * Surfaces, FrameAndLegs, Rods, Rack), each with the colour its CSS class
 * paints, so the canvas batches them into a couple of draw calls. A face is
 * corner `a` and sides `u`, `v` (v runs down the classic view's element);
 * `colors` are gradient stops along v, flat when one.
 */
import { sideOverhangMm, type CabinetProfile, type CabinetSurface } from '../cabinetProfile';
import type { WallLayout, WallSlot } from '../packCabinets';

type V3 = readonly [number, number, number];
export type RGBA = readonly [number, number, number, number];

export interface ColoredQuad {
  /** The classic view's class for the face (its material and side). */
  readonly cls: string;
  readonly a: V3;
  readonly u: V3;
  readonly v: V3;
  /** Gradient stops along v, 0 at a; one stop: flat. */
  readonly colors: readonly (readonly [number, RGBA])[];
}

const hex = (h: string, alpha = 1): RGBA => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255, alpha];
const rgba = (r: number, g: number, b: number, a: number): RGBA => [r / 255, g / 255, b / 255, a];

/**
 * The classic view's paint per class (CabinetScene styles). The mesh shelf's two diagonal stripe sets (55 % black,
 * 3 px of every 11 each way) are drawn as their average over the steel.
 */
function colorsOf(cls: string): (readonly [number, RGBA])[] {
  const has = (c: string) => cls.split(' ').includes(c);
  if (has('cab-pane')) return [[0, rgba(190, 236, 236, 0.25)]];
  if (has('m-glass-plate')) return [[0, rgba(190, 226, 230, 0.07)]];
  if (has('m-glass-rim')) return [[0, rgba(196, 236, 236, 0.45)]];
  if (has('m-glass-top')) return [[0, rgba(190, 226, 230, 0.1)]];
  if (has('m-glass-edge')) return [[0, rgba(176, 232, 232, 0.8)]];
  if (has('m-rod')) return [[0, hex('#747b83')]];
  // linear-gradient(0deg, #5a4a3a, #47392d): the bottom of the element first
  if (has('m-board')) return [[0, hex('#47392d')], [1, hex('#5a4a3a')]];
  if (has('m-mesh')) {
    const black = 1 - (8 / 11) ** 2;
    const k = 1 - 0.55 * black;
    const [r, g, b] = hex('#2c2e33');
    return [[0, [r * k, g * k, b * k, 1]]];
  }
  if (has('m-wood')) return [[0, hex(has('f-side') ? '#221c1a' : has('f-top') ? '#3b332f' : '#2f2825')]];
  // steel: the front and the rims #1d1e22, sides, tops and undersides each their own shade
  return [[0, hex(has('f-side') ? '#131417' : has('f-top') ? '#2b2d32' : has('f-bottom') ? '#0d0e10' : '#1d1e22')]];
}

const along = (a: V3, u: V3, v: V3, s: number, t: number): V3 => [a[0] + s * u[0] + t * v[0], a[1] + s * u[1] + t * v[1], a[2] + s * u[2] + t * v[2]];
const times = (u: V3, k: number): V3 => [u[0] * k, u[1] * k, u[2] * k];

class Faces {
  readonly out: ColoredQuad[] = [];

  quad(cls: string, a: V3, u: V3, v: V3): void {
    if (!(Math.hypot(...u) > 0) || !(Math.hypot(...v) > 0)) return;
    this.out.push({ cls, a, u, v, colors: colorsOf(cls) });
  }

  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, cls: string, faces: readonly string[] = ['front', 'back', 'left', 'right', 'top', 'bottom']): void {
    const w = x1 - x0;
    const h = y1 - y0;
    const d = z1 - z0;
    for (const f of faces) {
      if (f === 'front') this.quad(`${cls} f-front`, [x0, y1, z1], [w, 0, 0], [0, -h, 0]);
      if (f === 'back') this.quad(`${cls} f-back`, [x0, y1, z0], [w, 0, 0], [0, -h, 0]);
      if (f === 'left') this.quad(`${cls} f-side`, [x0, y1, z0], [0, 0, d], [0, -h, 0]);
      if (f === 'right') this.quad(`${cls} f-side`, [x1, y1, z0], [0, 0, d], [0, -h, 0]);
      if (f === 'top') this.quad(`${cls} f-top`, [x0, y1, z0], [w, 0, 0], [0, 0, d]);
      if (f === 'bottom') this.quad(`${cls} f-bottom`, [x0, y0, z0], [w, 0, 0], [0, 0, d]);
    }
  }

  edges(a: V3, u: V3, v: V3, cls: string, mm: number): void {
    const lu = Math.hypot(...u);
    const lv = Math.hypot(...v);
    const eu = times(u, mm / lu);
    const ev = times(v, mm / lv);
    const inner = times(v, 1 - (2 * mm) / lv);
    this.quad(cls, a, u, ev);
    this.quad(cls, along(a, u, v, 0, 1 - mm / lv), u, ev);
    this.quad(cls, along(a, u, v, 0, mm / lv), eu, inner);
    this.quad(cls, along(a, u, v, 1 - mm / lu, mm / lv), eu, inner);
  }

  rimmed(a: V3, u: V3, v: V3, cls: string, rimCls: string, mm: number): void {
    this.quad(cls, a, u, v);
    this.edges([a[0], a[1] + RIM_LIFT_MM, a[2]], u, v, rimCls, mm);
  }
}

/** CabinetScene's constants for the same faces. */
const PANE_EDGE_MM = 1;
const RIM_LIFT_MM = 0.3;
const GLASS_RIM_MM = 2;
const GLASS_TOP_RIM_MM = 3;

function caseFloor(p: CabinetProfile): CabinetSurface {
  return p.surfaces.find((s) => !s.outsideDoor) ?? p.surfaces[0];
}

function panes(f: Faces, slot: WallSlot): void {
  const p = slot.profile;
  const { leftMm: x0, rightMm: x1 } = slot;
  const D = p.outer.depthMm;
  const floor = caseFloor(p);
  const top = p.surfaces[p.surfaces.length - 1];
  const lo = floor.material === 'wood' ? floor.topMm : floor.topMm - floor.thicknessMm;
  const hi = top.topMm - top.thicknessMm;
  const h = hi - lo;
  const inset = p.panels.sideMm / 2;
  if (p.materials.sides === 'glass') {
    f.edges([x0 + inset, hi, -D], [0, 0, D], [0, -h, 0], 'cab-pane cab-pane--side', PANE_EDGE_MM);
    f.edges([x1 - inset, hi, -D], [0, 0, D], [0, -h, 0], 'cab-pane cab-pane--side', PANE_EDGE_MM);
  }
  if (p.materials.back === 'glass') f.edges([x0, hi, -D + p.panels.backMm / 2], [x1 - x0, 0, 0], [0, -h, 0], 'cab-pane cab-pane--back', PANE_EDGE_MM);
  if (p.materials.front === 'glassDoor') f.edges([x0, hi, -1], [x1 - x0, 0, 0], [0, -h, 0], 'cab-pane cab-pane--door', PANE_EDGE_MM);
}

function surfaces(f: Faces, slot: WallSlot): void {
  const p = slot.profile;
  const { leftMm: x0, rightMm: x1, centerMm: cx } = slot;
  const D = p.outer.depthMm;
  const post = p.panels.sideMm;
  const last = p.surfaces.length - 1;
  p.surfaces.forEach((s, i) => {
    const y0 = s.topMm - s.thicknessMm;
    if (i === last) {
      const wood = s.material === 'wood';
      f.box(x0, x1, y0, s.topMm, -D, 0, wood ? 'm-wood' : 'm-steel', ['front', 'left', 'right', 'bottom']);
      if (wood) f.quad('m-wood f-top', [x0, s.topMm, -D], [x1 - x0, 0, 0], [0, 0, D]);
      else f.rimmed([x0, s.topMm, -D], [x1 - x0, 0, 0], [0, 0, D], 'm-glass-top', 'm-steel f-rim', GLASS_TOP_RIM_MM);
      return;
    }
    if (s.material === 'wood') {
      f.box(x0, x1, y0, s.topMm, -D, 0, 'm-wood', ['front', 'left', 'right', 'top']);
      return;
    }
    if (s.plate && p.plate) {
      const w = p.plate.widthMm;
      const zf = -p.plate.frontInsetMm;
      const zb = zf - p.plate.depthMm;
      f.rimmed([cx - w / 2, s.topMm, zb], [w, 0, 0], [0, 0, zf - zb], 'm-glass-plate', 'm-glass-rim', GLASS_RIM_MM);
      f.quad(s.thicknessMm > 8 ? 'm-steel f-front' : 'm-glass-edge', [cx - w / 2, s.topMm, zf], [w, 0, 0], [0, -s.thicknessMm, 0]);
      return;
    }
    const ix0 = x0 + post;
    const ix1 = x1 - post;
    if (s.outsideDoor) {
      f.quad('m-mesh', [ix0, s.topMm, -D + post], [ix1 - ix0, 0, 0], [0, 0, D - 2 * post]);
      f.quad('m-steel f-front', [x0, s.topMm, 0], [x1 - x0, 0, 0], [0, -s.thicknessMm, 0]);
      return;
    }
    if (s.material === 'glass') f.rimmed([ix0, s.topMm, -D + post], [ix1 - ix0, 0, 0], [0, 0, D - 2 * post], 'm-glass-plate', 'm-glass-rim', GLASS_RIM_MM);
    else f.quad('m-mesh', [ix0, s.topMm, -D + post], [ix1 - ix0, 0, 0], [0, 0, D - 2 * post]);
    f.quad('m-steel f-front', [x0, s.topMm, 0], [x1 - x0, 0, 0], [0, -s.thicknessMm, 0]);
  });
}

function frameAndLegs(f: Faces, slot: WallSlot): void {
  const p = slot.profile;
  const { leftMm: x0, rightMm: x1 } = slot;
  const D = p.outer.depthMm;
  const H = p.outer.heightMm;
  const sec = p.base.leg?.sectionMm ?? p.panels.sideMm;
  const legTop = p.base.heightMm;
  const side = sideOverhangMm(p);
  const front = p.footprint?.frontOverhangMm ?? 0;
  const corners = [
    { x: x0, z: -sec, dx: -side, dz: front },
    { x: x1 - sec, z: -sec, dx: side, dz: front },
    { x: x0, z: -D, dx: -side, dz: 0 },
    { x: x1 - sec, z: -D, dx: side, dz: 0 },
  ];
  for (const c of corners) f.box(c.x, c.x + sec, legTop, H, c.z, c.z + sec, 'm-steel', ['front', 'left', 'right']);
  for (const c of corners) {
    f.quad('m-steel f-front', [c.x, legTop, c.z + sec], [sec, 0, 0], [c.dx, -legTop, c.dz]);
    f.quad('m-steel f-side', [c.dx < 0 ? c.x : c.x + sec, legTop, c.z], [0, 0, sec], [c.dx, -legTop, c.dz]);
    f.quad('m-steel f-top cab-foot', [c.x + c.dx - 6, 0.5, c.z + c.dz - 4], [sec + 12, 0, 0], [0, 0, sec + 8]);
  }
}

function rods(f: Faces, slot: WallSlot): void {
  const p = slot.profile;
  if (!p.plate) return;
  const floor = caseFloor(p);
  const top = p.surfaces[p.surfaces.length - 1];
  const w = p.plate.widthMm;
  const zf = -p.plate.frontInsetMm;
  const zb = zf - p.plate.depthMm;
  for (const x of [slot.centerMm - w / 2 + 3, slot.centerMm + w / 2 - 9])
    for (const z of [zf - 9, zb + 3]) f.box(x, x + 6, floor.topMm, top.topMm - top.thicknessMm, z, z + 6, 'm-rod', ['front', 'left']);
}

function rack(f: Faces, slot: WallSlot): void {
  const p = slot.profile;
  const { leftMm: x0, rightMm: x1 } = slot;
  const D = p.outer.depthMm;
  const H = p.outer.heightMm;
  const post = p.rack?.postMm ?? 38;
  for (const x of [x0, x1 - post]) for (const z of [-post, -D]) f.box(x, x + post, 0, H, z, z + post, 'm-steel', ['front', 'left', 'right']);
  for (const s of p.surfaces) {
    f.box(x0, x1, s.topMm - s.thicknessMm, s.topMm, -D, 0, 'm-steel', ['front', 'left', 'right', 'bottom']);
    f.quad('m-board', [x0 + post / 2, s.topMm, -D + post / 2], [x1 - x0 - post, 0, 0], [0, 0, D - post]);
  }
}

/** Every face of one cabinet, as the classic view's Cabinet draws it. */
export function cabinetQuads(slot: WallSlot): ColoredQuad[] {
  const f = new Faces();
  const p = slot.profile;
  if (p.frame === 'open-rack') rack(f, slot);
  else {
    if (p.base.style === 'legs') frameAndLegs(f, slot);
    else rods(f, slot);
    surfaces(f, slot);
    panes(f, slot);
  }
  return f.out;
}

/** The room's wall and floor, as wide as the wall and 6 m past it each side (CabinetScene). */
export function roomQuads(wall: WallLayout): ColoredQuad[] {
  const maxDepth = Math.max(...wall.cabinets.map((c) => c.profile.outer.depthMm));
  const zBack = -maxDepth - 450;
  const x0 = wall.leftMm - 6000;
  const w = wall.rightMm - wall.leftMm + 12000;
  return [
    { cls: 'room-wall', a: [x0, 3200, zBack], u: [w, 0, 0], v: [0, -3200, 0], colors: [[0, hex('#2d3037')], [0.55, hex('#23262c')], [1, hex('#1a1c21')]] },
    { cls: 'room-floor', a: [x0, 0, zBack], u: [w, 0, 0], v: [0, 0, 6500], colors: [[0, hex('#121317')], [0.45, hex('#1b1d22')], [1, hex('#262930')]] },
  ];
}

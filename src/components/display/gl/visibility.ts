/**
 * CASE-GL visibility first (Ross 22:5xC 10-13: "compute what would be
 * visible and draw only that"), a coarse CPU pass before the GPU sees a
 * card, each stage counted:
 *
 * 1. frustum: a cabinet whose box draws wholly off the frame takes its cards
 *    with it; then each card whose box draws off the frame;
 * 2. cabinets: one wholly behind a nearer cabinet's opaque front (the presets'
 *    fronts are glass doors or open, so this stage removes none of them today);
 * 3. boards: a shelf whose figures all lie under an opaque board (wood, a
 *    rack's board) from the camera is dropped whole, then each such figure;
 * 4. figures: one wholly behind nearer opaque cards (framed art, plates),
 *    on a coverage grid of COVER_CELL_PX cells: a cell counts as covered only
 *    when an occluder covers it whole, so the test never drops a card that
 *    shows (conservative; the GPU depth buffer resolves the rest per pixel).
 *
 * Every card is flat at its own z, facing the viewer, and the camera stands
 * in front of all of them, so a card at a larger z is nearer along every
 * ray: z orders them exactly. What is left is drawn front to back (early z).
 */
import { project, type Camera, type Vec3 } from '../caseCamera';
import { hiddenUnder, type Board } from '../caseCull';

/** The coverage grid's cell, CSS px. */
export const COVER_CELL_PX = 8;

export interface CabinetBounds {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly z0: number;
  readonly z1: number;
  /** A front nothing behind it shows through (no preset has one: glass doors and open racks). */
  readonly opaqueFront: boolean;
}

/** A card as the cull sees it: flat at z, x0..x1 by y0..y1 (world mm), in its cabinet, on a surface of it. */
export interface CardBox {
  readonly id: number;
  readonly cab: number;
  readonly surface: number;
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly z: number;
  /** Covers what lies behind it everywhere in its box (framed art, a plate); a cut-out does not. */
  readonly opaque: boolean;
}

export interface CullInput {
  readonly camera: Camera;
  readonly panPx: number;
  readonly cabinets: readonly CabinetBounds[];
  readonly boards: (cab: number) => readonly Board[];
  readonly cards: readonly CardBox[];
  /** The frustum's reach past the frame on each side, as a share of it (0: the frame; the atlas prefetches at 0.5). */
  readonly margin?: number;
}

/** Cards in, and how many each stage removed. */
export interface CullStages {
  readonly total: number;
  readonly frustum: number;
  readonly cabinets: number;
  readonly boards: number;
  readonly figures: number;
}

export interface CullResult {
  /** Card ids to draw, front to back. */
  readonly visible: number[];
  /** Cabinets left after the frustum and cabinet stages. */
  readonly cabinets: number[];
  readonly stages: CullStages;
}

interface ScreenRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The screen box of these points; the whole frame when some lie behind the camera, null when all do. */
function screenRect(camera: Camera, panPx: number, points: readonly Vec3[]): ScreenRect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let behind = 0;
  for (const p of points) {
    const s = project(camera, p);
    if (!(s.depth > 0)) {
      behind++;
      continue;
    }
    x0 = Math.min(x0, s.x + panPx);
    x1 = Math.max(x1, s.x + panPx);
    y0 = Math.min(y0, s.y);
    y1 = Math.max(y1, s.y);
  }
  if (behind === points.length) return null;
  if (behind > 0) return { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity };
  return { x0, y0, x1, y1 };
}

const inFrame = (r: ScreenRect | null, w: number, h: number, m = 0): r is ScreenRect =>
  r !== null && r.x1 > -m * w && r.x0 < w + m * w && r.y1 > -m * h && r.y0 < h + m * h;

const boxPoints = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Vec3[] => {
  const out: Vec3[] = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of z0 === z1 ? [z0] : [z0, z1]) out.push([x, y, z]);
  return out;
};

/** A coarse coverage buffer over the frame: which cells nearer occluders cover whole. */
class Coverage {
  private readonly cols: number;
  private readonly rows: number;
  private readonly bits: Uint8Array;
  private readonly w: number;
  private readonly h: number;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.cols = Math.max(1, Math.ceil(w / COVER_CELL_PX));
    this.rows = Math.max(1, Math.ceil(h / COVER_CELL_PX));
    this.bits = new Uint8Array(this.cols * this.rows);
  }

  /** Mark the cells `r` covers whole. */
  cover(r: ScreenRect): void {
    const c0 = Math.max(0, Math.ceil(r.x0 / COVER_CELL_PX));
    const c1 = Math.min(this.cols, Math.floor(r.x1 / COVER_CELL_PX));
    const r0 = Math.max(0, Math.ceil(r.y0 / COVER_CELL_PX));
    const r1 = Math.min(this.rows, Math.floor(r.y1 / COVER_CELL_PX));
    for (let y = r0; y < r1; y++) this.bits.fill(1, y * this.cols + c0, y * this.cols + Math.max(c0, c1));
  }

  /** Whether every cell the in-frame part of `r` touches is covered. */
  covers(r: ScreenRect): boolean {
    const x0 = Math.max(0, r.x0);
    const x1 = Math.min(this.w, r.x1);
    const y0 = Math.max(0, r.y0);
    const y1 = Math.min(this.h, r.y1);
    if (!(x1 > x0 && y1 > y0)) return false;
    const c0 = Math.floor(x0 / COVER_CELL_PX);
    const c1 = Math.min(this.cols, Math.ceil(x1 / COVER_CELL_PX));
    const r0 = Math.floor(y0 / COVER_CELL_PX);
    const r1 = Math.min(this.rows, Math.ceil(y1 / COVER_CELL_PX));
    for (let y = r0; y < r1; y++) for (let x = c0; x < c1; x++) if (this.bits[y * this.cols + x] === 0) return false;
    return true;
  }
}

export function cullCards(input: CullInput): CullResult {
  const { camera, panPx, cabinets, boards, cards, margin = 0 } = input;
  const { width: w, height: h } = camera.frame;
  const rectOf = (pts: readonly Vec3[]) => screenRect(camera, panPx, pts);

  // 1. frustum: cabinets, then cards
  const cabSeen = cabinets.map((c) => inFrame(rectOf(boxPoints(c.x0, c.x1, c.y0, c.y1, c.z0, c.z1)), w, h, margin));
  // 2. cabinets behind a nearer opaque front, nearest fronts first
  const cabHidden = cabinets.map(() => false);
  const fronts = cabinets.map((c, i) => ({ c, i })).sort((a, b) => b.c.z1 - a.c.z1);
  const cabCover = new Coverage(w, h);
  for (let g = 0; g < fronts.length; ) {
    let e = g;
    while (e < fronts.length && fronts[e].c.z1 === fronts[g].c.z1) e++;
    for (let k = g; k < e; k++) {
      const { c, i } = fronts[k];
      const r = rectOf(boxPoints(c.x0, c.x1, c.y0, c.y1, c.z0, c.z1));
      if (cabSeen[i] && r && cabCover.covers(r)) cabHidden[i] = true;
    }
    for (let k = g; k < e; k++) {
      const { c } = fronts[k];
      const r = c.opaqueFront ? rectOf(boxPoints(c.x0, c.x1, c.y0, c.y1, c.z1, c.z1)) : null;
      if (r) cabCover.cover(r);
    }
    g = e;
  }

  let frustum = 0;
  let cabinetStage = 0;
  const rects = new Map<number, ScreenRect>();
  const afterFrustum: CardBox[] = [];
  for (const card of cards) {
    if (!cabSeen[card.cab]) {
      frustum++;
      continue;
    }
    const r = rectOf(boxPoints(card.x0, card.x1, card.y0, card.y1, card.z, card.z));
    if (!inFrame(r, w, h, margin)) {
      frustum++;
      continue;
    }
    if (cabHidden[card.cab]) {
      cabinetStage++;
      continue;
    }
    rects.set(card.id, r);
    afterFrustum.push(card);
  }

  // 3. boards: a shelf's figures together, then one by one
  let boardStage = 0;
  const groups = new Map<string, CardBox[]>();
  for (const card of afterFrustum) {
    const k = `${card.cab}:${card.surface}`;
    const list = groups.get(k);
    if (list) list.push(card);
    else groups.set(k, [card]);
  }
  const afterBoards: CardBox[] = [];
  for (const list of groups.values()) {
    const bs = boards(list[0].cab);
    if (bs.length === 0) {
      afterBoards.push(...list);
      continue;
    }
    const pts = boxPoints(
      Math.min(...list.map((c) => c.x0)),
      Math.max(...list.map((c) => c.x1)),
      Math.min(...list.map((c) => c.y0)),
      Math.max(...list.map((c) => c.y1)),
      Math.min(...list.map((c) => c.z)),
      Math.max(...list.map((c) => c.z)),
    );
    if (bs.some((b) => hiddenUnder(camera, pts, b))) {
      boardStage += list.length;
      continue;
    }
    for (const card of list) {
      const corners = boxPoints(card.x0, card.x1, card.y0, card.y1, card.z, card.z);
      if (bs.some((b) => hiddenUnder(camera, corners, b))) boardStage++;
      else afterBoards.push(card);
    }
  }

  // 4. figures behind nearer opaque cards, front to back
  afterBoards.sort((a, b) => b.z - a.z || a.id - b.id);
  const cover = new Coverage(w, h);
  const visible: number[] = [];
  let figureStage = 0;
  for (const card of afterBoards) {
    const r = rects.get(card.id)!;
    if (cover.covers(r)) {
      figureStage++;
      continue;
    }
    visible.push(card.id);
    if (card.opaque) cover.cover(r);
  }

  return {
    visible,
    cabinets: cabinets.flatMap((_, i) => (cabSeen[i] && !cabHidden[i] ? [i] : [])),
    stages: { total: cards.length, frustum, cabinets: cabinetStage, boards: boardStage, figures: figureStage },
  };
}

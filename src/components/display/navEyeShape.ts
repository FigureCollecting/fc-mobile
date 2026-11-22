/**
 * NAV-EYE shape (Ross 11-22, "fused"; handoff FINAL B, ref 02): the hat and its eye drawn as ONE outline. The eye sits
 * wholly outside the hat's ring, in a bubble at its upper-left, inboard shoulder (EYE_SLOT_DEG); the bubble's arc, more
 * than a semicircle, runs into the ring's outer perimeter on both sides. The ring's arc inside the bubble is a seam of its
 * own (SEAM_PATH), under the eye, as both references draw it. Everything is in the hat's box, 100 units across (its outer
 * radius 50), so the shape scales with the ring (compact or wide, and smaller on a mouse-only desktop). The seam is where
 * a touch changes hands (EYE_HIT): inside the ring is the hat's, outside it the eye's.
 */
import { EYE_BUBBLE, EYE_SLOT_DEG } from './navTuning';

export interface Circle {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

/**
 * How far in (units) each drawn line sits from the edge of what takes the touch: half its 1.5 px stroke (non-scaling)
 * at the smallest hat (the compact ring on a mouse-only desktop, 88.4 px: 0.85 units = 0.75 px), so the line never
 * draws outside the hat's circle or the eye's.
 */
const INSET = 0.85;
const OUTER = 50;
const at = (EYE_SLOT_DEG * Math.PI) / 180;

/** The eye: its bubble's centre and its outer radius (the bubble as drawn lies just inside it). */
export const EYE: Circle = { x: OUTER + EYE_BUBBLE.at * OUTER * Math.cos(at), y: OUTER - EYE_BUBBLE.at * OUTER * Math.sin(at), r: EYE_BUBBLE.r * OUTER };
/** The ring as drawn. */
export const RING: Circle = { x: OUTER, y: OUTER, r: OUTER - INSET };
/** The bubble as drawn. */
export const BUBBLE: Circle = { x: EYE.x, y: EYE.y, r: EYE.r - INSET };

/** The eye glyph's own box (its viewBox, tight round its ink): width over height. */
export const EYE_GLYPH_VIEWBOX = '0.9 4.4 22.2 15.2';
const [, , vbW, vbH] = EYE_GLYPH_VIEWBOX.split(' ').map(Number);
/** The eye glyph's box (units), centred on the bubble. */
export const EYE_GLYPH_BOX = { w: EYE_BUBBLE.glyph * 2 * EYE.r, h: (EYE_BUBBLE.glyph * 2 * EYE.r * vbH) / vbW } as const;

const n = (v: number) => v.toFixed(3);
const pt = (c: Circle, t: number) => `${n(c.x + c.r * Math.cos(t))} ${n(c.y + c.r * Math.sin(t))}`;

/*
 * The fused outline: from one join, the ring's arc the long way round (away from the eye), then the bubble's arc round
 * the eye's far side back to the start. Both arcs run clockwise on screen (sweep 1): the outline of the two circles'
 * union. The joins are where the two drawn circles cross: angle `spread` either side of the eye's direction.
 */
const d = Math.hypot(BUBBLE.x - RING.x, BUBBLE.y - RING.y);
const toward = Math.atan2(BUBBLE.y - RING.y, BUBBLE.x - RING.x);
const spread = Math.acos((RING.r * RING.r - BUBBLE.r * BUBBLE.r + d * d) / (2 * d * RING.r));
const start = pt(RING, toward + spread);
const end = pt(RING, toward - spread);

/** The hat with its eye: one closed outline. */
export const FUSED_PATH = `M ${start} A ${n(RING.r)} ${n(RING.r)} 0 1 1 ${end} A ${n(BUBBLE.r)} ${n(BUBBLE.r)} 0 1 1 ${start} Z`;
/**
 * The seam (Ross 11-22, "like this image": both references draw it): the ring's own arc inside the bubble, from one join
 * to the other the short way, straight under the eye; an open line of its own, in the ring's stroke. The glyph clears it.
 */
export const SEAM_PATH = `M ${end} A ${n(RING.r)} ${n(RING.r)} 0 0 1 ${start}`;
/** The hat with no eye (no Look on offer): the ring alone, two half circles. */
export const RING_PATH = `M ${pt(RING, Math.PI)} A ${n(RING.r)} ${n(RING.r)} 0 1 1 ${pt(RING, 0)} A ${n(RING.r)} ${n(RING.r)} 0 1 1 ${pt(RING, Math.PI)} Z`;

/*
 * What takes a touch (chal2 SHOULD-1, ruling 11-22: what the user sees is what they tap). The seam is the boundary: every
 * press inside the ring as drawn (RING, the seam's circle), the bubble's part over it included, is the hat's; the eye
 * takes only what lies outside it (over the hat's own hit circle, the eye is on top). Cut there, the eye would be
 * shallower than the bubble, so its hit area reaches out past the bubble, away from the ring into the scene, by as much
 * as the ring cuts in (EYE_PAD): from the seam straight out it is the bubble's width again (EYE_HIT_PX on the compact
 * ring). Nothing of it is drawn.
 */
const k = Math.hypot(EYE.x - RING.x, EYE.y - RING.y);
const u = { x: (EYE.x - RING.x) / k, y: (EYE.y - RING.y) / k };
/** How far (units) the eye's hit area reaches out past its bubble: as deep as the ring cuts into the bubble. */
export const EYE_PAD = EYE.r - (k - RING.r);
/** The bubble moved out by the pad: the far end of the eye's hit area. */
const FAR = { x: EYE.x + u.x * EYE_PAD, y: EYE.y + u.y * EYE_PAD };

/** Does the eye take a press at (x, y) (hat units): outside the ring as drawn, within the bubble swept out by the pad. */
export function eyeTakes(x: number, y: number): boolean {
  if (Math.hypot(x - RING.x, y - RING.y) <= RING.r) return false;
  const along = Math.max(0, Math.min(EYE_PAD, (x - EYE.x) * u.x + (y - EYE.y) * u.y));
  return Math.hypot(x - (EYE.x + u.x * along), y - (EYE.y + u.y * along)) <= EYE.r;
}

/** Points along a circle's arc, from angle t0 to t1 (radians), at most `step` apart in angle; both ends included. */
const arc = (c: Circle, t0: number, t1: number, step = Math.PI / 96) => {
  const steps = Math.max(1, Math.ceil(Math.abs(t1 - t0) / step));
  return Array.from({ length: steps + 1 }, (_, i) => ({ x: c.x + c.r * Math.cos(t0 + ((t1 - t0) * i) / steps), y: c.y + c.r * Math.sin(t0 + ((t1 - t0) * i) / steps) }));
};

/**
 * The eye's hit area as a polygon (hat units), its box, and the CSS clip-path that cuts it from that box: the seam's arc
 * between the two joins (where the ring crosses the bubble), the bubble's arc out to its side, straight out by the
 * pad, round the far end, back in, and the bubble's arc to the other join.
 */
export const EYE_HIT = (() => {
  // the joins: on the hat's circle, `reach` either side of the eye's direction (`toward`); seen from the bubble's centre,
  // `side` either side of it
  const reach = Math.acos((RING.r * RING.r + k * k - EYE.r * EYE.r) / (2 * RING.r * k));
  const j = { x: RING.x + RING.r * Math.cos(toward + reach), y: RING.y + RING.r * Math.sin(toward + reach) };
  const off = Math.atan2(j.y - EYE.y, j.x - EYE.x) - toward;
  const side = Math.atan2(Math.sin(off), Math.cos(off));
  const points = [
    ...arc(RING, toward - reach, toward + reach),
    ...arc(EYE, toward + side, toward + Math.PI / 2).slice(1),
    ...arc({ ...FAR, r: EYE.r }, toward + Math.PI / 2, toward - Math.PI / 2),
    ...arc(EYE, toward - Math.PI / 2, toward - side).slice(0, -1),
  ];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  const pc = (v: number) => `${v.toFixed(3)}%`;
  const clip = `polygon(${points.map((p) => `${pc((100 * (p.x - box.x)) / box.w)} ${pc((100 * (p.y - box.y)) / box.h)}`).join(', ')})`;
  return { points, box, clip } as const;
})();

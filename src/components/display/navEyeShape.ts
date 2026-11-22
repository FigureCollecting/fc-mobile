/**
 * NAV-EYE shape (Ross 11-22, "fused"; handoff FINAL B, ref 02): the hat and its eye drawn as ONE outline. The eye sits
 * wholly outside the hat's ring, in a bubble at its upper-left, inboard shoulder (EYE_SLOT_DEG); the bubble's arc, more
 * than a semicircle, runs into the ring's outer perimeter on both sides. The ring's arc inside the bubble is a seam of its
 * own (SEAM_PATH), under the eye, as both references draw it. Everything is in the hat's box, 100 units across (its outer radius 50), so the shape scales with the ring
 * (compact or wide, and smaller on a mouse-only desktop). The bubble is also the eye's hit circle (FloatingNav).
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

/** The eye: its bubble's centre and its hit circle's radius. */
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

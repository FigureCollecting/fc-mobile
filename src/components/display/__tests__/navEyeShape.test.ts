import { describe, it, expect } from 'vitest';
import { BUBBLE, EYE, EYE_GLYPH_BOX, FUSED_PATH, RING, RING_PATH } from '../navEyeShape';
import { EYE_HIT_PX, EYE_SLOT_DEG, HAT_RING_PX, NAV_MOUSE_SCALE } from '../navTuning';

// NAV-EYE shape (Ross 11-22, "fused"): the eye sits wholly OUTSIDE the hat's ring, in a bubble at the ring's upper-left,
// inboard shoulder; the bubble's arc (more than a semicircle) runs into the ring's outer perimeter on both sides, so the
// hat and the eye read as one outline. Everything here is in the hat's box, 100 units across (its outer radius 50).

const C = { x: 50, y: 50 };
const OUTER = 50;
type P = { x: number; y: number };
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
/** The fewest px a unit is: the compact ring on a mouse-only desktop. */
const MIN_PX_PER_UNIT = (HAT_RING_PX.compact * NAV_MOUSE_SCALE) / 100;
/** The outline's stroke is 1.5 px (vector-effect: non-scaling-stroke): half of it reaches out past the path. */
const HALF_STROKE_PX = 0.75;

interface Arc {
  from: P;
  to: P;
  r: number;
  large: boolean;
  sweep: boolean;
}

/** The path's commands: one M, then arcs, then Z (nothing else is allowed in the outline). */
function parse(d: string): { start: P; arcs: Arc[]; closed: boolean; moves: number } {
  const tokens = d.trim().split(/[\s,]+|(?=[MAZmaz])|(?<=[MAZmaz])/).filter(Boolean);
  let i = 0;
  const num = () => Number(tokens[i++]);
  let start: P | null = null;
  let at: P | null = null;
  const arcs: Arc[] = [];
  let closed = false;
  let moves = 0;
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'M') {
      start = at = { x: num(), y: num() };
      moves += 1;
    } else if (cmd === 'A') {
      const rx = num();
      const ry = num();
      expect(ry, 'a circle, not an ellipse').toBe(rx);
      expect(num(), 'no rotation').toBe(0);
      const large = num() === 1;
      const sweep = num() === 1;
      const to = { x: num(), y: num() };
      arcs.push({ from: at!, to, r: rx, large, sweep });
      at = to;
    } else if (cmd === 'Z') {
      closed = true;
    } else {
      throw new Error(`unexpected command ${cmd} in ${d}`);
    }
  }
  return { start: start!, arcs, closed, moves };
}

/** SVG's endpoint-to-centre conversion (SVG 1.1 F.6.5) for a circular arc: the centre the flags choose. */
function centreOf(a: Arc): P {
  const hx = (a.from.x - a.to.x) / 2;
  const hy = (a.from.y - a.to.y) / 2;
  const h2 = hx * hx + hy * hy;
  const k = Math.sqrt(Math.max(0, (a.r * a.r - h2) / h2)) * (a.large === a.sweep ? -1 : 1);
  return { x: k * hy + (a.from.x + a.to.x) / 2, y: -k * hx + (a.from.y + a.to.y) / 2 };
}

describe('NAV-EYE shape: the eye wholly outside the ring', () => {
  it('the eye sits at the upper-left, inboard shoulder (EYE_SLOT_DEG), beyond the ring', () => {
    expect(EYE_SLOT_DEG).toBe(135);
    expect((Math.atan2(C.y - EYE.y, EYE.x - C.x) * 180) / Math.PI).toBeCloseTo(EYE_SLOT_DEG, 6);
    expect(dist(EYE, C), 'the bubble\'s centre is outside the ring: more than a semicircle of it shows').toBeGreaterThan(OUTER);
    // and it reaches into the ring: the two outlines cross (they fuse), at two points
    expect(dist(BUBBLE, C) - BUBBLE.r).toBeLessThan(RING.r);
    expect(dist(BUBBLE, C) + BUBBLE.r).toBeGreaterThan(RING.r);
    expect([BUBBLE.x, BUBBLE.y]).toEqual([EYE.x, EYE.y]);
  });

  it('the eye glyph\'s bounding circle lies entirely outside the ring\'s outer radius', () => {
    const glyphR = Math.hypot(EYE_GLYPH_BOX.w, EYE_GLYPH_BOX.h) / 2;
    expect(dist(EYE, C) - glyphR).toBeGreaterThan(OUTER);
    // and inside the bubble, clear of its line
    expect(glyphR).toBeLessThan(BUBBLE.r - 2);
    // a glyph still big enough to read: 12 px across at the compact ring
    expect((EYE_GLYPH_BOX.w * HAT_RING_PX.compact) / 100).toBeGreaterThanOrEqual(12);
  });

  it('the hit circle is the bubble: at least EYE_HIT_PX across on the compact touch ring', () => {
    expect(EYE_HIT_PX).toBeGreaterThanOrEqual(48);
    expect((2 * EYE.r * HAT_RING_PX.compact) / 100).toBeGreaterThanOrEqual(EYE_HIT_PX);
  });

  it('what is drawn stays inside what takes the touch: the ring\'s and the bubble\'s strokes inside the hat\'s and the eye\'s boxes', () => {
    expect(OUTER - RING.r).toBeGreaterThanOrEqual(HALF_STROKE_PX / MIN_PX_PER_UNIT);
    expect(EYE.r - BUBBLE.r).toBeGreaterThanOrEqual(HALF_STROKE_PX / MIN_PX_PER_UNIT);
    expect([RING.x, RING.y]).toEqual([C.x, C.y]);
  });
});

describe('NAV-EYE shape: one fused outline', () => {
  it('is one closed path: the ring\'s arc then the bubble\'s, sharing both endpoints', () => {
    const p = parse(FUSED_PATH);
    expect(p.moves).toBe(1);
    expect(p.closed).toBe(true);
    expect(p.arcs).toHaveLength(2);
    const [ring, bubble] = p.arcs;
    expect(ring.from).toEqual(p.start);
    expect(dist(ring.to, bubble.from)).toBe(0);
    expect(dist(bubble.to, p.start), 'the bubble\'s arc closes on the ring\'s start').toBeLessThanOrEqual(0.005);
  });

  it('each arc is its own circle\'s, and both joins lie on both circles (within 0.5 px at the widest ring)', () => {
    const [ring, bubble] = parse(FUSED_PATH).arcs;
    const halfPx = 0.5 / (HAT_RING_PX.wide / 100);
    expect(ring.r).toBeCloseTo(RING.r, 2);
    expect(bubble.r).toBeCloseTo(BUBBLE.r, 2);
    expect(dist(centreOf(ring), RING)).toBeLessThanOrEqual(0.01);
    expect(dist(centreOf(bubble), BUBBLE)).toBeLessThanOrEqual(0.01);
    for (const j of [ring.from, ring.to]) {
      expect(Math.abs(dist(j, RING) - RING.r)).toBeLessThanOrEqual(halfPx);
      expect(Math.abs(dist(j, BUBBLE) - BUBBLE.r)).toBeLessThanOrEqual(halfPx);
    }
  });

  it('the ring\'s arc is the long way round, away from the eye; the bubble\'s the part outside the ring: no line crosses the eye', () => {
    const [ring, bubble] = parse(FUSED_PATH).arcs;
    expect(ring.large).toBe(true);
    expect(bubble.large).toBe(true);
    // both traversed the same way round: the outline of the union, not a figure eight
    expect(ring.sweep).toBe(bubble.sweep);
    // the ring's arc never passes inside the bubble, and the bubble's never inside the ring: sample each
    const sample = (a: Arc, c: P, n: number) => {
      const t0 = Math.atan2(a.from.y - c.y, a.from.x - c.x);
      let t1 = Math.atan2(a.to.y - c.y, a.to.x - c.x);
      if (a.sweep) while (t1 <= t0) t1 += 2 * Math.PI;
      else while (t1 >= t0) t1 -= 2 * Math.PI;
      return Array.from({ length: n - 1 }, (_, k) => {
        const t = t0 + ((t1 - t0) * (k + 1)) / n;
        return { x: c.x + a.r * Math.cos(t), y: c.y + a.r * Math.sin(t) };
      });
    };
    for (const q of sample(ring, RING, 72)) expect(dist(q, BUBBLE)).toBeGreaterThan(BUBBLE.r);
    for (const q of sample(bubble, BUBBLE, 72)) expect(dist(q, RING)).toBeGreaterThan(RING.r);
    // the bubble's arc passes the eye's far side: the point straight out from the hat's centre
    const far = { x: EYE.x + ((EYE.x - C.x) / dist(EYE, C)) * BUBBLE.r, y: EYE.y + ((EYE.y - C.y) / dist(EYE, C)) * BUBBLE.r };
    expect(sample(bubble, BUBBLE, 360).some((q) => dist(q, far) < 0.5)).toBe(true);
  });

  it('with no eye (no Look on offer) the hat is the ring alone: one closed circle', () => {
    const p = parse(RING_PATH);
    expect(p.moves).toBe(1);
    expect(p.closed).toBe(true);
    for (const a of p.arcs) {
      expect(a.r).toBeCloseTo(RING.r, 2);
      expect(dist(centreOf(a), RING)).toBeLessThanOrEqual(0.01);
    }
    expect(p.arcs.length).toBe(2);
  });
});

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { JOG_CURVE_POW, JOG_DEAD_PX, JOG_FULL_PX, JOG_FRAMES_PER_S, JOG_MAX_STEP_MS, JOG_MAX_X, JOG_SNAP_DEG, jogDetents, jogSpeed, jogStep } from '../casePose';
import { CULL_MARGIN, RECULL_SHARE } from '../caseCull';

// NAV-JOG (Ross 10-28): the thumb's offset on the bottom-centre button, held, moves the eye that way; the farther it is
// dragged the faster; a frame's step is speed times the time since the last frame.

const W = 443;

describe('jogStep: a held thumb offset to a step of picture travel (px at the anchor depth) this frame', () => {
  it('the constants: a dead zone a tap wobbles in, full speed a thumb reach away, an axis snap, a stalled frame capped', () => {
    expect(JOG_DEAD_PX).toBe(8);
    expect(JOG_FULL_PX).toBe(64);
    expect(JOG_SNAP_DEG).toBe(20);
    expect(JOG_FRAMES_PER_S).toBe(1);
    expect(JOG_MAX_STEP_MS).toBe(100);
    // NAV-2B (Ross 10-31): twice today's top speed, the extra as the sixth power of the reach
    expect(JOG_MAX_X).toBe(2);
    expect(JOG_CURVE_POW).toBe(6);
  });

  it('inside the dead zone, or no time passed, nothing moves', () => {
    expect(jogStep(0, 0, 16, W)).toEqual({ x: 0, y: 0 });
    expect(jogStep(JOG_DEAD_PX, 0, 16, W)).toEqual({ x: 0, y: 0 });
    expect(jogStep(5, -5, 16, W)).toEqual({ x: 0, y: 0 });
    expect(jogStep(60, 0, 0, W)).toEqual({ x: 0, y: 0 });
    expect(jogStep(60, 0, -5, W)).toEqual({ x: 0, y: 0 });
  });

  it('at full reach, two frame widths a second (NAV-2B: twice today\'s), in the direction the thumb points', () => {
    expect(jogStep(JOG_FULL_PX, 0, 1000 / 10, W).x).toBeCloseTo((2 * W) / 10, 9);
    expect(jogStep(-200, 0, 50, W)).toEqual({ x: -W / 10, y: 0 });
    expect(jogStep(0, -JOG_FULL_PX, 50, W)).toEqual({ x: 0, y: -W / 10 });
    expect(jogStep(0, 90, 50, W)).toEqual({ x: 0, y: W / 10 });
    // ?jogmax=1 is today's: one frame width a second
    expect(jogStep(JOG_FULL_PX, 0, 1000 / 10, W, 1).x).toBeCloseTo(W / 10, 9);
  });

  it('speed grows with the drag: jogSpeed of the thumb\'s distance, from the dead zone to full reach', () => {
    const at = (d: number) => jogStep(d, 0, 100, W).x;
    const half = (JOG_DEAD_PX + JOG_FULL_PX) / 2;
    expect(at(half)).toBeCloseTo((W / 10) * jogSpeed(half), 9);
    // the distance is the thumb's, whichever way it points
    expect(Math.hypot(jogStep(30, 40, 100, W).x, jogStep(30, 40, 100, W).y)).toBeCloseTo((W / 10) * jogSpeed(50), 9);
    let prev = 0;
    for (let d = JOG_DEAD_PX + 1; d <= JOG_FULL_PX; d++) {
      expect(at(d)).toBeGreaterThan(prev);
      prev = at(d);
    }
    expect(at(JOG_FULL_PX + 40)).toBe(at(JOG_FULL_PX));
  });

  it('within 20 deg of an axis it moves along that axis only; past it, along the thumb', () => {
    const near = jogStep(60, 60 * Math.tan(19 * (Math.PI / 180)), 50, W);
    expect(near.y).toBe(0);
    expect(near.x).toBeGreaterThan(0);
    const nearUp = jogStep(-60 * Math.tan(15 * (Math.PI / 180)), -60, 50, W);
    expect(nearUp.x).toBe(0);
    expect(nearUp.y).toBeLessThan(0);
    const diagonal = jogStep(50, -50, 50, W);
    expect(diagonal.x).toBeCloseTo(-diagonal.y, 9);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo((JOG_MAX_X * W) / 20, 9);
  });

  it('a frame late by more than 100 ms moves as if 100 ms passed: a stalled phone never leaps', () => {
    expect(jogStep(JOG_FULL_PX, 0, 400, W)).toEqual(jogStep(JOG_FULL_PX, 0, JOG_MAX_STEP_MS, W));
    // at the top speed the most a frame moves is a fifth of a frame width
    expect(jogStep(JOG_FULL_PX, 0, 400, W).x).toBeCloseTo(W / 5, 9);
  });

  it('fuzz: never longer than full speed allows, and never against the thumb', () => {
    fc.assert(
      fc.property(fc.double({ min: -300, max: 300, noNaN: true }), fc.double({ min: -300, max: 300, noNaN: true }), fc.double({ min: 0, max: 500, noNaN: true }), (dx, dy, dt) => {
        const s = jogStep(dx, dy, dt, W);
        expect(Math.hypot(s.x, s.y)).toBeLessThanOrEqual((JOG_MAX_X * W * Math.min(dt, JOG_MAX_STEP_MS)) / 1000 + 1e-9);
        expect(s.x * dx).toBeGreaterThanOrEqual(0);
        expect(s.y * dy).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});

// NAV-2B (Ross 10-31, on the Fold8): the jog is "perfection on movement"; he wants 1.5-2x the top speed and more
// gradations, with the middle he likes unchanged. Today's speed is the square of the reach (dead zone to full reach, a
// frame width a second at full); the new adds (max - 1) times its sixth power, so it keeps today's to within 3 % up to
// 30 px, is 6.25 % faster at half reach, and reaches `max` times today's at full reach.
describe('jogSpeed (NAV-2B): frame widths a second at a thumb distance; today\'s in the middle, up to twice at full reach', () => {
  /** Today's speed (upstream/develop 1fb5561): the square of the reach between 8 and 64 px, a frame width a second at full. */
  const today = (d: number) => Math.min(1, Math.max(0, (d - 8) / 56)) ** 2;

  it('at 12, 20 and 30 px within 3 % of today\'s; within 1 % up to 24 px; at half reach (36 px) 6.25 % faster', () => {
    for (const d of [12, 20, 30]) expect(Math.abs(jogSpeed(d) / today(d) - 1), `${d} px`).toBeLessThan(0.03);
    for (let d = 9; d <= 24; d++) expect(Math.abs(jogSpeed(d) / today(d) - 1), `${d} px`).toBeLessThan(0.01);
    expect(jogSpeed(36) / today(36)).toBeCloseTo(1.0625, 9);
  });

  it('full reach is jogmax times today\'s top: 2 by default, 1.5, and 1 (today\'s curve, every distance)', () => {
    expect(jogSpeed(JOG_FULL_PX)).toBe(2 * JOG_FRAMES_PER_S);
    expect(jogSpeed(JOG_FULL_PX, 1.5)).toBe(1.5);
    expect(jogSpeed(JOG_FULL_PX, 1)).toBe(1);
    for (let d = 0; d <= 100; d += 0.5) expect(jogSpeed(d, 1), `${d} px`).toBeCloseTo(today(d), 12);
    // past full reach is full speed
    expect(jogSpeed(JOG_FULL_PX + 50)).toBe(jogSpeed(JOG_FULL_PX));
  });

  it('none inside the dead zone or for a distance that is not a number; strictly faster from 9 to 64 px at every jogmax', () => {
    for (const d of [0, 4, JOG_DEAD_PX, -20, Number.NaN]) expect(jogSpeed(d)).toBe(0);
    for (const max of [1, 1.5, 2]) {
      let prev = 0;
      for (let d = JOG_DEAD_PX + 1; d <= JOG_FULL_PX; d++) {
        expect(jogSpeed(d, max), `${d} px at ${max}x`).toBeGreaterThan(prev);
        prev = jogSpeed(d, max);
      }
    }
  });

  it('the detents: 0.5x and 1x today\'s top and the top itself, in order; at 1x, only two', () => {
    expect(jogDetents()).toEqual([0.5, 1, 2]);
    expect(jogDetents(1.5)).toEqual([0.5, 1, 1.5]);
    expect(jogDetents(1)).toEqual([0.5, 1]);
    // where they fall at 2x: today's top at about 54 px (r 0.83), the new top at full reach
    const at = (level: number) => {
      let d = JOG_DEAD_PX;
      while (jogSpeed(d) < level) d += 0.01;
      return d;
    };
    expect(at(0.5)).toBeCloseTo(44.5, 0);
    expect(at(1)).toBeCloseTo(54.3, 0);
    expect((at(1) - JOG_DEAD_PX) / (JOG_FULL_PX - JOG_DEAD_PX)).toBeCloseTo(0.83, 2);
    expect(at(2)).toBeCloseTo(JOG_FULL_PX, 1);
  });

  it('one late frame at the top speed steps less than a kept cull holds in hand: a re-cull a frame late still covers it (why jogmax stops at 2)', () => {
    // a kept cull (stickyPose) has the frame within CULL_MARGIN - RECULL_SHARE of it; the next frame, 100 ms late at
    // most, moves the picture jogSpeed x 0.1 frame widths at the anchor depth: still inside what the cull drew
    const step = (jogSpeed(JOG_FULL_PX) * JOG_MAX_STEP_MS) / 1000;
    expect(step).toBeCloseTo(0.2, 9);
    expect(CULL_MARGIN - RECULL_SHARE + step).toBeLessThan(CULL_MARGIN);
    // 3x would not be: a fifth more than the share in hand
    expect((jogSpeed(JOG_FULL_PX, 3) * JOG_MAX_STEP_MS) / 1000).toBeGreaterThan(RECULL_SHARE);
  });
});

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { JOG_DEAD_PX, JOG_FULL_PX, JOG_FRAMES_PER_S, JOG_MAX_STEP_MS, JOG_SNAP_DEG, jogStep } from '../casePose';

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
  });

  it('inside the dead zone, or no time passed, nothing moves', () => {
    expect(jogStep(0, 0, 16, W)).toEqual({ x: 0, y: 0 });
    expect(jogStep(JOG_DEAD_PX, 0, 16, W)).toEqual({ x: 0, y: 0 });
    expect(jogStep(5, -5, 16, W)).toEqual({ x: 0, y: 0 });
    expect(jogStep(60, 0, 0, W)).toEqual({ x: 0, y: 0 });
    expect(jogStep(60, 0, -5, W)).toEqual({ x: 0, y: 0 });
  });

  it('at full reach, one frame width a second, in the direction the thumb points', () => {
    expect(jogStep(JOG_FULL_PX, 0, 1000 / 10, W).x).toBeCloseTo(W / 10, 9);
    expect(jogStep(-200, 0, 50, W)).toEqual({ x: -W / 20, y: 0 });
    expect(jogStep(0, -JOG_FULL_PX, 50, W)).toEqual({ x: 0, y: -W / 20 });
    expect(jogStep(0, 90, 50, W)).toEqual({ x: 0, y: W / 20 });
  });

  it('speed grows with the drag: quadratic from the dead zone to full reach', () => {
    const at = (d: number) => jogStep(d, 0, 100, W).x;
    const half = (JOG_DEAD_PX + JOG_FULL_PX) / 2;
    expect(at(half)).toBeCloseTo((W / 10) * 0.25, 9);
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
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(W / 20, 9);
  });

  it('a frame late by more than 100 ms moves as if 100 ms passed: a stalled phone never leaps', () => {
    expect(jogStep(JOG_FULL_PX, 0, 400, W)).toEqual(jogStep(JOG_FULL_PX, 0, JOG_MAX_STEP_MS, W));
  });

  it('fuzz: never longer than full speed allows, and never against the thumb', () => {
    fc.assert(
      fc.property(fc.double({ min: -300, max: 300, noNaN: true }), fc.double({ min: -300, max: 300, noNaN: true }), fc.double({ min: 0, max: 500, noNaN: true }), (dx, dy, dt) => {
        const s = jogStep(dx, dy, dt, W);
        expect(Math.hypot(s.x, s.y)).toBeLessThanOrEqual((W * Math.min(dt, JOG_MAX_STEP_MS)) / 1000 + 1e-9);
        expect(s.x * dx).toBeGreaterThanOrEqual(0);
        expect(s.y * dy).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});

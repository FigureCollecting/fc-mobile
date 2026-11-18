import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  JOG_DEAD_PX,
  JOG_FULL_PX,
  JOG_MAX_STEP_MS,
  LOOK_DEG_PER_S,
  LOOK_MAX_X,
  LOOK_TICK_BACK,
  PITCH,
  cone,
  jogSpeed,
  jogStep,
  look,
  lookSpeed,
  lookStep,
  lookWind,
  turn,
  turnBy,
  turnInside,
  turnRaw,
  type Pose,
  type YawCone,
} from '../casePose';

// NAV-LOOKDRIVE (nav rework U4): a Look driven by a rate (the hat held off its centre turns the eye at an angular speed)
// goes through the very cone a scene Look does: turnBy holds turn's limits, and turn is turnBy of its bearings' angles.

const DEG = Math.PI / 180;
const POSE: Pose = { x: 0, y: 1200, z: 2500, yaw: 0, pitch: 0 };
const HALF_PX = JOG_DEAD_PX + (JOG_FULL_PX - JOG_DEAD_PX) / 2;

/** turn as it stood before turnBy (b22fcf5 casePose.ts:117-133), kept here word for word: what scene Look must stay. */
function turnBefore(start: Pose, a0: number, b0: number, a1: number, b1: number, limits: YawCone): { committed: Pose; shown: Pose; past: boolean } {
  const raw = look(start, a0, b0, a1, b1);
  const side = (at: number, lo: number, hi: number, hardLo: number, hardHi: number, value: number) => {
    const l = Math.min(lo, at);
    const h = Math.max(hi, at);
    return cone(value, l, h, Math.min(hardLo, l), Math.max(hardHi, h));
  };
  const l = limits.left ?? limits;
  const r = limits.right ?? limits;
  const yaw = side(start.yaw, -l.soft, r.soft, -l.hard, r.hard, raw.yaw);
  const pitch = side(start.pitch, -PITCH.upSoft, PITCH.downSoft, -PITCH.upHard, PITCH.downHard, raw.pitch);
  return {
    committed: { ...start, yaw: yaw.committed, pitch: pitch.committed },
    shown: { ...start, yaw: yaw.shown, pitch: pitch.shown },
    past: yaw.past || pitch.past,
  };
}

type Turned = { committed: Pose; shown: Pose; past: boolean };
const AXES = ['x', 'y', 'z', 'yaw', 'pitch'] as const;
/** Two turns are the same bit for bit: every field of both poses (Object.is: a signed zero and a NaN told apart), no field more, and `past`. */
function same(a: Turned, b: Turned): boolean {
  for (const k of ['committed', 'shown'] as const) {
    if (Object.keys(a[k]).length !== AXES.length || Object.keys(b[k]).length !== AXES.length) return false;
    for (const axis of AXES) if (!Object.is(a[k][axis], b[k][axis])) return false;
  }
  return a.past === b.past;
}

const sideArb =fc.record({ soft: fc.double({ min: 0, max: 45, noNaN: true }), band: fc.double({ min: 0, max: 15, noNaN: true }) }).map(({ soft, band }) => ({ soft: soft * DEG, hard: (soft + band) * DEG }));
const limitsArb: fc.Arbitrary<YawCone> = fc
  .record({ both: sideArb, left: fc.option(sideArb, { nil: undefined }), right: fc.option(sideArb, { nil: undefined }) })
  .map(({ both, left, right }) => ({ ...both, ...(left ? { left } : {}), ...(right ? { right } : {}) }));
/** A start anywhere a pose may stand turned, past the limits included (turn holds it there). */
const startArb: fc.Arbitrary<Pose> = fc
  .record({ yaw: fc.double({ min: -70, max: 70, noNaN: true }), pitch: fc.double({ min: -50, max: 75, noNaN: true }) })
  .map(({ yaw, pitch }) => ({ ...POSE, yaw: yaw * DEG, pitch: pitch * DEG }));
/** A finger's bearing: the tangent of an angle within 80 deg of the frame's centre. */
const bearingArb = fc.double({ min: -80, max: 80, noNaN: true }).map((deg) => Math.tan(deg * DEG));

describe('(f) turn is turnBy of its bearings\' angles: scene Look is what it was', () => {
  it('10,000 random bearings within 80 deg, starts and cones: turn equals the turn before turnBy, bit for bit', () => {
    fc.assert(
      fc.property(startArb, bearingArb, bearingArb, bearingArb, bearingArb, limitsArb, (start, a0, b0, a1, b1, limits) => {
        return same(turn(start, a0, b0, a1, b1, limits), turnBefore(start, a0, b0, a1, b1, limits));
      }),
      { numRuns: 10_000, seed: 20261117 },
    );
  }, 60_000);

  it('10,000 random bearings: turn equals turnBy(atan a0 - atan a1, atan b1 - atan b0), bit for bit', () => {
    fc.assert(
      fc.property(startArb, bearingArb, bearingArb, bearingArb, bearingArb, limitsArb, (start, a0, b0, a1, b1, limits) => {
        return same(turn(start, a0, b0, a1, b1, limits), turnBy(start, Math.atan(a0) - Math.atan(a1), Math.atan(b1) - Math.atan(b0), limits));
      }),
      { numRuns: 10_000, seed: 1117 },
    );
  }, 60_000);

  it('the comparison itself tells a last-bit difference, a signed zero and an extra field (a roll) apart', () => {
    const t = turnBy(POSE, 0.1, 0.2, { soft: 30 * DEG, hard: 45 * DEG });
    expect(same(t, turnBy(POSE, 0.1, 0.2, { soft: 30 * DEG, hard: 45 * DEG }))).toBe(true);
    expect(same(t, { ...t, shown: { ...t.shown, yaw: t.shown.yaw + Number.EPSILON / 8 } })).toBe(false);
    expect(same(t, { ...t, committed: { ...t.committed, x: -0 } })).toBe(false);
    expect(same(t, { ...t, past: !t.past })).toBe(false);
    expect(same(t, { ...t, shown: { ...t.shown, roll: 0 } as Pose })).toBe(false);
  });

  it('turnBy: inside the cone the turn asked for; past it committed at soft and shown short of hard; a start past a limit is held there', () => {
    const limits: YawCone = { soft: 30 * DEG, hard: 45 * DEG, right: { soft: 10 * DEG, hard: 25 * DEG } };
    const inside = turnBy(POSE, 5 * DEG, -10 * DEG, limits);
    expect(inside).toEqual({ committed: { ...POSE, yaw: 5 * DEG, pitch: -10 * DEG }, shown: { ...POSE, yaw: 5 * DEG, pitch: -10 * DEG }, past: false });
    const right = turnBy(POSE, 200 * DEG, 0, limits);
    expect(right.committed.yaw).toBe(10 * DEG);
    expect(right.shown.yaw).toBeGreaterThan(10 * DEG);
    expect(right.shown.yaw).toBeLessThan(25 * DEG);
    expect(right.past).toBe(true);
    // a turn of more than a quarter circle keeps its sign: no wrap (the bearings' tangents would flip it)
    expect(turnBy(POSE, -200 * DEG, 0, limits).shown.yaw).toBeLessThan(-30 * DEG);
    expect(turnBy(POSE, -200 * DEG, 0, limits).shown.yaw).toBeGreaterThan(-45 * DEG);
    const up = turnBy(POSE, 0, -400 * DEG, limits);
    expect(up.committed.pitch).toBe(-PITCH.upSoft);
    expect(up.shown.pitch).toBeGreaterThan(-PITCH.upHard);
    const held = turnBy({ ...POSE, yaw: 40 * DEG }, 0, 0, limits);
    expect(held.committed.yaw).toBe(40 * DEG);
    expect(held.past).toBe(false);
    // no roll: a pose is its eye, yaw and pitch
    expect(Object.keys(right.shown).sort()).toEqual(['pitch', 'x', 'y', 'yaw', 'z']);
  });
});

describe('lookSpeed and lookStep: the jog\'s curve, in angle', () => {
  it('45 deg a second times r^2 + (max - 1) r^6 of the reach: none in the dead zone, about 12 deg/s at half reach, 90 at full', () => {
    expect(LOOK_DEG_PER_S).toBe(45);
    expect(LOOK_MAX_X).toBe(2);
    expect(lookSpeed(0)).toBe(0);
    expect(lookSpeed(JOG_DEAD_PX)).toBe(0);
    expect(lookSpeed(HALF_PX) / DEG).toBeCloseTo(45 * (0.25 + 1 / 64), 9);
    expect(lookSpeed(JOG_FULL_PX) / DEG).toBeCloseTo(90, 9);
    expect(lookSpeed(500) / DEG).toBeCloseTo(90, 9);
    expect(lookSpeed(JOG_FULL_PX, 1) / DEG).toBeCloseTo(45, 9);
    // the jog's own curve, whatever the reach
    for (const d of [9, 20, 36, 50, 64]) expect(lookSpeed(d, 1.5)).toBeCloseTo(45 * DEG * jogSpeed(d, 1.5), 12);
  });

  it('thumb right turns right (yaw +), thumb up looks up (pitch -); within 20 deg of an axis that axis only; a diagonal both', () => {
    const right = lookStep(JOG_FULL_PX, 0, 100);
    expect(right.yaw / DEG).toBeCloseTo(9, 9);
    expect(right.pitch).toBe(0);
    const up = lookStep(0, -JOG_FULL_PX, 100);
    expect(up.yaw).toBe(0);
    expect(up.pitch / DEG).toBeCloseTo(-9, 9);
    // 15 deg off the x axis: snapped to it
    const near = lookStep(60, 60 * Math.tan(15 * DEG), 16);
    expect(near.pitch).toBe(0);
    expect(near.yaw).toBeGreaterThan(0);
    const diag = lookStep(-50, 50, 16);
    expect(diag.yaw).toBeLessThan(0);
    expect(diag.pitch).toBeGreaterThan(0);
    expect(diag.pitch).toBeCloseTo(-diag.yaw, 12);
  });

  it('nothing in the dead zone or with no time; a late frame turns as JOG_MAX_STEP_MS would; the jog\'s step in radians', () => {
    expect(lookStep(JOG_DEAD_PX, 0, 16)).toEqual({ yaw: 0, pitch: 0 });
    expect(lookStep(JOG_FULL_PX, 0, 0)).toEqual({ yaw: 0, pitch: 0 });
    expect(lookStep(JOG_FULL_PX, 0, 5000)).toEqual(lookStep(JOG_FULL_PX, 0, JOG_MAX_STEP_MS));
    const jog = jogStep(40, -30, 16, 45 * DEG, 2);
    expect(lookStep(40, -30, 16, 2)).toEqual({ yaw: jog.x, pitch: jog.y });
  });
});

describe('anti-windup: a turn held against a limit asks no further than its hard limit', () => {
  const limits: YawCone = { soft: 30 * DEG, hard: 45 * DEG };

  it('inside, the step is added as it is; outward past the hard limit the turn asked for stops there, each axis on its own', () => {
    expect(lookWind(POSE, 5 * DEG, 0, { yaw: 2 * DEG, pitch: -1 * DEG }, limits)).toEqual({ dYaw: 5 * DEG + 2 * DEG, dPitch: -1 * DEG });
    const right = lookWind(POSE, 44 * DEG, 0, { yaw: 9 * DEG, pitch: 3 * DEG }, limits);
    expect(right.dYaw).toBe(45 * DEG);
    expect(right.dPitch).toBe(3 * DEG);
    const left = lookWind(POSE, -44 * DEG, 0, { yaw: -9 * DEG, pitch: 0 }, limits);
    expect(left.dYaw).toBe(-45 * DEG);
    expect(lookWind(POSE, 0, 69 * DEG, { yaw: 0, pitch: 9 * DEG }, limits).dPitch).toBe(PITCH.downHard);
    expect(lookWind(POSE, 0, -44 * DEG, { yaw: 0, pitch: -9 * DEG }, limits).dPitch).toBe(-PITCH.upHard);
  });

  it('held there 10 s the turn asked for stands at the hard limit, and the first step back moves it: no windup', () => {
    let raw = { dYaw: 0, dPitch: 0 };
    for (let i = 0; i < 625; i++) raw = lookWind(POSE, raw.dYaw, raw.dPitch, lookStep(JOG_FULL_PX, 0, 16), limits);
    expect(raw.dYaw).toBe(45 * DEG);
    const held = turnBy(POSE, raw.dYaw, raw.dPitch, limits).shown.yaw;
    expect(held).toBeLessThan(45 * DEG);
    const back = lookWind(POSE, raw.dYaw, raw.dPitch, lookStep(-JOG_FULL_PX, 0, 16), limits);
    expect(turnBy(POSE, back.dYaw, back.dPitch, limits).shown.yaw).toBeLessThan(held - 0.5 * DEG);
  });

  it('a turn already asked for past the hard limit (taken over from a deeper look) is never pulled in, only stopped going out; back, it moves', () => {
    const deep = lookWind(POSE, 80 * DEG, 0, { yaw: 1 * DEG, pitch: 0 }, limits);
    expect(deep.dYaw).toBe(80 * DEG);
    expect(lookWind(POSE, 80 * DEG, 0, { yaw: -1 * DEG, pitch: 0 }, limits).dYaw).toBeCloseTo(79 * DEG, 12);
    const low = lookWind(POSE, -80 * DEG, 0, { yaw: -1 * DEG, pitch: 0 }, limits);
    expect(low.dYaw).toBe(-80 * DEG);
  });

  it('from a start past the limits (held where it began) the hard limit is the start\'s: nothing more is asked that way', () => {
    const start = { ...POSE, yaw: 50 * DEG };
    expect(lookWind(start, 0, 0, { yaw: 5 * DEG, pitch: 0 }, limits).dYaw).toBe(0);
    expect(lookWind(start, 0, 0, { yaw: -5 * DEG, pitch: 0 }, limits).dYaw).toBe(-5 * DEG);
  });
});

describe('turnRaw: the turn asked for that shows a given aim (a look taken over mid-ease starts where it is drawn)', () => {
  const limits: YawCone = { soft: 30 * DEG, hard: 45 * DEG, left: { soft: 12 * DEG, hard: 20 * DEG } };

  it('10,000 random turns: turnBy of turnRaw of what a turn shows, shows it again (within 1e-9 rad)', () => {
    fc.assert(
      fc.property(startArb, fc.double({ min: -60, max: 60, noNaN: true }), fc.double({ min: -40, max: 40, noNaN: true }), limitsArb, (start, dy, dp, cone) => {
        const t = turnBy(start, dy * DEG, dp * DEG, cone);
        const raw = turnRaw(start, t.shown.yaw, t.shown.pitch, cone);
        const again = turnBy(start, raw.dYaw, raw.dPitch, cone);
        const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
        return (
          near(again.shown.yaw, t.shown.yaw) &&
          near(again.shown.pitch, t.shown.pitch) &&
          near(again.committed.yaw, t.committed.yaw) &&
          near(again.committed.pitch, t.committed.pitch) &&
          Number.isFinite(raw.dYaw) &&
          Number.isFinite(raw.dPitch)
        );
      }),
      { numRuns: 10_000, seed: 4 },
    );
  }, 60_000);

  it('inside the cone, the aim itself; in a band, the turn past its soft limit that the band shows there, either way', () => {
    expect(turnRaw(POSE, 10 * DEG, -5 * DEG, limits)).toEqual({ dYaw: 10 * DEG, dPitch: -5 * DEG });
    const right = turnRaw(POSE, 37.5 * DEG, 0, limits);
    expect(right.dYaw / DEG).toBeCloseTo(30 + 15 * Math.LN2, 9);
    const left = turnRaw(POSE, -16 * DEG, 0, limits);
    expect(left.dYaw / DEG).toBeCloseTo(-(12 + 8 * Math.LN2), 9);
    const down = turnRaw(POSE, 0, PITCH.downSoft + 12.5 * DEG, limits);
    expect(down.dPitch / DEG).toBeCloseTo(45 + 25 * Math.LN2, 9);
  });

  it('an aim at or past a hard limit, or past a limit with no band, is finite: the deepest the band shows; none where there is no band', () => {
    const at = turnRaw(POSE, 45 * DEG, 0, limits);
    expect(Number.isFinite(at.dYaw)).toBe(true);
    expect(at.dYaw).toBeGreaterThan(45 * DEG);
    expect(turnBy(POSE, at.dYaw, 0, limits).shown.yaw).toBeLessThanOrEqual(45 * DEG);
    expect(turnRaw(POSE, 80 * DEG, 0, limits).dYaw).toBe(at.dYaw);
    const flat: YawCone = { soft: 20 * DEG, hard: 20 * DEG };
    expect(turnRaw(POSE, 25 * DEG, 0, flat).dYaw).toBe(20 * DEG);
    expect(turnRaw(POSE, -25 * DEG, 0, flat).dYaw).toBe(-20 * DEG);
  });
});

describe('turnInside: the turn is back inside both soft limits by a margin (the soft-limit tick arms again)', () => {
  const limits: YawCone = { soft: 30 * DEG, hard: 45 * DEG };

  it('1 deg of hysteresis: inside by it either way on both axes, true; nearer a limit or past it, false', () => {
    expect(LOOK_TICK_BACK).toBe(1 * DEG);
    expect(turnInside(POSE, 0, 0, limits, LOOK_TICK_BACK)).toBe(true);
    expect(turnInside(POSE, 28.9 * DEG, 0, limits, LOOK_TICK_BACK)).toBe(true);
    expect(turnInside(POSE, 29.5 * DEG, 0, limits, LOOK_TICK_BACK)).toBe(false);
    expect(turnInside(POSE, 31 * DEG, 0, limits, LOOK_TICK_BACK)).toBe(false);
    expect(turnInside(POSE, -29.5 * DEG, 0, limits, LOOK_TICK_BACK)).toBe(false);
    expect(turnInside(POSE, 0, 44.5 * DEG, limits, LOOK_TICK_BACK)).toBe(false);
    expect(turnInside(POSE, 0, -29.5 * DEG, limits, LOOK_TICK_BACK)).toBe(false);
    expect(turnInside(POSE, 0, -28 * DEG, limits, LOOK_TICK_BACK)).toBe(true);
  });
});

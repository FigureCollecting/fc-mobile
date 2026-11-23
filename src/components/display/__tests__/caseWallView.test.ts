import { describe, it, expect } from 'vitest';
import { PITCH_CAP_STEP, WALL_KEEP_FRAME, keepsWall, pitchCap, turnKept, wallAway, wallKept, wallShown } from '../caseWallView';
import { PITCH, coneIn, lookWind, poseOf, turnBy, turnInside, withPose, type Pose, type YawCone } from '../casePose';
import { sideOverhangMm } from '../cabinetProfile';
import { freeSceneOf } from './freeDrivesScene';

// NAV-EMPTY (Ross 11-22): whether the frame still holds the wall, how far a Look may turn before it does not, and that
// cap through the one limit path of every Look (casePose's spansOf).

const DEG = Math.PI / 180;
const scene = freeSceneOf({ frame: { width: 1536, height: 730 } });
const base = poseOf(scene.base);
const cam = (p: Partial<Pose>) => withPose(scene.base, { ...base, ...p });
const TOP = { y: 2388.4, z: 3639.8 };
const BOTTOM = { y: 300, z: 3639.8 };

describe('wallShown: some cabinet front is in the frame', () => {
  it('at the framing, and from the room\'s top and bottom at the framing\'s depth', () => {
    expect(wallShown(scene.base, scene.wall)).toBe(true);
    expect(wallShown(cam(TOP), scene.wall)).toBe(true);
    expect(wallShown(cam(BOTTOM), scene.wall)).toBe(true);
  });

  it('not over the cabinets\' tops, nor looking up 30 degrees from the room\'s top, nor down 45 from its bottom', () => {
    expect(wallShown(cam({ ...TOP, z: 0 }), scene.wall)).toBe(false);
    expect(wallShown(cam({ ...TOP, pitch: -PITCH.upSoft }), scene.wall)).toBe(false);
    expect(wallShown(cam({ ...BOTTOM, pitch: PITCH.downSoft }), scene.wall)).toBe(false);
  });

  it('not past the wall\'s end, turned away from it', () => {
    expect(wallShown(cam({ x: scene.wall.rightMm + 3000, yaw: 60 * DEG }), scene.wall)).toBe(false);
  });

  it('inset, asks about the frame\'s middle: a front at the frame\'s edge alone shows at 0 and not an eighth in', () => {
    // level at the room's top, nearer and nearer: the cabinets' tops sink to the frame's bottom edge, then out of it
    let z = TOP.z;
    while (wallShown(cam({ ...TOP, z }), scene.wall, WALL_KEEP_FRAME)) z -= 20;
    expect(wallShown(cam({ ...TOP, z }), scene.wall)).toBe(true);
    expect(wallShown(cam({ ...TOP, z: z - 100 }), scene.wall)).toBe(true);
    let gone = z;
    while (wallShown(cam({ ...TOP, z: gone }), scene.wall)) gone -= 20;
    expect(z - gone).toBeGreaterThan(200);
  });
});

describe('wallKept: how well the frame holds the wall', () => {
  it('an eighth in where a front reaches the frame\'s middle; 0 where one shows only at its edge; nothing where none shows', () => {
    expect(WALL_KEEP_FRAME).toBe(1 / 8);
    expect(wallKept(scene.base, scene.wall)).toBe(WALL_KEEP_FRAME);
    expect(wallKept(cam(TOP), scene.wall)).toBe(WALL_KEEP_FRAME);
    let z = TOP.z;
    while (wallShown(cam({ ...TOP, z }), scene.wall, WALL_KEEP_FRAME)) z -= 20;
    expect(wallKept(cam({ ...TOP, z }), scene.wall)).toBe(0);
    expect(wallKept(cam({ ...TOP, z: 0 }), scene.wall)).toBeUndefined();
  });
});

describe('pitchCap: the furthest a Look rests with the wall still held', () => {
  it('at the room\'s top: up is capped at the last pitch that holds a front an eighth in, to PITCH_CAP_STEP; down is PITCH\'s', () => {
    const cap = pitchCap(cam(TOP), scene.wall)!;
    expect(cap.hi).toBeUndefined();
    expect(cap.lo!).toBeLessThan(-2 * DEG);
    expect(cap.lo!).toBeGreaterThan(-PITCH.upSoft);
    expect(wallShown(cam({ ...TOP, pitch: cap.lo! }), scene.wall, WALL_KEEP_FRAME)).toBe(true);
    expect(wallShown(cam({ ...TOP, pitch: cap.lo! - PITCH_CAP_STEP }), scene.wall, WALL_KEEP_FRAME)).toBe(false);
  });

  it('at the room\'s bottom: down is capped the same way; up is PITCH\'s', () => {
    const cap = pitchCap(cam(BOTTOM), scene.wall)!;
    expect(cap.lo).toBeUndefined();
    expect(cap.hi!).toBeGreaterThan(5 * DEG);
    expect(cap.hi!).toBeLessThan(PITCH.downSoft);
    expect(wallShown(cam({ ...BOTTOM, pitch: cap.hi! }), scene.wall, WALL_KEEP_FRAME)).toBe(true);
    expect(wallShown(cam({ ...BOTTOM, pitch: cap.hi! + PITCH_CAP_STEP }), scene.wall, WALL_KEEP_FRAME)).toBe(false);
  });

  it('from a frame with a front only at its edge, the cap keeps that much: the last pitch that shows one at all', () => {
    let z = TOP.z;
    while (wallShown(cam({ ...TOP, z }), scene.wall, WALL_KEEP_FRAME)) z -= 20;
    const edge = cam({ ...TOP, z: z - 100 });
    const cap = pitchCap(edge, scene.wall)!;
    expect(cap.lo!).toBeLessThan(0);
    expect(wallShown({ ...edge, pitch: cap.lo! }, scene.wall)).toBe(true);
    expect(wallShown({ ...edge, pitch: cap.lo! - PITCH_CAP_STEP }, scene.wall)).toBe(false);
  });

  it('through a long lens both ways are capped, each side of the pitch the camera has', () => {
    const long = { ...cam({ pitch: 2 * DEG }), focalPx: scene.base.focalPx * 6 };
    const cap = pitchCap(long, scene.wall)!;
    expect(cap.lo!).toBeLessThan(2 * DEG);
    expect(cap.lo!).toBeGreaterThan(-PITCH.upSoft);
    expect(cap.hi!).toBeGreaterThan(2 * DEG);
    expect(cap.hi!).toBeLessThan(PITCH.downSoft);
  });

  it('none where both soft limits still show a front', () => {
    const near = cam({ y: 1000, z: 500 });
    expect(wallShown({ ...near, pitch: -PITCH.upSoft }, scene.wall)).toBe(true);
    expect(wallShown({ ...near, pitch: PITCH.downSoft }, scene.wall)).toBe(true);
    expect(pitchCap(near, scene.wall)).toBeUndefined();
  });

  it('none where the camera shows no front as it is: nothing to keep, and a Look may bring the wall back', () => {
    expect(pitchCap(cam({ ...TOP, pitch: -PITCH.upSoft }), scene.wall)).toBeUndefined();
    expect(pitchCap(cam({ ...TOP, z: 0 }), scene.wall)).toBeUndefined();
  });

  it('a side the camera is at or past already is left out (turnBy holds a turn where it began)', () => {
    // a lens wide enough to show the wall from at and past the soft limits
    const wide = (p: Partial<Pose>) => ({ ...cam(p), focalPx: scene.base.focalPx / 4 });
    const up = wide({ ...TOP, pitch: -PITCH.upSoft });
    expect(wallShown(up, scene.wall)).toBe(true);
    expect(pitchCap(up, scene.wall)?.lo).toBeUndefined();
    const down = wide({ ...BOTTOM, pitch: PITCH.downSoft + 1 * DEG });
    expect(wallShown(down, scene.wall)).toBe(true);
    expect(pitchCap(down, scene.wall)?.hi).toBeUndefined();
  });
});

describe('the pitch cap through a Look\'s limits (spansOf)', () => {
  const yaw = { soft: 40 * DEG, hard: 55 * DEG };
  const level: Pose = { x: 0, y: 2388.4, z: 3000, yaw: 0, pitch: 0 };
  const capped: YawCone = { ...yaw, pitch: { lo: -12 * DEG, hi: 20 * DEG } };

  it('a turn up rests at the cap, shown past it in PITCH\'s band, never to the band\'s end', () => {
    const t = turnBy(level, 0, -60 * DEG, capped);
    expect(t.committed.pitch).toBeCloseTo(-12 * DEG, 12);
    expect(t.past).toBe(true);
    expect(t.shown.pitch).toBeLessThan(-12 * DEG);
    expect(t.shown.pitch).toBeGreaterThan(-12 * DEG - (PITCH.upHard - PITCH.upSoft));
  });

  it('a turn down the same, with the down band', () => {
    const t = turnBy(level, 0, 80 * DEG, capped);
    expect(t.committed.pitch).toBeCloseTo(20 * DEG, 12);
    expect(t.shown.pitch).toBeGreaterThan(20 * DEG);
    expect(t.shown.pitch).toBeLessThan(20 * DEG + (PITCH.downHard - PITCH.downSoft));
  });

  it('inside the cap a turn is itself', () => {
    const t = turnBy(level, 0, -10 * DEG, capped);
    expect(t.committed.pitch).toBeCloseTo(-10 * DEG, 12);
    expect(t.shown.pitch).toBe(t.committed.pitch);
    expect(t.past).toBe(false);
  });

  it('with no cap, one side\'s, or one past PITCH\'s soft limit, the other limits are PITCH\'s exactly', () => {
    for (const limits of [yaw, { ...yaw, pitch: {} }, { ...yaw, pitch: { lo: -40 * DEG, hi: 50 * DEG } }] as YawCone[]) {
      expect(turnBy(level, 0, -80 * DEG, limits).committed.pitch).toBe(-PITCH.upSoft);
      expect(turnBy(level, 0, 80 * DEG, limits).committed.pitch).toBe(PITCH.downSoft);
      expect(turnBy(level, 0, -80 * DEG, limits).shown.pitch).toBe(turnBy(level, 0, -80 * DEG, yaw).shown.pitch);
    }
    expect(turnBy(level, 0, 80 * DEG, { ...yaw, pitch: { lo: -12 * DEG } }).committed.pitch).toBe(PITCH.downSoft);
    expect(turnBy(level, 0, -80 * DEG, { ...yaw, pitch: { hi: 20 * DEG } }).committed.pitch).toBe(-PITCH.upSoft);
  });

  it('a turn that begins past a cap is held where it began, never pulled back', () => {
    const start = { ...level, pitch: -25 * DEG };
    expect(turnBy(start, 0, 0, capped).shown.pitch).toBe(-25 * DEG);
    expect(turnBy(start, 0, -30 * DEG, capped).committed.pitch).toBe(-25 * DEG);
    expect(turnBy(start, 0, 10 * DEG, capped).committed.pitch).toBeCloseTo(-15 * DEG, 12);
  });

  it('a hat held against the cap stores nothing up past its band (lookWind), and turnInside measures from the cap', () => {
    const band = PITCH.upHard - PITCH.upSoft;
    let asked = 0;
    for (let i = 0; i < 400; i++) asked = lookWind(level, 0, asked, { yaw: 0, pitch: -1 * DEG }, capped).dPitch;
    expect(asked).toBeCloseTo(-12 * DEG - band, 9);
    expect(turnInside(level, 0, -11 * DEG, capped, 0.5 * DEG)).toBe(true);
    expect(turnInside(level, 0, -11.8 * DEG, capped, 0.5 * DEG)).toBe(false);
  });

  it('coneIn keeps the cap: on the cone it narrows, and on the cone it hands back as it is', () => {
    const narrowed = coneIn(capped, { soft: 10 * DEG, hard: 20 * DEG });
    expect(narrowed).toEqual({ soft: 10 * DEG, hard: 20 * DEG, pitch: capped.pitch });
    expect(coneIn(capped, { soft: 50 * DEG, hard: 60 * DEG })).toBe(capped);
    expect(coneIn(yaw, { soft: 10 * DEG, hard: 20 * DEG })).toEqual({ soft: 10 * DEG, hard: 20 * DEG });
  });
});

/** At the room's top, turned up and round past where any front shows (CHALLENGE-1's browser seq 34 ended near it). */
const BARE = { ...TOP, yaw: -30 * DEG, pitch: -28 * DEG };

describe('wallAway: how far a frame that shows no front is turned from the wall', () => {
  it('turning back down toward the cabinets makes it less; further up, or further round past the wall\'s end, more', () => {
    expect(wallShown(cam(BARE), scene.wall)).toBe(false);
    const away = wallAway(cam(BARE), scene.wall);
    expect(away).toBeGreaterThan(0);
    expect(wallAway(cam({ ...BARE, pitch: -20 * DEG }), scene.wall)).toBeLessThan(away);
    expect(wallAway(cam({ ...BARE, pitch: -20 * DEG, yaw: -20 * DEG }), scene.wall)).toBeLessThan(away);
    expect(wallAway(cam({ ...BARE, pitch: -35 * DEG }), scene.wall)).toBeGreaterThan(away);
    expect(wallAway(cam({ ...BARE, yaw: -40 * DEG }), scene.wall)).toBeGreaterThan(away);
  });

  it('the least angle to any front\'s outline: as a dense walk round every front finds it, to a hundredth of a degree', () => {
    const dense = (c: ReturnType<typeof cam>) => {
      const ax = [Math.cos(c.pitch) * Math.sin(c.yaw ?? 0), -Math.sin(c.pitch), -Math.cos(c.pitch) * Math.cos(c.yaw ?? 0)];
      let least = Math.PI;
      for (const slot of scene.wall.cabinets) {
        const feet = sideOverhangMm(slot.profile);
        const [x0, x1, top] = [slot.leftMm - feet, slot.rightMm + feet, slot.profile.outer.heightMm];
        const corners = [[x0, 0], [x1, 0], [x1, top], [x0, top], [x0, 0]];
        for (let k = 0; k < 4; k++) {
          for (let i = 0; i <= 2000; i++) {
            const x = corners[k][0] + ((corners[k + 1][0] - corners[k][0]) * i) / 2000;
            const y = corners[k][1] + ((corners[k + 1][1] - corners[k][1]) * i) / 2000;
            const d = [x - c.x, y - c.y, -c.z];
            least = Math.min(least, Math.acos((ax[0] * d[0] + ax[1] * d[1] + ax[2] * d[2]) / Math.hypot(d[0], d[1], d[2])));
          }
        }
      }
      return least;
    };
    for (const p of [BARE, { ...BARE, yaw: 10 * DEG }, { ...TOP, pitch: -40 * DEG }, { ...BOTTOM, pitch: 50 * DEG, yaw: 35 * DEG }, { yaw: 80 * DEG }, { ...TOP, z: 0 }]) {
      const c = cam(p);
      expect(wallShown(c, scene.wall)).toBe(false);
      expect(Math.abs(wallAway(c, scene.wall) - dense(c))).toBeLessThan(0.01 * DEG);
    }
  });

  it('0 where the axis meets a front (the framing)', () => {
    expect(wallAway(scene.base, scene.wall)).toBe(0);
  });

  it('turned right round, the wall behind is more than a right angle away', () => {
    expect(wallAway(cam({ yaw: Math.PI }), scene.wall)).toBeGreaterThan(Math.PI / 2);
  });
});

describe('keepsWall: a turn from this frame holds the wall as well as it does', () => {
  it('from a frame holding a front an eighth in: a turn that keeps one there passes; one that keeps it only at the edge does not', () => {
    const ok = keepsWall(cam(TOP), scene.wall);
    expect(ok(cam(TOP))).toBe(true);
    expect(ok(cam({ ...TOP, pitch: -PITCH.upSoft }))).toBe(false);
    let pitch = 0;
    while (wallShown(cam({ ...TOP, pitch }), scene.wall, WALL_KEEP_FRAME)) pitch -= 0.5 * DEG;
    expect(wallShown(cam({ ...TOP, pitch }), scene.wall)).toBe(true);
    expect(ok(cam({ ...TOP, pitch }))).toBe(false);
  });

  it('from a frame with a front at its edge only: any front passes, none does not', () => {
    let pitch = 0;
    while (wallShown(cam({ ...TOP, pitch }), scene.wall, WALL_KEEP_FRAME)) pitch -= 0.5 * DEG;
    const ok = keepsWall(cam({ ...TOP, pitch }), scene.wall);
    expect(ok(cam(TOP))).toBe(true);
    expect(ok(cam({ ...TOP, pitch }))).toBe(true);
    expect(ok(cam({ ...TOP, pitch: -PITCH.upSoft }))).toBe(false);
  });

  it('from a frame that shows none: a turn no further from the wall passes, one further does not, one that brings a front in does', () => {
    const ok = keepsWall(cam(BARE), scene.wall);
    expect(ok(cam(BARE))).toBe(true);
    expect(ok(cam({ ...BARE, pitch: -20 * DEG }))).toBe(true);
    expect(ok(cam({ ...BARE, pitch: -35 * DEG }))).toBe(false);
    expect(ok(cam({ ...BARE, yaw: -40 * DEG }))).toBe(false);
    expect(ok(cam(TOP))).toBe(true);
  });
});

describe('turnKept: a turn taken as far toward the one asked for as still passes', () => {
  const from = { ...base, yaw: 0, pitch: 0 };
  const asked = { ...from, yaw: -30 * DEG, pitch: -30 * DEG };

  it('a turn that passes is itself', () => {
    expect(turnKept(from, asked, () => true)).toBe(asked);
  });

  it('held on one axis, it goes on along the other: the pitch stops at its last passing angle, the yaw goes all the way', () => {
    const ok = (p: Pose) => p.pitch >= -10 * DEG;
    const got = turnKept(from, asked, ok);
    expect(ok(got)).toBe(true);
    expect(got.pitch).toBeLessThan(-10 * DEG + PITCH_CAP_STEP);
    expect(got.yaw).toBe(asked.yaw);
  });

  it('held on both, each stops at its last passing angle', () => {
    const ok = (p: Pose) => p.pitch >= -10 * DEG && p.yaw >= -20 * DEG;
    const got = turnKept(from, asked, ok);
    expect(ok(got)).toBe(true);
    expect(got.pitch).toBeLessThan(-10 * DEG + PITCH_CAP_STEP);
    expect(got.yaw).toBeLessThan(-20 * DEG + PITCH_CAP_STEP);
  });

  it('the asked turn\'s place, and where even the turn it comes from fails there, that turn', () => {
    const moved = { ...asked, z: from.z - 100 };
    expect(turnKept(from, moved, (p) => p.pitch === 0 && p.yaw === 0)).toEqual({ ...moved, yaw: 0, pitch: 0 });
    expect(turnKept(from, moved, () => false)).toEqual({ ...moved, yaw: 0, pitch: 0 });
  });
});

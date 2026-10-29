import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../cabinetPresets';
import { castRay, lensFocalPx, project, rayHitPlane, type Camera, type Vec3 } from '../caseCamera';
import {
  capSpanMm,
  centreCabinet,
  deepestFrontMm,
  frameCap,
  frameCase,
  frameSpanMm,
  frontsOf,
  nearestCabinet,
  pageInView,
  pagerReach,
  seenDepthsMm,
  wallPages,
  wallReachMm,
  yawCapRad,
  type FramingInput,
} from '../caseFraming';
import { DRAWN_CABINETS_LIMIT, cullRect, faceInView } from '../caseCull';
import { wallLayout, type WallLayout } from '../packCabinets';
import { WALL_PATTERNS } from '../casePrefs';

// NAV-1A: the framings in Free camera (level openings, rulings R0.3) and the framing maths under a turned camera
// (rulings S2, S3, S7).

const DEG = Math.PI / 180;
// the scene's frame at the Fold8's four panels as the e2e opens them (caseFraming.test, CF1)
const FOLD8 = [
  { width: 443, height: 418 },
  { width: 616, height: 217 },
  { width: 870, height: 335 },
  { width: 657, height: 547 },
];
const long = (profiles: (typeof IKEA_KLINGSBO)[], n = 40) => wallLayout(Array.from({ length: n }, (_, i) => profiles[i % profiles.length]));
const KLINGSBO = long([IKEA_KLINGSBO]);
const input = (frame: { width: number; height: number }, wall: WallLayout = KLINGSBO, patch: Partial<FramingInput> = {}): FramingInput => ({
  frame,
  wall,
  headroomMm: wall.cabinets.map(() => 300),
  view: 'wall',
  focus: 10,
  shelf: 0,
  ...patch,
});

describe('level openings (rulings R0.3)', () => {
  it('Free camera\'s wall view stands level at the wall\'s half height; the old one stays tilted', () => {
    for (const frame of FOLD8) {
      const old = frameCase(input(frame));
      const lvl = frameCase(input(frame, KLINGSBO, { level: true }));
      expect(old.camera.pitch).toBeGreaterThan(0);
      expect(lvl.camera.pitch).toBe(0);
      expect(lvl.camera.y).toBe(lvl.look[1]);
      expect(lvl.look[1]).toBe(old.look[1]);
      // the whole wall still stands in the frame: the level camera steps back to fit it
      expect(lvl.camera.z).toBeGreaterThan(0);
    }
  });

  it('the cabinet and shelf views are level already: level changes nothing there', () => {
    for (const frame of FOLD8) {
      for (const view of ['cabinet', 'shelf'] as const) {
        const a = frameCase(input(frame, KLINGSBO, { view, shelf: 2 }));
        const b = frameCase(input(frame, KLINGSBO, { view, shelf: 2, level: true }));
        expect(b.camera).toEqual(a.camera);
        expect(b.camera.pitch).toBe(0);
      }
    }
  });

  it('level absent or false is the old framing, to the bit', () => {
    const a = frameCase(input(FOLD8[2]));
    expect(frameCase(input(FOLD8[2], KLINGSBO, { level: false }))).toEqual(a);
  });
});

const yawed = fc.record({
  x: fc.double({ min: -3000, max: 25_000, noNaN: true }),
  y: fc.double({ min: 300, max: 2300, noNaN: true }),
  z: fc.double({ min: 400, max: 6000, noNaN: true }),
  yaw: fc.double({ min: -60 * DEG, max: 60 * DEG, noNaN: true }).filter((v) => Math.abs(v) > 1e-6),
  pitch: fc.double({ min: -40 * DEG, max: 60 * DEG, noNaN: true }),
  panel: fc.integer({ min: 0, max: 3 }),
});
const cam = (c: { x: number; y: number; z: number; yaw: number; pitch: number; panel: number }): Camera => ({ x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch, focalPx: lensFocalPx(FOLD8[c.panel]), frame: FOLD8[c.panel] });
const FRONTS = { y0: 0, y1: 2200, z0: 0, z1: 0 };
const ROOM = { y0: 0, y1: 2200, z0: -450, z1: 60 };

/** What the frame shows of a room (its box over a long x range): the world points of each clipped face. */
function seen(camera: Camera, room: typeof ROOM) {
  const X = 1e6;
  const faces: [Vec3, Vec3, Vec3][] = room.z0 === room.z1
    ? [[[camera.x - X, room.y0, room.z0], [2 * X, 0, 0], [0, room.y1 - room.y0, 0]]]
    : [
        [[camera.x - X, room.y0, room.z1], [2 * X, 0, 0], [0, room.y1 - room.y0, 0]],
        [[camera.x - X, room.y0, room.z0], [2 * X, 0, 0], [0, room.y1 - room.y0, 0]],
        [[camera.x - X, room.y1, room.z0], [2 * X, 0, 0], [0, 0, room.z1 - room.z0]],
        [[camera.x - X, room.y0, room.z0], [2 * X, 0, 0], [0, 0, room.z1 - room.z0]],
      ];
  const rect = cullRect(camera.frame, 0);
  return faces.flatMap(([a, u, v]) => faceInView({ camera, panPx: 0 }, a, u, v, rect));
}

describe('seenDepthsMm and frameSpanMm under yaw (rulings S3)', () => {
  it('the nearest and farthest depth the turned frame shows the room at, and the stretch of the wall it shows it along', () => {
    fc.assert(
      fc.property(yawed, fc.constantFrom(FRONTS, ROOM), (c, room) => {
        const camera = cam(c);
        const pts = seen(camera, room);
        const depths = seenDepthsMm(camera, room);
        if (pts.length === 0) {
          expect(depths).toBeNull();
          expect(frameSpanMm(camera, room)).toBe(0);
          return;
        }
        const ds = pts.map((p) => project(camera, p).depth);
        expect(depths![0]).toBeCloseTo(Math.min(...ds), 6);
        expect(depths![1]).toBeCloseTo(Math.max(...ds), 6);
        const xs = pts.map((p) => p[0]);
        const span = Math.max(...xs) - Math.min(...xs);
        // a stretch that runs out to the far reach (1e6 mm either way) is unbounded
        if (xs.some((x) => Math.abs(x - camera.x) >= 1e6 * (1 - 1e-9))) expect(frameSpanMm(camera, room)).toBe(Infinity);
        else expect(frameSpanMm(camera, room)).toBeCloseTo(span, 6);
      }),
      { numRuns: 1_000 },
    );
  });

  it('continuous through yaw 0: a hair of yaw gives the unturned stretch', () => {
    for (const frame of FOLD8) {
      const camera = frameCase(input(frame, KLINGSBO, { level: true })).camera;
      const at0 = frameSpanMm(camera, FRONTS);
      expect(frameSpanMm({ ...camera, yaw: 1e-9 }, FRONTS)).toBeCloseTo(at0, 3);
      expect(frameSpanMm({ ...camera, yaw: 10 * DEG }, FRONTS)).toBeGreaterThan(at0);
    }
  });
});

describe('deepestFrontMm under yaw', () => {
  it('a level camera turned y sees the fronts straight ahead at z / cos y; tilted, the bottom row reaches deeper', () => {
    const camera: Camera = { x: 0, y: 1000, z: 2000, yaw: 30 * DEG, pitch: 0, focalPx: 400, frame: FOLD8[0] };
    expect(deepestFrontMm(camera)).toBeCloseTo(2000 / Math.cos(30 * DEG), 6);
    const tilted = { ...camera, pitch: 20 * DEG };
    const bottom = rayHitPlane(castRay(tilted, tilted.frame.width / 2, tilted.frame.height), 'z', 0)!;
    expect(deepestFrontMm(tilted)).toBeCloseTo(Math.max(bottom.t, (2000 * Math.cos(20 * DEG)) / Math.cos(30 * DEG)), 6);
  });
});

describe('wallReachMm under yaw', () => {
  it('every point of the room that draws into the turned frame lies within the reach', () => {
    fc.assert(
      fc.property(yawed, fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (c, u, v) => {
        const camera = cam(c);
        const ray = castRay(camera, u * camera.frame.width, v * camera.frame.height);
        const [lo, hi] = wallReachMm(camera, 0, ROOM, 0);
        for (const z of [ROOM.z0, ROOM.z1]) {
          const hit = rayHitPlane(ray, 'z', z);
          if (!hit || hit.at[1] < ROOM.y0 || hit.at[1] > ROOM.y1) continue;
          expect(hit.at[0]).toBeGreaterThanOrEqual(lo - 1e-6);
          expect(hit.at[0]).toBeLessThanOrEqual(hi + 1e-6);
        }
      }),
      { numRuns: 1_000 },
    );
  });
});

describe('frameCap and yawCapRad (rulings S2): the drawn-cabinet cap follows the turned frame, up to the limit', () => {
  const PATTERN_WALLS = WALL_PATTERNS.map((p) => [p.id, long([...p.profiles])] as const);

  it('at yaw 0 it is the framing\'s cap, on every Fold8 panel and wall pattern, in every view', () => {
    for (const [id, wall] of PATTERN_WALLS) {
      for (const frame of FOLD8) {
        for (const view of ['wall', 'cabinet', 'shelf'] as const) {
          const f = frameCase(input(frame, wall, { view, level: true, shelf: 1 }));
          expect(frameCap(f.camera, wall, frontsOf(wall, input(frame, wall).headroomMm), f.drawCap), `${id} ${frame.width} ${view}`).toBe(f.drawCap);
        }
      }
    }
  });

  it('turning draws more, never more than the limit; the cap at the Classic yaw limit is the limit', () => {
    for (const frame of FOLD8) {
      const f = frameCase(input(frame, KLINGSBO, { level: true }));
      const fronts = frontsOf(KLINGSBO, input(frame).headroomMm);
      const caps = [0, 10, 20, 30, 40, 50].map((d) => frameCap({ ...f.camera, yaw: d * DEG }, KLINGSBO, fronts, f.drawCap));
      for (let i = 1; i < caps.length; i++) expect(caps[i]).toBeGreaterThanOrEqual(caps[i - 1]);
      expect(Math.max(...caps)).toBeLessThanOrEqual(DRAWN_CABINETS_LIMIT);
      const cap = yawCapRad(f.camera, KLINGSBO, fronts);
      // bisection: the stretch at the cap is the limit's span, a hair past it more
      expect(frameSpanMm({ ...f.camera, yaw: cap }, fronts)).toBeLessThanOrEqual(capSpanMm(KLINGSBO, DRAWN_CABINETS_LIMIT));
      expect(frameSpanMm({ ...f.camera, yaw: cap + 1e-4 }, fronts)).toBeGreaterThan(capSpanMm(KLINGSBO, DRAWN_CABINETS_LIMIT));
      // symmetric
      expect(yawCapRad({ ...f.camera, yaw: -0.3 }, KLINGSBO, fronts)).toBe(cap);
      // a real turn either way on every panel (the values per panel go in the report: NAV-1A acceptance 8)
      expect(cap).toBeGreaterThan(20 * DEG);
    }
  });

  it('no cap on a wall the limit draws whole; none at all where even straight on the frame shows too much', () => {
    const short = wallLayout(Array(12).fill(IKEA_DETOLF));
    const camera = frameCase(input(FOLD8[0], short, { level: true, focus: 3 })).camera;
    expect(yawCapRad(camera, short, frontsOf(short, short.cabinets.map(() => 300)))).toBe(Math.PI / 2);
    const far = { ...frameCase(input(FOLD8[2], KLINGSBO, { level: true })).camera, z: 60_000 };
    expect(yawCapRad(far, KLINGSBO, frontsOf(KLINGSBO, KLINGSBO.cabinets.map(() => 300)))).toBe(0);
  });
});

describe('centreCabinet (rulings S7): the cabinet the frame centre looks at, not the one the eye stands before', () => {
  const MIXED = long([IKEA_KLINGSBO, IKEA_DETOLF, OPEN_STEEL_RACK]);
  it('the one the centre ray meets on the fronts\' plane', () => {
    const camera = frameCase(input(FOLD8[2], MIXED, { view: 'cabinet', level: true, focus: 12 })).camera;
    expect(centreCabinet(camera, MIXED)).toBe(12);
    const turned = { ...camera, yaw: 20 * DEG };
    const hit = rayHitPlane(castRay(turned, turned.frame.width / 2, turned.frame.height / 2), 'z', 0)!;
    const want = MIXED.cabinets.findIndex((c) => hit.at[0] >= c.leftMm && hit.at[0] <= c.rightMm);
    expect(want).toBeGreaterThan(12);
    expect(centreCabinet(turned, MIXED)).toBe(want);
  });

  it('between two cabinets, or past the wall\'s end: the nearest; a ray that never meets the fronts: the one nearest the eye', () => {
    const gapX = (MIXED.cabinets[4].rightMm + MIXED.cabinets[5].leftMm) / 2;
    const camera: Camera = { x: gapX, y: 1000, z: 2000, yaw: 0, pitch: 0, focalPx: 400, frame: FOLD8[0] };
    expect(centreCabinet(camera, MIXED)).toBe(nearestCabinet(MIXED, gapX));
    expect(centreCabinet({ ...camera, x: MIXED.rightMm + 4000 }, MIXED)).toBe(MIXED.cabinets.length - 1);
    // behind the fronts' plane past the wall's end, looking away from it
    const behind = { ...camera, x: MIXED.leftMm - 3000, z: -300 };
    expect(centreCabinet(behind, MIXED)).toBe(0);
  });

  it('pageInView and pagerReach page from the centre cabinet when given one', () => {
    const inp = input(FOLD8[2], MIXED, { level: true, focus: 12 });
    const pages = wallPages(inp);
    const f = frameCase(inp);
    const at = pageInView(pages, MIXED, f);
    // a turned frame centring on a cabinet two pages on pages from there
    const target = pages[at + 2][0];
    const centre = { cabinet: target, x: MIXED.cabinets[target].centerMm };
    expect(pageInView(pages, MIXED, f, 0, centre)).toBe(at + 2);
    const ends = { first: -1e10, last: 1e10 };
    expect(pagerReach(pages, MIXED, f, 0, ends, { cabinet: pages[pages.length - 1][0], x: 2e10 }).next).toBe(false);
    expect(pagerReach(pages, MIXED, f, 0, ends, { cabinet: pages[pages.length - 1][0], x: 0 }).next).toBe(true);
    expect(pagerReach(pages, MIXED, f, 0, ends, { cabinet: pages[0][0], x: -2e10 }).prev).toBe(false);
  });
});

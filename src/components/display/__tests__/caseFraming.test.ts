import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../cabinetPresets';
import { IN_MM, frameMargins, project, startCameraY } from '../caseCamera';
import { wallLayout } from '../packCabinets';
import { sideOverhangMm } from '../cabinetProfile';
import {
  STEP_BACK_MAX_MM,
  cabinetBox,
  frameCase,
  panLimitsPx,
  swipeCamera,
  cabinetsInReach,
  wallPages,
  wallReachMm,
  type FramingInput,
} from '../caseFraming';

const COVER = { width: 443, height: 454 };
const OPEN = { width: 870, height: 475 };

function input(patch: Partial<FramingInput> = {}): FramingInput {
  return {
    frame: COVER,
    wall: wallLayout([IKEA_DETOLF]),
    headroomMm: [300],
    view: 'cabinet',
    focus: 0,
    shelf: 0,
    ...patch,
  };
}

function inside(frameW: number, frameH: number, x: number, y: number, slack = 1e-3): boolean {
  const m = frameMargins({ width: frameW, height: frameH });
  return x >= m.x - slack && x <= frameW - m.x + slack && y >= m.y - slack && y <= frameH - m.y + slack;
}

describe('cabinetBox: the part of the room one cabinet fills', () => {
  it('a Detolf: its body, up to the framing headroom', () => {
    expect(cabinetBox(wallLayout([IKEA_DETOLF]).cabinets[0], 300)).toEqual({ x0: 0, x1: 430, y0: 0, y1: 1930, z0: -370, z1: 0 });
  });

  it('a KLINGSBO reaches out to its splayed feet, in front too', () => {
    expect(cabinetBox(wallLayout([IKEA_KLINGSBO]).cabinets[0], 300)).toEqual({ x0: -47.5, x1: 497.5, y0: 0, y1: 2100, z0: -400, z1: 50 });
  });
});

describe('frameCase: one cabinet (CC15 start camera, tilted at the look-at)', () => {
  it('the Detolf on the cover: look-at 965 mm, camera 52.74 in high, the camera-out-v3 golden 1647.7 mm back, 12.8 deg down', () => {
    const f = frameCase(input());
    expect(f.look[1]).toBe(965);
    expect(f.camera.y / IN_MM).toBeCloseTo(52.74, 2);
    expect(f.camera.z - f.look[2]).toBeCloseTo(1647.7, 0);
    expect((f.camera.pitch * 180) / Math.PI).toBeCloseTo(12.8, 1);
    expect(f.camera.x).toBe(215);
  });

  it('the KLINGSBO: look-at 1050 mm (half of 1800 + 300), the camera two-thirds of the way to 60 in (53.8 in)', () => {
    const f = frameCase(input({ wall: wallLayout([IKEA_KLINGSBO]) }));
    expect(f.look).toEqual([225, 1050, 0]);
    expect(f.camera.y).toBeCloseTo(startCameraY(1050), 9);
    expect(f.camera.y / IN_MM).toBeCloseTo(53.84, 2);
  });

  it('frames the cabinet, feet to headroom, inside the margins, whatever its neighbours', () => {
    const wall = wallLayout([IKEA_KLINGSBO, IKEA_DETOLF, OPEN_STEEL_RACK]);
    for (const focus of [0, 1, 2]) {
      const f = frameCase(input({ wall, headroomMm: [300, 300, 457.2], focus, frame: OPEN }));
      const b = cabinetBox(wall.cabinets[focus], [300, 300, 457.2][focus]);
      for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [b.z0, b.z1]) {
        const p = project(f.camera, [x, y, z]);
        expect(inside(OPEN.width, OPEN.height, p.x, p.y)).toBe(true);
      }
      expect(f.camera.x).toBeCloseTo(wall.cabinets[focus].centerMm, 9);
    }
  });

  it('the camera follows the taller headroom: a tall figure on the top raises the look-at', () => {
    const low = frameCase(input({ headroomMm: [300] }));
    const high = frameCase(input({ headroomMm: [609.6] }));
    expect(high.look[1]).toBeCloseTo((1630 + 609.6) / 2, 9);
    expect(high.camera.y).toBeGreaterThan(low.camera.y);
  });
});

describe('frameCase: whole cabinets (as many side by side as the one-cabinet distance shows)', () => {
  it('a wide screen shows several Detolfs; their page is framed, centred, no farther back than one cabinet needs', () => {
    const wall = wallLayout(Array(8).fill(IKEA_DETOLF));
    const headroomMm = Array(8).fill(300);
    const one = frameCase(input({ wall, headroomMm, frame: OPEN }));
    const all = frameCase(input({ wall, headroomMm, frame: OPEN, view: 'wall' }));
    expect(all.page.length).toBeGreaterThan(2);
    expect(all.camera.z - all.look[2]).toBeLessThanOrEqual(one.camera.z - one.look[2] + 1);
    const first = wall.cabinets[all.page[0]];
    const last = wall.cabinets[all.page[all.page.length - 1]];
    expect(all.camera.x).toBeCloseTo((first.leftMm + last.rightMm) / 2, 9);
  });

  it('the page holds the focus cabinet; a page never runs past the end of the wall', () => {
    const wall = wallLayout(Array(7).fill(IKEA_KLINGSBO));
    const headroomMm = Array(7).fill(300);
    const pages = wallPages(input({ wall, headroomMm, frame: OPEN, view: 'wall' }));
    expect(pages.flat()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    for (const focus of [0, 3, 6]) {
      const f = frameCase(input({ wall, headroomMm, frame: OPEN, view: 'wall', focus }));
      expect(f.page).toContain(focus);
    }
  });

  it('a narrow screen whose width only holds one cabinet pages one at a time', () => {
    const wall = wallLayout([OPEN_STEEL_RACK, OPEN_STEEL_RACK]);
    const pages = wallPages(input({ wall, headroomMm: [300, 300], frame: { width: 200, height: 800 }, view: 'wall' }));
    expect(pages).toEqual([[0], [1]]);
  });

  it('an empty wall still frames: a default page of nothing at the origin', () => {
    expect(wallPages(input({ wall: wallLayout([]), headroomMm: [], view: 'wall' }))).toEqual([]);
    expect(() => frameCase(input({ wall: wallLayout([]), headroomMm: [] }))).toThrow(RangeError);
  });
});

describe('frameCase: one shelf (level; CC4b steps back at the top)', () => {
  it('a glass shelf of the KLINGSBO: level at the middle of its band, the whole width and height in the margins', () => {
    const wall = wallLayout([IKEA_KLINGSBO]);
    // reading order: 0 = the top, 1 = glass shelf 5, ...
    const f = frameCase(input({ wall, view: 'shelf', shelf: 1, frame: OPEN }));
    expect(f.camera.pitch).toBe(0);
    const lo = 1519 - 17;
    const hi = 1800;
    expect(f.look[1]).toBeCloseTo((lo + hi) / 2, 9);
    for (const x of [0, 450]) for (const y of [lo, hi]) {
      const p = project(f.camera, [x, y, 0]);
      expect(inside(OPEN.width, OPEN.height, p.x, p.y)).toBe(true);
    }
  });

  it('CC4b: at the top the camera steps back at most 3 in past the width fit to show a tall top figure', () => {
    const wall = wallLayout([IKEA_DETOLF]);
    const crop = frameCase(input({ wall, view: 'shelf', shelf: 0, frame: OPEN, headroomMm: [40] }));
    const tall = frameCase(input({ wall, view: 'shelf', shelf: 0, frame: OPEN, headroomMm: [609.6] }));
    const dCrop = crop.camera.z - crop.look[2];
    const dTall = tall.camera.z - tall.look[2];
    expect(STEP_BACK_MAX_MM).toBe(3 * IN_MM);
    expect(dTall).toBeGreaterThan(dCrop);
    expect(dTall - dCrop).toBeLessThanOrEqual(STEP_BACK_MAX_MM + 1e-9);
    expect(dTall - dCrop).toBeCloseTo(STEP_BACK_MAX_MM, 6);
  });

  it('a shelf index past the cabinet is clamped to its lowest surface', () => {
    const f = frameCase(input({ wall: wallLayout([IKEA_DETOLF]), view: 'shelf', shelf: 99 }));
    const g = frameCase(input({ wall: wallLayout([IKEA_DETOLF]), view: 'shelf', shelf: 4 }));
    expect(f.camera).toEqual(g.camera);
  });
});

describe('CC4 swipe: move the camera along the wall, or pan the drawn wall like a photo', () => {
  const wall = wallLayout(Array(5).fill(IKEA_KLINGSBO));
  const headroomMm = Array(5).fill(300);
  // the middle cabinet, so a swipe either way has room before the ends
  const base = frameCase(input({ wall, headroomMm, focus: 2 }));
  const atStart = frameCase(input({ wall, headroomMm }));

  it('camera: a finger moving right walks the camera left, by the pixels at the cabinet front', () => {
    const moved = swipeCamera(base, wall, 100);
    const perPx = (base.camera.z - base.look[2]) / base.camera.focalPx;
    expect(moved.camera.x).toBeCloseTo(base.camera.x - 100 * perPx, 6);
    expect(moved.look[0]).toBeCloseTo(moved.camera.x, 9);
    expect(moved.camera.y).toBe(base.camera.y);
    expect(moved.camera.pitch).toBe(base.camera.pitch);
  });

  it('camera: it stops at the first and the last cabinet', () => {
    expect(swipeCamera(base, wall, 1e6).camera.x).toBe(wall.cabinets[0].centerMm);
    expect(swipeCamera(base, wall, -1e6).camera.x).toBe(wall.cabinets[4].centerMm);
  });

  it('pan: the limits keep the wall on screen; a wall narrower than the frame does not pan', () => {
    const [min, max] = panLimitsPx(atStart, wall);
    expect(min).toBeLessThan(0);
    expect(max).toBe(0);
    const [midMin, midMax] = panLimitsPx(base, wall);
    expect(midMin).toBeLessThan(0);
    expect(midMax).toBeGreaterThan(0);
    const lone = frameCase(input({ wall: wallLayout([IKEA_KLINGSBO]) }));
    expect(panLimitsPx(lone, wallLayout([IKEA_KLINGSBO]))).toEqual([0, 0]);
  });

  it('pan: a wall that fits the frame but runs off its right edge still slides in, never past its ends', () => {
    // a short wide frame on the first of four cabinets: the wall is narrower than the frame, yet it starts mid-screen
    const four = wallLayout([IKEA_KLINGSBO, IKEA_KLINGSBO, IKEA_KLINGSBO, IKEA_KLINGSBO]);
    const f = frameCase(input({ frame: { width: 443, height: 344 }, wall: four, headroomMm: [300, 300, 300, 300] }));
    const m = frameMargins(f.camera.frame);
    const left = project(f.camera, [four.leftMm, f.look[1], 0]).x;
    const right = project(f.camera, [four.rightMm, f.look[1], 0]).x;
    expect(right - left).toBeLessThan(f.camera.frame.width - 2 * m.x);
    expect(right).toBeGreaterThan(f.camera.frame.width - m.x);
    const [min, max] = panLimitsPx(f, four);
    expect(min).toBeCloseTo(f.camera.frame.width - m.x - right, 6);
    expect(max).toBe(0);
  });

  it('pan: a wall that fits the frame but runs off its left edge slides in by the frame margin, never past its ends', () => {
    // the same four cabinets, framed on the last: the wall starts left of the frame margin
    const four = wallLayout([IKEA_KLINGSBO, IKEA_KLINGSBO, IKEA_KLINGSBO, IKEA_KLINGSBO]);
    const f = frameCase(input({ frame: { width: 443, height: 344 }, wall: four, headroomMm: [300, 300, 300, 300], focus: 3 }));
    const m = frameMargins(f.camera.frame);
    const left = project(f.camera, [four.leftMm, f.look[1], 0]).x;
    expect(left).toBeLessThan(m.x);
    const [min, max] = panLimitsPx(f, four);
    expect(min).toBe(0);
    expect(max).toBeCloseTo(m.x - left, 6);
  });

  it('camera moves keep the camera inside the wall for any swipe', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -2000, max: 2000, noNaN: true }), { maxLength: 12 }), (moves) => {
        let f = base;
        for (const dx of moves) f = swipeCamera(f, wall, dx);
        expect(f.camera.x).toBeGreaterThanOrEqual(wall.cabinets[0].centerMm - 1e-9);
        expect(f.camera.x).toBeLessThanOrEqual(wall.cabinets[4].centerMm + 1e-9);
      }),
    );
  });
});

describe('wallReachMm: the stretch of wall that can draw into the frame', () => {
  const room = { y0: 0, y1: 2438.4, z0: -400, z1: 50 };

  it('holds every point of the room that draws inside the frame, for any camera tilt and any pan', () => {
    fc.assert(
      fc.property(
        fc.record({
          x: fc.double({ min: -2000, max: 20000, noNaN: true }),
          y: fc.double({ min: 300, max: 2200, noNaN: true }),
          z: fc.double({ min: 600, max: 6000, noNaN: true }),
          pitch: fc.double({ min: -0.4, max: 0.4, noNaN: true }),
          pan: fc.double({ min: -3000, max: 3000, noNaN: true }),
          px: fc.double({ min: 0, max: 1, noNaN: true }),
          py: fc.double({ min: 0, max: 1, noNaN: true }),
          pz: fc.double({ min: 0, max: 1, noNaN: true }),
        }),
        ({ x, y, z, pitch, pan, px, py, pz }) => {
          const camera = { x, y, z, pitch, focalPx: 400, frame: { width: 443, height: 454 } };
          const [lo, hi] = wallReachMm(camera, pan, room, 0);
          // a point of the room straight below/above the frame's horizontal span, at some depth: wherever it draws
          const p = [0, room.y0 + py * (room.y1 - room.y0), room.z0 + pz * (room.z1 - room.z0)] as const;
          const probe = project(camera, [x, p[1], p[2]]);
          if (probe.depth <= 1) return;
          // the x that draws at px of the frame's width at that depth
          const wx = x + ((px * camera.frame.width - camera.frame.width / 2 - pan) * probe.depth) / camera.focalPx;
          const drawn = project(camera, [wx, p[1], p[2]]);
          expect(drawn.x + pan).toBeCloseTo(px * camera.frame.width, 6);
          expect(wx).toBeGreaterThanOrEqual(lo - 1e-6);
          expect(wx).toBeLessThanOrEqual(hi + 1e-6);
        },
      ),
    );
  });

  it('is exactly that stretch, padded by the margin: a far, panned view under a tilt', () => {
    const camera = { x: 500, y: 1400, z: 1650, pitch: 0.19, focalPx: 319, frame: { width: 360, height: 480 } };
    const [lo, hi] = wallReachMm(camera, -600, room, 0);
    const depth = (yy: number, zz: number) => (camera.y - yy) * Math.sin(camera.pitch) + (camera.z - zz) * Math.cos(camera.pitch);
    // panned left by 600 px: the right end is the far floor at the back, the left end the near top at the front
    expect(hi).toBeCloseTo(500 + ((180 + 600) * depth(0, -400)) / 319, 6);
    expect(lo).toBeCloseTo(500 + ((-180 + 600) * depth(2438.4, 50)) / 319, 6);
    const [plo, phi] = wallReachMm(camera, -600, room, 600);
    expect([plo, phi]).toEqual([lo - 600, hi + 600]);
  });

  it('a point at or behind the camera never widens it past 1 mm of depth', () => {
    const camera = { x: 0, y: 1000, z: 10, pitch: 0, focalPx: 400, frame: { width: 400, height: 400 } };
    const [lo, hi] = wallReachMm(camera, 0, { y0: 0, y1: 2000, z0: -400, z1: 50 }, 0);
    expect(hi).toBeCloseTo((200 * 410) / 400, 6);
    expect(lo).toBeCloseTo((-200 * 410) / 400, 6);
    const [, panned] = wallReachMm(camera, 300, { y0: 0, y1: 2000, z0: -400, z1: 50 }, 0);
    // slid right past the middle: the right end is the nearest point, held at 1 mm
    expect(panned).toBeCloseTo((-100 * 1) / 400, 6);
  });
});

describe('cabinetsInReach: the cabinets drawn for a stretch of wall', () => {
  const three = wallLayout([IKEA_KLINGSBO, IKEA_KLINGSBO, IKEA_KLINGSBO]);
  const feet = sideOverhangMm(IKEA_KLINGSBO);

  it('a cabinet whose splayed feet alone reach into the stretch is drawn; one a few mm farther is not', () => {
    const mid = three.cabinets[1];
    expect(feet).toBeGreaterThan(21);
    expect(mid.leftMm - cabinetBox(mid, 0).x0).toBeCloseTo(feet, 6);
    // the stretch ends inside the middle cabinet's left foot, short of its body
    expect(cabinetsInReach(three, [-1000, mid.leftMm - 20])).toEqual([0, 1]);
    expect(cabinetsInReach(three, [-1000, mid.leftMm - feet - 1])).toEqual([0]);
    // and from the right: inside its right foot
    expect(cabinetsInReach(three, [mid.rightMm + 20, 1e6])).toEqual([1, 2]);
    expect(cabinetsInReach(three, [mid.rightMm + feet + 1, 1e6])).toEqual([2]);
    // a foot's tip exactly at the end of the stretch still counts
    expect(cabinetsInReach(three, [-1000, mid.leftMm - feet])).toEqual([0, 1]);
    expect(cabinetsInReach(three, [mid.rightMm + feet, 1e6])).toEqual([1, 2]);
  });

  it('nothing in reach: nothing drawn', () => {
    expect(cabinetsInReach(three, [1e6, 2e6])).toEqual([]);
  });
});


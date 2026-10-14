import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../cabinetPresets';
import { IN_MM, frameMargins, project, startCameraY, unprojectToPlaneZ, type Camera, type Vec3 } from '../caseCamera';
import { MAX_DRAWN_CABINETS, trimFace } from '../caseCull';
import { wallLayout, type WallLayout } from '../packCabinets';
import { sideOverhangMm } from '../cabinetProfile';
import { WALL_PATTERNS } from '../casePrefs';
import {
  STEP_BACK_MAX_MM,
  cabinetBox,
  frameCase,
  PAN_EDGE_TAN_MAX,
  panFraming,
  panLimitsPx,
  panSlideMaxPx,
  settleWalk,
  swipeCamera,
  wholeCabinets,
  cabinetsInReach,
  capSlidePx,
  capSpanMm,
  wallPages,
  wallReachMm,
  walkStops,
  walkDeadPx,
  atX,
  nearestCabinet,
  WALK_MIN_PX,
  panStops,
  settlePan,
  type Box,
  type Framing,
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

describe('CC4 pan: the photo slides at most until its edge looks PAN_EDGE_TAN_MAX off the axis; past that it is retaken farther along', () => {
  // about 1,200 figures: a hundred KLINGSBOs, panned from one end of the wall to the other
  const long = wallLayout(Array(100).fill(IKEA_KLINGSBO));
  const headroomMm = Array(100).fill(300);
  const fronts = { y0: 0, y1: IKEA_KLINGSBO.outer.heightMm + 300, z0: 0, z1: 0 };
  const room = {
    y0: 0,
    y1: 2438.4,
    z0: -IKEA_KLINGSBO.outer.depthMm,
    z1: IKEA_KLINGSBO.footprint?.frontOverhangMm ?? 0,
  };
  for (const [name, frame] of [['cover', COVER], ['open', OPEN]] as const) {
    const base = frameCase(input({ frame, wall: long, headroomMm, view: 'wall' }));
    const [panMin] = panLimitsPx(base, long);
    const slide = base.slideMaxPx!;

    it(`${name}: the slide ends where the frame's edge looks PAN_EDGE_TAN_MAX off the axis, or sooner where the cap ends it`, () => {
      const edge = panSlideMaxPx(base.camera);
      expect(edge).toBeCloseTo(base.camera.focalPx * PAN_EDGE_TAN_MAX - frame.width / 2, 9);
      expect(edge).toBeGreaterThan(frame.width / 2);
      expect(panSlideMaxPx({ ...base.camera, focalPx: 1 })).toBe(0);
      // MOB-NAV-2: the slid frame shows no longer a stretch of the cabinets' fronts than the cap allows
      expect(slide).toBe(Math.min(edge, capSlidePx(base.camera, fronts, capSpanMm(long))));
      expect(slide).toBeGreaterThanOrEqual(frame.width / 2);
      expect(slide).toBeLessThan(edge);
    });

    it(`${name}: within the slide the camera stays and the picture slides by the pan`, () => {
      const r = panFraming(base, -slide + 1);
      expect(r.framing).toBe(base);
      expect(r.panPx).toBe(-slide + 1);
      expect(panFraming(base, slide).panPx).toBe(slide);
    });

    it(`${name}: past it the camera walks by the rest; the look line draws where the slid photo puts it`, () => {
      fc.assert(
        fc.property(fc.double({ min: panMin, max: -panMin, noNaN: true }), fc.double({ min: -20000, max: 100000, noNaN: true }), (pan, x) => {
          const r = panFraming(base, pan);
          expect(Math.abs(r.panPx)).toBeLessThanOrEqual(slide + 1e-9);
          expect(Math.sign(r.panPx)).toBe(Math.sign(pan));
          expect(r.framing.camera.y).toBe(base.camera.y);
          expect(r.framing.camera.pitch).toBe(base.camera.pitch);
          expect(r.framing.look[0] - r.framing.camera.x).toBeCloseTo(base.look[0] - base.camera.x, 6);
          const p = [x, base.look[1], base.look[2]] as const;
          expect(project(r.framing.camera, p).x + r.panPx).toBeCloseTo(project(base.camera, p).x + pan, 6);
        }),
      );
    });

    it(`${name}: the cabinets drawn stay bounded however far the wall is panned, and its far end is reached`, () => {
      const reach = (pan: number) => {
        const r = panFraming(base, pan);
        return wallReachMm(r.framing.camera, r.panPx, room, 600);
      };
      const width = (pan: number) => reach(pan)[1] - reach(pan)[0];
      const drawn = (pan: number) => cabinetsInReach(long, reach(pan));
      // the stretch that can draw never grows past where the photo stops sliding, so a few more cabinets
      // than at rest are drawn at most (the unbounded photo drew 34 of them at -8000 px)
      const widest = width(-slide);
      const most = drawn(0).length + 5;
      for (let pan = 0; pan >= panMin; pan -= 400) {
        expect(width(pan), `pan ${pan}`).toBeLessThanOrEqual(widest + 1e-6);
        expect(drawn(pan).length, `pan ${pan}`).toBeLessThanOrEqual(most);
      }
      expect(width(panMin)).toBeCloseTo(widest, 6);
      expect(drawn(panMin)).toContain(99);
    });
  }
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


describe('capSpanMm: the longest stretch of a wall a frame may show and still show no more than five cabinet fronts', () => {
  it('short of the narrowest run from one cabinet to the fifth after it, splayed feet and all', () => {
    // a KLINGSBO stands in its 545 mm of splayed feet, side by side: four of them between the first and the sixth
    expect(capSpanMm(wallLayout(Array(6).fill(IKEA_KLINGSBO)))).toBe(4 * 545 - 1);
    expect(capSpanMm(wallLayout(Array(30).fill(IKEA_DETOLF)))).toBe(1719);
    // a mixed wall is held to its narrowest run
    const mixed = wallLayout(Array.from({ length: 12 }, (_, i) => [IKEA_KLINGSBO, IKEA_DETOLF, OPEN_STEEL_RACK][i % 3]));
    const boxes = mixed.cabinets.map((slot) => cabinetBox(slot, 0));
    const runs = boxes.slice(0, -MAX_DRAWN_CABINETS).map((b, i) => boxes[i + MAX_DRAWN_CABINETS].x0 - b.x1);
    expect(capSpanMm(mixed)).toBe(Math.min(...runs) - 1);
  });

  it('a wall of five or fewer is never capped', () => {
    expect(capSpanMm(wallLayout(Array(5).fill(IKEA_KLINGSBO)))).toBe(Infinity);
  });
});

describe('capSlidePx: how far the photo may slide and still show no more of the fronts than the cap allows', () => {
  const fronts = { y0: 0, y1: 2100, z0: 0, z1: 0 };
  const camera: Camera = { x: 0, y: 1200, z: 1300, pitch: 0.15, focalPx: 300, frame: { width: 443, height: 344 } };

  it('a level camera sees the fronts at one depth: sliding never widens the stretch', () => {
    expect(capSlidePx({ ...camera, y: 1050, pitch: 0 }, { ...fronts, y1: 2100 }, 1)).toBe(Infinity);
  });

  it('a tilted one: the slide at which the slid frame spans exactly the cap, none where it already spans more', () => {
    const at = (span: number) => capSlidePx(camera, fronts, span);
    const seen = (pan: number) => {
      // the stretch of the fronts the frame shows slid by pan: its two edges over the rows that meet the fronts
      const rows = [0, camera.frame.height].map((y) => unprojectToPlaneZ(camera, camera.frame.width / 2, y, 0)![1]);
      const ys = [Math.max(fronts.y0, Math.min(...rows)), Math.min(fronts.y1, Math.max(...rows))];
      const xs = ys.flatMap((y) => [0, camera.frame.width].map((sx) => unprojectToPlaneZ(camera, sx - pan, project(camera, [0, y, 0]).y, 0)![0]));
      return Math.max(...xs) - Math.min(...xs);
    };
    const span = seen(0) * 1.2;
    const slide = at(span);
    expect(slide).toBeGreaterThan(0);
    expect(seen(slide)).toBeCloseTo(span, 3);
    expect(seen(-slide)).toBeCloseTo(span, 3);
    expect(seen(slide / 2)).toBeLessThan(span);
  });
});

describe(`frameCase: every view frames the fronts of at most the ${MAX_DRAWN_CABINETS} cabinets the case draws (MOB-NAV-2, Ross 12:1xC)`, () => {
  // the scene's frame at the Fold8's four panels (the page's chrome takes the rest), short and tall
  const FRAMES = [
    { width: 443, height: 344 },
    { width: 443, height: 454 },
    { width: 616, height: 200 },
    { width: 616, height: 245 },
    { width: 870, height: 261 },
    { width: 870, height: 475 },
    { width: 657, height: 480 },
    { width: 657, height: 600 },
    // a desktop window's short frame: wide enough that even a shelf, fitted by its height, would show six
    { width: 1536, height: 200 },
  ];
  const WALLS: [string, WallLayout][] = [
    ['KLINGSBO', wallLayout(Array(30).fill(IKEA_KLINGSBO))],
    ['Detolf', wallLayout(Array(30).fill(IKEA_DETOLF))],
    ['rack', wallLayout(Array(12).fill(OPEN_STEEL_RACK))],
    ['mixed', wallLayout(Array.from({ length: 30 }, (_, i) => [IKEA_KLINGSBO, IKEA_DETOLF, OPEN_STEEL_RACK][i % 3]))],
  ];
  const faces = (b: Box): [Vec3, Vec3, Vec3][] => [
    [[b.x0, b.y0, b.z1], [b.x1 - b.x0, 0, 0], [0, b.y1 - b.y0, 0]],
    [[b.x0, b.y0, b.z0], [b.x1 - b.x0, 0, 0], [0, b.y1 - b.y0, 0]],
    [[b.x0, b.y0, b.z0], [0, 0, b.z1 - b.z0], [0, b.y1 - b.y0, 0]],
    [[b.x1, b.y0, b.z0], [0, 0, b.z1 - b.z0], [0, b.y1 - b.y0, 0]],
    [[b.x0, b.y1, b.z0], [b.x1 - b.x0, 0, 0], [0, 0, b.z1 - b.z0]],
    [[b.x0, b.y0, b.z0], [b.x1 - b.x0, 0, 0], [0, 0, b.z1 - b.z0]],
  ];
  /**
   * What the frame itself shows of the wall (exact): the cabinets whose front (feet to top, splayed feet included,
   * on the front plane) draws in it, those whose front draws whole across it at the look-at's height, and those any
   * part of which draws in it (a neighbour's back seen through the glass at the frame's edge included).
   */
  const framed = (camera: Camera, panPx: number, wall: WallLayout, lookY: number) => {
    const rect = { x0: 0, x1: camera.frame.width, y0: 0, y1: camera.frame.height };
    const meets = ([a, u, v]: [Vec3, Vec3, Vec3]) => trimFace({ camera, panPx }, a, u, v, rect) !== null;
    const boxes = wall.cabinets.map((slot) => cabinetBox(slot, 0));
    const across = (b: Box) => [b.x0, b.x1].every((x) => {
      const p = project(camera, [x, lookY, 0]);
      return p.depth > 0 && p.x + panPx >= 0 && p.x + panPx <= camera.frame.width;
    });
    return {
      fronts: boxes.flatMap((b, i) => (meets([[b.x0, b.y0, 0], [b.x1 - b.x0, 0, 0], [0, b.y1 - b.y0, 0]]) ? [i] : [])),
      whole: boxes.flatMap((b, i) => (across(b) ? [i] : [])),
      any: boxes.flatMap((b, i) => (faces(b).some(meets) ? [i] : [])),
    };
  };
  /** Every picture a view leaves: as framed, after walks of the camera, and slid as a photo to the wall's ends. */
  const pictures = (f: Framing, wall: WallLayout) => {
    const out: { camera: Camera; panPx: number; at: string }[] = [{ camera: f.camera, panPx: 0, at: 'framed' }];
    let walked = f;
    for (let k = 1; k <= 12; k++) {
      walked = swipeCamera(walked, wall, -0.31 * f.camera.frame.width);
      out.push({ camera: walked.camera, panPx: 0, at: `walk ${k}` });
    }
    const [panMin, panMax] = panLimitsPx(f, wall);
    for (const end of [panMin, panMax]) {
      for (let k = 1; k <= 12; k++) {
        const r = panFraming(f, (end * k) / 12);
        out.push({ camera: r.framing.camera, panPx: r.panPx, at: `pan ${Math.round((end * k) / 12)}` });
      }
    }
    return out;
  };

  for (const [name, wall] of WALLS) {
    it(`${name} wall: the wall, cabinet and shelf views, walked or panned, never frame the fronts of more than ${MAX_DRAWN_CABINETS}`, () => {
      const headroomMm = wall.cabinets.map(() => 300);
      const mid = Math.floor(wall.cabinets.length / 2);
      let checked = 0;
      for (const frame of FRAMES) {
        for (const [view, focus, shelf] of [
          ['wall', 0, 0],
          ['wall', mid, 0],
          ['cabinet', mid, 0],
          ['shelf', mid, 0],
          ['shelf', mid, 2],
        ] as const) {
          const f = frameCase({ frame, wall, headroomMm, view, focus, shelf });
          for (const p of pictures(f, wall)) {
            const shows = framed(p.camera, p.panPx, wall, f.look[1]);
            const at = `${frame.width}x${frame.height} ${view} ${focus}/${shelf} ${p.at}`;
            expect(shows.fronts.length, `${at}: fronts ${shows.fronts.join(',')}`).toBeLessThanOrEqual(MAX_DRAWN_CABINETS);
            // past them, at most a neighbour each side is seen, at its back through the glass at the frame's edge
            expect(shows.any.length, `${at}: any part ${shows.any.join(',')}`).toBeLessThanOrEqual(MAX_DRAWN_CABINETS + 2);
            checked++;
          }
        }
      }
      expect(checked).toBe(FRAMES.length * 5 * 37);
    });
  }

  /** The wall view as the scene shows it: the focus cabinet's page framing (kept per focus), the camera where a walk settled (none: as framed). */
  const shownOn = (input: FramingInput) => {
    const framed = new Map<number, Framing>();
    return (focus: number, x: number | null) => {
      if (!framed.has(focus)) framed.set(focus, frameCase({ ...input, focus }));
      const f = framed.get(focus)!;
      return x === null ? f : atX(f, x);
    };
  };

  it('the wall view still shows the wall (Ross 12:1xC, desk MN2 a): wherever a walk settles short of the wall\'s ends, three cabinets or more whole across the frame, four fronts or more', () => {
    // every Fold8 panel; whole = the body, side to side, at the height the frame aims at. Where no stop along the wall
    // stands three whole (a wall of racks, 1.2 m wide, on the cover's tall frames), the most any stop does; at the
    // wall's ends, and at a stop that alone stands a cabinet whole, as many as it can (close-out 3, ruling 27)
    const short: string[] = [];
    let ends = 0;
    for (const [name, wall] of WALLS) {
      const headroomMm = wall.cabinets.map(() => 300);
      for (const frame of FRAMES) {
        const input: FramingInput = { frame, wall, headroomMm, view: 'wall', focus: 0, shelf: 0 };
        const shown = shownOn(input);
        const stops = walkStops(input);
        const most = Math.max(...stops.map((s) => s.whole.length));
        const need = Math.min(3, most);
        if (most < 3) short.push(`${name} ${frame.width}x${frame.height} ${most}`);
        const whole = (camera: Camera, lookY: number) =>
          wall.cabinets.flatMap((slot, i) =>
            [slot.leftMm, slot.rightMm].every((x) => {
              const p = project(camera, [x, lookY, 0]);
              return p.x >= 0 && p.x <= frame.width;
            })
              ? [i]
              : [],
          );
        const f = shown(0, null);
        expect(wholeCabinets(f.camera, wall, f.look[1]), `${name} ${frame.width}x${frame.height}`).toEqual(whole(f.camera, f.look[1]));
        let focus = 0;
        let x: number | null = null;
        // short swipes and long ones, forward to the wall's far end and back to its start
        for (const [k, dx] of [...Array.from({ length: 30 }, () => -0.13), ...Array.from({ length: 12 }, () => -0.7), ...Array.from({ length: 30 }, () => 0.4)].entries()) {
          const stop = settleWalk(shown(focus, x), wall, stops, dx * frame.width);
          if (stop === null) continue;
          focus = stop.focus;
          x = stop.x;
          const g = shown(focus, x);
          const at = `${name} ${frame.width}x${frame.height} walk ${k}`;
          const n = whole(g.camera, g.look[1]);
          const fronts = framed(g.camera, 0, wall, g.look[1]).fronts;
          expect(fronts.length, at).toBeLessThanOrEqual(MAX_DRAWN_CABINETS);
          if (stop === stops[0] || stop === stops[stops.length - 1]) {
            // the wall's end: its end cabinet whole, centred, the rest of the frame on what stands beside it
            ends++;
            expect(n, at).toContain(stop === stops[0] ? 0 : wall.cabinets.length - 1);
            continue;
          }
          expect(n.length, `${at}: ${n.join(',')}`).toBeGreaterThanOrEqual(need);
          // a partial one past the whole ones, unless the wall ends there
          const end = fronts.includes(0) || fronts.includes(wall.cabinets.length - 1);
          expect(fronts.length, at).toBeGreaterThanOrEqual(end ? 3 : 4);
        }
      }
    }
    expect(ends).toBeGreaterThan(0);
    expect(short).toEqual(['rack 443x454 2', 'rack 657x600 2']);
  }, 60_000);

  it('a settled walk snaps to the nearest stop ahead of where it started: a short swipe still moves on a stop, never back', () => {
    const wall = WALLS[0][1];
    const headroomMm = wall.cabinets.map(() => 300);
    for (const frame of [COVER, OPEN]) {
      const input: FramingInput = { frame, wall, headroomMm, view: 'wall', focus: 0, shelf: 0 };
      const shown = shownOn(input);
      const stops = walkStops(input);
      const f = shown(0, null);
      const xs = [f.camera.x];
      let walked = f;
      for (let k = 0; k < 8; k++) {
        // a swipe just past the dead zone: on its own it would walk the camera a quarter of a cabinet or so
        const stop = settleWalk(walked, wall, stops, -walkDeadPx(walked, wall))!;
        walked = shown(stop.focus, stop.x);
        xs.push(walked.camera.x);
      }
      for (let k = 1; k < xs.length; k++) expect(xs[k], `${frame.width} walk ${k}`).toBeGreaterThan(xs[k - 1]);
      // stop by stop: every stop past the first it reached, none skipped
      const from = stops.findIndex((s) => s.x === xs[1]);
      expect(xs.slice(1)).toEqual(stops.slice(from, from + 8).map((s) => s.x));
      // every stop stands at a cabinet's centre or halfway between two
      const centres = wall.cabinets.flatMap((c, i) => (i + 1 < wall.cabinets.length ? [c.centerMm, (c.centerMm + wall.cabinets[i + 1].centerMm) / 2] : [c.centerMm]));
      for (const s of stops) expect(centres.some((c) => Math.abs(c - s.x) < 1e-9), `${s.x}`).toBe(true);
      // and back: a short swipe the other way steps back one stop
      expect(settleWalk(walked, wall, stops, walkDeadPx(walked, wall))!.x).toBe(xs[xs.length - 2]);
      // a long swipe lands at the stop nearest where the camera walked to
      const far = swipeCamera(f, wall, -3 * frame.width);
      const nearest = stops.reduce((a, b) => (Math.abs(b.x - far.camera.x) < Math.abs(a.x - far.camera.x) ? b : a));
      expect(settleWalk(f, wall, stops, -3 * frame.width)).toBe(nearest);
    }
  });

  it('at the wall\'s ends the walk stands on the end cabinet\'s centre (reachability wins over the count); a swipe on goes nowhere; two cabinets stand both whole between', () => {
    const wall = WALLS[0][1];
    const headroomMm = wall.cabinets.map(() => 300);
    const input: FramingInput = { frame: COVER, wall, headroomMm, view: 'wall', focus: 0, shelf: 0 };
    const stops = walkStops(input);
    const f = frameCase(input);
    // swiped back past the start: the camera stands on the first cabinet, half the frame on bare wall
    const start = settleWalk(atX(f, stops[1].x), wall, stops, 10 * COVER.width)!;
    expect(start).toBe(stops[0]);
    expect(start.x).toBe(wall.cabinets[0].centerMm);
    expect(start.whole.length).toBeLessThan(3);
    expect(start.whole).toContain(0);
    expect(settleWalk(atX(f, start.x), wall, stops, 0.5 * COVER.width)).toBeNull();
    // at the far end, a swipe on stays put
    const end = settleWalk(f, wall, stops, -100 * COVER.width)!;
    expect(end).toBe(stops[stops.length - 1]);
    expect(end.whole).toContain(wall.cabinets.length - 1);
    expect(settleWalk(atX(frameCase({ ...input, focus: end.focus }), end.x), wall, stops, -0.5 * COVER.width)).toBeNull();
    // two cabinets: never three whole; the stop between them stands both
    const two = wallLayout([IKEA_KLINGSBO, IKEA_KLINGSBO]);
    const s2 = walkStops({ ...input, wall: two, headroomMm: [300, 300] });
    expect(s2.map((s) => s.whole)).toEqual([expect.arrayContaining([0]), [0, 1], expect.arrayContaining([1])]);
  });

  it('the wall view opens centred on its page; where that stands fewer than three whole, on the stop within the page that keeps the page whole and stands more, if one does', () => {
    let centred = 0;
    let moved = 0;
    for (const [name, wall] of WALLS) {
      const headroomMm = wall.cabinets.map(() => 300);
      for (const frame of FRAMES) {
        for (const focus of [0, 4, 9]) {
          const input = { frame, wall, headroomMm, view: 'wall' as const, focus, shelf: 0 };
          const page = wallPages(input).find((p) => p.includes(focus))!;
          const lo = wall.cabinets[page[0]].leftMm;
          const hi = wall.cabinets[page[page.length - 1]].rightMm;
          const mid = (lo + hi) / 2;
          const f = frameCase(input);
          const at = `${name} ${frame.width}x${frame.height} focus ${focus}`;
          const there = wholeCabinets({ ...f.camera, x: mid }, wall, f.look[1]);
          const here = wholeCabinets(f.camera, wall, f.look[1]);
          expect(here, at).toEqual(expect.arrayContaining(page));
          if (f.camera.x === mid) {
            centred++;
            // centred: the page stands three whole, or no stop within it keeps the page whole and stands more
            if (there.length < 3) {
              const centres = wall.cabinets.map((c) => c.centerMm);
              const inPage = centres.flatMap((x, i) => (i + 1 < centres.length ? [x, (x + centres[i + 1]) / 2] : [x])).filter((x) => x > lo && x < hi);
              for (const x of inPage) {
                const w = wholeCabinets({ ...f.camera, x }, wall, f.look[1]);
                if (page.every((i) => w.includes(i))) expect(w.length, `${at} at ${x}`).toBeLessThanOrEqual(there.length);
              }
            }
          } else {
            moved++;
            // moved off its page's centre only where that stood fewer than three whole, within the page, to where more do
            expect(there.length, at).toBeLessThan(3);
            expect(here.length, at).toBeGreaterThan(there.length);
            expect(f.camera.x, at).toBeGreaterThan(lo);
            expect(f.camera.x, at).toBeLessThan(hi);
            expect(f.look[0], at).toBe(f.camera.x);
          }
        }
      }
    }
    expect(centred).toBeGreaterThan(50);
    expect(moved).toBeGreaterThan(0);
  });

  it('the opening move, page by page: centred where the page stands three whole or no stop within it stands more with the page whole; else the stop within the page nearest its centre that keeps the page whole and stands the most, up to three', () => {
    const mixed = (n: number) => wallLayout(Array.from({ length: n }, (_, i) => [IKEA_KLINGSBO, IKEA_DETOLF, OPEN_STEEL_RACK][i % 3]));
    const cases: [string, WallLayout, { width: number; height: number }][] = [
      ...WALLS.flatMap(([name, wall]) => FRAMES.map((frame): [string, WallLayout, { width: number; height: number }] => [name, wall, frame])),
      // a short mixed wall where the centred page already stands three, and a stop within it would stand four
      ['mixed x4', mixed(4), { width: 300, height: 210 }],
      // and one with two stops within the page that stand three
      ['mixed x3', mixed(3), { width: 417, height: 375 }],
    ];
    let centred = 0;
    let moved = 0;
    for (const [name, wall, frame] of cases) {
      const input: FramingInput = { frame, wall, headroomMm: wall.cabinets.map(() => 300), view: 'wall', focus: 0, shelf: 0 };
      const centres = wall.cabinets.map((c) => c.centerMm);
      const xs = centres.flatMap((x, i) => (i + 1 < centres.length ? [x, (x + centres[i + 1]) / 2] : [x]));
      for (const page of wallPages(input)) {
        const f = frameCase({ ...input, focus: page[0] });
        const at = `${name} ${frame.width}x${frame.height} page [${page}]`;
        const lo = wall.cabinets[page[0]].leftMm;
        const hi = wall.cabinets[page[page.length - 1]].rightMm;
        const mid = (lo + hi) / 2;
        const there = wholeCabinets({ ...f.camera, x: mid }, wall, f.look[1]).length;
        const inPage = xs
          .filter((x) => x > lo && x < hi)
          .map((x) => ({ x, whole: wholeCabinets({ ...f.camera, x }, wall, f.look[1]) }))
          .filter((c) => page.every((i) => c.whole.includes(i)));
        const most = Math.max(there, ...inPage.map((c) => c.whole.length));
        if (there >= 3 || most === there) {
          expect(f.camera.x, at).toBe(mid);
          centred++;
          continue;
        }
        const best = inPage.filter((c) => c.whole.length >= Math.min(3, most));
        const nearest = best.reduce((a, b) => (Math.abs(b.x - mid) < Math.abs(a.x - mid) ? b : a));
        expect(f.camera.x, at).toBe(nearest.x);
        moved++;
      }
    }
    expect(centred).toBeGreaterThan(100);
    expect(moved).toBeGreaterThan(0);
  }, 60_000);
});

describe('the wall view reaches every cabinet (close-out 3, ruling 27): the pager and a walk each stand every cabinet of every pattern whole', () => {
  // the scene's frame at the Fold8's four panels, in the browser and as the installed app (full screen), both ways round
  const PANELS = [
    { width: 443, height: 344 },
    { width: 616, height: 143 },
    { width: 870, height: 261 },
    { width: 657, height: 473 },
    { width: 444, height: 487 },
    { width: 870, height: 443 },
    { width: 657, height: 656 },
    // the narrowest phone the e2e runs (android 412 x 915)
    { width: 412, height: 701 },
  ];
  // every width a Fold8 panel or the narrowest phone gives the scene, at every height from a short sideways frame to a tall one
  const SWEEP = [412, 443, 444, 616, 657, 870].flatMap((width) => Array.from({ length: 30 }, (_, k) => ({ width, height: 140 + 20 * k })));
  const LENGTHS = [1, 2, 3, 4, 5, 8, 18];
  const WALLS: [string, WallLayout][] = WALL_PATTERNS.flatMap((p) =>
    LENGTHS.map((n): [string, WallLayout] => [`${p.id} x${n}`, wallLayout(Array.from({ length: n }, (_, i) => p.profiles[i % p.profiles.length]))]),
  );
  const wallInput = (wall: WallLayout, frame: { width: number; height: number }, focus = 0): FramingInput => ({
    frame,
    wall,
    headroomMm: wall.cabinets.map(() => 300),
    view: 'wall',
    focus,
    shelf: 0,
  });
  const wholeIn = (f: Framing, wall: WallLayout) => wholeCabinets(f.camera, wall, f.look[1]);

  it('the pager: every page opens with all its cabinets whole, and each press moves the camera on along the wall', () => {
    let pages = 0;
    for (const [name, wall] of WALLS) {
      for (const frame of [...PANELS, ...SWEEP]) {
        const input = wallInput(wall, frame);
        const all = wallPages(input);
        expect(all.flat(), `${name} ${frame.width}x${frame.height}`).toEqual(wall.cabinets.map((_, i) => i));
        let lastX = -Infinity;
        for (const page of all) {
          const f = frameCase({ ...input, focus: page[0] });
          const at = `${name} ${frame.width}x${frame.height} page [${page}]`;
          expect(wholeIn(f, wall), at).toEqual(expect.arrayContaining(page));
          expect(f.camera.x, at).toBeGreaterThan(lastX);
          lastX = f.camera.x;
          pages++;
        }
      }
    }
    expect(pages).toBeGreaterThan(10_000);
  }, 120_000);

  it('the wall view opens on any cabinet with that cabinet and its page whole', () => {
    for (const [name, wall] of WALLS) {
      for (const frame of PANELS) {
        const input = wallInput(wall, frame);
        const pages = wallPages(input);
        for (let focus = 0; focus < wall.cabinets.length; focus++) {
          const f = frameCase({ ...input, focus });
          const page = pages.find((p) => p.includes(focus))!;
          expect(f.page).toEqual(page);
          expect(wholeIn(f, wall), `${name} ${frame.width}x${frame.height} focus ${focus}`).toEqual(expect.arrayContaining(page));
        }
      }
    }
  }, 60_000);

  /** The wall view as the scene shows it: the focus cabinet's page framing (the scene keeps it per focus), the camera where a walk settled (none: as framed). */
  const showing = (input: FramingInput) => {
    const framed = new Map<number, Framing>();
    return (focus: number, x: number | null) => {
      if (!framed.has(focus)) framed.set(focus, frameCase({ ...input, focus }));
      const f = framed.get(focus)!;
      return x === null ? f : atX(f, x);
    };
  };

  it('a walk, by swipes just past the dead zone or long ones, out to the far end and back: it settles only on stops, each as it says, and every cabinet stands whole on the way', () => {
    for (const [name, wall] of WALLS) {
      for (const frame of [...PANELS, ...SWEEP]) {
        const input = wallInput(wall, frame);
        const shown = showing(input);
        const stops = walkStops(input);
        const at = `${name} ${frame.width}x${frame.height}`;
        // the wall's ends are always stops: the first and the last cabinet's centre, where the swipe stops
        expect(stops[0].x, at).toBe(wall.cabinets[0].centerMm);
        expect(stops[stops.length - 1].x, at).toBe(wall.cabinets[wall.cabinets.length - 1].centerMm);
        for (const [out, back] of [
          [(f: Framing) => -walkDeadPx(f, wall), (f: Framing) => walkDeadPx(f, wall)],
          [() => -0.7 * frame.width, () => 0.4 * frame.width],
        ]) {
          let focus = 0;
          let x: number | null = null;
          // as it opens, then at each stop the walk settles on
          const seen = new Set<number>(wholeIn(shown(0, null), wall));
          for (const swipe of [out, back]) {
            for (let k = 0; k <= stops.length; k++) {
              const f = shown(focus, x);
              const dx = swipe(f);
              const stop = settleWalk(f, wall, stops, dx);
              if (stop === null) break;
              expect(stops, `${at} at ${stop.x}`).toContain(stop);
              // the scene shows the stop's picture: its whole cabinets are what the stop says
              expect(wholeIn(shown(stop.focus, stop.x), wall), `${at} at ${stop.x}`).toEqual(stop.whole);
              expect(stop.focus).toBe(nearestCabinet(wall, stop.x));
              // a finger moving left walks the camera right
              expect(Math.sign(stop.x - f.camera.x), `${at} at ${stop.x}`).toBe(-Math.sign(dx));
              stop.whole.forEach((i) => seen.add(i));
              focus = stop.focus;
              x = stop.x;
            }
            // a swipe on past the end goes nowhere: the walk stands at the wall's end
            expect(shown(focus, x).camera.x, `${at} end`).toBe(swipe === out ? stops[stops.length - 1].x : stops[0].x);
          }
          expect([...seen].sort((a, b) => a - b), at).toEqual(wall.cabinets.map((_, i) => i));
        }
      }
    }
  }, 120_000);

  it('the stops: three or more whole (or the most any stop stands), the two ends, and for a cabinet whole at none of those the stop that stands it whole beside the most', () => {
    let reach = 0;
    for (const [name, wall] of WALLS) {
      for (const frame of [...PANELS, ...SWEEP]) {
        const stops = walkStops(wallInput(wall, frame));
        const at = `${name} ${frame.width}x${frame.height}`;
        const most = Math.max(...stops.map((s) => s.whole.length));
        const need = Math.min(3, most);
        const full = stops.filter((s) => s.whole.length >= need);
        const ends = [stops[0], stops[stops.length - 1]];
        for (const s of stops) {
          if (full.includes(s) || ends.includes(s)) continue;
          // a stop short of the count stands a cabinet whole that no stop of the count nor an end does
          const alone = s.whole.filter((i) => ![...full, ...ends].some((t) => t.whole.includes(i)));
          expect(alone.length, `${at} stop ${s.x} whole [${s.whole}]`).toBeGreaterThan(0);
          // of the places a walk may settle (each seen from its focus cabinet's page), none stands that cabinet whole beside more
          const input = wallInput(wall, frame);
          const shown = showing(input);
          const centres = wall.cabinets.map((c) => c.centerMm);
          for (const x of centres.flatMap((c, i) => (i + 1 < centres.length ? [c, (c + centres[i + 1]) / 2] : [c]))) {
            const w = wholeIn(shown(nearestCabinet(wall, x), x), wall);
            if (alone.some((i) => w.includes(i))) expect(w.length, `${at} stop ${s.x} against ${x}`).toBeLessThanOrEqual(s.whole.length);
          }
          reach++;
        }
        for (let k = 1; k < stops.length; k++) expect(stops[k].x, at).toBeGreaterThan(stops[k - 1].x);
      }
    }
    // a short mixed wall on a tall narrow frame needs them: its rack is whole only at its own centre
    expect(reach).toBeGreaterThan(0);
  }, 60_000);

  it('the focus a walk leaves is the cabinet whose centre is nearest the camera, the first of two as near', () => {
    const wall = wallLayout(Array(4).fill(IKEA_KLINGSBO));
    const [c0, c1] = [wall.cabinets[0].centerMm, wall.cabinets[1].centerMm];
    expect(nearestCabinet(wall, (c0 + c1) / 2)).toBe(0);
    expect(nearestCabinet(wall, (c0 + c1) / 2 + 1)).toBe(1);
    expect(nearestCabinet(wall, -1e6)).toBe(0);
    expect(nearestCabinet(wall, 1e6)).toBe(3);
  });

  it(`NOTE 30: a drag must move ${WALK_MIN_PX} px or a quarter of the cabinet's width net before the walk steps; one that comes back near where it started settles back`, () => {
    const wall = wallLayout(Array(18).fill(IKEA_KLINGSBO));
    for (const frame of PANELS) {
      const input = wallInput(wall, frame, 6);
      const stops = walkStops(input);
      const f = frameCase(input);
      const dead = walkDeadPx(f, wall);
      const perPx = (f.camera.z - f.look[2]) / f.camera.focalPx;
      expect(dead).toBeCloseTo(Math.max(WALK_MIN_PX, IKEA_KLINGSBO.outer.widthMm / 4 / perPx), 9);
      for (const dx of [-2, 2, -(dead - 0.5), dead - 0.5]) expect(settleWalk(f, wall, stops, dx), `${frame.width} ${dx}`).toBeNull();
      expect(settleWalk(f, wall, stops, -dead)!.x).toBeGreaterThan(f.camera.x);
      expect(settleWalk(f, wall, stops, dead)!.x).toBeLessThan(f.camera.x);
    }
  });
});

describe('NOTE 31: a pan of the wall view settles on the same kind of stop, where the photo can slide to one', () => {
  const PANELS = [
    { width: 443, height: 344 },
    { width: 616, height: 143 },
    { width: 870, height: 261 },
    { width: 657, height: 473 },
    { width: 444, height: 487 },
    { width: 870, height: 443 },
    { width: 657, height: 656 },
  ];
  const WALLS: [string, WallLayout][] = WALL_PATTERNS.flatMap((p) =>
    [1, 2, 4, 8, 18].map((n): [string, WallLayout] => [`${p.id} x${n}`, wallLayout(Array.from({ length: n }, (_, i) => p.profiles[i % p.profiles.length]))]),
  );
  const opening = (wall: WallLayout, frame: { width: number; height: number }) =>
    frameCase({ frame, wall, headroomMm: wall.cabinets.map(() => 300), view: 'wall', focus: 0, shelf: 0 });
  /** The cabinets whole across the picture slid panPx (retaken farther along past the slide), at the height it aims at. */
  const wholeAt = (f: Framing, wall: WallLayout, panPx: number) => {
    const r = panFraming(f, panPx);
    return wall.cabinets.flatMap((slot, i) =>
      [slot.leftMm, slot.rightMm].every((x) => {
        const p = project(r.framing.camera, [x, f.look[1], 0]).x + r.panPx;
        return p >= 0 && p <= f.camera.frame.width;
      })
        ? [i]
        : [],
    );
  };

  it('the stops: the slides to the wall\'s two ends, and in between each slide that centres a stop of the walk, three or more whole or the most any does, or one that alone stands a cabinet whole', () => {
    for (const [name, wall] of WALLS) {
      for (const frame of PANELS) {
        const f = opening(wall, frame);
        const [lo, hi] = panLimitsPx(f, wall);
        const stops = panStops(f, wall);
        const at = `${name} ${frame.width}x${frame.height}`;
        expect(stops[0].panPx, at).toBe(lo);
        expect(stops[stops.length - 1].panPx, at).toBe(hi);
        for (let k = 1; k < stops.length; k++) expect(stops[k].panPx, at).toBeGreaterThan(stops[k - 1].panPx);
        for (const s of stops) expect(s.whole, `${at} pan ${s.panPx}`).toEqual(wholeAt(f, wall, s.panPx));
        const need = Math.min(3, Math.max(...stops.map((s) => s.whole.length)));
        const full = stops.filter((s) => s.whole.length >= need);
        const ends = [stops[0], stops[stops.length - 1]];
        for (const s of stops) {
          if (full.includes(s) || ends.includes(s)) continue;
          expect(s.whole.filter((i) => ![...full, ...ends].some((t) => t.whole.includes(i))).length, `${at} pan ${s.panPx}`).toBeGreaterThan(0);
        }
      }
    }
  }, 60_000);

  it('a pan by swipes just past the dead zone out to the wall\'s end and back settles only on stops, the photo following the finger; on the open-rotated panel two swipes in it stands three whole', () => {
    for (const [name, wall] of WALLS) {
      for (const frame of PANELS) {
        const f = opening(wall, frame);
        const stops = panStops(f, wall);
        const at = `${name} ${frame.width}x${frame.height}`;
        for (const finger of [-1, 1]) {
          let pan = finger < 0 ? 0 : stops[stops.length - 1].panPx;
          for (let k = 0; k <= stops.length; k++) {
            const dx = finger * walkDeadPx(panFraming(f, pan).framing, wall);
            const stop = settlePan(f, wall, stops, pan, dx);
            if (stop === null) break;
            expect(stops, at).toContain(stop);
            expect(Math.sign(stop.panPx - pan), at).toBe(finger);
            pan = stop.panPx;
          }
          expect(pan, at).toBe(finger < 0 ? stops[0].panPx : stops[stops.length - 1].panPx);
        }
      }
    }
    // the e2e's pan-2: two swipes of 400 px into the fixture wall (KLINGSBOs) on the open-rotated panel
    const wall = wallLayout(Array(18).fill(IKEA_KLINGSBO));
    const f = opening(wall, { width: 657, height: 473 });
    const stops = panStops(f, wall);
    let pan = 0;
    for (let k = 0; k < 2; k++) pan = settlePan(f, wall, stops, pan, -400)!.panPx;
    expect(wholeAt(f, wall, pan).length).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it('a drag short of the dead zone settles back: no stop', () => {
    const wall = wallLayout(Array(18).fill(IKEA_KLINGSBO));
    const f = opening(wall, { width: 657, height: 473 });
    const stops = panStops(f, wall);
    const dead = walkDeadPx(f, wall);
    expect(settlePan(f, wall, stops, 0, -(dead - 0.5))).toBeNull();
    expect(settlePan(f, wall, stops, 0, -dead)!.panPx).toBeLessThan(0);
    // and past the wall's end a pan goes nowhere
    expect(settlePan(f, wall, stops, 0, 1000)).toBeNull();
    // past the slide the photo is retaken farther along: the dead zone is the cabinet that picture centres on (a mixed
    // wall, where it is not the one the unslid picture centres on)
    const mixed = wallLayout(Array.from({ length: 18 }, (_, i) => [IKEA_KLINGSBO, IKEA_DETOLF, OPEN_STEEL_RACK][i % 3]));
    const g = opening(mixed, { width: 657, height: 473 });
    const ms = panStops(g, mixed);
    const d0 = walkDeadPx(g, mixed);
    const far = ms.find((x) => walkDeadPx(panFraming(g, x.panPx).framing, mixed) > d0)!;
    const d1 = walkDeadPx(panFraming(g, far.panPx).framing, mixed);
    expect(settlePan(g, mixed, ms, far.panPx, (d0 + d1) / 2)).toBeNull();
    expect(settlePan(g, mixed, ms, far.panPx, d1)!.panPx).toBeGreaterThan(far.panPx);
  });
});

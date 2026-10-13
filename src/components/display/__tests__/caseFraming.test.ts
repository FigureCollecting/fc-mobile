import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../cabinetPresets';
import { IN_MM, frameMargins, project, startCameraY, unprojectToPlaneZ, type Camera, type Vec3 } from '../caseCamera';
import { MAX_DRAWN_CABINETS, trimFace } from '../caseCull';
import { wallLayout, type WallLayout } from '../packCabinets';
import { sideOverhangMm } from '../cabinetProfile';
import {
  STEP_BACK_MAX_MM,
  cabinetBox,
  frameCase,
  PAN_EDGE_TAN_MAX,
  panFraming,
  panLimitsPx,
  panSlideMaxPx,
  swipeCamera,
  cabinetsInReach,
  capSlidePx,
  capSpanMm,
  wallPages,
  wallReachMm,
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

  it('the wall view still shows the wall (Ross 12:1xC): as it opens, three cabinets whole across the frame; walked, four fronts or more, two whole', () => {
    // a wall of one kind of glass cabinet, every Fold8 panel; whole = the body, side to side, at the height the frame aims at
    for (const [name, wall] of WALLS.slice(0, 2)) {
      const headroomMm = wall.cabinets.map(() => 300);
      for (const frame of FRAMES) {
        const f = frameCase({ frame, wall, headroomMm, view: 'wall', focus: 0, shelf: 0 });
        const whole = (camera: Camera) =>
          wall.cabinets.flatMap((slot, i) =>
            [slot.leftMm, slot.rightMm].every((x) => {
              const p = project(camera, [x, f.look[1], 0]);
              return p.x >= 0 && p.x <= frame.width;
            })
              ? [i]
              : [],
          );
        expect(whole(f.camera).length, `${name} ${frame.width}x${frame.height} as it opens`).toBeGreaterThanOrEqual(3);
        let walked = f;
        for (let k = 1; k <= 40; k++) {
          walked = swipeCamera(walked, wall, -0.13 * frame.width);
          const at = `${name} ${frame.width}x${frame.height} walk ${k}`;
          expect(whole(walked.camera).length, at).toBeGreaterThanOrEqual(2);
          expect(framed(walked.camera, 0, wall, f.look[1]).fronts.length, at).toBeGreaterThanOrEqual(4);
        }
      }
    }
  });
});

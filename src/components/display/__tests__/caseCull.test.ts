import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { IKEA_DETOLF, IKEA_KLINGSBO, OPEN_STEEL_RACK } from '../cabinetPresets';
import { boxCorners, lensFocalPx, project, type Camera, type Vec3 } from '../caseCamera';
import { cabinetBox, frameCase, panFraming, wallPages, type FramingInput } from '../caseFraming';
import { wallLayout } from '../packCabinets';
import { sideOverhangMm } from '../cabinetProfile';
import {
  CABINET_HYSTERESIS,
  CULL_MARGIN,
  DRAWN_CABINETS_LIMIT,
  DRAWN_FIGURES_LIMIT,
  FIGURE_BUDGET_VIEWPORTS,
  MAX_DRAWN_CABINETS,
  MAX_DRAWN_FIGURES,
  NEAR_MM,
  RECULL_SHARE,
  byFrameCentre,
  cullRect,
  figureCap,
  figureScales,
  figuresToDraw,
  hiddenUnder,
  opaqueBoards,
  nearestCabinets,
  stickyView,
  texelScale,
  trimFace,
  type CullView,
  type FigureBox,
} from '../caseCull';

const COVER = { width: 443, height: 344 };
const OPEN = { width: 870, height: 261 };
const WALL = wallLayout(Array.from({ length: 100 }, () => IKEA_KLINGSBO));

function framing(frame = COVER, focus = 10, view: FramingInput['view'] = 'wall') {
  return frameCase({ frame, wall: WALL, headroomMm: WALL.cabinets.map(() => 300), view, focus, shelf: 0 });
}
const viewOf = (camera: Camera, panPx = 0): CullView => ({ camera, panPx });
const at = (a: Vec3, u: Vec3, v: Vec3, s: number, t: number): Vec3 => [a[0] + s * u[0] + t * v[0], a[1] + s * u[1] + t * v[1], a[2] + s * u[2] + t * v[2]];
const screen = (view: CullView, p: Vec3) => {
  const q = project(view.camera, p);
  return { x: q.x + view.panPx, y: q.y, depth: q.depth };
};

describe('cullRect: the frame and half a viewport round it', () => {
  it('reaches half the frame past each edge', () => {
    expect(CULL_MARGIN).toBe(0.5);
    expect(cullRect(COVER)).toEqual({ x0: -221.5, x1: 664.5, y0: -172, y1: 516 });
  });
});

describe('trimFace: the part of a face that draws in the frame and its margin', () => {
  const view = viewOf(framing().camera);
  const rect = cullRect(COVER);

  it('a face wholly inside is drawn whole', () => {
    const slot = WALL.cabinets[10];
    expect(trimFace(view, [slot.leftMm, 1000, 0], [slot.rightMm - slot.leftMm, 0, 0], [0, -500, 0], rect)).toEqual({ s0: 0, s1: 1, t0: 0, t1: 1 });
  });

  it('a face wholly past the margin is not drawn', () => {
    const slot = WALL.cabinets[40];
    expect(trimFace(view, [slot.leftMm, 1000, 0], [slot.rightMm - slot.leftMm, 0, 0], [0, -500, 0], rect)).toBeNull();
  });

  it('the room wall, 100 m long, is cut to the stretch the frame and its margin see, and reaches both edges', () => {
    const a: Vec3 = [-6000, 3200, -850];
    const u: Vec3 = [WALL.rightMm + 12000, 0, 0];
    const v: Vec3 = [0, -3200, 0];
    const t = trimFace(view, a, u, v, rect)!;
    // a few metres of a wall some 60 m long
    expect((t.s1 - t.s0) * u[0]).toBeLessThan(12_000);
    // the cut's ends: the frame's side (with its margin) runs through one corner of each, the other lies past it
    const xs = (s: number) => [t.t0, t.t1].map((tt) => screen(view, at(a, u, v, s, tt)).x);
    expect(Math.max(...xs(t.s0))).toBeCloseTo(rect.x0, 3);
    expect(Math.min(...xs(t.s1))).toBeCloseTo(rect.x1, 3);
  });

  it('the room floor, reaching past the camera, stops at the near plane in front of it', () => {
    const a: Vec3 = [-6000, 0, -850];
    const u: Vec3 = [WALL.rightMm + 12000, 0, 0];
    const v: Vec3 = [0, 0, 20_000];
    const t = trimFace(view, a, u, v, rect)!;
    expect(t).not.toBeNull();
    for (const s of [t.s0, t.s1]) for (const tt of [t.t0, t.t1]) expect(screen(view, at(a, u, v, s, tt)).depth).toBeGreaterThanOrEqual(NEAR_MM - 1e-6);
  });

  it('a face running from in front of the camera to behind it stops at the near plane', () => {
    // a level camera; the face is the vertical plane through it along its axis, a hand either side of its eye
    const camera: Camera = { x: 0, y: 1000, z: 1000, pitch: 0, focalPx: 300, frame: COVER };
    const a: Vec3 = [0, 1100, -2000];
    const u: Vec3 = [0, 0, 4000];
    const v: Vec3 = [0, -200, 0];
    const t = trimFace(viewOf(camera), a, u, v, rect)!;
    expect(t).not.toBeNull();
    // the part kept reaches to the near plane and no nearer
    const depth = (s: number) => screen(viewOf(camera), at(a, u, v, s, 0.5)).depth;
    expect(Math.min(depth(t.s0), depth(t.s1))).toBeCloseTo(NEAR_MM, 6);
  });

  it('the near plane stands 10 mm in front of the camera: a face 9 mm away is not drawn, one 11 mm away is', () => {
    // a level camera looking down -z; a face square to its axis, small enough to sit inside the frame either way
    const camera: Camera = { x: 0, y: 1000, z: 1000, pitch: 0, focalPx: 300, frame: COVER };
    const face = (depth: number) => trimFace(viewOf(camera), [-1, 999, 1000 - depth], [2, 0, 0], [0, 2, 0], rect);
    expect(face(9)).toBeNull();
    expect(face(11)).toEqual({ s0: 0, s1: 1, t0: 0, t1: 1 });
  });

  it('a face that only touches the rect along its edge is not drawn', () => {
    // a level camera whose frame centre sits on the rect's left side: that side's plane is x = 0 exactly
    const camera: Camera = { x: 0, y: 0, z: 1000, pitch: 0, focalPx: 100, frame: { width: 200, height: 200 } };
    const edge = { x0: 100, x1: 300, y0: -100, y1: 300 };
    expect(trimFace(viewOf(camera), [-500, 0, 0], [500, 0, 0], [0, 100, 0], edge)).toBeNull();
    expect(trimFace(viewOf(camera), [-500, 0, 0], [501, 0, 0], [0, 100, 0], edge)).not.toBeNull();
  });

  it('a pan shifts what is seen: a face the slid picture brings in is drawn', () => {
    const slot = WALL.cabinets[20];
    const face: [Vec3, Vec3, Vec3] = [[slot.leftMm, 1000, 0], [slot.rightMm - slot.leftMm, 0, 0], [0, -500, 0]];
    const camera = framing().camera;
    const shift = screen(viewOf(camera), [slot.centerMm, 1000, 0]).x;
    expect(trimFace(viewOf(camera), ...face, rect)).toBeNull();
    expect(trimFace(viewOf(camera, -shift + COVER.width / 2), ...face, rect)).toEqual({ s0: 0, s1: 1, t0: 0, t1: 1 });
  });

  it('never loses a point that draws inside the rect, and every corner of the cut draws inside it', () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.double({ min: -3000, max: 8000, noNaN: true }), fc.double({ min: -500, max: 3000, noNaN: true }), fc.double({ min: -1500, max: 3000, noNaN: true })),
        fc.tuple(fc.double({ min: -9000, max: 9000, noNaN: true }), fc.double({ min: -3000, max: 3000, noNaN: true }), fc.double({ min: -9000, max: 9000, noNaN: true })),
        fc.tuple(fc.double({ min: -9000, max: 9000, noNaN: true }), fc.double({ min: -3000, max: 3000, noNaN: true }), fc.double({ min: -9000, max: 9000, noNaN: true })),
        (a, u, v) => {
          const t = trimFace(view, a, u, v, rect);
          for (let i = 0; i <= 8; i++) {
            for (let j = 0; j <= 8; j++) {
              const p = screen(view, at(a, u, v, i / 8, j / 8));
              const shows = p.depth >= NEAR_MM && p.x >= rect.x0 && p.x <= rect.x1 && p.y >= rect.y0 && p.y <= rect.y1;
              if (!shows) continue;
              expect(t).not.toBeNull();
              expect(i / 8).toBeGreaterThanOrEqual(t!.s0 - 1e-6);
              expect(i / 8).toBeLessThanOrEqual(t!.s1 + 1e-6);
              expect(j / 8).toBeGreaterThanOrEqual(t!.t0 - 1e-6);
              expect(j / 8).toBeLessThanOrEqual(t!.t1 + 1e-6);
            }
          }
          if (t) {
            expect(t.s0).toBeGreaterThanOrEqual(0);
            expect(t.s1).toBeLessThanOrEqual(1);
            expect(t.t0).toBeGreaterThanOrEqual(0);
            expect(t.t1).toBeLessThanOrEqual(1);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe(`nearestCabinets: at most ${MAX_DRAWN_CABINETS} drawn, nearest the frame centre, steady against small moves`, () => {
  it('a long wall on the open panel: the five whose fronts draw nearest the frame centre', () => {
    const camera = framing(OPEN, 10).camera;
    const got = nearestCabinets(viewOf(camera), WALL, []);
    expect(got).toHaveLength(MAX_DRAWN_CABINETS);
    const dist = (i: number) => Math.abs(screen(viewOf(camera), [WALL.cabinets[i].centerMm, IKEA_KLINGSBO.outer.heightMm / 2, 0]).x - camera.frame.width / 2);
    const rest = WALL.cabinets.map((_, i) => i).filter((i) => !got.includes(i));
    expect(Math.max(...got.map(dist))).toBeLessThanOrEqual(Math.min(...rest.map(dist)));
    expect(got).toEqual([...got].sort((x, y) => x - y));
  });

  it('a wall of three draws all three', () => {
    const wall = wallLayout([IKEA_KLINGSBO, IKEA_KLINGSBO, IKEA_KLINGSBO]);
    expect(nearestCabinets(viewOf(framing().camera), wall, [])).toEqual([0, 1, 2]);
  });

  it('a cabinet already drawn keeps its place until another is nearer the centre by a tenth of the frame', () => {
    expect(CABINET_HYSTERESIS).toBe(0.1);
    // the open panel's full-height camera shows some fifteen fronts (CF1 a: the whole panel): five are chosen among them
    const camera = framing(OPEN, 10).camera;
    const fresh = nearestCabinets(viewOf(camera), WALL, []);
    // walk the camera along the wall so the rightmost not drawn comes nearer than the leftmost drawn, by a little
    const step = (WALL.cabinets[1].centerMm - WALL.cabinets[0].centerMm) * 0.6;
    const little = { ...camera, x: camera.x + step };
    const kept = nearestCabinets(viewOf(little), WALL, fresh);
    expect(kept).toEqual(fresh);
    expect(nearestCabinets(viewOf(little), WALL, [])).not.toEqual(fresh);
    // and a walk of a few cabinets replaces it
    const far = { ...camera, x: camera.x + step * 10 };
    expect(nearestCabinets(viewOf(far), WALL, fresh)).toEqual(nearestCabinets(viewOf(far), WALL, []));
  });

  it('a front the frame shows only high up (the shelf view at the top) is still a front: drawn before a neighbour kept from before', () => {
    // level at a top shelf, close in: the frame shows the fronts above some 1.2 m only, the rest of each front below it
    const H = IKEA_KLINGSBO.outer.heightMm;
    let checked = 0;
    for (let x = WALL.cabinets[5].centerMm; x <= WALL.cabinets[7].centerMm; x += 13) {
      const camera: Camera = { x, y: H * 0.85, z: 1100, pitch: 0, focalPx: lensFocalPx(OPEN), frame: OPEN };
      const view = viewOf(camera);
      const bottom = { x0: 0, x1: OPEN.width, y0: 0, y1: OPEN.height };
      const feet = sideOverhangMm(IKEA_KLINGSBO);
      const front = (i: number, h: number) => {
        const slot = WALL.cabinets[i];
        return trimFace(view, [slot.leftMm - feet, 0, 0], [slot.rightMm - slot.leftMm + 2 * feet, 0, 0], [0, h, 0], bottom);
      };
      const fronts = WALL.cabinets.flatMap((_, i) => (front(i, H) ? [i] : []));
      // none of the lower half of any front is in the frame
      for (const i of fronts) expect(front(i, H / 2)).toBeNull();
      expect(fronts.length).toBeLessThanOrEqual(MAX_DRAWN_CABINETS);
      // whatever was drawn before (each other cabinet near the frame, given the bonus), every front is drawn
      for (let prev = fronts[0] - 4; prev <= fronts[fronts.length - 1] + 4; prev++) {
        const got = nearestCabinets(view, WALL, [prev]);
        for (const i of fronts) expect(got, `x ${x} prev ${prev}`).toContain(i);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  const MIXED = wallLayout(Array.from({ length: 30 }, (_, i) => [IKEA_KLINGSBO, IKEA_DETOLF, OPEN_STEEL_RACK][i % 3]));
  for (const [name, wall] of [
    ['KLINGSBOs', WALL],
    ['KLINGSBO, Detolf, rack', MIXED],
  ] as const) {
    it(`a cabinet the frame shows comes before one it does not, wherever along the wall the camera stands: ${name}`, () => {
      // a narrow frame shows four cabinets or so: the fifth drawn is one it shows at its edge, never one wholly past it
      const narrow = { width: 360, height: 480 };
      const base = frameCase({ frame: narrow, wall, headroomMm: wall.cabinets.map(() => 300), view: 'wall', focus: 3, shelf: 0 }).camera;
      let checked = 0;
      for (let x = wall.cabinets[2].centerMm; x <= wall.cabinets[8].centerMm; x += 7) {
        const view = viewOf({ ...base, x });
        const span = (i: number) => {
          const b = cabinetBox(wall.cabinets[i], 0);
          const xs = boxCorners(b.x0, b.x1, b.y0, wall.cabinets[i].profile.outer.heightMm, b.z0, b.z1).map((c) => screen(view, c).x);
          return [Math.min(...xs), Math.max(...xs)];
        };
        const shows = wall.cabinets.map((_, i) => i).filter((i) => span(i)[1] >= 0 && span(i)[0] <= narrow.width);
        if (shows.length > MAX_DRAWN_CABINETS) continue;
        checked++;
        const got = nearestCabinets(view, wall, []);
        for (const i of shows) expect(got, `camera at ${x}: cabinet ${i} shows at ${span(i).map((v) => v.toFixed(0))}`).toContain(i);
        // and cabinets drawn before keep no place against one the frame shows, however many there are
        const kept = wall.cabinets.map((_, i) => i).filter((i) => !shows.includes(i) && Math.abs(i - shows[0]) <= 4);
        expect(nearestCabinets(view, wall, kept)).toEqual(expect.arrayContaining(shows));
      }
      expect(checked).toBeGreaterThan(50);
    });
  }

  it('every cabinet whose front the frame shows comes before one it sees only through the glass at its edge, walked or slid', () => {
    let checked = 0;
    for (const [frame, wall] of [
      [COVER, WALL],
      [OPEN, WALL],
      [{ width: 657, height: 480 }, MIXED],
    ] as const) {
      const f = frameCase({ frame, wall, headroomMm: wall.cabinets.map(() => 300), view: 'wall', focus: 12, shelf: 0 });
      for (let k = -12; k <= 12; k++) {
        const r = panFraming(f, (k / 12) * (f.slideMaxPx ?? 0) * 1.5);
        const view = viewOf(r.framing.camera, r.panPx);
        // each cabinet's front, feet to top, on the front plane, where it draws inside the frame itself (CASE-FB1: the
        // drawn frame, cropped to five fronts where the full-height camera would show more)
        const rect = { x0: 0, x1: f.camera.frame.width, y0: 0, y1: f.camera.frame.height };
        const fronts = wall.cabinets.flatMap((slot, i) => {
          const b = cabinetBox(slot, 0);
          return trimFace(view, [b.x0, b.y0, 0], [b.x1 - b.x0, 0, 0], [0, b.y1 - b.y0, 0], rect) ? [i] : [];
        });
        // CF1 (a): the framing draws its own cap of cabinets (more on a wide panel)
        expect(fronts.length).toBeLessThanOrEqual(f.drawCap);
        expect(nearestCabinets(view, wall, [], f.drawCap), `${frame.width} slid ${r.panPx}`).toEqual(expect.arrayContaining(fronts));
        checked++;
      }
    }
    expect(checked).toBe(75);
  });

  it('a corner behind the camera never stretches a cabinet across the frame', () => {
    // the camera stands inside the cabinets' depth, looking at their backs: their fronts are behind it
    const wall = wallLayout(Array.from({ length: 20 }, () => IKEA_KLINGSBO));
    const x = wall.cabinets[10].centerMm;
    const camera: Camera = { x, y: 1000, z: -200, pitch: 0, focalPx: 300, frame: COVER };
    // the photo slid right: the backs the frame centre sees are those of the cabinets left of the camera
    const view = viewOf(camera, 900);
    const backs = (i: number) => [wall.cabinets[i].leftMm - 47.5, wall.cabinets[i].rightMm + 47.5].map((wx) => screen(view, [wx, 1000, -400]).x);
    const off = (i: number) => {
      const [x0, x1] = backs(i);
      return x1 < COVER.width / 2 ? COVER.width / 2 - x1 : x0 > COVER.width / 2 ? x0 - COVER.width / 2 : 0;
    };
    const want = wall.cabinets
      .map((_, i) => i)
      .sort((a, b) => off(a) - off(b) || a - b)
      .slice(0, 5)
      .sort((a, b) => a - b);
    expect(nearestCabinets(view, wall, [])).toEqual(want);
    // slid by 900 px at 1.5 px per mm at their backs: some 600 mm, a cabinet and more, to the left of the camera's
    expect(want).toEqual([7, 8, 9, 10, 11]);
  });

  it('a cabinet behind the camera is never chosen over one in front', () => {
    const camera = { ...framing().camera, z: -1000 };
    expect(nearestCabinets(viewOf(camera), wallLayout([IKEA_KLINGSBO]), [])).toEqual([0]);
  });
});

describe('stickyView: re-cull on a camera change, not on every small move', () => {
  const camera = framing().camera;
  const view = viewOf(camera);

  it('the first view is taken as it is', () => {
    expect(stickyView(null, view)).toBe(view);
  });

  it(`keeps the culled view while the picture has moved less than ${RECULL_SHARE * 100} % of the frame width, by a pan or a walk`, () => {
    expect(RECULL_SHARE).toBe(0.25);
    const smallPan = viewOf(camera, -0.2 * camera.frame.width);
    expect(stickyView(view, smallPan)).toBe(view);
    const perPx = (camera.z - 0) / camera.focalPx;
    const smallWalk = viewOf({ ...camera, x: camera.x + 0.2 * camera.frame.width * perPx * 0.9 });
    expect(stickyView(view, smallWalk)).toBe(view);
  });

  it('takes the new view once the picture moved farther, or anything but the camera x and the pan changed', () => {
    const bigPan = viewOf(camera, -0.3 * camera.frame.width);
    expect(stickyView(view, bigPan)).toBe(bigPan);
    const perPx = (camera.z - 0) / camera.focalPx;
    const bigWalk = viewOf({ ...camera, x: camera.x + 0.4 * camera.frame.width * perPx });
    expect(stickyView(view, bigWalk)).toBe(bigWalk);
    for (const patch of [{ z: camera.z + 1 }, { y: camera.y + 1 }, { pitch: camera.pitch + 0.01 }, { focalPx: camera.focalPx + 1 }, { frame: OPEN }]) {
      const next = viewOf({ ...camera, ...patch });
      expect(stickyView(view, next)).toBe(next);
    }
  });

  it('takes the new view when the old one looked at nothing on the cabinets front', () => {
    const away = viewOf({ ...camera, pitch: -Math.PI / 2 });
    const next = viewOf({ ...away.camera, x: away.camera.x + 1 });
    expect(stickyView(away, next)).toBe(next);
  });
});

describe('texelScale: faces drawn at the px per mm the screen shows them, never coarser', () => {
  const span = { y0: 0, y1: 2100, z0: -400, z1: 50 };
  const nearest = (camera: Camera) => {
    const sin = Math.sin(camera.pitch);
    const cos = Math.cos(camera.pitch);
    const depths = [span.y0, span.y1].flatMap((y) => [span.z0, span.z1].map((z) => (camera.y - y) * sin + (camera.z - z) * cos));
    return camera.focalPx / Math.min(...depths);
  };

  it.each([
    ['wall, cover', framing(COVER)],
    ['wall, open', framing(OPEN)],
    ['cabinet, cover', framing(COVER, 10, 'cabinet')],
    ['shelf, open', framing(OPEN, 10, 'shelf')],
  ])('%s: at least what the nearest point shows, under 1.19 times it, at most 1 px per mm', (_, f) => {
    const s = texelScale(f.camera, span);
    const need = nearest(f.camera);
    expect(s).toBeLessThanOrEqual(1);
    expect(s).toBeGreaterThanOrEqual(Math.min(1, need) - 1e-9);
    if (need < 2 ** -0.25) expect(s).toBeLessThan(need * 2 ** 0.25 + 1e-9);
  });

  it('never more than a quarter octave over what the nearest point shows, wherever the camera stands', () => {
    const framed = framing(COVER).camera;
    fc.assert(
      fc.property(fc.double({ min: 400, max: 30_000, noNaN: true }), fc.double({ min: 0, max: 0.6, noNaN: true }), (z, pitch) => {
        const camera = { ...framed, z, pitch };
        const need = nearest(camera);
        if (need >= 2 ** -0.25 || need <= 1 / 64) return;
        const s = texelScale(camera, span);
        expect(s).toBeGreaterThanOrEqual(need - 1e-12);
        expect(s).toBeLessThan(need * 2 ** 0.25 + 1e-12);
      }),
      { numRuns: 400 },
    );
  });

  it('steps by quarter octaves, so a camera walking the wall keeps it', () => {
    const f = framing(COVER);
    const s = texelScale(f.camera, span);
    expect(Math.log2(s) * 4).toBeCloseTo(Math.round(Math.log2(s) * 4), 9);
    expect(texelScale({ ...f.camera, x: f.camera.x + 20_000 }, span)).toBe(s);
  });

  it('a camera nearer than 1 mm per px draws at 1 px per mm, and one far back at no less than 1/64', () => {
    const f = framing(COVER, 10, 'shelf');
    expect(texelScale({ ...f.camera, z: 100 }, span)).toBe(1);
    expect(texelScale({ ...f.camera, z: 1e7 }, span)).toBe(1 / 64);
  });

  it('the headroom over the cabinets counts: the nearest point a camera looking down sees is the top of the room', () => {
    // a camera 2.4 m up looking down 45 deg, 1.2 m out: the room's top (2,100 mm, its front 50 mm out) is the nearest
    const camera: Camera = { x: 0, y: 2400, z: 1200, pitch: Math.PI / 4, focalPx: 400, frame: COVER };
    const nearest = (2400 - 2100) * Math.SQRT1_2 + (1200 - 50) * Math.SQRT1_2;
    const room = texelScale(camera, span);
    expect(room).toBe(2 ** (Math.ceil(4 * Math.log2(400 / nearest)) / 4));
    expect(room).toBe(2 ** -1.25);
    // the cabinets' bodies alone (1,800 mm) stand farther: a quarter octave coarser
    expect(texelScale(camera, { ...span, y1: 1800 })).toBe(2 ** -1.5);
  });

  it('the camera focal length is the lens on the frame', () => {
    expect(framing(COVER).camera.focalPx).toBeCloseTo(lensFocalPx(COVER), 9);
  });
});

describe('hiddenUnder: a figure wholly behind an opaque board, from where the camera stands', () => {
  const board = { x0: 0, x1: 800, y0: 980, y1: 1000, z0: -400, z1: 0 };
  const figure = (x0: number, x1: number, y0: number, y1: number, z: number): Vec3[] => [
    [x0, y0, z],
    [x1, y0, z],
    [x0, y1, z],
    [x1, y1, z],
  ];
  const above: Camera = { x: 400, y: 1600, z: 300, pitch: 0.6, focalPx: 400, frame: COVER };

  it('a figure under the board, every ray to it through the board: hidden', () => {
    expect(hiddenUnder(above, figure(300, 500, 700, 900, -300), board)).toBe(true);
  });

  it('a figure under the board whose foot shows past its front edge: drawn', () => {
    expect(hiddenUnder(above, figure(300, 500, 300, 900, -100), board)).toBe(false);
  });

  it('a camera level with the shelf sees under the board: drawn', () => {
    expect(hiddenUnder({ ...above, y: 800, pitch: 0 }, figure(300, 500, 700, 900, -300), board)).toBe(false);
  });

  it('a figure standing on the board, above it: drawn', () => {
    expect(hiddenUnder(above, figure(300, 500, 1000, 1200, -300), board)).toBe(false);
  });

  it('a camera under the board looking up at a figure above it: hidden', () => {
    expect(hiddenUnder({ ...above, y: 400, pitch: -0.6 }, figure(300, 500, 1100, 1200, -300), board)).toBe(true);
  });

  it('a camera inside the board itself (level with its thickness) is hidden by neither face', () => {
    expect(hiddenUnder({ ...above, y: 990, pitch: 0 }, figure(300, 500, 700, 900, -300), board)).toBe(false);
  });

  it('a ray meeting the board exactly on its edge is through it: hidden (from straight over the edge)', () => {
    // the camera over the board's left edge: the rays to the figure's left side meet the board at x0 itself
    expect(hiddenUnder({ ...above, x: 0 }, figure(0, 200, 700, 900, -300), board)).toBe(true);
    expect(hiddenUnder({ ...above, x: 800 }, figure(600, 800, 700, 900, -300), board)).toBe(true);
  });

  it('a figure beside the board, its rays past the side: drawn', () => {
    expect(hiddenUnder(above, figure(900, 1100, 700, 900, -300), board)).toBe(false);
  });
});

describe('wallPages: a page holds at most the cabinets drawn at a time (CF1: the framing\'s cap)', () => {
  it('the open panel pages a long wall as many at a time as stand whole across its frame, never more than its cap', () => {
    const input: FramingInput = { frame: OPEN, wall: WALL, headroomMm: WALL.cabinets.map(() => 300), view: 'wall', focus: 0, shelf: 0 };
    const pages = wallPages(input);
    const cap = frameCase(input).drawCap;
    expect(cap).toBeGreaterThan(MAX_DRAWN_CABINETS);
    // more than the fallback five: the whole panel stands a dozen whole across
    expect(Math.max(...pages.map((p) => p.length))).toBeGreaterThan(MAX_DRAWN_CABINETS);
    expect(Math.max(...pages.map((p) => p.length))).toBeLessThanOrEqual(cap);
    expect(pages.flat()).toEqual(WALL.cabinets.map((_, i) => i));
  });
});

describe('opaqueBoards: what may hide a figure in a cabinet', () => {
  it('a KLINGSBO is glass and mesh: none; a Detolf its wood boards; a rack every board, inside its posts', () => {
    expect(opaqueBoards(wallLayout([IKEA_KLINGSBO]).cabinets[0])).toEqual([]);
    const detolf = wallLayout([IKEA_DETOLF]).cabinets[0];
    const wood = IKEA_DETOLF.surfaces.filter((x) => x.material === 'wood');
    expect(wood.length).toBeGreaterThan(0);
    expect(opaqueBoards(detolf)).toEqual(
      wood.map((x) => ({ x0: detolf.leftMm, x1: detolf.rightMm, y0: x.topMm - x.thicknessMm, y1: x.topMm, z0: -IKEA_DETOLF.outer.depthMm, z1: 0 })),
    );
    const rack = wallLayout([OPEN_STEEL_RACK]).cabinets[0];
    const post = OPEN_STEEL_RACK.rack!.postMm;
    const D = OPEN_STEEL_RACK.outer.depthMm;
    expect(opaqueBoards(rack)).toEqual(
      OPEN_STEEL_RACK.surfaces.map((x) => ({ x0: rack.leftMm + post / 2, x1: rack.rightMm - post / 2, y0: x.topMm - x.thicknessMm, y1: x.topMm, z0: -D + post / 2, z1: -post / 2 })),
    );
  });

  it('a rack without its post size given stands on 38 mm posts', () => {
    const bare = { ...OPEN_STEEL_RACK, rack: undefined };
    const slot = wallLayout([bare]).cabinets[0];
    expect(opaqueBoards(slot)[0].x0).toBe(slot.leftMm + 19);
  });
});

describe('figuresToDraw: in a drawn cabinet, in the frame and its margin, under no board', () => {
  const rack = wallLayout([OPEN_STEEL_RACK, OPEN_STEEL_RACK, OPEN_STEEL_RACK]);
  const slot = rack.cabinets[0];
  const [, b1, b2] = OPEN_STEEL_RACK.surfaces;
  // a camera close above the rack, looking steeply down into it
  const camera: Camera = { x: slot.centerMm, y: 2600, z: 500, pitch: 1.1, focalPx: 300, frame: COVER };
  const view = viewOf(camera);
  const rect = cullRect(COVER);
  const fig = (cab: number, y0: number, y1: number, z: number, x = rack.cabinets[cab].centerMm) => ({ cab, x0: x - 40, x1: x + 40, y0, y1, z });
  const boards = (cab: number) => opaqueBoards(rack.cabinets[cab]);

  it('draws one in view, skips one under a board, one past the margin and one in a cabinet not drawn', () => {
    const under = fig(0, b1.topMm, b2.topMm - b2.thicknessMm - 10, -300);
    const onTop = fig(0, b2.topMm, b2.topMm + 150, -200);
    const far = fig(0, b2.topMm, b2.topMm + 150, -200, slot.centerMm + 40_000);
    const elsewhere = fig(2, b2.topMm, b2.topMm + 150, -200);
    for (const board of boards(0)) expect(hiddenUnder(camera, [[onTop.x0, onTop.y0, onTop.z]], board)).toBe(false);
    const got = figuresToDraw(view, rect, [under, onTop, far, elsewhere], new Set([0, 1]), boards);
    expect(got).toEqual({ shown: [1], hidden: 1 });
  });

  it('a figure under a board but showing past its front edge is drawn', () => {
    const peeking = fig(0, b1.topMm, b2.topMm - b2.thicknessMm - 10, 200);
    expect(figuresToDraw(view, rect, [peeking], new Set([0]), boards)).toEqual({ shown: [0], hidden: 0 });
  });
});

describe(`figuresToDraw: at most ${MAX_DRAWN_FIGURES} figures, the nearest the frame centre (Ross 12:2xC)`, () => {
  // a dense front: a grid of small figures on the front plane of one cabinet, all inside the frame and its margin
  const camera: Camera = { x: 0, y: 900, z: 3000, pitch: 0, focalPx: 600, frame: COVER };
  const grid = (n: number, cols: number): FigureBox[] =>
    Array.from({ length: n }, (_, i) => {
      const x = ((i % cols) - cols / 2) * 40;
      const y = 400 + Math.floor(i / cols) * 60;
      return { cab: 0, x0: x, x1: x + 30, y0: y, y1: y + 50, z: 0 };
    });
  const dist = (view: CullView, f: FigureBox) => {
    const q = screen(view, [(f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2, f.z]);
    return Math.hypot(q.x - view.camera.frame.width / 2, q.y - view.camera.frame.height / 2);
  };

  it('is 250', () => {
    expect(MAX_DRAWN_FIGURES).toBe(250);
  });

  for (const panPx of [0, 150]) {
    it(`draws the ${MAX_DRAWN_FIGURES} nearest the frame centre of more, in wall order (pan ${panPx})`, () => {
      const view = viewOf(camera, panPx);
      const figs = grid(600, 30);
      const all = figuresToDraw(view, cullRect(COVER), figs, new Set([0]), () => [], Infinity);
      expect(all.shown).toHaveLength(600);
      const { shown, hidden } = figuresToDraw(view, cullRect(COVER), figs, new Set([0]), () => []);
      expect(hidden).toBe(0);
      expect(shown).toHaveLength(MAX_DRAWN_FIGURES);
      expect(shown).toEqual([...shown].sort((a, b) => a - b));
      const kept = new Set(shown);
      const farthestKept = Math.max(...shown.map((i) => dist(view, figs[i])));
      const nearestDropped = Math.min(...figs.flatMap((f, i) => (kept.has(i) ? [] : [dist(view, f)])));
      expect(farthestKept).toBeLessThanOrEqual(nearestDropped);
    });
  }

  it('draws all of no more than the cap', () => {
    const figs = grid(MAX_DRAWN_FIGURES, 25);
    expect(figuresToDraw(viewOf(camera), cullRect(COVER), figs, new Set([0]), () => []).shown).toHaveLength(MAX_DRAWN_FIGURES);
    expect(figuresToDraw(viewOf(camera), cullRect(COVER), figs, new Set([0]), () => [], 10).shown).toHaveLength(10);
  });

  it('byFrameCentre: nearest the frame centre on screen first, one behind the camera last', () => {
    const view = viewOf(camera, 40);
    const figs = [...grid(40, 8), { cab: 0, x0: -20, x1: 20, y0: 800, y1: 900, z: 5000 }];
    const order = byFrameCentre(view, figs);
    expect([...order].sort((a, b) => a - b)).toEqual(figs.map((_, i) => i));
    expect(order[order.length - 1]).toBe(40);
    for (let k = 1; k < order.length - 1; k++) expect(dist(view, figs[order[k]])).toBeGreaterThanOrEqual(dist(view, figs[order[k - 1]]));
  });
});

describe('G1: the figure cap scales with the drawn cabinets; past a cap, no cabinet with a figure in view is left empty', () => {
  it('figureCap: each drawn cabinet\'s kind\'s capacity (the most one of that kind holds on the wall), summed', () => {
    const kinds = ['k', 'd', 'r', 'k', 'd', 'r', 'k'];
    const counts = [58, 40, 12, 57, 41, 0, 10];
    expect(figureCap(counts, kinds, [0, 1, 2])).toBe(58 + 41 + 12);
    // an emptier cabinet of a kind is given its kind's capacity: the cap never leaves it short
    expect(figureCap(counts, kinds, [3, 6])).toBe(2 * 58);
    expect(figureCap(counts, kinds, [5])).toBe(12);
    expect(figureCap(counts, kinds, [])).toBe(0);
    // a kind no cabinet holds anything of
    expect(figureCap([0, 0], ['a', 'b'], [0, 1])).toBe(0);
  });

  it('figureCap: at most the limit (DRAWN_FIGURES_LIMIT when not given)', () => {
    const kinds = ['k', 'k', 'k'];
    expect(figureCap([5000, 1, 1], kinds, [0, 1, 2])).toBe(DRAWN_FIGURES_LIMIT);
    expect(figureCap([60, 1, 1], kinds, [0, 1, 2], 100)).toBe(100);
    expect(figureCap([60, 1, 1], kinds, [0, 1, 2], 180)).toBe(180);
    expect(figureCap([60, 1, 1], kinds, [0, 1, 2], 181)).toBe(180);
  });

  it('the limit: the most the scene was measured drawing under the layer ceiling (e2e/case-budget), a figure or more for every cabinet the case may draw', () => {
    expect(DRAWN_FIGURES_LIMIT).toBe(1440);
    expect(DRAWN_FIGURES_LIMIT).toBeGreaterThanOrEqual(DRAWN_CABINETS_LIMIT);
  });

  // a full cabinet at the frame centre and a few figures of another at its edge, all inside the frame and its margin
  const camera: Camera = { x: 0, y: 900, z: 3000, pitch: 0, focalPx: 600, frame: COVER };
  const centre: FigureBox[] = Array.from({ length: 600 }, (_, i) => {
    const x = ((i % 30) - 15) * 40;
    const y = 400 + Math.floor(i / 30) * 60;
    return { cab: 0, x0: x, x1: x + 30, y0: y, y1: y + 50, z: 0 };
  });
  const edge: FigureBox[] = Array.from({ length: 30 }, (_, i) => ({ cab: 1, x0: 1000 + (i % 6) * 40, x1: 1030 + (i % 6) * 40, y0: 400 + Math.floor(i / 6) * 60, y1: 450 + Math.floor(i / 6) * 60, z: 0 }));
  const figs = [...centre, ...edge];
  const dist = (f: FigureBox) => {
    const q = project(camera, [(f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2, f.z]);
    return Math.hypot(q.x - COVER.width / 2, q.y - COVER.height / 2);
  };
  const byCab = (shown: number[]) => [shown.filter((i) => figs[i].cab === 0), shown.filter((i) => figs[i].cab === 1)];
  /** Each cabinet's kept figures are its own nearest the frame centre. */
  const nearestOwn = (kept: number[], cab: number) => {
    const own = figs.flatMap((f, i) => (f.cab === cab ? [i] : []));
    const out = own.filter((i) => !kept.includes(i));
    if (kept.length === 0 || out.length === 0) return true;
    return Math.max(...kept.map((i) => dist(figs[i]))) <= Math.min(...out.map((i) => dist(figs[i])));
  };

  it('every figure in view when the cap holds them all', () => {
    const all = figuresToDraw(viewOf(camera), cullRect(COVER), figs, new Set([0, 1]), () => [], figs.length);
    expect(all.shown).toHaveLength(630);
    // the edge cabinet's lie in the frame's margin: farther than any 250 of the centre cabinet's
    expect(Math.min(...edge.map(dist))).toBeGreaterThan(Math.max(...[...centre].map(dist).sort((a, b) => a - b).slice(0, 250)));
  });

  for (const [cap, centreKept, edgeKept] of [
    [250, 220, 30],
    [40, 20, 20],
    [61, 31, 30],
    [3, 2, 1],
    [2, 1, 1],
  ] as const) {
    it(`past a cap of ${cap}: one each in turn, each cabinet its own nearest the frame centre: ${centreKept} and ${edgeKept}`, () => {
      const { shown, hidden } = figuresToDraw(viewOf(camera), cullRect(COVER), figs, new Set([0, 1]), () => [], cap);
      expect(hidden).toBe(0);
      expect(shown).toHaveLength(cap);
      expect(shown).toEqual([...shown].sort((a, b) => a - b));
      const [c, e] = byCab(shown);
      expect([c.length, e.length]).toEqual([centreKept, edgeKept]);
      expect(nearestOwn(c, 0)).toBe(true);
      expect(nearestOwn(e, 1)).toBe(true);
    });
  }

  it('past a cap of one: the nearest the frame centre of all', () => {
    const { shown } = figuresToDraw(viewOf(camera), cullRect(COVER), figs, new Set([0, 1]), () => [], 1);
    expect(shown).toHaveLength(1);
    expect(dist(figs[shown[0]])).toBe(Math.min(...figs.map(dist)));
  });

  it('a cap ending a round partway: the turn goes to the cabinet nearer the frame centre, not the lower index', () => {
    // cabinet 0 (the lower indices) stands off to the left, cabinet 1 (the higher) at the frame centre
    const left: FigureBox[] = Array.from({ length: 10 }, (_, i) => ({ cab: 0, x0: -900 + i * 40, x1: -870 + i * 40, y0: 900, y1: 950, z: 0 }));
    const mid: FigureBox[] = Array.from({ length: 10 }, (_, i) => ({ cab: 1, x0: -200 + i * 40, x1: -170 + i * 40, y0: 900, y1: 950, z: 0 }));
    const both = [...left, ...mid];
    expect(Math.min(...mid.map(dist))).toBeLessThan(Math.min(...left.map(dist)));
    const { shown } = figuresToDraw(viewOf(camera), cullRect(COVER), both, new Set([0, 1]), () => [], 3);
    expect(shown).toHaveLength(3);
    expect([shown.filter((i) => both[i].cab === 0).length, shown.filter((i) => both[i].cab === 1).length]).toEqual([1, 2]);
  });
});

describe('figureScales: the figures cost at most a budget of px wherever the camera stands, the farthest from the frame centre drawn coarser first', () => {
  const box = (x: number, w = 150, h = 220): FigureBox => ({ cab: 0, x0: x - w / 2, x1: x + w / 2, y0: 400, y1: 400 + h, z: 0 });
  const cost = (figs: readonly FigureBox[], scales: readonly number[]) => figs.reduce((a, f, i) => a + (f.x1 - f.x0) * (f.y1 - f.y0) * scales[i] ** 2, 0);
  const budget = FIGURE_BUDGET_VIEWPORTS * COVER.width * COVER.height;

  it('is a share of the frame the faces leave under the 3-viewport ceiling', () => {
    expect(FIGURE_BUDGET_VIEWPORTS).toBeGreaterThan(0.5);
    expect(FIGURE_BUDGET_VIEWPORTS).toBeLessThanOrEqual(1.5);
  });

  it('every figure at the scene\'s px per mm while they fit the budget', () => {
    const figs = [box(0), box(200), box(-200)];
    const camera: Camera = { x: 0, y: 500, z: 3000, pitch: 0, focalPx: 600, frame: COVER };
    expect(figureScales(viewOf(camera), figs, 0.25, budget)).toEqual([0.25, 0.25, 0.25]);
  });

  it('past it, the farthest from the frame centre first: whole octaves down, never finer than a nearer one, the nearest at the scene\'s', () => {
    // a camera stepping in: the scene's px per mm rises, the figures' cost does not
    for (const [z, s] of [
      [3000, 0.25],
      [1500, 0.5],
      [600, 1],
    ] as const) {
      const camera: Camera = { x: 0, y: 500, z, pitch: 0, focalPx: 600, frame: COVER };
      const view = viewOf(camera, 30);
      const figs = Array.from({ length: 250 }, (_, i) => box((i - 125) * 37));
      const scales = figureScales(view, figs, s, budget);
      const order = byFrameCentre(view, figs);
      expect(scales[order[0]], `${z}`).toBe(s);
      for (let k = 1; k < order.length; k++) expect(scales[order[k]], `${z} ${k}`).toBeLessThanOrEqual(scales[order[k - 1]]);
      for (const x of scales) expect(Number.isInteger(Math.log2(s / x)), `${x}`).toBe(true);
      const floor = figs.reduce((a, f) => a + (f.x1 - f.x0) * (f.y1 - f.y0) * (1 / 64) ** 2, 0);
      expect(cost(figs, scales), `${z}`).toBeLessThanOrEqual(budget + floor);
      expect(Math.min(...scales)).toBeGreaterThanOrEqual(1 / 64);
      // and the budget is spent: one octave finer for the first figure drawn coarser would not fit
      const first = order.findIndex((i) => scales[i] < s);
      expect(first, `${z}`).toBeGreaterThan(0);
      const before = order.slice(0, first).map((i) => figs[i]);
      const f = figs[order[first]];
      expect(cost(before, before.map(() => s)) + (f.x1 - f.x0) * (f.y1 - f.y0) * (2 * scales[order[first]]) ** 2, `${z}`).toBeGreaterThan(budget);
    }
  });

  it('a small figure past a big one is never drawn finer than it: the octave only coarsens outward', () => {
    const camera: Camera = { x: 0, y: 500, z: 3000, pitch: 0, focalPx: 600, frame: COVER };
    const view = viewOf(camera);
    // big and small in turn, outward from the centre: the budget runs out on a big one, which a small one would still fit
    const figs = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? box((i - 30) * 160, 400, 600) : box((i - 30) * 160, 20, 40)));
    const scales = figureScales(view, figs, 0.5, budget);
    const order = byFrameCentre(view, figs);
    expect(new Set(scales).size).toBeGreaterThan(2);
    for (let k = 1; k < order.length; k++) expect(scales[order[k]], `${k}`).toBeLessThanOrEqual(scales[order[k - 1]]);
  });

  it('SHOULD 29: a figure\'s name plate, drawn at its px per mm, spends the same budget: with plates the octave coarsens sooner and all of it stays within', () => {
    const camera: Camera = { x: 0, y: 500, z: 1500, pitch: 0, focalPx: 600, frame: COVER };
    const view = viewOf(camera, 30);
    const bare = Array.from({ length: 250 }, (_, i) => box((i - 125) * 37));
    const plated = bare.map((f) => ({ ...f, plateMm2: 110 * 30 }));
    const without = figureScales(view, bare, 0.5, budget);
    const withPlates = figureScales(view, plated, 0.5, budget);
    const order = byFrameCentre(view, bare);
    const firstCoarse = (scales: readonly number[]) => order.findIndex((i) => scales[i] < 0.5);
    expect(firstCoarse(withPlates)).toBeGreaterThan(0);
    expect(firstCoarse(withPlates)).toBeLessThan(firstCoarse(without));
    const spent = plated.reduce((a, f, i) => a + ((f.x1 - f.x0) * (f.y1 - f.y0) + f.plateMm2) * withPlates[i] ** 2, 0);
    const floor = plated.reduce((a, f) => a + ((f.x1 - f.x0) * (f.y1 - f.y0) + f.plateMm2) * (1 / 64) ** 2, 0);
    expect(spent).toBeLessThanOrEqual(budget + floor);
    expect(cost(bare, without)).toBeLessThanOrEqual(budget + floor);
  });

  it('a figure too big for the budget alone is drawn at the coarsest, never skipped', () => {
    const camera: Camera = { x: 0, y: 500, z: 3000, pitch: 0, focalPx: 600, frame: COVER };
    const huge = box(0, 40_000, 40_000);
    expect(figureScales(viewOf(camera), [huge], 1, budget)).toEqual([1 / 64]);
    expect(figureScales(viewOf(camera), [], 1, budget)).toEqual([]);
  });
});

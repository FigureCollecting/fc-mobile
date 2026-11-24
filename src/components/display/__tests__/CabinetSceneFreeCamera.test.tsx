import { describe, it, expect, vi, afterEach, beforeEach, onTestFinished } from 'vitest';
import { render, fireEvent, screen, cleanup, act } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene } from '../CabinetScene';
import { DEFAULT_CASE_PREFS, WALL_PATTERNS, type CasePrefs } from '../casePrefs';
import { __clearAlphaMarginCache } from '../alphaMargin';
import { AXIS_UNLOCK_PX, DRAG_WALK_GAIN_X, DRAG_WALK_GAIN_Y, EYE_MARGIN_MM, JOG_FRAMES_PER_S, JOG_FULL_PX, JOG_MAX_STEP_MS, JOG_MAX_X, LOOK_HOLD_MS, PITCH, jogSpeed, jogStep, move as movePose, yawLimits } from '../casePose';
import { coneOf } from '../useFreeCamera';
import { useJogStore } from '../../../stores/jog';
import { CABINET_FACES_PX, CONTROLS_VIEWPORTS, MESH_BUDGET_VIEWPORTS, SCENE_CEILING_VIEWPORTS, SHADOW_PX } from '../caseBudget';
import { wallLayout } from '../packCabinets';
import { IKEA_KLINGSBO } from '../cabinetPresets';
import { project } from '../caseCamera';
import { DRAWN_CABINETS_LIMIT, texelScale } from '../caseCull';
import { DEPTH_DEAD } from '../caseDepth';

// NAV-1A, the Free camera, in the scene: MOVE and LOOK from one finger, the hold that arms Look without swallowing
// a tap, the realism cone and its ease back, the pose held across a fold, the arrows and Reset from the frame-centre
// cabinet, the side walls, and PINCH-1 as it was. jsdom lays nothing out: a client point is a frame point.

const COVER = { width: 443, height: 418 };
const DEG = Math.PI / 180;
const sized = (i: number): Figure => ({ _id: `s${i}`, name: `Figure ${i}`, dimensions: { heightMm: 200, widthMm: 100 } }) as Figure;
const FIGURES = Array.from({ length: 120 }, (_, i) => sized(i));
const prefs = (patch: Partial<CasePrefs> = {}): CasePrefs => ({ ...DEFAULT_CASE_PREFS, clearanceMm: 0, ...patch });

type P = { x: number; y: number };
type Opts = { button?: number; shiftKey?: boolean; pointerType?: string };
const host = () => document.querySelector('.cabinet-scene') as HTMLElement;
const down = (id: number, p: P, o: Opts = {}) =>
  fireEvent.pointerDown(host(), { pointerId: id, clientX: p.x, clientY: p.y, button: o.button ?? 0, shiftKey: o.shiftKey ?? false, pointerType: o.pointerType ?? 'mouse' });
const move = (id: number, p: P) => fireEvent.pointerMove(host(), { pointerId: id, clientX: p.x, clientY: p.y });
const up = (id: number, p: P) => fireEvent.pointerUp(host(), { pointerId: id, clientX: p.x, clientY: p.y });
const cancel = (id: number, p: P) => fireEvent.pointerCancel(host(), { pointerId: id, clientX: p.x, clientY: p.y });
const tick = (ms = 20) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const cam = () => JSON.parse(host().dataset.camera!) as { x: number; y: number; z: number; yaw: number; pitch: number; focalPx: number; width: number; height: number };
const pose = () => {
  const c = cam();
  return { x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch };
};

/** One finger from `from` through `steps` moves to `to`, a frame after each; lifted unless `lift` is false. */
function drag(from: P, to: P, { steps = 6, lift = true, id = 1, ...o }: { steps?: number; lift?: boolean; id?: number } & Opts = {}) {
  down(id, from, o);
  for (let i = 1; i <= steps; i++) {
    move(id, { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
    tick(16);
  }
  if (lift) up(id, to);
}

let onSelect = vi.fn();
function scene(patch: Partial<CasePrefs> = {}, extra: Record<string, unknown> = {}) {
  onSelect = vi.fn();
  const props = { figures: FIGURES, onSelect, prefs: prefs(patch), frameFallback: COVER, ...extra };
  const utils = render(<CabinetScene {...props} />);
  const again = (next: Partial<CasePrefs> = {}, more: Record<string, unknown> = {}) => utils.rerender(<CabinetScene {...props} prefs={prefs({ ...patch, ...next })} {...more} />);
  return { ...utils, again };
}

beforeEach(() => {
  __clearAlphaMarginCache();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Free camera (the only camera, NAV-GRAD): what the scene publishes and draws', () => {
  it('a level opening (rulings R0.3); data-camera with its yaw; no pan; the cone; the two side walls', () => {
    scene();
    expect(host().dataset.freeCamera).toBe('1');
    const c = cam();
    expect(c.yaw).toBe(0);
    expect(c.pitch).toBe(0);
    expect(host().hasAttribute('data-pan')).toBe(false);
    expect(host().hasAttribute('data-pan-y')).toBe(false);
    const cone = JSON.parse(host().dataset.cone!) as { soft: number; hard: number };
    expect(cone.soft).toBeGreaterThan(20);
    expect(cone.hard).toBeGreaterThanOrEqual(cone.soft);
    // the side walls stand 6 m past the wall's ends: out of the opening's view, drawn once a walk past an end shows one
    expect(host().querySelectorAll('.room-side')).toHaveLength(0);
    for (let i = 0; i < 8; i++) drag({ x: 60, y: 200 }, { x: 420, y: 200 });
    drag({ x: 200, y: 200 }, { x: 400, y: 200 }, { button: 2 });
    tick(500);
    expect(host().querySelectorAll('.room-side').length).toBeGreaterThanOrEqual(1);
    // the viewport never slides
    expect((host().querySelector('.cabinet-scene__viewport') as HTMLElement).style.transform).toBe('');
  });
});

describe('MOVE: one finger, at once', () => {
  it('a sideways drag trucks the eye opposite the finger; up and down stay locked; yaw and pitch kept', () => {
    scene();
    const before = pose();
    drag({ x: 300, y: 200 }, { x: 150, y: 210 }, { lift: false });
    const live = pose();
    expect(live.x).toBeGreaterThan(before.x + 100);
    expect(live.y).toBe(before.y);
    expect(live.z).toBe(before.z);
    expect([live.yaw, live.pitch]).toEqual([0, 0]);
    expect(host().dataset.gesture).toBe('move');
    // NAV-1A acceptance 5: let go, the pose is the last live one: no settle
    up(1, { x: 150, y: 210 });
    tick(500);
    expect(pose()).toEqual(live);
    expect(host().dataset.gesture).toBeUndefined();
  });

  it('the minor axis unlocks past 24 px and moves from there on, with no jump', () => {
    scene();
    const before = pose();
    drag({ x: 300, y: 200 }, { x: 200, y: 240 });
    const after = pose();
    expect(after.x).toBeGreaterThan(before.x);
    // a finger moving down raises the eye; only the part past the unlock counts
    expect(after.y).toBeGreaterThan(before.y);
  });

  it('pointercancel ends the gesture and commits nothing', () => {
    scene();
    const before = pose();
    drag({ x: 300, y: 200 }, { x: 100, y: 200 }, { lift: false });
    expect(pose().x).not.toBe(before.x);
    cancel(1, { x: 100, y: 200 });
    tick();
    expect(pose()).toEqual(before);
  });

  it('a second finger makes it a pinch: the walk goes back where it began, and the zoom is PINCH-1\'s', () => {
    scene();
    const before = pose();
    drag({ x: 300, y: 200 }, { x: 200, y: 200 }, { lift: false });
    down(2, { x: 260, y: 260 });
    move(1, { x: 180, y: 200 });
    move(2, { x: 300, y: 260 });
    up(1, { x: 180, y: 200 });
    up(2, { x: 300, y: 260 });
    tick(500);
    expect(pose()).toEqual(before);
    expect(JSON.parse(host().dataset.zoom!).k).toBeGreaterThan(1);
  });

  it('zoomed, one finger pans the magnified picture and never moves the camera (PINCH-1)', () => {
    scene();
    down(11, { x: 180, y: 260 });
    down(12, { x: 260, y: 260 });
    move(11, { x: 140, y: 260 });
    move(12, { x: 300, y: 260 });
    up(11, { x: 140, y: 260 });
    up(12, { x: 300, y: 260 });
    tick(500);
    const before = pose();
    const zoom = host().dataset.zoom;
    drag({ x: 200, y: 200 }, { x: 150, y: 200 });
    tick(500);
    expect(pose()).toEqual(before);
    expect(host().dataset.zoom).not.toBe(zoom);
  });

  it('the eye never rises past the ceiling less its clearance', () => {
    scene();
    for (let i = 0; i < 6; i++) drag({ x: 200, y: 20 }, { x: 200, y: 400 });
    expect(cam().y).toBeLessThanOrEqual(DEFAULT_CASE_PREFS.ceilingMm - 50 + 1e-6);
  });
});

describe('NAV-SWIPE-2X (Ross 11-04): a one-finger MOVE walks twice as far sideways as the finger; height stays 1:1', () => {
  // pressed at the frame centre of a level opening, the anchor is the fronts' plane (z = 0) at the eye's distance, z
  const centre = () => ({ x: cam().width / 2, y: cam().height / 2 });

  it('a 100 px sideways drag moves the eye exactly 2x what move() gives for 100 px at the same anchor (the point under the finger no longer stays under it)', () => {
    scene();
    const c0 = cam();
    const p0 = pose();
    const at = centre();
    drag(at, { x: at.x - 100, y: at.y }, { lift: false });
    // move() is still 1:1 (the jog's speed rides on it): 100 px at the anchor depth z
    const oneToOne = movePose(p0, -100, 0, c0.z, c0.focalPx).x - p0.x;
    expect(oneToOne).toBeCloseTo((100 * c0.z) / c0.focalPx, 9);
    expect(pose().x - p0.x).toBeCloseTo(2 * oneToOne, 3);
    expect(DRAG_WALK_GAIN_X).toBe(2);
    expect([pose().y, pose().z, pose().yaw, pose().pitch]).toEqual([p0.y, p0.z, p0.yaw, p0.pitch]);
    up(1, { x: at.x - 100, y: at.y });
  });

  it('a 100 px vertical drag moves the eye\'s height exactly 1x what move() gives (DRAG_WALK_GAIN_Y)', () => {
    scene();
    const c0 = cam();
    const p0 = pose();
    const at = centre();
    // finger up lowers the eye: away from the ceiling's bound
    drag(at, { x: at.x, y: at.y - 100 }, { lift: false });
    const oneToOne = movePose(p0, 0, -100, c0.z, c0.focalPx).y - p0.y;
    expect(oneToOne).toBeCloseTo((-100 * c0.z) / c0.focalPx, 9);
    expect(pose().y - p0.y).toBeCloseTo(oneToOne, 3);
    expect(DRAG_WALK_GAIN_Y).toBe(1);
    expect([pose().x, pose().z]).toEqual([p0.x, p0.z]);
    up(1, { x: at.x, y: at.y - 100 });
  });

  it(`the axis lock opens at AXIS_UNLOCK_PX (${AXIS_UNLOCK_PX}) of finger travel, not of the doubled walk`, () => {
    scene();
    const c0 = cam();
    const p0 = pose();
    const at = centre();
    down(1, at);
    // locked up and down by its first move
    move(1, { x: at.x, y: at.y - 60 });
    tick(16);
    // AXIS_UNLOCK_PX sideways (doubled, 48 would be past it): still locked, the eye keeps its x
    move(1, { x: at.x + AXIS_UNLOCK_PX, y: at.y - 80 });
    tick(16);
    expect(pose().x).toBe(p0.x);
    // 6 px more: open; the step since the last move walks, doubled, opposite the finger
    move(1, { x: at.x + AXIS_UNLOCK_PX + 6, y: at.y - 90 });
    tick(16);
    expect(pose().x - p0.x).toBeCloseTo((-2 * 6 * c0.z) / c0.focalPx, 3);
    up(1, { x: at.x + AXIS_UNLOCK_PX + 6, y: at.y - 90 });
  });

  it('a doubled drag into the room\'s side wall stops at the wall (less EYE_MARGIN_MM), never past it', () => {
    // one cabinet: the side walls stand ROOM_SIDE_MM (6 m) past the wall's ends
    scene({}, { figures: FIGURES.slice(0, 2) });
    const boxes = JSON.parse(host().dataset.wall!) as number[][];
    const bound = Math.min(...boxes.map((b) => b[0])) - 6000 + EYE_MARGIN_MM;
    let swipes = 0;
    for (let last = NaN; pose().x !== last && swipes < 40; swipes++) {
      last = pose().x;
      // finger right: the eye walks left
      drag({ x: 40, y: 200 }, { x: 400, y: 200 });
      expect(pose().x).toBeGreaterThanOrEqual(bound);
    }
    expect(swipes).toBeLessThan(40);
    expect(pose().x).toBe(bound);
  });
});

describe('LOOK (rulings S6): a still hold arms it; the hold never swallows a tap', () => {
  it(`still ${LOOK_HOLD_MS} ms: the ring and data-gesture=look; a drag then turns the eye from where it stands`, () => {
    scene();
    const before = pose();
    down(1, { x: 220, y: 200 });
    tick(LOOK_HOLD_MS - 10);
    expect(host().dataset.gesture).toBeUndefined();
    tick(20);
    expect(host().dataset.gesture).toBe('look');
    const ring = host().querySelector('.cabinet-scene__look-ring') as HTMLElement;
    expect(ring.hasAttribute('data-on')).toBe(true);
    expect([ring.style.left, ring.style.top]).toEqual(['220px', '200px']);
    for (const x of [230, 240, 250]) {
      move(1, { x, y: 200 });
      tick(16);
    }
    const looked = pose();
    // finger right: the eye turns left
    expect(looked.yaw).toBeLessThan(0);
    expect([looked.x, looked.y, looked.z]).toEqual([before.x, before.y, before.z]);
    up(1, { x: 250, y: 200 });
    tick();
    expect(ring.hasAttribute('data-on')).toBe(false);
    expect(host().dataset.gesture).toBeUndefined();
  });

  it('a hold then release with no move opens the figure under it (the click is not swallowed)', () => {
    scene();
    const fig = screen.getAllByRole('button', { name: /^Figure / })[0];
    down(1, { x: 220, y: 200 });
    tick(300);
    up(1, { x: 220, y: 200 });
    fireEvent.click(fig);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('a hold then a drag opens nothing (the drag swallows its click)', () => {
    scene();
    const fig = screen.getAllByRole('button', { name: /^Figure / })[0];
    down(1, { x: 220, y: 200 });
    tick(300);
    move(1, { x: 250, y: 200 });
    up(1, { x: 250, y: 200 });
    fireEvent.click(fig);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('a drag that starts before the hold is a MOVE', () => {
    scene();
    down(1, { x: 220, y: 200 });
    tick(100);
    move(1, { x: 260, y: 200 });
    tick(300);
    move(1, { x: 280, y: 200 });
    up(1, { x: 280, y: 200 });
    expect(pose().yaw).toBe(0);
    expect(host().querySelector('.cabinet-scene__look-ring')!.hasAttribute('data-on')).toBe(false);
  });

  it('NAVLOOK 1a: a finger held still on the scene arms nothing; its drag then MOVEs (the hat\'s eye is touch\'s Look)', () => {
    scene();
    const before = pose();
    down(1, { x: 220, y: 200 }, { pointerType: 'touch' });
    tick(LOOK_HOLD_MS * 3);
    expect(host().dataset.gesture).toBeUndefined();
    expect(host().querySelector('.cabinet-scene__look-ring')!.hasAttribute('data-on')).toBe(false);
    for (const x of [200, 180, 160]) {
      move(1, { x, y: 200 });
      tick(16);
    }
    expect(host().dataset.gesture).toBe('move');
    up(1, { x: 160, y: 200 });
    tick();
    const after = pose();
    expect(after.x, 'walked').toBeGreaterThan(before.x);
    expect([after.yaw, after.pitch], 'never turned').toEqual([0, 0]);
  });

  it('NAVLOOK 1a: a finger\'s hold still opens the figure under it on release (the tap is kept)', () => {
    scene();
    const fig = screen.getAllByRole('button', { name: /^Figure / })[0];
    down(1, { x: 220, y: 200 }, { pointerType: 'touch' });
    tick(LOOK_HOLD_MS + 100);
    up(1, { x: 220, y: 200 });
    fireEvent.click(fig);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('a right drag and a Shift+left drag turn at once', () => {
    for (const o of [{ button: 2 }, { shiftKey: true }] as const) {
      const { unmount } = scene();
      const before = pose();
      drag({ x: 220, y: 200 }, { x: 160, y: 200 }, o);
      expect(pose().yaw).toBeGreaterThan(0);
      expect(pose().x).toBe(before.x);
      unmount();
    }
  });

  it('NAV-2A: a stored swipe mode changes nothing: with Pan the wall stored, a quick one-finger drag MOVEs, and a hold still LOOKs', () => {
    // NAV-2A2: no prefs carry a swipe mode any more; a stale one handed in is still nothing
    scene({ swipe: 'pan' } as Partial<CasePrefs>);
    const before = pose();
    drag({ x: 220, y: 200 }, { x: 160, y: 200 });
    tick(500);
    const moved = pose();
    expect(moved.x).toBeGreaterThan(before.x);
    expect([moved.yaw, moved.pitch]).toEqual([0, 0]);
    down(1, { x: 220, y: 200 });
    tick(LOOK_HOLD_MS + 20);
    for (let i = 1; i <= 6; i++) {
      move(1, { x: 220 - i * 10, y: 200 });
      tick(16);
    }
    up(1, { x: 160, y: 200 });
    expect(pose().yaw).toBeGreaterThan(0);
    expect(pose().x).toBe(moved.x);
  });

  it('a finger down looks up; the pitch keeps to its cone', () => {
    scene();
    drag({ x: 220, y: 100 }, { x: 220, y: 400 }, { button: 2 });
    tick(500);
    expect(pose().pitch).toBeLessThan(0);
    expect(pose().pitch).toBeGreaterThanOrEqual(-PITCH.upSoft - 1e-6);
  });

  it('a long hold\'s context menu is prevented on the scene', () => {
    scene();
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    host().dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe('the realism cone (rulings S8)', () => {
  it('held past the limit: committed never past soft, shown short of hard on every frame; 200 ms after release they meet', () => {
    scene();
    const cone = JSON.parse(host().dataset.cone!) as { soft: number; hard: number };
    down(1, { x: 440, y: 200 }, { button: 2 });
    let maxShown = 0;
    for (let x = 430; x >= 0; x -= 10) {
      move(1, { x, y: 200 });
      tick(16);
      maxShown = Math.max(maxShown, pose().yaw);
    }
    expect(maxShown / DEG).toBeGreaterThan(cone.soft);
    expect(maxShown / DEG).toBeLessThan(cone.hard);
    up(1, { x: 0, y: 200 });
    tick(16);
    // easing back: still past the soft limit a frame in
    expect(pose().yaw / DEG).toBeGreaterThan(cone.soft);
    tick(250);
    expect(pose().yaw / DEG).toBeCloseTo(cone.soft, 1);
  });

  it('the ease back runs on the clock from the lift: a first frame 220 ms late lands on the soft limit', () => {
    scene();
    const cone = JSON.parse(host().dataset.cone!) as { soft: number; hard: number };
    drag({ x: 440, y: 200 }, { x: 0, y: 200 }, { button: 2, steps: 20, lift: false });
    const queued: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => queued.push(cb));
    up(1, { x: 0, y: 200 });
    // a busy phone: no frame for 220 ms after the finger lifts
    vi.advanceTimersByTime(220);
    raf.mockRestore();
    act(() => {
      for (const cb of queued.splice(0)) cb(performance.now());
    });
    expect(pose().yaw / DEG).toBeCloseTo(cone.soft, 3);
  });

  it('under reduced motion the shown pose is the committed one at once', () => {
    const real = window.matchMedia;
    window.matchMedia = ((q: string) => ({ ...real(q), matches: q.includes('prefers-reduced-motion: reduce') })) as typeof window.matchMedia;
    try {
      scene();
      const cone = JSON.parse(host().dataset.cone!) as { soft: number; hard: number };
      drag({ x: 440, y: 200 }, { x: 0, y: 200 }, { button: 2, steps: 20, lift: false });
      up(1, { x: 0, y: 200 });
      expect(pose().yaw / DEG).toBeCloseTo(cone.soft, 3);
    } finally {
      window.matchMedia = real;
    }
  });

  it('the cone the scene publishes is the one its frame and lens give (the Classic cap included)', () => {
    scene();
    const wall = wallLayout(Array(1).fill(IKEA_KLINGSBO));
    const limits = yawLimits(2 * Math.atan(COVER.width / 2 / cam().focalPx));
    const cone = JSON.parse(host().dataset.cone!) as { soft: number; hard: number };
    expect(cone.soft).toBeLessThanOrEqual(limits.soft / DEG + 1e-6);
    expect(coneOf({ ...cam(), frame: COVER }, wall, { y0: 0, y1: 2000, z0: 0, z1: 0 }).soft).toBeCloseTo(limits.soft, 9);
  });
});

describe('the pose across new prefs (NAV-SCOPE: one view; the Reset chip is the zoom\'s alone, navScope.test.tsx)', () => {
  it('a new wall pattern starts from its framing; new prefs that are not a new wall keep the pose, a stale view among them', () => {
    const { again } = scene();
    drag({ x: 300, y: 200 }, { x: 100, y: 200 });
    const walked = pose();
    again({ showEstimated: true });
    expect(pose()).toEqual(walked);
    again({ showEstimated: true, view: 'cabinet' } as Partial<CasePrefs>);
    expect(pose()).toEqual(walked);
    again({ showEstimated: true, pattern: 'ikea-detolf' });
    expect(pose().x).not.toBe(walked.x);
  });
});

describe('a fold or an unfold keeps the pose (spec 6.6)', () => {
  it('only the frame and the lens\'s px change', () => {
    let size = { width: 443, height: 418 };
    const proto = Element.prototype;
    const w = Object.getOwnPropertyDescriptor(proto, 'clientWidth');
    const h = Object.getOwnPropertyDescriptor(proto, 'clientHeight');
    Object.defineProperty(proto, 'clientWidth', { configurable: true, get(this: HTMLElement) { return this.classList.contains('cabinet-scene') ? size.width : 0; } });
    Object.defineProperty(proto, 'clientHeight', { configurable: true, get(this: HTMLElement) { return this.classList.contains('cabinet-scene') ? size.height : 0; } });
    try {
      scene();
      const opened = cam();
      size = { width: 870, height: 335 };
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });
      const unfolded = cam();
      expect(unfolded.width).toBe(870);
      expect([unfolded.x, unfolded.y, unfolded.z, unfolded.yaw, unfolded.pitch]).toEqual([opened.x, opened.y, opened.z, opened.yaw, opened.pitch]);
    } finally {
      Object.defineProperty(proto, 'clientWidth', w!);
      Object.defineProperty(proto, 'clientHeight', h!);
    }
  });

  it('a wall laid out before the host is measured opens on the measured frame\'s framing, no pose held (no Reset)', () => {
    // the framed fixtures lay out at once, on the fallback frame; the host's first measured size is not a fold
    const measured = { width: 870, height: 475 };
    const { unmount } = scene({}, { frameFallback: measured });
    const framing = pose();
    unmount();
    const proto = Element.prototype;
    const w = Object.getOwnPropertyDescriptor(proto, 'clientWidth');
    const h = Object.getOwnPropertyDescriptor(proto, 'clientHeight');
    Object.defineProperty(proto, 'clientWidth', { configurable: true, get(this: HTMLElement) { return this.classList.contains('cabinet-scene') ? measured.width : 0; } });
    Object.defineProperty(proto, 'clientHeight', { configurable: true, get(this: HTMLElement) { return this.classList.contains('cabinet-scene') ? measured.height : 0; } });
    try {
      scene();
      tick();
      expect(cam().width).toBe(870);
      expect(pose()).toEqual(framing);
      expect(screen.queryByRole('button', { name: 'Reset view' })).toBeNull();
    } finally {
      Object.defineProperty(proto, 'clientWidth', w!);
      Object.defineProperty(proto, 'clientHeight', h!);
    }
  });
});

describe('Go to (CARD-VIEW-1) in Free camera', () => {
  it('stands the camera at the framing Go to gives', () => {
    const onWentTo = vi.fn();
    const { again } = scene({}, { onWentTo });
    drag({ x: 300, y: 200 }, { x: 100, y: 200 }, { button: 2 });
    again({}, { onWentTo, goTo: { figureId: 's60', seq: 1 } });
    tick();
    expect(onWentTo).toHaveBeenCalledWith('s60', true);
    expect(cam().yaw).toBe(0);
    expect(screen.getByRole('button', { name: 'Figure 60' })).toBeInTheDocument();
  });
});

// NAV-1A a+b, Ross 10-28: the GPU budget under a turn. (a) turned, the scene keeps the framing's px per mm; (b) a look
// whose projected scene would still pass the 3-viewport ceiling stops at the last yaw that fits, eased like the cone.
type Px = { figures: number; shadows: number; mesh: number; room: number; faces: number };
type Projected = { vp: number; drawn: number; figures: number; px: Px };
type Side = { hard: number; fit: number | null; atHard: Projected | null };
type Budget = {
  ceiling: number;
  /** The cost where the look starts (asked first each way it can turn). */
  start: (Projected & { yaw: number }) | null;
  /** Each way: its hard limit, the cost there where the search got that far, and the last yaw that fits where (b) engaged. */
  left: Side;
  right: Side;
  /** Every yaw asked (deg) with its cost (viewports), in the order asked. */
  asked: [number, number][];
  ms: number;
};
const total = (px: Px) => px.figures + px.shadows + px.mesh + px.room + px.faces;
const budget = () => JSON.parse(host().dataset.yawBudget!) as Budget;
/** A long wall of small figures: a turn along it brings more of them into view than the opening shows. */
const WIDE = Array.from({ length: 900 }, (_, i): Figure => ({ _id: `w${i}`, name: `Wide ${i}`, dimensions: { heightMm: 90, widthMm: 40 } }) as Figure);
/** Longer than the case draws at once (DRAWN_CABINETS_LIMIT cabinets): a move there keeps to the Classic cap. */
const LONG = Array.from({ length: 1300 }, (_, i): Figure => ({ _id: `l${i}`, name: `Long ${i}`, dimensions: { heightMm: 90, widthMm: 40 } }) as Figure);
/**
 * A timeout for the tests here that draw a scene at many poses, over and over (Vitest's default is 5 s): under coverage
 * on CI's runner they took 2.4-6.4 s (one timed out), two to three times as long as on a 2-core local run. 20 s is three
 * times the slowest.
 */
const HEAVY_MS = 20_000;
const pxPerMm = () => Number(host().dataset.pxPerMm);

/** The scene's element px by kind, as jsdom has them (each face's own width x height). */
function domPx() {
  const out = { figures: 0, shadows: 0, mesh: 0, room: 0, faces: 0, shadowCount: 0 };
  for (const el of Array.from(host().querySelectorAll<HTMLElement>('.cabinet-scene__root .q'))) {
    const px = parseFloat(el.style.width) * parseFloat(el.style.height);
    if (el.classList.contains('cab-figure') || el.classList.contains('cab-plate')) out.figures += px;
    else if (el.classList.contains('cab-shadow')) {
      out.shadows += px;
      out.shadowCount++;
    } else if (el.classList.contains('m-mesh')) out.mesh += px;
    else if (['room-wall', 'room-floor', 'room-ceiling'].some((c) => el.classList.contains(c))) out.room += px;
    else out.faces += px;
  }
  return out;
}

/** The screen jsdom reports (window.innerWidth x innerHeight), for one test. */
function screenOf(width: number, height: number) {
  const w = Object.getOwnPropertyDescriptor(window, 'innerWidth')!;
  const h = Object.getOwnPropertyDescriptor(window, 'innerHeight')!;
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
  return () => {
    Object.defineProperty(window, 'innerWidth', w);
    Object.defineProperty(window, 'innerHeight', h);
  };
}

/** A look held to the right as far as the finger goes (a right drag across the frame); returns the most yaw shown. */
function lookRight() {
  down(1, { x: 440, y: 200 }, { button: 2 });
  let most = 0;
  for (let x = 430; x >= 0; x -= 10) {
    move(1, { x, y: 200 });
    tick(16);
    most = Math.max(most, pose().yaw);
  }
  return most;
}

describe('the GPU budget under a turn (NAV-1A a+b, Ross 10-28)', () => {
  it('(a) turned, the scene is drawn at the framing\'s px per mm, below what the turned view asks; back at the framing, today\'s', () => {
    const { again } = scene();
    const framing = pxPerMm();
    expect(host().hasAttribute('data-turned-px-per-mm')).toBe(false);
    // walked in toward the fronts, the cabinet beside the eye near: a turn there asks a sharper scene
    lookRight();
    up(1, { x: 0, y: 200 });
    tick(500);
    for (let i = 0; i < 3; i++) drag({ x: 200, y: 300 }, { x: 200, y: 300 - 1 }, { steps: 1 });
    expect(cam().yaw).not.toBe(0);
    expect(pxPerMm()).toBe(framing);
    expect(Number(host().dataset.turnedPxPerMm)).toBeGreaterThan(framing);
    // back at the framing (NAV-SCOPE: Reset is the zoom's alone; a new filter starts from the framing), today's px per mm again
    again({}, { filterKey: 'another' });
    tick();
    expect(cam().yaw).toBe(0);
    expect(pxPerMm()).toBe(framing);
    expect(host().hasAttribute('data-turned-px-per-mm')).toBe(false);
  });

  it('(a) a move or a pitch made while turned never draws sharper than where the turn left yaw 0; turned straight, today\'s', () => {
    const { again } = scene();
    const opening = pxPerMm();
    lookRight();
    up(1, { x: 0, y: 200 });
    tick(500);
    const rest = pose();
    expect(rest.yaw).toBeGreaterThan(0);
    // turned right, a finger moving right walks the eye toward the fronts
    let nearest = rest.z;
    for (let i = 0; i < 4; i++) {
      drag({ x: 60, y: 300 }, { x: 420, y: 300 });
      tick(100);
      nearest = Math.min(nearest, pose().z);
      expect(pose().yaw).toBe(rest.yaw);
      expect(pxPerMm(), `move ${i + 1} while turned`).toBeLessThanOrEqual(opening);
    }
    expect(nearest).toBeLessThan(rest.z - 300);
    // a diagonal look from there (turned on and pitched): still never past it
    drag({ x: 300, y: 100 }, { x: 200, y: 400 }, { button: 2 });
    tick(500);
    expect(Math.abs(pose().pitch)).toBeGreaterThan(5 * DEG);
    expect(pxPerMm(), 'pitched while turned').toBeLessThanOrEqual(opening);
    // and from the opening (a new filter starts there: NAV-SCOPE), one diagonal look (right and up together)
    again({}, { filterKey: 'another' });
    tick();
    expect(pxPerMm()).toBe(opening);
    drag({ x: 440, y: 400 }, { x: 0, y: 0 }, { button: 2, steps: 12 });
    tick(500);
    expect(pose().yaw).toBeGreaterThan(0);
    expect(Math.abs(pose().pitch)).toBeGreaterThan(5 * DEG);
    expect(pxPerMm(), 'one diagonal look').toBeLessThanOrEqual(opening);
  }, HEAVY_MS);

  it('(b) never engages where the turn to the hard limit fits: the full cone, data-yaw-budget with no fit either way', () => {
    scene();
    const cone = JSON.parse(host().dataset.cone!) as { soft: number; hard: number };
    const most = lookRight();
    const b = budget();
    expect(b.ceiling).toBe(SCENE_CEILING_VIEWPORTS);
    expect(b.right.fit).toBeNull();
    expect(b.left.fit).toBeNull();
    // the start, then every probe out to each hard limit: all of them fit
    expect(b.start!.yaw).toBe(0);
    expect(b.asked.length).toBeGreaterThanOrEqual(2 * Math.ceil(cone.hard / 5) + 1);
    for (const [yaw, vp] of b.asked) expect(vp, `${yaw} deg`).toBeLessThanOrEqual(SCENE_CEILING_VIEWPORTS);
    expect(b.right.atHard!.vp).toBeLessThanOrEqual(SCENE_CEILING_VIEWPORTS);
    expect(b.left.atHard!.vp).toBeLessThanOrEqual(SCENE_CEILING_VIEWPORTS);
    expect(b.right.hard).toBeCloseTo(cone.hard, 4);
    expect(most / DEG).toBeGreaterThan(cone.soft);
    up(1, { x: 0, y: 200 });
    tick(500);
    expect(pose().yaw / DEG).toBeCloseTo(cone.soft, 1);
  });

  it('the projection at the pose a look starts from is what the scene draws there, kind by kind, never under it', () => {
    scene({}, { labels: true });
    const dom = domPx();
    const drawn = Number(host().dataset.drawnCabinets);
    const figures = Number(host().dataset.drawnFigures);
    down(1, { x: 300, y: 200 }, { button: 2 });
    move(1, { x: 280, y: 200 });
    const start = budget().start!;
    expect(start.yaw).toBe(0);
    expect(start.drawn).toBe(drawn);
    expect(start.figures).toBe(figures);
    expect(dom.figures).toBeGreaterThan(0);
    expect(start.px.figures).toBeGreaterThanOrEqual(dom.figures);
    expect(start.px.figures).toBeLessThan(dom.figures * 1.6);
    expect(start.px.shadows).toBe(SHADOW_PX * figures);
    expect(start.px.shadows).toBeGreaterThanOrEqual(dom.shadows);
    expect(start.px.mesh).toBeGreaterThan(0);
    expect(start.px.mesh).toBeCloseTo(dom.mesh, -1);
    expect(start.px.room).toBe(dom.room);
    expect(start.px.faces).toBe(CABINET_FACES_PX * drawn);
    expect(start.px.faces).toBeGreaterThanOrEqual(dom.faces);
    // over the screen's px (the window's), the controls added
    expect(start.vp).toBeCloseTo(total(start.px) / (window.innerWidth * window.innerHeight) + CONTROLS_VIEWPORTS, 4);
    up(1, { x: 280, y: 200 });
  });

  it('at the opening and at a Go to\'s shelf framing the projection at the start draws the cabinets and figures the scene draws (the cap is the wall\'s, CF1)', () => {
    const { again } = scene({}, { figures: WIDE });
    for (const at of ['opening', 'go to'] as const) {
      if (at === 'go to') {
        again({}, { figures: WIDE, goTo: { figureId: 'w300', seq: 1 } });
        tick();
      }
      const drawn = [Number(host().dataset.drawnCabinets), Number(host().dataset.drawnFigures)];
      down(1, { x: 300, y: 200 }, { button: 2 });
      move(1, { x: 290, y: 200 });
      const start = budget().start!;
      expect([start.drawn, start.figures], at).toEqual(drawn);
      up(1, { x: 290, y: 200 });
      tick(500);
    }
  });

  it('a turned start is projected as the scene draws it there; a turn\'s projection counts the cabinets and figures it brings in', () => {
    const { again } = scene({}, { figures: WIDE });
    const opening = Number(host().dataset.drawnFigures);
    lookRight();
    const first = budget();
    up(1, { x: 0, y: 200 });
    tick(500);
    // resting turned right at the soft limit: drawn afresh there, more of the long wall than the opening drew
    const restRight = { cabs: Number(host().dataset.drawnCabinets), figures: Number(host().dataset.drawnFigures) };
    expect(pose().yaw).toBeGreaterThan(0);
    expect(restRight.figures).toBeGreaterThan(opening);
    // the turn to the hard limit (past that rest) was projected with the figures of cabinets the opening did not draw
    expect(first.right.atHard!.figures).toBeGreaterThanOrEqual(restRight.figures);
    // a look from the rest projects its start as the scene draws it there: the same cabinets, the same figures
    down(1, { x: 300, y: 200 }, { button: 2 });
    move(1, { x: 290, y: 200 });
    const right = budget().start!;
    expect(right.yaw).toBeGreaterThan(0);
    expect([right.drawn, right.figures]).toEqual([restRight.cabs, restRight.figures]);
    up(1, { x: 290, y: 200 });
    tick(500);
    // walked in toward the fronts while turned (the frame spans less of them than the opening's cap): the same again
    drag({ x: 60, y: 300 }, { x: 260, y: 300 });
    tick(100);
    const walkedIn = { cabs: Number(host().dataset.drawnCabinets), figures: Number(host().dataset.drawnFigures) };
    down(1, { x: 300, y: 200 }, { button: 2 });
    move(1, { x: 290, y: 200 });
    const inner = budget().start!;
    expect([inner.drawn, inner.figures]).toEqual([walkedIn.cabs, walkedIn.figures]);
    up(1, { x: 290, y: 200 });
    tick(500);
    // and turned left from the opening (a new filter starts there: NAV-SCOPE), past the wall's start (fewer cabinets in
    // view than the opening's cap)
    again({}, { figures: WIDE, filterKey: 'another' });
    tick();
    down(1, { x: 0, y: 200 }, { button: 2 });
    for (let x = 10; x <= 440; x += 10) {
      move(1, { x, y: 200 });
      tick(16);
    }
    up(1, { x: 440, y: 200 });
    tick(500);
    expect(pose().yaw).toBeLessThan(0);
    const restLeft = { cabs: Number(host().dataset.drawnCabinets), figures: Number(host().dataset.drawnFigures) };
    down(1, { x: 300, y: 200 }, { button: 2 });
    move(1, { x: 290, y: 200 });
    const left = budget().start!;
    expect(left.yaw).toBeLessThan(0);
    expect([left.drawn, left.figures]).toEqual([restLeft.cabs, restLeft.figures]);
    up(1, { x: 290, y: 200 });
  }, HEAVY_MS);

  it('NAV-DOLLY: where the hard limit at the eye\'s px per mm would pass the ceiling, the scene is drawn coarser there and the turn goes all the way (the camera is never stopped for the budget)', () => {
    // read the costs (px, the same on any screen) on a screen where every yaw fits at the px per mm the eye asks, then
    // size the screen so the start fits at it and the hard limit right does not
    const big = screenOf(4000, 4000);
    scene({}, { figures: WIDE });
    lookRight();
    const b0 = budget();
    up(1, { x: 0, y: 200 });
    cleanup();
    big();
    const startPx = total(b0.start!.px);
    const hardPx = total(b0.right.atHard!.px);
    expect(hardPx).toBeGreaterThan(startPx * 1.05);
    const v = (startPx + hardPx) / 2 / (SCENE_CEILING_VIEWPORTS - CONTROLS_VIEWPORTS);
    const restore = screenOf(Math.round(Math.sqrt(v)), Math.round(Math.sqrt(v)));
    try {
      scene({}, { figures: WIDE });
      const cone = JSON.parse(host().dataset.cone!) as { soft: number; hard: number };
      const most = lookRight();
      const b = budget();
      expect(b.start!.vp).toBeLessThanOrEqual(SCENE_CEILING_VIEWPORTS);
      expect(total(b.start!.px)).toBe(startPx);
      // every yaw asked fits, the hard limit too: projected as drawn there, coarser than the eye asks (fewer px than
      // the big screen's, where it was drawn at that)
      expect(b.asked.every(([, vp]) => vp <= SCENE_CEILING_VIEWPORTS)).toBe(true);
      expect(b.right.fit).toBeNull();
      expect(b.right.atHard!.vp).toBeLessThanOrEqual(SCENE_CEILING_VIEWPORTS);
      expect(total(b.right.atHard!.px)).toBeLessThan(hardPx);
      // the turn went to the cone's own hard limit
      expect(most / DEG).toBeGreaterThan(cone.soft);
      up(1, { x: 0, y: 200 });
      tick(500);
      // let go: eased back to the cone's soft limit; the scene drawn there is within the ceiling
      expect(pose().yaw / DEG).toBeCloseTo(cone.soft, 1);
      const dom = domPx();
      expect((dom.figures + dom.shadows + dom.mesh + dom.room + dom.faces) / (window.innerWidth * window.innerHeight) + CONTROLS_VIEWPORTS).toBeLessThanOrEqual(SCENE_CEILING_VIEWPORTS);
    } finally {
      restore();
    }
  }, HEAVY_MS);

  it('(b) where nothing past the start fits (a tiny screen), a look turns no further that way', () => {
    const restore = screenOf(120, 120);
    try {
      scene();
      const most = lookRight();
      expect(budget().start!.vp).toBeGreaterThan(SCENE_CEILING_VIEWPORTS);
      expect(budget().right.fit).toBe(0);
      expect(most).toBe(0);
    } finally {
      restore();
    }
  });

  it('every wall pattern: a cabinet\'s faces on their grids cost at most CABINET_FACES_PX, the bound the projection takes', () => {
    let most = 0;
    for (const pattern of WALL_PATTERNS) {
      // a frame wide enough that no face is cut: each cabinet's whole set
      const { unmount } = scene({ pattern: pattern.id }, { frameFallback: { width: 4000, height: 3000 } });
      const cabs = Array.from(host().querySelectorAll<HTMLElement>('.cab'));
      expect(cabs.length, pattern.id).toBeGreaterThan(0);
      for (const cab of cabs) {
        const px = Array.from(cab.querySelectorAll<HTMLElement>('.q:not(.m-mesh)')).reduce((a, el) => a + parseFloat(el.style.width) * parseFloat(el.style.height), 0);
        expect(px, `${pattern.id} cabinet ${cab.dataset.index}`).toBeGreaterThan(0);
        expect(px, `${pattern.id} cabinet ${cab.dataset.index}`).toBeLessThanOrEqual(CABINET_FACES_PX);
        most = Math.max(most, px);
      }
      unmount();
    }
    // and a tight bound: the costliest cabinet takes most of it
    expect(most).toBeGreaterThan(CABINET_FACES_PX * 0.75);
  });

  it('a hold that arms Look works the cone out while the finger is still, once the ring has shown: the turn\'s first move waits on none of it', () => {
    scene();
    down(1, { x: 300, y: 200 });
    tick(LOOK_HOLD_MS + 1);
    // armed, the ring on; the cone not yet (the ring paints first)
    expect(host().dataset.gesture).toBe('look');
    expect(host().hasAttribute('data-yaw-budget')).toBe(false);
    tick(40);
    expect(budget().start!.yaw).toBe(0);
    host().removeAttribute('data-yaw-budget');
    move(1, { x: 280, y: 200 });
    tick(16);
    expect(pose().yaw).toBeGreaterThan(0);
    expect(host().hasAttribute('data-yaw-budget')).toBe(false);
    up(1, { x: 280, y: 200 });
    tick(500);
  });

  it('a turn that starts before the hold\'s cone is worked out, or at once (a right drag), works it out at its first move, once', () => {
    scene();
    down(1, { x: 300, y: 200 });
    tick(LOOK_HOLD_MS + 1);
    move(1, { x: 280, y: 200 });
    expect(budget().start!.yaw).toBe(0);
    host().removeAttribute('data-yaw-budget');
    tick(100);
    expect(host().hasAttribute('data-yaw-budget')).toBe(false);
    up(1, { x: 280, y: 200 });
    tick(500);
    host().removeAttribute('data-yaw-budget');
    down(1, { x: 300, y: 200 }, { button: 2 });
    tick(LOOK_HOLD_MS + 100);
    expect(host().hasAttribute('data-yaw-budget')).toBe(false);
    move(1, { x: 280, y: 200 });
    expect(budget().start!.yaw).toBeGreaterThan(0);
    up(1, { x: 280, y: 200 });
  });

  it('the hold\'s cone is the turn\'s only for the start and the scene it was worked out at: a render between works it out again', () => {
    const { again } = scene();
    down(1, { x: 300, y: 200 });
    tick(LOOK_HOLD_MS + 40);
    host().removeAttribute('data-yaw-budget');
    again({}, { labels: true });
    move(1, { x: 280, y: 200 });
    expect(budget().start!.yaw).toBe(0);
    up(1, { x: 280, y: 200 });
  });

  it('a hold that arms while a let-go eases back works the cone out from where the ease rests, and the turn takes it', () => {
    window.history.replaceState(null, '', '?lookhold=100');
    onTestFinished(() => window.history.replaceState(null, '', '/'));
    scene();
    lookRight();
    up(1, { x: 0, y: 200 });
    // pressed again at once: armed 100 ms on, the ease (200 ms) still running
    down(1, { x: 300, y: 200 });
    tick(100 + 40);
    const armed = budget();
    expect(armed.start!.yaw).toBeGreaterThan(0);
    host().removeAttribute('data-yaw-budget');
    move(1, { x: 290, y: 200 });
    expect(host().hasAttribute('data-yaw-budget')).toBe(false);
    // the turn goes on from the rest's cone, drawn from where the ease had got to (NAV-LOOKDRIVE: no jump): 140 ms in,
    // a hair past the rest
    expect(pose().yaw / DEG).toBeGreaterThan(armed.start!.yaw);
    expect(pose().yaw / DEG).toBeLessThan(armed.start!.yaw + 1);
    up(1, { x: 290, y: 200 });
  });

  it('at the opening, before any look: no budget published and no turned px per mm', () => {
    scene();
    expect(host().hasAttribute('data-yaw-budget')).toBe(false);
    expect(host().hasAttribute('data-turned-px-per-mm')).toBe(false);
  });
});

// NAV-JOG (Ross 10-28): the bottom-centre button (TabBar) drives the jog the scene offers: held off its centre, the eye
// moves the way the thumb holds it every frame, faster the farther; the lift stops it where it got. A move like a
// swipe's: through the room and the furniture, the Classic cap, and turned, the px per mm held where the turn left yaw 0.
describe('the jog (NAV-JOG): the eye moves the way the thumb holds the bottom-centre button', () => {
  const jog = () => useJogStore.getState().target!;
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) tick(16);
  };
  const run = (dx: number, dy: number, n: number) => {
    act(() => jog().aim(dx, dy));
    frames(n);
  };
  const begin = () => {
    let ok = false;
    act(() => {
      ok = jog().start();
    });
    // its first frame only takes the time
    frames(1);
    return ok;
  };
  const end = () => act(() => jog().stop());

  beforeEach(() => useJogStore.setState({ target: null }));

  it('the case offers a jog while it is shown, the same one through new prefs and walls; gone, it is withdrawn; shown again, offered again', () => {
    const { again, unmount } = scene();
    const offered = useJogStore.getState().target;
    expect(offered).not.toBeNull();
    again({ pattern: 'ikea-detolf' });
    again({ ceilingMm: 2700 });
    expect(useJogStore.getState().target, 'offered once, not again at each render').toBe(offered);
    unmount();
    expect(useJogStore.getState().target).toBeNull();
    scene({ ceilingMm: 2700 });
    expect(useJogStore.getState().target).not.toBeNull();
  });

  it('held right: the eye trucks right every frame, as much faster at full reach than half way as jogSpeed says (NAV-2B: 7.5x); the lift stops it there', () => {
    scene();
    const before = pose();
    expect(begin()).toBe(true);
    expect(host().dataset.gesture).toBe('jog');
    const x0 = pose().x;
    const halfPx = (8 + JOG_FULL_PX) / 2;
    run(halfPx, 0, 10);
    const half = pose().x - x0;
    expect(half).toBeGreaterThan(0);
    const x1 = pose().x;
    run(JOG_FULL_PX, 0, 10);
    const ratio = jogSpeed(JOG_FULL_PX) / jogSpeed(halfPx);
    expect(ratio).toBeCloseTo(7.53, 2);
    expect((pose().x - x1) / half).toBeCloseTo(ratio, 1);
    // the reach past full is full speed
    const x2 = pose().x;
    run(JOG_FULL_PX * 3, 0, 10);
    expect((pose().x - x2) / half).toBeCloseTo(ratio, 1);
    expect([pose().y, pose().z, pose().yaw, pose().pitch]).toEqual([before.y, before.z, 0, 0]);
    const running = pose();
    end();
    const stopped = pose();
    // the lift holds the pose the jog got to: no snap back to where it began
    expect(stopped).toEqual(running);
    expect(host().dataset.gesture).toBeUndefined();
    frames(30);
    expect(pose()).toEqual(stopped);
    // the stop holds the pose: a render keeps it
    fireEvent.pointerDown(host(), { pointerId: 7, clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerUp(host(), { pointerId: 7, clientX: 10, clientY: 10 });
    tick(500);
    expect(pose()).toEqual(stopped);
    // the stop let go of the jog: the next starts, from there, and moves
    expect(begin()).toBe(true);
    run(JOG_FULL_PX, 0, 5);
    expect(pose().x).toBeGreaterThan(stopped.x);
    end();
  });

  /** The animation frames by hand: each runs every callback asked for at the time given (as a browser's frame does). */
  const handFrames = () => {
    const asked = new Map<number, FrameRequestCallback>();
    let id = 0;
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => (asked.set(++id, cb), id));
    const caf = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((n) => void asked.delete(n));
    onTestFinished(() => {
      raf.mockRestore();
      caf.mockRestore();
    });
    return (t: number) =>
      act(() => {
        const due = [...asked.values()];
        asked.clear();
        for (const cb of due) cb(t);
      });
  };

  it('each frame moves by the time since the last, however uneven (8, 33, 120 ms): two frame widths a second at full reach (NAV-2B), a late frame as 100 ms', () => {
    scene();
    const frameAt = handFrames();
    const c0 = cam();
    act(() => {
      jog().start();
      jog().aim(JOG_FULL_PX, 0);
    });
    // the first frame only takes the time
    frameAt(1000);
    expect(cam()).toEqual(c0);
    let t = 1000;
    for (const dt of [8, 33, 120]) frameAt((t += dt));
    // picture travel at the anchor depth: a level eye's frame centre meets the fronts at its distance, z
    const travelPx = [8, 33, 120].reduce((a, dt) => a + jogStep(JOG_FULL_PX, 0, dt, c0.width).x, 0);
    expect(travelPx).toBeCloseTo((JOG_MAX_X * JOG_FRAMES_PER_S * c0.width * (8 + 33 + JOG_MAX_STEP_MS)) / 1000, 9);
    expect(cam().x - c0.x).toBeCloseTo((travelPx * c0.z) / c0.focalPx, 3);
    expect([cam().y, cam().z]).toEqual([c0.y, c0.z]);
    end();
  });

  it('NAV-SWIPE-2X: the swipe\'s doubling is the swipe\'s alone: a jog held at an offset steps its picture travel 1:1 at the anchor depth, each way', () => {
    scene();
    const frameAt = handFrames();
    const c0 = cam();
    act(() => {
      jog().start();
      jog().aim(40, 0);
    });
    frameAt(1000);
    frameAt(1000 + JOG_MAX_STEP_MS);
    const right = jogStep(40, 0, JOG_MAX_STEP_MS, c0.width).x;
    expect(right).toBeGreaterThan(0);
    expect(cam().x - c0.x).toBeCloseTo((right * c0.z) / c0.focalPx, 3);
    const c1 = cam();
    // held up: the eye rises by the picture travel at the anchor depth, 1:1
    act(() => jog().aim(0, -40));
    frameAt(1000 + 2 * JOG_MAX_STEP_MS);
    const upward = jogStep(0, -40, JOG_MAX_STEP_MS, c0.width).y;
    expect(cam().y - c1.y).toBeCloseTo((-upward * c1.z) / c1.focalPx, 3);
    expect(cam().x).toBe(c1.x);
    end();
  });

  it('inside the dead zone nothing moves and nothing is written; left moves left', () => {
    scene();
    const before = cam();
    begin();
    run(5, -5, 20);
    expect(cam()).toEqual(before);
    run(-JOG_FULL_PX, 0, 10);
    expect(pose().x).toBeLessThan(before.x);
    end();
  });

  it('up raises the eye, down lowers it, a diagonal does both; never past the ceiling less its clearance', () => {
    scene();
    const before = pose();
    begin();
    run(0, -JOG_FULL_PX, 10);
    const raised = pose();
    expect(raised.y).toBeGreaterThan(before.y);
    expect(raised.x).toBe(before.x);
    run(0, JOG_FULL_PX, 20);
    expect(pose().y).toBeLessThan(raised.y);
    const low = pose();
    run(50, -50, 10);
    expect(pose().x).toBeGreaterThan(low.x);
    expect(pose().y).toBeGreaterThan(low.y);
    run(0, -JOG_FULL_PX, 600);
    expect(cam().y).toBeLessThanOrEqual(DEFAULT_CASE_PREFS.ceilingMm - 50 + 1e-6);
    end();
  });

  /** The wall's ends (mm): its first cabinet's left side and its last's right, their overhangs included (data-wall). */
  const wallEnds = () => {
    const boxes = JSON.parse(host().dataset.wall!) as number[][];
    return { left: Math.min(...boxes.map((b) => b[0])), right: Math.max(...boxes.map((b) => b[1])) };
  };

  it('a long jog at twice the speed (NAV-2B) stops where the eye reaches the wall\'s end, never past it (half the frame still shows the wall); there up still goes, and back', () => {
    scene();
    expect(host().dataset.focus).toBe('0');
    const ends = wallEnds();
    begin();
    run(JOG_FULL_PX, 0, 3000);
    const far = pose();
    // within one frame's step short of the end: 16 ms at full reach's speed, at the anchor depth (the eye's distance)
    const step = (jogSpeed(JOG_FULL_PX) * cam().width * 0.016 * far.z) / cam().focalPx;
    expect(jogSpeed(JOG_FULL_PX)).toBe(2);
    expect(far.x).toBeLessThanOrEqual(ends.right);
    expect(far.x).toBeGreaterThan(ends.right - step - 1e-6);
    run(JOG_FULL_PX, 0, 100);
    expect(pose().x).toBe(far.x);
    // a diagonal there keeps its rise, not its run past the end (NAV-SCOPE: from the wall's framing the last full step can
    // stop short of the end by more than a diagonal's smaller run, which may still close that gap, never cross it)
    run(JOG_FULL_PX, -JOG_FULL_PX, 10);
    expect(pose().x).toBeGreaterThanOrEqual(far.x);
    expect(pose().x).toBeLessThanOrEqual(ends.right);
    expect(pose().y).toBeGreaterThan(far.y);
    const risen = pose();
    run(JOG_FULL_PX, -JOG_FULL_PX, 10);
    expect(pose().x).toBe(risen.x);
    expect(pose().y).toBeGreaterThan(risen.y);
    end();
    expect(Number(host().dataset.focus)).toBeGreaterThan(0);
    // and back the whole way: the left end holds it as well
    begin();
    run(-JOG_FULL_PX, 0, 3000);
    expect(pose().x).toBeGreaterThanOrEqual(ends.left);
    expect(pose().x).toBeLessThan(ends.left + step + 1e-6);
    end();
  });

  it('an eye a swipe left past the wall\'s end: the jog brings it back, never farther out', () => {
    // one cabinet: a single swipe walks the eye past its end
    scene({}, { figures: FIGURES.slice(0, 2) });
    const ends = wallEnds();
    drag({ x: 430, y: 200 }, { x: 20, y: 200 });
    tick(500);
    const out = pose();
    expect(out.x).toBeGreaterThan(ends.right);
    begin();
    run(JOG_FULL_PX, 0, 30);
    expect(pose().x).toBe(out.x);
    run(-JOG_FULL_PX, 0, 10);
    expect(pose().x).toBeLessThan(out.x);
    end();
  });

  /** The cabinets the scene draws, and those whose front the level frame shows (a pixel's grace at either edge). */
  const drawnCabs = () => new Set(Array.from(document.querySelectorAll<HTMLElement>('.cab')).map((el) => Number(el.dataset.index)));
  const wallBoxes = () => JSON.parse(host().dataset.wall!) as [number, number, number, number, number][];
  const frontsShown = (boxes: [number, number, number, number, number][]) => {
    const c = cam();
    const camera = { ...c, frame: { width: c.width, height: c.height } };
    return boxes.flatMap(([x0, x1], i) => (project(camera, [x1, 0, 0]).x > 1 && project(camera, [x0, 0, 0]).x < c.width - 1 ? [i] : []));
  };
  /** `n` frames of a jog `dx` each way, every one checked: no front shown but not drawn. How many fronts it checked. */
  const everyFrontDrawn = (dx: number, n: number) => {
    const boxes = wallBoxes();
    let checked = 0;
    act(() => jog().aim(dx, 0));
    for (let i = 0; i < n; i++) {
      tick(16);
      const has = drawnCabs();
      const need = frontsShown(boxes);
      expect(need.filter((k) => !has.has(k)), `fronts shown but not drawn at x ${cam().x.toFixed(0)}`).toEqual([]);
      checked += need.length;
    }
    return checked;
  };

  it('every frame of a jog draws every cabinet whose front the frame shows (stickyWhole): no background where a front stands', () => {
    // a long wall: more cabinets than the frame needs drawn
    scene({}, { figures: WIDE });
    expect(begin()).toBe(true);
    expect(everyFrontDrawn(JOG_FULL_PX, 90) + everyFrontDrawn(-JOG_FULL_PX, 90)).toBeGreaterThan(180);
    end();
  }, HEAVY_MS);

  it('on a wall longer than the case draws at once, the jog keeps to the Classic cap and still goes, every front drawn', () => {
    scene({}, { figures: LONG });
    expect(wallBoxes().length).toBeGreaterThan(DRAWN_CABINETS_LIMIT);
    const x0 = pose().x;
    expect(begin()).toBe(true);
    expect(everyFrontDrawn(JOG_FULL_PX, 60)).toBeGreaterThan(60);
    expect(pose().x).toBeGreaterThan(x0);
    expect(Number(host().dataset.drawnCap)).toBeLessThanOrEqual(DRAWN_CABINETS_LIMIT);
    end();
  });

  it('turned on a wall longer than the case draws at once, a jog backing away keeps to the Classic cap: it stops where a swipe does', () => {
    const backAway = (how: 'swipe' | 'jog') => {
      const { unmount } = scene({}, { figures: LONG });
      lookRight();
      up(1, { x: 0, y: 200 });
      tick(500);
      const rest = pose();
      if (how === 'swipe') {
        // turned right, a finger right to left walks the eye back, as far as the cap lets it
        for (let i = 0; i < 3; i++) {
          drag({ x: 400, y: 300 }, { x: 40, y: 300 }, { id: 30 + i });
          tick(100);
        }
      } else {
        begin();
        run(JOG_FULL_PX, 0, 100);
        end();
      }
      const at = pose();
      unmount();
      return { rest, at };
    };
    const swipe = backAway('swipe');
    const jogged = backAway('jog');
    expect(jogged.rest).toEqual(swipe.rest);
    expect(swipe.at.z).toBeGreaterThan(swipe.rest.z + 1000);
    // a swipe's steps are coarse (60 px a move): it stops up to one short of the cap; the jog's finer steps get closer
    expect(jogged.at.z).toBeGreaterThanOrEqual(swipe.at.z);
    expect(jogged.at.z - swipe.at.z).toBeLessThan(300);
    // (the 1,300-figure wall drawn twice: slow under coverage on a loaded host)
  }, 30_000);

  it('a finger on the scene owns the camera: the jog refuses meanwhile; a finger pressed while the jog runs moves nothing of its own', () => {
    scene();
    down(1, { x: 200, y: 200 });
    let ok = true;
    act(() => {
      ok = jog().start();
    });
    expect(ok).toBe(false);
    up(1, { x: 200, y: 200 });
    tick(500);
    expect(begin()).toBe(true);
    const at = pose();
    drag({ x: 300, y: 200 }, { x: 100, y: 200 }, { id: 3 });
    expect(pose()).toEqual(at);
    expect(host().dataset.gesture).toBe('jog');
    // a second start while it runs is refused too
    act(() => {
      ok = jog().start();
    });
    expect(ok).toBe(false);
    end();
  });

  it('turned, a jog keeps the turn and never draws sharper than where the turn left yaw 0 (a)', () => {
    scene();
    const opening = pxPerMm();
    lookRight();
    up(1, { x: 0, y: 200 });
    tick(500);
    const rest = pose();
    expect(rest.yaw).toBeGreaterThan(0);
    begin();
    // turned right, the jog left walks the eye toward the fronts
    let nearest = rest.z;
    for (let i = 0; i < 6; i++) {
      run(-JOG_FULL_PX, 0, 10);
      nearest = Math.min(nearest, pose().z);
      expect(pose().yaw).toBe(rest.yaw);
      expect(pxPerMm(), `jog ${i + 1} while turned`).toBeLessThanOrEqual(opening);
    }
    end();
    expect(nearest).toBeLessThan(rest.z - 100);
    expect(pxPerMm(), 'let go turned').toBeLessThanOrEqual(opening);
  });

  it('a jog while a look eases back starts from where the ease rests (the soft limit), the view easing on to it under the jog (NAV-LOOKDRIVE: no jump)', () => {
    scene();
    const cone = JSON.parse(host().dataset.cone!) as { soft: number; hard: number };
    drag({ x: 440, y: 200 }, { x: 0, y: 200 }, { button: 2, steps: 20, lift: false });
    up(1, { x: 0, y: 200 });
    tick(16);
    const easing = pose().yaw;
    expect(easing / DEG).toBeGreaterThan(cone.soft + 1);
    let ok = false;
    act(() => {
      ok = jog().start();
    });
    expect(ok).toBe(true);
    // drawn where the ease had it, and a frame on a little nearer its rest
    expect(pose().yaw).toBe(easing);
    frames(1);
    expect(pose().yaw).toBeLessThan(easing);
    expect(pose().yaw / DEG).toBeGreaterThan(cone.soft);
    run(JOG_FULL_PX, 0, 20);
    expect(pose().yaw / DEG).toBeCloseTo(cone.soft, 3);
    end();
    tick(500);
    expect(pose().yaw / DEG).toBeCloseTo(cone.soft, 3);
  });

  it('zoomed, a jog drops the magnification and moves the camera', () => {
    scene();
    down(11, { x: 180, y: 260 });
    down(12, { x: 260, y: 260 });
    move(11, { x: 140, y: 260 });
    move(12, { x: 300, y: 260 });
    up(11, { x: 140, y: 260 });
    up(12, { x: 300, y: 260 });
    tick(500);
    expect(JSON.parse(host().dataset.zoom!).k).toBeGreaterThan(1);
    const before = pose();
    begin();
    expect(JSON.parse(host().dataset.zoom!).k).toBe(1);
    run(JOG_FULL_PX, 0, 10);
    end();
    expect(pose().x).toBeGreaterThan(before.x);
  });

  // NAV-LOOKDRIVE: the same button in Look mode drives the scene's camera by rate (useFreeCamera's lookStart, lookAim, lookStop)
  it('the jog offers the hat\'s Look: held right the eye turns right where it stands; let go past the soft limit it eases back to it; zoomed, its start drops the magnification', () => {
    scene();
    const cone = JSON.parse(host().dataset.cone!) as { soft: number; hard: number };
    down(11, { x: 180, y: 260 });
    down(12, { x: 260, y: 260 });
    move(11, { x: 140, y: 260 });
    move(12, { x: 300, y: 260 });
    up(11, { x: 140, y: 260 });
    up(12, { x: 300, y: 260 });
    tick(500);
    expect(JSON.parse(host().dataset.zoom!).k).toBeGreaterThan(1);
    const before = pose();
    const look = jog().look!;
    let ok = false;
    act(() => {
      ok = look.start();
    });
    expect(ok).toBe(true);
    expect(JSON.parse(host().dataset.zoom!).k).toBe(1);
    expect(host().dataset.gesture).toBe('jog-look');
    act(() => look.aim(JOG_FULL_PX, 0));
    frames(61);
    expect(pose().yaw / DEG).toBeGreaterThan(cone.soft);
    expect(pose().yaw / DEG).toBeLessThan(cone.hard);
    expect([pose().x, pose().y, pose().z]).toEqual([before.x, before.y, before.z]);
    act(() => look.stop());
    expect(host().hasAttribute('data-gesture')).toBe(false);
    // easing back: still past the soft limit a frame in, at it once the ease is over
    tick(16);
    expect(pose().yaw / DEG).toBeGreaterThan(cone.soft);
    tick(250);
    expect(pose().yaw / DEG).toBeCloseTo(cone.soft, 3);
    // a finger on the scene owns it: the Look is refused
    down(1, { x: 200, y: 200 });
    act(() => {
      ok = look.start();
    });
    expect(ok).toBe(false);
    up(1, { x: 200, y: 200 });
  });

  // NAV-LOGPOSE: the jog offers the Log-Pose orb's tilt drive (useFreeCamera's tiltSet, tiltFold)
  it('the jog offers the tilt: an offset turns the view drawn, not the pose held; its fold keeps the view and holds it there', () => {
    scene();
    const before = pose();
    const tilt = jog().tilt!;
    let ok = false;
    act(() => {
      ok = tilt.set(3 * DEG, 0);
    });
    expect(ok).toBe(true);
    expect(pose().yaw).toBeCloseTo(before.yaw + 3 * DEG, 6);
    expect([pose().x, pose().y, pose().z]).toEqual([before.x, before.y, before.z]);
    const shown = pose();
    act(() => tilt.fold());
    tick(300);
    expect(pose()).toEqual(shown);
    // folded: the source's next sample is its new neutral, refused once
    act(() => {
      ok = tilt.set(3 * DEG, 0);
    });
    expect(ok).toBe(false);
    expect(pose()).toEqual(shown);
  });

  // NAV-DESKTOP-ZOOM: the wheel's magnification keeps the jog's rule: no magnification rides a moving camera
  const wheel = (deltaY: number) => fireEvent.wheel(host(), { clientX: 220, clientY: 260, deltaY, deltaMode: 0 });
  const k = () => (JSON.parse(host().dataset.zoom!) as { k: number }).k;

  it('a wheel zoom, in or out under 1x and not yet settled, is dropped at a jog\'s start and never settles back after', () => {
    scene();
    wheel(300);
    expect(k()).toBeLessThan(1);
    begin();
    expect(k()).toBe(1);
    tick(500);
    expect(k()).toBe(1);
    end();
    cleanup();
    scene();
    wheel(-300);
    expect(k()).toBeGreaterThan(1);
    begin();
    expect(k()).toBe(1);
    tick(500);
    expect(k()).toBe(1);
    end();
  });

  it('while the jog runs the wheel zooms nothing (the page still never scrolls); stopped, it zooms again', () => {
    scene();
    begin();
    run(JOG_FULL_PX, 0, 5);
    expect(wheel(-300)).toBe(false);
    expect(k()).toBe(1);
    end();
    // a jog let go leaves no spring: the next notch zooms
    wheel(-300);
    expect(k()).toBeGreaterThan(1);
  });

  it('gone mid-run: no frame runs on, and the withdrawn jog\'s calls do nothing', () => {
    const { unmount } = scene();
    begin();
    const held = jog();
    act(() => held.aim(JOG_FULL_PX, 0));
    unmount();
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    frames(10);
    act(() => held.aim(JOG_FULL_PX, 0));
    act(() => held.stop());
    expect(raf).not.toHaveBeenCalled();
    raf.mockRestore();
  });

  // NAV-DEPTH-2: the window losing focus mid-jog halts it; the lift that comes later sets the focus from where the eye
  // stands, never from a halted pose the eye has since left (a second finger's swipe)
  describe('NAV-DEPTH-2: a blur mid-jog, then the lift', () => {
    /** The cabinet whose span is nearest the eye's x (data-wall's [x0, x1, ...] per cabinet). */
    const nearest = () => {
      const boxes = JSON.parse(host().dataset.wall!) as number[][];
      const x = cam().x;
      return boxes.map((b, i) => [Math.max(0, b[0] - x, x - b[1]), i]).sort((a, b) => a[0] - b[0])[0][1];
    };
    const jogAlong = () => {
      scene();
      expect(host().dataset.focus).toBe('0');
      begin();
      act(() => jog().aim(JOG_FULL_PX, 0));
      frames(3000);
      act(() => void window.dispatchEvent(new Event('blur')));
    };

    it('the eye holds where the blur found it, and the lift moves the focus to the cabinet it stands at', () => {
      jogAlong();
      const at = cam().x;
      frames(10);
      expect(cam().x).toBe(at);
      end();
      frames(1);
      expect(Number(host().dataset.focus)).toBeGreaterThan(0);
      expect(Number(host().dataset.focus)).toBe(nearest());
    });

    it('a second finger swipes the eye elsewhere before the lift: the focus is the cabinet the eye stands at now', () => {
      jogAlong();
      const halted = cam().x;
      for (let k = 0; k < 6; k++) {
        drag({ x: 100, y: 200 }, { x: 700, y: 200 }, { id: 2 });
        tick(16);
      }
      tick(500);
      expect(cam().x).not.toBe(halted);
      end();
      frames(1);
      expect(Number(host().dataset.focus)).toBe(nearest());
    });
  });

  // NAV-2B: Ross tunes the top speed on the device with ?jogmax=1|1.5|2 (as ?lookhold=), no roll; 2 unless it says 1 to 2
  it('?jogmax= sets the top speed: 1 is today\'s, 1.5, 2 the default; outside 1 to 2 or not a number, 2; the button is told it', () => {
    onTestFinished(() => window.history.replaceState(null, '', '/'));
    /** Frame widths a second of picture at the anchor depth, held at full reach over one 100 ms frame. */
    const topSpeed = () => {
      const { unmount } = scene();
      const frameAt = handFrames();
      const c0 = cam();
      act(() => {
        jog().start();
        jog().aim(JOG_FULL_PX, 0);
      });
      frameAt(1000);
      frameAt(1000 + JOG_MAX_STEP_MS);
      const speed = (((cam().x - c0.x) * c0.focalPx) / c0.z / c0.width) * (1000 / JOG_MAX_STEP_MS);
      const max = jog().max;
      end();
      unmount();
      return { speed: Math.round(speed * 1e6) / 1e6, max };
    };
    for (const [query, x] of [['', 2], ['?jogmax=1', 1], ['?jogmax=1.5', 1.5], ['?jogmax=2', 2], ['?jogmax=1.25', 1.25], ['?jogmax=3', 2], ['?jogmax=0.5', 2], ['?jogmax=fast', 2], ['?jogmax=', 2]] as const) {
      window.history.replaceState(null, '', `/${query}`);
      expect(topSpeed(), query || 'no knob').toEqual({ speed: x * JOG_FRAMES_PER_S, max: x });
    }
  });
});

// NAV-DEPTH-3: the jog the scene offers carries the depth rocker's drive (useFreeCamera's depthStart / depthRate /
// depthStop): forward the eye nears the wall along its level heading, back it leaves it, with the hat or alone; the
// last drive let go moves the focus to the cabinet the eye stands at, as the jog's lift does.
describe('the depth rocker\'s drive (NAV-DEPTH-3): the offered jog\'s depth moves the eye toward and away from the wall', () => {
  const jog = () => useJogStore.getState().target!;
  const depth = () => jog().depth!;
  const frames = (n: number) => {
    for (let i = 0; i < n; i++) tick(16);
  };
  const press = (r: number) => {
    let ok = false;
    act(() => {
      ok = depth().start(r);
    });
    frames(1);
    return ok;
  };
  const lift = () => act(() => depth().stop());

  beforeEach(() => useJogStore.setState({ target: null }));

  it('offered with the jog; gone with the case', () => {
    const { unmount } = scene();
    expect(typeof depth().start).toBe('function');
    unmount();
    expect(useJogStore.getState().target).toBeNull();
  });

  it('forward (r > 0): z falls every frame, x, y, yaw and pitch kept; back (r < 0) z rises; the stop holds where it got to', () => {
    scene();
    const before = pose();
    expect(press(1)).toBe(true);
    expect(host().dataset.gesture).toBe('depth');
    frames(20);
    const near = pose();
    expect(near.z).toBeLessThan(before.z);
    expect([near.x, near.y, near.yaw, near.pitch]).toEqual([before.x, before.y, before.yaw, before.pitch]);
    act(() => depth().rate(-1));
    frames(20);
    expect(pose().z).toBeGreaterThan(near.z);
    expect(pose().x).toBe(before.x);
    const running = pose();
    lift();
    expect(pose()).toEqual(running);
    expect(host().dataset.gesture).toBeUndefined();
    frames(20);
    expect(pose()).toEqual(running);
  });

  it('NAV-DOLLY: held forward on the cover, the eye reaches the shelves\' margin; all the way the scene is drawn within the ceiling, its mesh shelves (not its figures) drawn coarser to fit', () => {
    const restore = screenOf(443, 558);
    onTestFinished(restore);
    scene();
    const screenPx = 443 * 558;
    const meshS = () => Number(host().dataset.meshPxPerMm);
    // at the framing the mesh costs little: drawn at the scene's px per mm
    expect(meshS()).toBe(pxPerMm());
    // the cabinets' room, front to back (a level eye's px per mm asks nothing of its height)
    const boxes = JSON.parse(host().dataset.wall!) as number[][];
    const span = { y0: 0, y1: 2400, z0: Math.min(...boxes.map((b) => b[3])), z1: Math.max(...boxes.map((b) => b[4])) };
    expect(pose().pitch).toBe(0);
    const level = () => texelScale({ ...cam(), frame: { width: cam().width, height: cam().height } }, span);
    // the eye 200 mm below the framing's height (a finger moving up lowers it): more of the shelves' tops in view
    const y0 = pose().y;
    for (let i = 0; i < 20 && pose().y > y0 - 200; i++) drag({ x: 200, y: 300 }, { x: 200, y: 280 });
    tick(500);
    expect(pose().y).toBeLessThanOrEqual(y0 - 200);
    let coarser = 0;
    let stops = 0;
    for (let z = pose().z; ; ) {
      // a stretch of the walk in, then let go: rendered where the eye stands
      expect(press(1)).toBe(true);
      frames(4);
      lift();
      tick();
      const dom = domPx();
      const s = pxPerMm();
      // the figures' scene at the px per mm the eye asks, never coarser for the mesh's sake
      expect(s, `scene at z ${pose().z}`).toBe(level());
      const octaves = Math.log2(s / meshS());
      expect(octaves).toBe(Math.round(octaves));
      expect(octaves).toBeGreaterThanOrEqual(0);
      if (octaves > 0) coarser++;
      // every mesh shelf is drawn at the mesh's px per mm (its element's size and its pattern's)
      const meshes = Array.from(host().querySelectorAll<HTMLElement>('.cabinet-scene__root .m-mesh'));
      for (const el of meshes) expect(el.style.getPropertyValue('--s')).toBe(String(meshS()));
      expect(dom.mesh, `mesh at z ${pose().z}`).toBeLessThanOrEqual(MESH_BUDGET_VIEWPORTS * screenPx + 1);
      if (octaves > 0) expect(dom.mesh * 4, `an octave finer at z ${pose().z}`).toBeGreaterThan(MESH_BUDGET_VIEWPORTS * screenPx - 1);
      expect((dom.figures + dom.shadows + dom.mesh + dom.room + dom.faces) / screenPx + CONTROLS_VIEWPORTS, `scene at z ${pose().z}`).toBeLessThanOrEqual(SCENE_CEILING_VIEWPORTS);
      stops++;
      if (pose().z === z) break;
      z = pose().z;
    }
    expect(stops).toBeGreaterThan(5);
    expect(coarser).toBeGreaterThan(0);
    expect(pose().z).toBeCloseTo(span.z1 + EYE_MARGIN_MM, 6);
    expect(host().dataset.dollyHeld).toBe('room');
  }, HEAVY_MS);

  it('inside the dead zone the drive runs and moves nothing', () => {
    scene();
    const before = pose();
    press(DEPTH_DEAD);
    frames(20);
    expect(pose()).toEqual(before);
    lift();
  });

  it('refused while a finger is on the scene', () => {
    scene();
    down(1, { x: 200, y: 200 });
    expect(press(1)).toBe(false);
    up(1, { x: 200, y: 200 });
  });

  it('zoomed, the depth\'s start drops the magnification and moves the eye', () => {
    scene();
    fireEvent.wheel(host(), { clientX: 220, clientY: 260, deltaY: -300, deltaMode: 0 });
    expect(JSON.parse(host().dataset.zoom!).k).toBeGreaterThan(1);
    const before = pose();
    press(1);
    expect(JSON.parse(host().dataset.zoom!).k).toBe(1);
    frames(10);
    lift();
    expect(pose().z).toBeLessThan(before.z);
  });

  it('held with the hat: x and z both move; the hat\'s lift leaves the depth running; its stop, the last, moves the focus to the cabinet the eye stands at', () => {
    scene();
    expect(host().dataset.focus).toBe('0');
    const before = pose();
    act(() => {
      jog().start();
      jog().aim(JOG_FULL_PX, 0);
    });
    press(0.5);
    frames(3000);
    const both = pose();
    expect(both.x).toBeGreaterThan(before.x);
    expect(both.z).not.toBe(before.z);
    act(() => jog().stop());
    expect(host().dataset.gesture).toBe('depth');
    // the hat's lift was not the last: the focus waits
    expect(host().dataset.focus).toBe('0');
    lift();
    frames(1);
    const boxes = JSON.parse(host().dataset.wall!) as number[][];
    const x = cam().x;
    const nearest = boxes.map((b, i) => [Math.max(0, b[0] - x, x - b[1]), i]).sort((a, b) => a[0] - b[0])[0][1];
    expect(Number(host().dataset.focus)).toBeGreaterThan(0);
    expect(Number(host().dataset.focus)).toBe(nearest);
  });

  it('a stop with no depth drive running (after the hat alone) changes nothing', () => {
    scene();
    const before = pose();
    lift();
    frames(2);
    expect(pose()).toEqual(before);
    expect(host().dataset.focus).toBe('0');
  });
});

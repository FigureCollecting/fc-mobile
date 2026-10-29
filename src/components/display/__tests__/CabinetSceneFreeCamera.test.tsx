import { describe, it, expect, vi, afterEach, beforeEach, onTestFinished } from 'vitest';
import { render, fireEvent, screen, cleanup, act } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene } from '../CabinetScene';
import { DEFAULT_CASE_PREFS, WALL_PATTERNS, type CasePrefs } from '../casePrefs';
import { __clearAlphaMarginCache } from '../alphaMargin';
import { JOG_FRAMES_PER_S, JOG_FULL_PX, JOG_MAX_STEP_MS, LOOK_HOLD_MS, PITCH, jogStep, yawLimits } from '../casePose';
import { coneOf } from '../useFreeCamera';
import { useJogStore } from '../../../stores/jog';
import { CABINET_FACES_PX, CONTROLS_VIEWPORTS, SCENE_CEILING_VIEWPORTS, SHADOW_PX } from '../caseBudget';
import { wallLayout } from '../packCabinets';
import { IKEA_DETOLF, IKEA_KLINGSBO } from '../cabinetPresets';
import { frameMargins, project } from '../caseCamera';
import { DRAWN_CABINETS_LIMIT } from '../caseCull';

// NAV-1A, the Free camera (trial), in the scene: MOVE and LOOK from one finger, the hold that arms Look without swallowing
// a tap, the realism cone and its ease back, the pose held across a fold, the arrows and Reset from the frame-centre
// cabinet, the side walls, and PINCH-1 as it was. jsdom lays nothing out: a client point is a frame point.

const COVER = { width: 443, height: 418 };
const DEG = Math.PI / 180;
const sized = (i: number): Figure => ({ _id: `s${i}`, name: `Figure ${i}`, dimensions: { heightMm: 200, widthMm: 100 } }) as Figure;
const FIGURES = Array.from({ length: 120 }, (_, i) => sized(i));
const prefs = (patch: Partial<CasePrefs> = {}): CasePrefs => ({ ...DEFAULT_CASE_PREFS, clearanceMm: 0, freeCamera: true, ...patch });

type P = { x: number; y: number };
type Opts = { button?: number; shiftKey?: boolean };
const host = () => document.querySelector('.cabinet-scene') as HTMLElement;
const down = (id: number, p: P, o: Opts = {}) => fireEvent.pointerDown(host(), { pointerId: id, clientX: p.x, clientY: p.y, button: o.button ?? 0, shiftKey: o.shiftKey ?? false });
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

describe('Free camera on: what the scene publishes and draws', () => {
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

  it('off: none of it', () => {
    scene({ freeCamera: false });
    expect(host().hasAttribute('data-free-camera')).toBe(false);
    expect(host().hasAttribute('data-cone')).toBe(false);
    expect(cam()).not.toHaveProperty('yaw');
    expect(host().querySelectorAll('.room-side')).toHaveLength(0);
    expect(host().querySelector('.cabinet-scene__look-ring')).toBeNull();
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

  it('the header\'s Look around (swipe pan) turns at once; so do a right drag and a Shift+left drag', () => {
    for (const [patch, o] of [
      [{ swipe: 'pan' }, {}],
      [{}, { button: 2 }],
      [{}, { shiftKey: true }],
    ] as const) {
      const { unmount } = scene(patch);
      const before = pose();
      drag({ x: 220, y: 200 }, { x: 160, y: 200 }, o);
      expect(pose().yaw).toBeGreaterThan(0);
      expect(pose().x).toBe(before.x);
      unmount();
    }
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

describe('the arrows and Reset from where you look (rulings S7, spec 4)', () => {
  it('Reset: absent after a walk at the opening height, present after a look once the gesture ends, and back to the framing (yaw 0)', () => {
    scene({ view: 'cabinet' });
    drag({ x: 300, y: 200 }, { x: 100, y: 200 });
    tick(500);
    expect(screen.queryByRole('button', { name: 'Reset view' })).toBeNull();
    drag({ x: 300, y: 200 }, { x: 160, y: 200 }, { button: 2, lift: false });
    expect(screen.queryByRole('button', { name: 'Reset view' })).toBeNull();
    up(1, { x: 160, y: 200 });
    tick(500);
    const reset = screen.getByRole('button', { name: 'Reset view' });
    expect(reset.classList.contains('cabinet-scene__reset--fade')).toBe(true);
    const focus = host().dataset.focus;
    fireEvent.click(reset);
    tick();
    expect(cam().yaw).toBe(0);
    expect(host().dataset.focus).toBe(focus);
    expect(screen.queryByRole('button', { name: 'Reset view' })).toBeNull();
  });

  it('NAV-JOG: the side arrows retire in Free camera (the jog moves it); the shelf view keeps its shelf steps; off, the arrows stay', () => {
    scene({ view: 'cabinet' });
    expect(screen.queryByRole('button', { name: 'Next cabinet' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Previous cabinet' })).toBeNull();
    cleanup();
    scene({ view: 'shelf' });
    expect(screen.queryByRole('button', { name: 'Next cabinet' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Shelf below' })).toBeInTheDocument();
    cleanup();
    scene({ freeCamera: false });
    expect(screen.getByRole('button', { name: 'Next cabinet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous cabinet' })).toBeInTheDocument();
  });

  it('the shelf arrows stand it at the shelf\'s framing too', () => {
    scene({ view: 'shelf' });
    drag({ x: 300, y: 200 }, { x: 100, y: 200 });
    fireEvent.click(screen.getByRole('button', { name: 'Shelf below' }));
    tick();
    expect(host().dataset.shelf).toBe('1');
    expect(cam().pitch).toBe(0);
  });

  it('a new view starts from its framing; a mode switch keeps the pose', () => {
    const { again } = scene();
    drag({ x: 300, y: 200 }, { x: 100, y: 200 });
    const walked = pose();
    again({ swipe: 'pan' });
    expect(pose()).toEqual(walked);
    again({ swipe: 'pan', view: 'cabinet' });
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
    const { again } = scene({ view: 'shelf' }, { onWentTo });
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
    scene();
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
    // Reset: the framing, turned straight, at today's px per mm again
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    tick();
    expect(cam().yaw).toBe(0);
    expect(pxPerMm()).toBe(framing);
    expect(host().hasAttribute('data-turned-px-per-mm')).toBe(false);
  });

  it('(a) a move or a pitch made while turned never draws sharper than where the turn left yaw 0; turned straight, today\'s', () => {
    scene();
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
    // and from the opening, one diagonal look (right and up together)
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    tick();
    expect(pxPerMm()).toBe(opening);
    drag({ x: 440, y: 400 }, { x: 0, y: 0 }, { button: 2, steps: 12 });
    tick(500);
    expect(pose().yaw).toBeGreaterThan(0);
    expect(Math.abs(pose().pitch)).toBeGreaterThan(5 * DEG);
    expect(pxPerMm(), 'one diagonal look').toBeLessThanOrEqual(opening);
  });

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

  it('in every view the projection at the start draws the cabinets and figures the scene draws (the cap is the wall\'s, CF1)', () => {
    for (const view of ['wall', 'cabinet', 'shelf'] as const) {
      const { unmount } = scene({ view }, { figures: WIDE });
      const drawn = [Number(host().dataset.drawnCabinets), Number(host().dataset.drawnFigures)];
      down(1, { x: 300, y: 200 }, { button: 2 });
      move(1, { x: 290, y: 200 });
      const start = budget().start!;
      expect([start.drawn, start.figures], view).toEqual(drawn);
      up(1, { x: 290, y: 200 });
      unmount();
    }
  });

  it('a turned start is projected as the scene draws it there; a turn\'s projection counts the cabinets and figures it brings in', () => {
    scene({}, { figures: WIDE });
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
    // and turned left, past the wall's start (fewer cabinets in view than the opening's cap)
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
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
  });

  it('(b) engaged: past the ceiling at the hard limit, the turn stops at the last yaw that fits and eases back to the band\'s soft limit', () => {
    // read the costs (px, the same on any screen) on a screen where every yaw fits, so the search gets to the hard limit,
    // then size the screen so the start fits and the hard limit right does not
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
      // a yaw to the right past the ceiling, where the search stopped
      expect(b.asked.some(([yaw, vp]) => yaw > 0 && vp > SCENE_CEILING_VIEWPORTS)).toBe(true);
      expect(b.right.fit).not.toBeNull();
      expect(b.right.fit!).toBeLessThan(cone.hard);
      expect(b.right.fit!).toBeGreaterThan(0);
      // shown never past the last yaw that fits
      expect(most / DEG).toBeLessThanOrEqual(b.right.fit! + 1e-6);
      up(1, { x: 0, y: 200 });
      tick(500);
      // let go: eased back to the band's soft limit, the cone's band moved in to end at the fit
      expect(pose().yaw / DEG).toBeCloseTo(Math.max(0, b.right.fit! - (cone.hard - cone.soft)), 1);
    } finally {
      restore();
    }
  });

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
    // the turn goes on from the rest (the band past it), not from where the ease had got to
    expect(pose().yaw / DEG).toBeGreaterThan(armed.start!.yaw);
    expect(pose().yaw / DEG).toBeLessThan(armed.start!.yaw + 1);
    up(1, { x: 290, y: 200 });
  });

  it('off: no budget published and the px per mm is today\'s', () => {
    scene({ freeCamera: false });
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

  it('Free camera offers a jog while it is shown; turned off or gone, it is withdrawn; off, none', () => {
    const { again, unmount } = scene();
    expect(useJogStore.getState().target).not.toBeNull();
    again({ freeCamera: false });
    expect(useJogStore.getState().target).toBeNull();
    again({ freeCamera: true });
    expect(useJogStore.getState().target).not.toBeNull();
    unmount();
    expect(useJogStore.getState().target).toBeNull();
    scene({ freeCamera: false });
    expect(useJogStore.getState().target).toBeNull();
  });

  it('held right: the eye trucks right every frame, four times as fast at full reach as half way; the lift stops it there', () => {
    scene();
    const before = pose();
    expect(begin()).toBe(true);
    expect(host().dataset.gesture).toBe('jog');
    const x0 = pose().x;
    run((8 + JOG_FULL_PX) / 2, 0, 10);
    const half = pose().x - x0;
    expect(half).toBeGreaterThan(0);
    const x1 = pose().x;
    run(JOG_FULL_PX, 0, 10);
    expect((pose().x - x1) / half).toBeCloseTo(4, 1);
    // the reach past full is full speed
    const x2 = pose().x;
    run(JOG_FULL_PX * 3, 0, 10);
    expect((pose().x - x2) / half).toBeCloseTo(4, 1);
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

  it('each frame moves by the time since the last, however uneven (8, 33, 120 ms): a frame width a second at full reach, a late frame as 100 ms', () => {
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
    expect(travelPx).toBeCloseTo((JOG_FRAMES_PER_S * c0.width * (8 + 33 + JOG_MAX_STEP_MS)) / 1000, 9);
    expect(cam().x - c0.x).toBeCloseTo((travelPx * c0.z) / c0.focalPx, 3);
    expect([cam().y, cam().z]).toEqual([c0.y, c0.z]);
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

  it('a long jog stops where the eye reaches the wall\'s end, never past it (half the frame still shows the wall); there up still goes, and back', () => {
    scene({ view: 'cabinet' });
    expect(host().dataset.focus).toBe('0');
    const ends = wallEnds();
    begin();
    run(JOG_FULL_PX, 0, 3000);
    const far = pose();
    // within one frame's step short of the end: 16 ms at a frame width a second, at the anchor depth (the eye's distance)
    const step = (cam().width * 0.016 * far.z) / cam().focalPx;
    expect(far.x).toBeLessThanOrEqual(ends.right);
    expect(far.x).toBeGreaterThan(ends.right - step - 1e-6);
    run(JOG_FULL_PX, 0, 100);
    expect(pose().x).toBe(far.x);
    // a diagonal there keeps its rise, not its run
    run(JOG_FULL_PX, -JOG_FULL_PX, 10);
    expect(pose().x).toBe(far.x);
    expect(pose().y).toBeGreaterThan(far.y);
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
    scene({ view: 'cabinet' }, { figures: FIGURES.slice(0, 2) });
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
  });

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

  it('a jog while a look eases back starts from where the ease rests (the soft limit)', () => {
    scene();
    const cone = JSON.parse(host().dataset.cone!) as { soft: number; hard: number };
    drag({ x: 440, y: 200 }, { x: 0, y: 200 }, { button: 2, steps: 20, lift: false });
    up(1, { x: 0, y: 200 });
    tick(16);
    begin();
    expect(pose().yaw / DEG).toBeCloseTo(cone.soft, 3);
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
});

// NAV3-TOP (b), Ross 10-28 ("we can try b I reckon"), a trial with the Free camera: only the one-cabinet view stands back so
// the tallest figure on a cabinet's top shows whole; the wall view keeps the 24 in crop (raise or look up there).
describe('NAV3-TOP (b): the one-cabinet view shows the tallest top figure whole; the wall view keeps the crop', () => {
  const tall = { _id: 'tall', name: 'Tall', dimensions: { heightMm: 700, widthMm: 200 } } as Figure;
  /** Where the tall figure's head draws in the frame (px from its top), and the frame's top margin. */
  const head = () => {
    const w = JSON.parse(host().querySelector<HTMLElement>('.cab-figure[data-figure-id="tall"]')!.dataset.world!) as { x0: number; x1: number; y1: number; z: number };
    const c = cam();
    const frame = { width: c.width, height: c.height };
    return { y: project({ ...c, frame }, [(w.x0 + w.x1) / 2, w.y1, w.z]).y, margin: frameMargins(frame).y, top: w.y1 };
  };

  it('a 700 mm figure on a Detolf\'s top, the open Fold8: the cabinet view stands back to show it whole; the wall view frames as for one at the cap', () => {
    const atCap = { ...tall, dimensions: { heightMm: 609.6 - 40, widthMm: 200 } } as Figure;
    const open = { frameFallback: { width: 870, height: 475 } };
    const { again } = scene({ view: 'cabinet', pattern: IKEA_DETOLF.id }, { ...open, figures: [tall] });
    const cabinet = head();
    expect(cabinet.top).toBeGreaterThan(IKEA_DETOLF.outer.heightMm + 609.6);
    expect(cabinet.y).toBeGreaterThanOrEqual(cabinet.margin - 1e-6);
    const stoodBack = cam();
    again({ view: 'cabinet', pattern: IKEA_DETOLF.id }, { ...open, figures: [atCap] });
    expect(stoodBack.z).toBeGreaterThan(cam().z);
    // the wall view: the same camera for either (the crop kept: a figure past the cap is cut at the frame's top)
    again({ view: 'wall', pattern: IKEA_DETOLF.id }, { ...open, figures: [atCap] });
    const wallAtCap = cam();
    again({ view: 'wall', pattern: IKEA_DETOLF.id }, { ...open, figures: [tall] });
    expect(cam()).toEqual(wallAtCap);
  });

  it('the cover\'s cabinet view too', () => {
    scene({ view: 'cabinet', pattern: IKEA_DETOLF.id }, { figures: [tall] });
    const { y, margin } = head();
    expect(y).toBeGreaterThanOrEqual(margin - 1e-6);
  });

  it('off: the cabinet view keeps the crop, as before', () => {
    scene({ view: 'cabinet', pattern: IKEA_DETOLF.id, freeCamera: false }, { figures: [tall], frameFallback: { width: 870, height: 475 } });
    const { y, margin } = head();
    expect(y).toBeLessThan(margin - 1);
  });
});

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, screen, cleanup, act } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene } from '../CabinetScene';
import { DEFAULT_CASE_PREFS, type CasePrefs } from '../casePrefs';
import { __clearAlphaMarginCache } from '../alphaMargin';
import { LOOK_HOLD_MS, PITCH, yawLimits } from '../casePose';
import { coneOf } from '../useFreeCamera';
import { wallLayout } from '../packCabinets';
import { IKEA_KLINGSBO } from '../cabinetPresets';

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

  it('after a look in the cabinet view, Next goes on from the cabinet the frame centre shows, at its framing', () => {
    scene({ view: 'cabinet' });
    expect(host().dataset.focus).toBe('0');
    drag({ x: 300, y: 200 }, { x: 60, y: 200 }, { button: 2 });
    tick(500);
    const looked = Number(host().dataset.focus);
    expect(looked).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Next cabinet' }));
    tick();
    expect(Number(host().dataset.focus)).toBe(looked + 1);
    expect(cam().yaw).toBe(0);
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

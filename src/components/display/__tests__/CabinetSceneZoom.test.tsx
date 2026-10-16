import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, screen, cleanup, act } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene, ZOOM_SETTLE_MS } from '../CabinetScene';
import { DEFAULT_CASE_PREFS, type CasePrefs } from '../casePrefs';
import { getFixtureFigures } from '../../../dev-fixtures/fixtures';
import { __clearAlphaMarginCache } from '../alphaMargin';
import { ZOOM_MAX, ZOOM_UNDER, toScreen, type Zoom } from '../caseZoom';

// PINCH-1 (Ross 10-16): a photo-style pinch zoom toward the pinch point, a one-finger pan while zoomed that never
// walks, and quick ways back to 1x. jsdom has no layout, so the frame's top-left is the client origin (its
// bounding box is all zeros) and a client point is a frame point.

const FRAME = { width: 443, height: 454 };
const prefs = (patch: Partial<CasePrefs> = {}): CasePrefs => ({ ...DEFAULT_CASE_PREFS, ...patch });
const realMatchMedia = window.matchMedia;

beforeEach(() => {
  __clearAlphaMarginCache();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.matchMedia = realMatchMedia;
});

function scene(figures: Figure[], patch: Partial<CasePrefs> = {}, extra: Partial<Parameters<typeof CabinetScene>[0]> = {}) {
  const onSelect = vi.fn();
  const props = { figures, onSelect, prefs: prefs(patch), frameFallback: FRAME, ...extra };
  const utils = render(<CabinetScene {...props} />);
  const host = utils.container.querySelector('.cabinet-scene') as HTMLElement;
  const layer = host.querySelector('.cabinet-scene__zoom') as HTMLElement;
  const again = (next: Partial<Parameters<typeof CabinetScene>[0]>) => utils.rerender(<CabinetScene {...props} {...next} />);
  return { ...utils, onSelect, host, layer, again };
}

const zoomOf = (host: HTMLElement): Zoom => JSON.parse(host.dataset.zoom!) as Zoom;
const figureButtons = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLButtonElement>('button.cab-figure'));
const chip = () => screen.queryByRole('button', { name: 'Reset view' });
/** What the camera, the walk and the pan are: none of it may change while zoomed. */
const still = (host: HTMLElement) => ({ camera: host.dataset.camera, focus: host.dataset.focus, pan: host.dataset.pan, panY: host.dataset.panY });

type P = { x: number; y: number };
const down = (el: Element, id: number, p: P) => fireEvent.pointerDown(el, { pointerId: id, clientX: p.x, clientY: p.y, button: 0 });
const move = (el: Element, id: number, p: P) => fireEvent.pointerMove(el, { pointerId: id, clientX: p.x, clientY: p.y });
const up = (el: Element, id: number, p: P) => fireEvent.pointerUp(el, { pointerId: id, clientX: p.x, clientY: p.y });

/** Two fingers down at a0 and b0, moved in two steps to a1 and b1, and lifted unless `lift` is false. */
function pinch(el: Element, a0: P, b0: P, a1: P, b1: P, lift = true) {
  down(el, 11, a0);
  down(el, 12, b0);
  for (const t of [0.5, 1]) {
    move(el, 11, { x: a0.x + (a1.x - a0.x) * t, y: a0.y + (a1.y - a0.y) * t });
    move(el, 12, { x: b0.x + (b1.x - b0.x) * t, y: b0.y + (b1.y - b0.y) * t });
  }
  if (!lift) return;
  up(el, 11, a1);
  up(el, 12, b1);
}

/** Zoom 2x about (220, 260). */
const zoomIn = (el: Element) => pinch(el, { x: 180, y: 260 }, { x: 260, y: 260 }, { x: 140, y: 260 }, { x: 300, y: 260 });

/** One finger's drag by (dx, dy) from (200, 200). */
function drag(el: Element, dx: number, dy = 0) {
  down(el, 1, { x: 200, y: 200 });
  move(el, 1, { x: 200 + dx / 2, y: 200 + dy / 2 });
  move(el, 1, { x: 200 + dx, y: 200 + dy });
  up(el, 1, { x: 200 + dx, y: 200 + dy });
}

/** A finger's tap on `el` at p: down, up and the click the browser makes of them. */
function tap(el: Element, p: P = { x: 120, y: 90 }) {
  down(el, 3, p);
  up(el, 3, p);
  fireEvent.click(el);
}

function reducedMotion() {
  window.matchMedia = ((query: string) => ({ ...realMatchMedia(query), matches: query.includes('prefers-reduced-motion: reduce') })) as typeof window.matchMedia;
}

describe('CabinetScene: pinch zoom (PINCH-1)', () => {
  it('starts at 1x: no transform on the zoom layer and no Reset view chip', () => {
    const { host, layer } = scene(getFixtureFigures(8));
    expect(zoomOf(host)).toEqual({ k: 1, x: 0, y: 0 });
    expect(layer.style.transform).toBe('');
    expect(chip()).toBeNull();
  });

  it('a two-finger pinch zooms toward the midpoint between the fingers, as one transform on the zoom layer; the camera, the walk and the pan stay', () => {
    const { host, layer } = scene(getFixtureFigures(8), { swipe: 'camera', view: 'cabinet' });
    const before = still(host);
    zoomIn(host);
    const z = zoomOf(host);
    expect(z.k).toBeCloseTo(2, 6);
    const under = toScreen(z, { x: 220, y: 260 });
    expect(under.x).toBeCloseTo(220, 6);
    expect(under.y).toBeCloseTo(260, 6);
    expect(layer.style.transform).toBe('translate(-220px, -260px) scale(2)');
    expect(still(host)).toEqual(before);
    expect(chip()).not.toBeNull();
  });

  it('while the fingers move the layer is promoted for the gesture (will-change); let go, it is not, so it rasters sharp at its zoom', () => {
    const { host, layer } = scene(getFixtureFigures(8));
    pinch(host, { x: 180, y: 260 }, { x: 260, y: 260 }, { x: 140, y: 260 }, { x: 300, y: 260 }, false);
    expect(layer.classList.contains('cabinet-scene__zoom--live')).toBe(true);
    up(host, 11, { x: 140, y: 260 });
    up(host, 12, { x: 300, y: 260 });
    expect(layer.classList.contains('cabinet-scene__zoom--live')).toBe(false);
  });

  it(`stops at ${ZOOM_MAX}x however far the fingers spread`, () => {
    const { host } = scene(getFixtureFigures(8));
    pinch(host, { x: 210, y: 250 }, { x: 230, y: 250 }, { x: 10, y: 250 }, { x: 430, y: 250 });
    expect(zoomOf(host).k).toBe(ZOOM_MAX);
  });

  it(`a pinch under 1x shrinks no further than ${ZOOM_UNDER}x while the fingers are down, and settles back at exactly 1x, animated`, () => {
    const { host, layer } = scene(getFixtureFigures(8));
    pinch(host, { x: 20, y: 250 }, { x: 420, y: 250 }, { x: 200, y: 250 }, { x: 240, y: 250 }, false);
    expect(zoomOf(host).k).toBe(ZOOM_UNDER);
    up(host, 11, { x: 200, y: 250 });
    up(host, 12, { x: 240, y: 250 });
    expect(zoomOf(host)).toEqual({ k: 1, x: 0, y: 0 });
    expect(layer.style.transform).toBe('');
    expect(layer.classList.contains('cabinet-scene__zoom--settling')).toBe(true);
    expect(chip()).toBeNull();
  });

  it('a second finger landing mid-swipe stops the walk where it started: a two-finger gesture never walks', () => {
    const { host, onSelect } = scene(getFixtureFigures(8), { swipe: 'camera', view: 'cabinet' });
    const before = still(host);
    down(host, 11, { x: 300, y: 200 });
    move(host, 11, { x: 240, y: 200 });
    expect(host.dataset.camera).not.toBe(before.camera);
    down(host, 12, { x: 340, y: 200 });
    expect(still(host)).toEqual(before);
    move(host, 11, { x: 200, y: 200 });
    move(host, 12, { x: 360, y: 200 });
    up(host, 12, { x: 360, y: 200 });
    // the finger left behind at a pinch's end pans if zoomed, never walks
    move(host, 11, { x: 60, y: 200 });
    up(host, 11, { x: 60, y: 200 });
    expect(still(host)).toEqual(before);
    fireEvent.click(figureButtons(host)[0]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('a pinch that ends back at 1x leaves its last finger unable to walk', () => {
    const { host } = scene(getFixtureFigures(8), { swipe: 'camera', view: 'cabinet' });
    const before = still(host);
    pinch(host, { x: 180, y: 260 }, { x: 260, y: 260 }, { x: 200, y: 260 }, { x: 240, y: 260 }, false);
    up(host, 12, { x: 240, y: 260 });
    expect(zoomOf(host).k).toBe(1);
    move(host, 11, { x: 20, y: 260 });
    up(host, 11, { x: 20, y: 260 });
    expect(still(host)).toEqual(before);
    expect(zoomOf(host)).toEqual({ k: 1, x: 0, y: 0 });
  });

  it('a third finger neither steers nor ends the pinch', () => {
    const { host } = scene(getFixtureFigures(8));
    pinch(host, { x: 180, y: 260 }, { x: 260, y: 260 }, { x: 140, y: 260 }, { x: 300, y: 260 }, false);
    const z = zoomOf(host);
    down(host, 13, { x: 50, y: 50 });
    move(host, 13, { x: 400, y: 400 });
    up(host, 13, { x: 400, y: 400 });
    expect(zoomOf(host)).toEqual(z);
    move(host, 11, { x: 100, y: 260 });
    move(host, 12, { x: 340, y: 260 });
    expect(zoomOf(host).k).toBeCloseTo(3, 6);
  });

  it('a cancelled pinch settles where it is', () => {
    const { host } = scene(getFixtureFigures(8));
    pinch(host, { x: 180, y: 260 }, { x: 260, y: 260 }, { x: 140, y: 260 }, { x: 300, y: 260 }, false);
    fireEvent.pointerCancel(host, { pointerId: 11, clientX: 140, clientY: 260 });
    fireEvent.pointerCancel(host, { pointerId: 12, clientX: 300, clientY: 260 });
    expect(zoomOf(host).k).toBeCloseTo(2, 6);
  });
});

describe('CabinetScene: panning while zoomed (PINCH-1)', () => {
  for (const swipe of ['camera', 'pan'] as const) {
    it(`${swipe} mode: zoomed, one finger pans the magnified picture; it never walks the wall, changes cabinets, lifts or slides the photo`, () => {
      const { host, onSelect } = scene(getFixtureFigures(60), { swipe, view: 'wall' });
      zoomIn(host);
      const z0 = zoomOf(host);
      const before = still(host);
      drag(host, -150);
      expect(zoomOf(host)).toEqual({ ...z0, x: z0.x - 150 });
      drag(host, 0, 120);
      expect(zoomOf(host)).toEqual({ ...z0, x: z0.x - 150, y: z0.y + 120 });
      // a long drag stops at the picture's edge, still without a walk
      for (let i = 0; i < 4; i++) drag(host, -400);
      expect(zoomOf(host).x).toBeCloseTo(-FRAME.width, 6);
      expect(still(host)).toEqual(before);
      // the click a pan leaves opens nothing
      fireEvent.click(figureButtons(host)[0]);
      expect(onSelect).not.toHaveBeenCalled();
    });
  }

  it('at 1x the swipe walks as before', () => {
    const { host } = scene(getFixtureFigures(8), { swipe: 'camera', view: 'cabinet' });
    const x0 = Number(host.dataset.cameraX);
    drag(host, -150);
    expect(Number(host.dataset.cameraX)).toBeGreaterThan(x0);
    expect(zoomOf(host)).toEqual({ k: 1, x: 0, y: 0 });
  });

  it('zoomed, a tap on a figure still opens that figure', () => {
    const many = getFixtureFigures(8);
    const { host, onSelect } = scene(many);
    zoomIn(host);
    const button = figureButtons(host)[2];
    tap(button);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]._id).toBe(button.dataset.figureId);
    expect(zoomOf(host).k).toBeCloseTo(2, 6);
  });
});

describe('CabinetScene: the quick way back to 1x (PINCH-1)', () => {
  it('a double-tap on an empty spot returns to 1x with a short animation', () => {
    const { host, layer } = scene(getFixtureFigures(8));
    zoomIn(host);
    tap(host);
    tap(host);
    expect(zoomOf(host)).toEqual({ k: 1, x: 0, y: 0 });
    expect(layer.style.transform).toBe('');
    expect(layer.classList.contains('cabinet-scene__zoom--settling')).toBe(true);
    expect(chip()).toBeNull();
  });

  it(`the animation ends after ${ZOOM_SETTLE_MS} ms, and a new gesture cuts it short`, () => {
    vi.useFakeTimers();
    const { host, layer } = scene(getFixtureFigures(8));
    zoomIn(host);
    tap(host);
    tap(host);
    expect(layer.classList.contains('cabinet-scene__zoom--settling')).toBe(true);
    act(() => {
      vi.advanceTimersByTime(ZOOM_SETTLE_MS + 50);
    });
    expect(layer.classList.contains('cabinet-scene__zoom--settling')).toBe(false);
    tap(host);
    tap(host);
    expect(layer.classList.contains('cabinet-scene__zoom--settling')).toBe(true);
    down(host, 11, { x: 100, y: 100 });
    expect(layer.classList.contains('cabinet-scene__zoom--settling')).toBe(false);
  });

  it('a double-tap at 1x zooms 2x at the tapped point (no double-tap was handled in the case before)', () => {
    const { host } = scene(getFixtureFigures(8));
    tap(host, { x: 300, y: 120 });
    tap(host, { x: 304, y: 118 });
    const z = zoomOf(host);
    expect(z.k).toBe(2);
    const under = toScreen(z, { x: 304, y: 118 });
    expect(under.x).toBeCloseTo(304, 6);
    expect(under.y).toBeCloseTo(118, 6);
    expect(chip()).not.toBeNull();
  });

  it('two taps on a figure open it, never zoom; taps apart in time or place are not a double-tap', () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    const { host, onSelect } = scene(getFixtureFigures(8));
    const button = figureButtons(host)[1];
    tap(button);
    tap(button);
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(zoomOf(host).k).toBe(1);
    tap(host, { x: 100, y: 100 });
    now.mockReturnValue(1_400);
    tap(host, { x: 100, y: 100 });
    expect(zoomOf(host).k).toBe(1);
    now.mockReturnValue(1_500);
    tap(host, { x: 300, y: 300 });
    expect(zoomOf(host).k).toBe(1);
    // a tap on a figure between two on the room is no double-tap either
    now.mockReturnValue(1_600);
    tap(button);
    now.mockReturnValue(1_700);
    tap(host, { x: 300, y: 300 });
    expect(zoomOf(host).k).toBe(1);
  });

  it('a drag between two taps is no double-tap', () => {
    const { host } = scene(getFixtureFigures(8), { swipe: 'pan' });
    tap(host, { x: 200, y: 200 });
    drag(host, -60);
    tap(host, { x: 200, y: 200 });
    expect(zoomOf(host).k).toBe(1);
  });

  it('the Reset view chip shows while zoomed and returns to 1x, animated', () => {
    const { host, layer } = scene(getFixtureFigures(8));
    zoomIn(host);
    const reset = chip()!;
    expect(reset.className).toContain('cabinet-scene__reset');
    tap(reset);
    expect(zoomOf(host)).toEqual({ k: 1, x: 0, y: 0 });
    expect(layer.classList.contains('cabinet-scene__zoom--settling')).toBe(true);
    expect(chip()).toBeNull();
  });

  it('reduced motion: the double-tap and the chip return to 1x at once, with no animation', () => {
    reducedMotion();
    const { host, layer } = scene(getFixtureFigures(8));
    zoomIn(host);
    tap(chip()!);
    expect(zoomOf(host)).toEqual({ k: 1, x: 0, y: 0 });
    expect(layer.classList.contains('cabinet-scene__zoom--settling')).toBe(false);
    zoomIn(host);
    tap(host);
    tap(host);
    expect(zoomOf(host).k).toBe(1);
    expect(layer.classList.contains('cabinet-scene__zoom--settling')).toBe(false);
  });

  for (const [what, next] of [
    ['view', { view: 'shelf' }],
    ['wall', { pattern: 'ikea-detolf' }],
    ['swipe mode', { swipe: 'pan' }],
  ] as const) {
    it(`switching the ${what} starts the picture at 1x, at once`, () => {
      const { host, layer, again } = scene(getFixtureFigures(8), { swipe: 'camera' });
      zoomIn(host);
      again({ prefs: prefs({ swipe: 'camera', ...next }) });
      expect(zoomOf(host)).toEqual({ k: 1, x: 0, y: 0 });
      expect(layer.style.transform).toBe('');
      expect(layer.classList.contains('cabinet-scene__zoom--settling')).toBe(false);
      expect(chip()).toBeNull();
    });
  }

  it('switching the filter starts the picture at 1x; the same filter with new figure data (an image landing) keeps the zoom', () => {
    const figures = getFixtureFigures(8);
    const { host, again } = scene(figures, {}, { filterKey: 'owned' });
    zoomIn(host);
    again({ figures: figures.map((f) => ({ ...f })), filterKey: 'owned' });
    expect(zoomOf(host).k).toBeCloseTo(2, 6);
    again({ figures: figures.slice(0, 5), filterKey: 'owned+wished' });
    expect(zoomOf(host)).toEqual({ k: 1, x: 0, y: 0 });
    expect(chip()).toBeNull();
  });

  it('a new frame size (folding or turning the phone) starts the picture at 1x', () => {
    const { host } = scene(getFixtureFigures(8));
    zoomIn(host);
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 870 });
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 420 });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(zoomOf(host)).toEqual({ k: 1, x: 0, y: 0 });
  });
});

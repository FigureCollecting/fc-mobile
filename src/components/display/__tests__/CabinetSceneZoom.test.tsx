import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, screen, cleanup, act } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene, ZOOM_SETTLE_MS } from '../CabinetScene';
import type { CasePrefs } from '../casePrefs';
import { LEGACY_PREFS } from '../../../test/legacyPrefs';
import { getFixtureFigures } from '../../../dev-fixtures/fixtures';
import { __clearAlphaMarginCache } from '../alphaMargin';
import { ZOOM_MAX, ZOOM_UNDER, toScreen, type Zoom } from '../caseZoom';

// PINCH-1 (Ross 10-16): a photo-style pinch zoom toward the pinch point, a one-finger pan while zoomed that never
// walks, and quick ways back to 1x. jsdom has no layout, so the frame's top-left is the client origin (its
// bounding box is all zeros) and a client point is a frame point.

/** Every render of the scene works out its figures' px per mm (figureScales) once: a count of its renders. */
const renders = vi.hoisted(() => vi.fn());
vi.mock('../caseCull', async (importOriginal) => {
  const real = await importOriginal<typeof import('../caseCull')>();
  return {
    ...real,
    figureScales: (...args: Parameters<typeof real.figureScales>) => {
      renders();
      return real.figureScales(...args);
    },
  };
});

const FRAME = { width: 443, height: 454 };
const prefs = (patch: Partial<CasePrefs> = {}): CasePrefs => ({ ...LEGACY_PREFS, ...patch });
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

describe('CabinetScene: sharp at the zoom once it settles (PINCH-1)', () => {
  /** The px per mm each figure's layer is drawn at (its --s), and the scene's. */
  const layerScales = (host: HTMLElement) => figureButtons(host).map((b) => Number(b.style.getPropertyValue('--s')));
  const sceneScale = (host: HTMLElement) => Number(host.dataset.pxPerMm);

  it('let go, the figures in the zoomed view are drawn at the zoom times the scene\'s px per mm; never while the fingers move; at 1x again, at the scene\'s once the way back has animated', () => {
    vi.useFakeTimers();
    const { host } = scene(getFixtureFigures(8));
    const s = sceneScale(host);
    expect(Math.max(...layerScales(host))).toBe(s);
    pinch(host, { x: 180, y: 260 }, { x: 260, y: 260 }, { x: 140, y: 260 }, { x: 300, y: 260 }, false);
    // the fingers still down: the layers as they were, only the zoom layer's transform moves
    expect(Math.max(...layerScales(host))).toBe(s);
    up(host, 11, { x: 140, y: 260 });
    up(host, 12, { x: 300, y: 260 });
    expect(Math.max(...layerScales(host))).toBeCloseTo(2 * s, 9);
    // the way back animates on the zoom layer alone: the scene is redrawn at 1x once it ends
    tap(chip()!);
    expect(chip()).toBeNull();
    expect(Math.max(...layerScales(host))).toBeCloseTo(2 * s, 9);
    act(() => {
      vi.advanceTimersByTime(ZOOM_SETTLE_MS);
    });
    expect(Math.max(...layerScales(host))).toBe(s);
  });

  it('a touch cutting the way back short redraws the scene at 1x at once', () => {
    vi.useFakeTimers();
    const { host } = scene(getFixtureFigures(8));
    const s = sceneScale(host);
    zoomIn(host);
    tap(chip()!);
    expect(Math.max(...layerScales(host))).toBeCloseTo(2 * s, 9);
    down(host, 1, { x: 100, y: 100 });
    expect(Math.max(...layerScales(host))).toBe(s);
    up(host, 1, { x: 100, y: 100 });
    act(() => {
      vi.advanceTimersByTime(ZOOM_SETTLE_MS);
    });
    expect(Math.max(...layerScales(host))).toBe(s);
  });

  it('a pinch, the chip it shows and the chip going render nothing of the scene: only the gesture\'s end redraws it', () => {
    vi.useFakeTimers();
    const { host } = scene(getFixtureFigures(8));
    // the scene works out its figures' px per mm once per render
    renders.mockClear();
    pinch(host, { x: 180, y: 260 }, { x: 260, y: 260 }, { x: 140, y: 260 }, { x: 300, y: 260 }, false);
    expect(chip()).not.toBeNull();
    expect(renders).not.toHaveBeenCalled();
    up(host, 11, { x: 140, y: 260 });
    up(host, 12, { x: 300, y: 260 });
    expect(renders).toHaveBeenCalledTimes(1);
    renders.mockClear();
    tap(chip()!);
    expect(chip()).toBeNull();
    expect(renders).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(ZOOM_SETTLE_MS);
    });
    expect(renders).toHaveBeenCalledTimes(1);
  });

  it('where the budget binds (4x), a pan while zoomed redraws them about the middle of the view it lets go at', () => {
    const { host } = scene(getFixtureFigures(60), { view: 'wall' });
    const s = sceneScale(host);
    pinch(host, { x: 210, y: 260 }, { x: 230, y: 260 }, { x: 180, y: 260 }, { x: 260, y: 260 });
    expect(zoomOf(host).k).toBeCloseTo(4, 6);
    const before = layerScales(host);
    expect(Math.max(...before)).toBeCloseTo(4 * s, 9);
    expect(Math.min(...before)).toBeLessThan(4 * s);
    drag(host, -300);
    const after = layerScales(host);
    expect(after).not.toEqual(before);
    expect(Math.max(...after)).toBeCloseTo(4 * s, 9);
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

  // CASE-FB3a item 1 (Ross 10-17, his Fold8 open: the rack's wall, boards and figures gone after returning from zoom):
  // a CSS transition on the zoom layer made the compositor raster every layer under it at the zoom's scale (3 to 5x
  // the tiles for seconds: e2e/case-zoom-return), so the animation is frames of the layer's transform, as the fingers'
  // moves are
  const scaleOf = (transform: string): number => Number(/scale\(([\d.]+)\)/.exec(transform)?.[1] ?? 1);

  it('the way back eases the zoom layer by frames from the picture it left, to 1x, never by a CSS transition', () => {
    vi.useFakeTimers();
    const { host, layer } = scene(getFixtureFigures(8));
    zoomIn(host);
    tap(chip()!);
    // the scene's state is the target at once; the layer is still where the picture was
    expect(zoomOf(host)).toEqual({ k: 1, x: 0, y: 0 });
    expect(layer.style.transform).toBe('translate(-220px, -260px) scale(2)');
    const ks: number[] = [];
    for (let i = 0; i < 4; i++) {
      act(() => {
        vi.advanceTimersByTime(ZOOM_SETTLE_MS / 5);
      });
      ks.push(scaleOf(layer.style.transform));
    }
    // each frame nearer 1x than the last, in between
    expect(ks.every((k) => k > 1 && k < 2)).toBe(true);
    expect([...ks].sort((a, b) => b - a)).toEqual(ks);
    expect(new Set(ks).size).toBe(ks.length);
    act(() => {
      vi.advanceTimersByTime(ZOOM_SETTLE_MS);
    });
    expect(layer.style.transform).toBe('');
    // and the case's own style gives the layer no transition to animate by
    const css = Array.from(document.querySelectorAll('style'), (el) => el.textContent ?? '').join('\n');
    expect(css).toMatch(/\.cabinet-scene__zoom\b/);
    expect(css).not.toMatch(/\.cabinet-scene__zoom[^{]*\{[^}]*transition/);
  });

  it('a double-tap in glides from 1x to the zoom, ending exactly there', () => {
    vi.useFakeTimers();
    const { host, layer } = scene(getFixtureFigures(8));
    tap(host);
    tap(host);
    expect(zoomOf(host).k).toBe(2);
    expect(layer.style.transform).toBe('');
    act(() => {
      vi.advanceTimersByTime(ZOOM_SETTLE_MS / 2);
    });
    expect(scaleOf(layer.style.transform)).toBeGreaterThan(1);
    expect(scaleOf(layer.style.transform)).toBeLessThan(2);
    act(() => {
      vi.advanceTimersByTime(ZOOM_SETTLE_MS);
    });
    expect(layer.style.transform).toBe(`translate(${zoomOf(host).x}px, ${zoomOf(host).y}px) scale(2)`);
  });

  it('a touch cutting a glide short puts the layer on the zoom it settles at at once, and no frame moves it after', () => {
    vi.useFakeTimers();
    const { host, layer } = scene(getFixtureFigures(8));
    zoomIn(host);
    tap(chip()!);
    act(() => {
      vi.advanceTimersByTime(ZOOM_SETTLE_MS / 4);
    });
    expect(layer.style.transform).not.toBe('');
    down(host, 1, { x: 100, y: 100 });
    expect(layer.style.transform).toBe('');
    act(() => {
      vi.advanceTimersByTime(ZOOM_SETTLE_MS * 2);
    });
    expect(layer.style.transform).toBe('');
  });

  it('a pinch beginning mid-glide takes the layer from where the fingers find it, not from the glide\'s start', () => {
    vi.useFakeTimers();
    const { host, layer } = scene(getFixtureFigures(8));
    zoomIn(host);
    tap(chip()!);
    act(() => {
      vi.advanceTimersByTime(ZOOM_SETTLE_MS / 2);
    });
    down(host, 11, { x: 180, y: 260 });
    down(host, 12, { x: 260, y: 260 });
    move(host, 11, { x: 140, y: 260 });
    move(host, 12, { x: 300, y: 260 });
    expect(layer.classList.contains('cabinet-scene__zoom--settling')).toBe(false);
    const held = layer.style.transform;
    act(() => {
      vi.advanceTimersByTime(ZOOM_SETTLE_MS * 2);
    });
    // no glide frame writes over the fingers' picture
    expect(layer.style.transform).toBe(held);
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

  it('the click a double-tap leaves never opens the figure that comes under the finger as the picture returns to 1x', () => {
    // CASE-FB2b (found by the stack e2e): with reduced motion the picture is at 1x before the browser makes the second
    // tap's click, which then lands on whatever figure now stands under the finger
    reducedMotion();
    const { host, onSelect } = scene(getFixtureFigures(8));
    zoomIn(host);
    tap(host);
    down(host, 3, { x: 120, y: 90 });
    up(host, 3, { x: 120, y: 90 });
    expect(zoomOf(host).k).toBe(1);
    fireEvent.click(figureButtons(host)[0]);
    expect(onSelect).not.toHaveBeenCalled();
    // the next tap on a figure opens it
    tap(figureButtons(host)[0]);
    expect(onSelect).toHaveBeenCalledTimes(1);
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

  // PAN-KEEP-1: the swipe mode is not a new picture (the camera stays across it): the zoom stays too, in the wall and cabinet
  // views; in the shelf view a mode still starts from the frame at 1x (TOP1)
  for (const [what, base, next] of [
    ['view', {}, { view: 'shelf' }],
    ['wall', {}, { pattern: 'ikea-detolf' }],
    ['swipe mode in the shelf view', { view: 'shelf' }, { swipe: 'pan' }],
    // PACK1: a new arrangement of the case, as a new sort
    ['arrangement', {}, { arrange: 'name' }],
  ] as const) {
    it(`switching the ${what} starts the picture at 1x, at once`, () => {
      const { host, layer, again } = scene(getFixtureFigures(8), { swipe: 'camera', ...base });
      zoomIn(host);
      again({ prefs: prefs({ swipe: 'camera', ...base, ...next }) });
      expect(zoomOf(host)).toEqual({ k: 1, x: 0, y: 0 });
      expect(layer.style.transform).toBe('');
      expect(layer.classList.contains('cabinet-scene__zoom--settling')).toBe(false);
      expect(chip()).toBeNull();
    });
  }

  for (const view of ['wall', 'cabinet'] as const) {
    it(`switching the swipe mode keeps the zoom in the ${view} view`, () => {
      const { host, again } = scene(getFixtureFigures(8), { swipe: 'camera', view });
      zoomIn(host);
      const zoomed = zoomOf(host);
      expect(zoomed.k).toBeCloseTo(2, 6);
      again({ prefs: prefs({ swipe: 'pan', view }) });
      expect(zoomOf(host)).toEqual(zoomed);
      expect(chip()).not.toBeNull();
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

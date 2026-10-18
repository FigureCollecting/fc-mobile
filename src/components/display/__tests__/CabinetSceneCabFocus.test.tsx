import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene, NEIGHBOUR_DIM } from '../CabinetScene';
import { DEFAULT_CASE_PREFS, type CasePrefs } from '../casePrefs';
import { project } from '../caseCamera';
import { getFixtureFigures } from '../../../dev-fixtures/fixtures';
import { __clearAlphaMarginCache } from '../alphaMargin';

// CAB-FOCUS-1 (Ross 10-18): the one-cabinet view's arrows snap to the straight-on view that fits the whole focus cabinet
// (a drag or a pinch then moves the picture as the swipe mode says, and never snaps), and the cabinets either side of
// it are dimmed: one named strength, only in this view, never over the focus cabinet, never in the way of a tap.

beforeEach(() => __clearAlphaMarginCache());
afterEach(() => cleanup());

const COVER = { width: 443, height: 558 };
const OPEN = { width: 870, height: 475 };
const prefs = (patch: Partial<CasePrefs> = {}): CasePrefs => ({ ...DEFAULT_CASE_PREFS, ...patch });

function scene(figures: Figure[], patch: Partial<CasePrefs> = {}, frame = COVER) {
  const onSelect = vi.fn();
  const { container } = render(<CabinetScene figures={figures} onSelect={onSelect} prefs={prefs(patch)} frameFallback={frame} />);
  return { host: container.querySelector('.cabinet-scene') as HTMLElement, onSelect };
}

const MANY = getFixtureFigures(40);
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const cameraOf = (host: HTMLElement) => {
  const c = JSON.parse(host.dataset.camera!) as { x: number; y: number; z: number; pitch: number; focalPx: number; width: number; height: number };
  return { ...c, frame: { width: c.width, height: c.height } };
};
const zoomK = (host: HTMLElement) => (JSON.parse(host.dataset.zoom!) as { k: number }).k;

type P = { x: number; y: number };
const down = (el: Element, id: number, p: P) => fireEvent.pointerDown(el, { pointerId: id, clientX: p.x, clientY: p.y, button: 0 });
const move = (el: Element, id: number, p: P) => fireEvent.pointerMove(el, { pointerId: id, clientX: p.x, clientY: p.y });
const up = (el: Element, id: number, p: P) => fireEvent.pointerUp(el, { pointerId: id, clientX: p.x, clientY: p.y });
function drag(el: Element, dx: number, dy = 0) {
  down(el, 1, { x: 200, y: 200 });
  move(el, 1, { x: 200 + dx / 2, y: 200 + dy / 2 });
  move(el, 1, { x: 200 + dx, y: 200 + dy });
  up(el, 1, { x: 200 + dx, y: 200 + dy });
}
function pinchOut(el: Element) {
  down(el, 11, { x: 180, y: 260 });
  down(el, 12, { x: 260, y: 260 });
  for (const t of [0.5, 1]) {
    move(el, 11, { x: 180 - 40 * t, y: 260 });
    move(el, 12, { x: 260 + 40 * t, y: 260 });
  }
  up(el, 11, { x: 140, y: 260 });
  up(el, 12, { x: 300, y: 260 });
}
function tapButton(name: string) {
  const b = button(name);
  down(b, 5, { x: 10, y: 10 });
  up(b, 5, { x: 10, y: 10 });
  fireEvent.click(b);
}
const next = (times = 1) => {
  for (let i = 0; i < times; i++) tapButton('Next cabinet');
};

describe('CAB-FOCUS-1 (1): an arrow press snaps to the straight-on fit of the whole focus cabinet; a gesture never does', () => {
  for (const [name, frame] of [['cover', COVER], ['open', OPEN]] as const) {
    it(`${name}: Next cabinet puts the camera straight on (no tilt) at the next cabinet`, () => {
      const { host } = scene(MANY, { view: 'cabinet', swipe: 'camera' }, frame);
      const first = cameraOf(host);
      expect(first.pitch).toBe(0);
      next();
      const snapped = cameraOf(host);
      expect(snapped.pitch).toBe(0);
      expect(snapped.x).toBeGreaterThan(first.x);
      expect(host.dataset.focus).toBe('1');
    });
  }

  it('Next cabinet after a lift (camera mode) and a pinch: the lift and the zoom are gone, as a fresh Next frames it', () => {
    // a fresh Next
    const fresh = scene(MANY, { view: 'cabinet', swipe: 'camera' }).host;
    next();
    const want = cameraOf(fresh);
    cleanup();
    // a lift and a pinch first
    const { host } = scene(MANY, { view: 'cabinet', swipe: 'camera' });
    drag(host, 0, -150);
    pinchOut(host);
    expect(zoomK(host)).toBeGreaterThan(1.5);
    expect(cameraOf(host).y).not.toBeCloseTo(want.y, 0);
    next();
    expect(zoomK(host)).toBe(1);
    expect(cameraOf(host)).toEqual(want);
  });

  it('Next cabinet after a slide of the photo (pan mode): the slide is gone', () => {
    const { host } = scene(MANY, { view: 'cabinet', swipe: 'pan' });
    drag(host, -90);
    expect(host.dataset.pan).toBe('-90');
    next();
    expect(host.dataset.pan).toBe('0');
  });

  it('Prev cabinet snaps the same way', () => {
    const { host } = scene(MANY, { view: 'cabinet', swipe: 'camera' });
    next(3);
    const there = cameraOf(host);
    drag(host, 0, -150);
    pinchOut(host);
    tapButton('Previous cabinet');
    expect(zoomK(host)).toBe(1);
    expect(cameraOf(host).pitch).toBe(0);
    expect(cameraOf(host).x).toBeLessThan(there.x);
    expect(host.dataset.focus).toBe('2');
  });

  it('a camera-mode walk that carries the focus to a neighbour moves the camera along the wall only: its distance, height and frame stay, nothing re-fits under the finger', () => {
    const { host } = scene(MANY, { view: 'cabinet', swipe: 'camera' });
    const before = cameraOf(host);
    drag(host, -400);
    expect(Number(host.dataset.focus)).toBeGreaterThan(0);
    const after = cameraOf(host);
    expect(after.x).toBeGreaterThan(before.x);
    expect({ y: after.y, z: after.z, pitch: after.pitch, w: after.width, h: after.height }).toEqual({ y: before.y, z: before.z, pitch: before.pitch, w: before.width, h: before.height });
  });

  it('after such a walk the arrows go on from the focus the walk reached, and frame it by its own size', () => {
    const { host } = scene(MANY, { view: 'cabinet', swipe: 'camera' });
    drag(host, -400);
    const k = Number(host.dataset.focus);
    expect(k).toBeGreaterThan(0);
    next();
    expect(host.dataset.focus).toBe(String(k + 1));
    const got = cameraOf(host);
    cleanup();
    const fresh = scene(MANY, { view: 'cabinet', swipe: 'camera' }).host;
    next(k + 1);
    expect(cameraOf(fresh)).toEqual(got);
  });

  it('the wall view\'s arrows do not snap (its one camera is the wall\'s): a lift survives Next', () => {
    const { host } = scene(MANY, { view: 'wall', swipe: 'camera' });
    drag(host, 0, -150);
    const lifted = cameraOf(host).y;
    next();
    expect(cameraOf(host).y).toBeCloseTo(lifted, 6);
  });
});

describe('CAB-FOCUS-1 (2): the cabinets either side of the focus are dimmed in the one-cabinet view, and only there', () => {
  const veils = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('.cabinet-scene__dim'));
  const sides = (host: HTMLElement) => veils(host).map((v) => v.dataset.side).sort();
  const wallOf = (host: HTMLElement) => JSON.parse(host.dataset.wall!) as [number, number, number, number, number][];

  it('the strength is one named constant, light to moderate: 35 to 45 % dark', () => {
    expect(NEIGHBOUR_DIM).toBeGreaterThanOrEqual(0.35);
    expect(NEIGHBOUR_DIM).toBeLessThanOrEqual(0.45);
    const { host } = scene(MANY, { view: 'cabinet' });
    next();
    for (const v of veils(host)) expect(v.style.backgroundColor).toBe(`rgba(0, 0, 0, ${NEIGHBOUR_DIM})`);
  });

  it('a neighbour on each side gets one: none on the side where the wall ends', () => {
    const { host } = scene(MANY, { view: 'cabinet' });
    const last = wallOf(host).length - 1;
    expect(last).toBeGreaterThan(2);
    expect(sides(host)).toEqual(['right']);
    next();
    expect(sides(host)).toEqual(['left', 'right']);
    next(last - 1);
    expect(host.dataset.focus).toBe(String(last));
    expect(sides(host)).toEqual(['left']);
  });

  it('none in the wall view, none in the shelf view', () => {
    for (const view of ['wall', 'shelf'] as const) {
      const { host } = scene(MANY, { view });
      next();
      expect(veils(host), view).toHaveLength(0);
      cleanup();
    }
  });

  it('it ends at the focus cabinet\'s silhouette: its edges are where the box\'s corners cross the frame, so the focus cabinet is never dimmed', () => {
    const { host } = scene(MANY, { view: 'cabinet', swipe: 'camera' });
    next();
    const k = Number(host.dataset.focus);
    const [x0, x1, y1, z0, z1] = wallOf(host)[k];
    const cam = cameraOf(host);
    const xs = [x0, x1].flatMap((x) => [0, y1].flatMap((y) => [z0, z1].map((z) => project(cam, [x, y, z]).x)));
    const [left, right] = [Math.min(...xs), Math.max(...xs)];
    const l = veils(host).find((v) => v.dataset.side === 'left')!;
    const r = veils(host).find((v) => v.dataset.side === 'right')!;
    expect(parseFloat(l.style.left) + parseFloat(l.style.width)).toBeCloseTo(left, 1);
    expect(parseFloat(r.style.left)).toBeCloseTo(right, 1);
    expect(Number(l.dataset.edge)).toBeCloseTo(left, 1);
    expect(Number(r.dataset.edge)).toBeCloseTo(right, 1);
    // across the middle of the frame, the focus cabinet's
    expect(left).toBeLessThan(cam.width / 2);
    expect(right).toBeGreaterThan(cam.width / 2);
  });

  it('a camera-mode walk carries the dimming with the picture: the edges are the focus cabinet\'s through the walked camera', () => {
    const { host } = scene(MANY, { view: 'cabinet', swipe: 'camera' });
    next();
    drag(host, -120);
    const k = Number(host.dataset.focus);
    const [x0, x1, y1, z0, z1] = wallOf(host)[k];
    const cam = cameraOf(host);
    const xs = [x0, x1].flatMap((x) => [0, y1].flatMap((y) => [z0, z1].map((z) => project(cam, [x, y, z]).x)));
    const edge = (side: string) => Number(veils(host).find((v) => v.dataset.side === side)!.dataset.edge);
    expect(edge('left')).toBeCloseTo(Math.min(...xs), 1);
    expect(edge('right')).toBeCloseTo(Math.max(...xs), 1);
  });

  it('a veil is no bigger than the frame it dims: never a layer the size of the wall (the case-budget ceiling)', () => {
    const { host } = scene(MANY, { view: 'cabinet' });
    next();
    const cam = cameraOf(host);
    expect(veils(host)).toHaveLength(2);
    for (const v of veils(host)) {
      expect(parseFloat(v.style.width)).toBeLessThanOrEqual(cam.width + 16);
      expect(parseFloat(v.style.height)).toBeLessThanOrEqual(cam.height + 16);
    }
  });

  it('as the photo slides (pan mode) the veils keep covering the frame: they span the window the slide shows, from the focus cabinet\'s edges', () => {
    const { host } = scene(MANY, { view: 'cabinet', swipe: 'pan' });
    next();
    drag(host, -90);
    const pan = Number(host.dataset.pan);
    expect(pan).toBe(-90);
    const cam = cameraOf(host);
    const l = veils(host).find((v) => v.dataset.side === 'left')!;
    const r = veils(host).find((v) => v.dataset.side === 'right')!;
    // the picture is drawn slid by `pan`: the frame shows the picture's x from -pan to -pan + its width
    expect(parseFloat(l.style.left)).toBeLessThanOrEqual(-pan);
    expect(parseFloat(l.style.left) + parseFloat(l.style.width)).toBeCloseTo(Number(l.dataset.edge), 1);
    expect(parseFloat(r.style.left)).toBeCloseTo(Number(r.dataset.edge), 1);
    expect(parseFloat(r.style.left) + parseFloat(r.style.width)).toBeGreaterThanOrEqual(-pan + cam.width);
    for (const v of veils(host)) {
      expect(parseFloat(v.style.width)).toBeLessThanOrEqual(cam.width + 16);
      expect(parseFloat(v.style.top)).toBeLessThanOrEqual(0);
      expect(parseFloat(v.style.top) + parseFloat(v.style.height)).toBeGreaterThanOrEqual(cam.height);
    }
  });

  it('a veil never takes a touch: the figures of the neighbours stay tappable', () => {
    const { host, onSelect } = scene(MANY, { view: 'cabinet' });
    next();
    for (const v of veils(host)) expect(v.style.pointerEvents).toBe('none');
    const figures = Array.from(host.querySelectorAll<HTMLButtonElement>('button.cab-figure'));
    expect(figures.length).toBeGreaterThan(0);
    fireEvent.click(figures[0]);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

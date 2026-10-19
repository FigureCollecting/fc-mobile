import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene } from '../CabinetScene';
import { DEFAULT_CASE_PREFS, type CasePrefs } from '../casePrefs';
import { IKEA_DETOLF } from '../cabinetPresets';
import { project } from '../caseCamera';
import { getFixtureFigures } from '../../../dev-fixtures/fixtures';
import { __clearAlphaMarginCache } from '../alphaMargin';

// SHELF-STEPS-1 (Ross 10-18, Fold8): the shelf steps are the wall's levels (no step that looks like the one above,
// the last one showing every cabinet's lowest surface), and an arrow press in the one-shelf view snaps to the
// straight-on view of that shelf (TOP1), where a drag or a pinch then moves the picture as the swipe mode says.

beforeEach(() => __clearAlphaMarginCache());
afterEach(() => cleanup());

const COVER = { width: 443, height: 418 };
const OPEN = { width: 870, height: 335 };
// the steps are about the wall's levels, with its figures sized for no clearance above them (CLEAR-1's default would move shelves out)
const prefs = (patch: Partial<CasePrefs> = {}): CasePrefs => ({ ...DEFAULT_CASE_PREFS, clearanceMm: 0, ...patch });

function scene(figures: Figure[], patch: Partial<CasePrefs> = {}, frameFallback = COVER) {
  const { container } = render(<CabinetScene figures={figures} onSelect={vi.fn()} prefs={prefs(patch)} frameFallback={frameFallback} />);
  return container.querySelector('.cabinet-scene') as HTMLElement;
}

const sized = (i: number, heightMm: number, widthMm: number): Figure => ({ _id: `s${i}`, name: `Figure ${i}`, dimensions: { heightMm, widthMm } }) as Figure;
/** Short figures with tall ones among them: in Detolfs, some cabinets stand with a glass shelf out (FB2b), others stock. */
const MIXED_DETOLFS: Figure[] = [
  ...Array.from({ length: 20 }, (_, i) => sized(i, 200, 100)),
  ...Array.from({ length: 10 }, (_, i) => sized(20 + i, [450, 780][i % 2], i % 2 === 0 ? 120 : 160)),
  ...Array.from({ length: 16 }, (_, i) => sized(30 + i, 200, 100)),
];

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const cameraOf = (host: HTMLElement) => {
  const c = JSON.parse(host.dataset.camera!) as { x: number; y: number; z: number; pitch: number; focalPx: number; width: number; height: number };
  return { ...c, frame: { width: c.width, height: c.height } };
};

type P = { x: number; y: number };
const down = (el: Element, id: number, p: P) => fireEvent.pointerDown(el, { pointerId: id, clientX: p.x, clientY: p.y, button: 0 });
const move = (el: Element, id: number, p: P) => fireEvent.pointerMove(el, { pointerId: id, clientX: p.x, clientY: p.y });
const up = (el: Element, id: number, p: P) => fireEvent.pointerUp(el, { pointerId: id, clientX: p.x, clientY: p.y });
/** One finger's drag by (dx, dy) from (200, 200). */
function drag(el: Element, dx: number, dy = 0) {
  down(el, 1, { x: 200, y: 200 });
  move(el, 1, { x: 200 + dx / 2, y: 200 + dy / 2 });
  move(el, 1, { x: 200 + dx, y: 200 + dy });
  up(el, 1, { x: 200 + dx, y: 200 + dy });
}
/** Two fingers spread: about 2x. */
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
/** A finger's tap on a button: down, up and the click the browser makes of them (the down ends what a drag left to swallow). */
function tapButton(name: string) {
  const b = button(name);
  down(b, 5, { x: 10, y: 10 });
  up(b, 5, { x: 10, y: 10 });
  fireEvent.click(b);
}
const zoomK = (host: HTMLElement) => (JSON.parse(host.dataset.zoom!) as { k: number }).k;

describe('SHELF-STEPS-1 (a): the shelf steps on a wall of Detolfs, some with a shelf out', () => {
  for (const [name, frame] of [['cover', COVER], ['open', OPEN]] as const) {
    it(`${name}: on a stock Detolf the last step is the fourth, Shelf below is disabled there, and no step repeats the one above`, () => {
      const host = scene(MIXED_DETOLFS, { pattern: 'ikea-detolf', view: 'shelf', swipe: 'camera' }, frame);
      const held = JSON.parse(host.dataset.held!) as [number, number, number[]][];
      expect(held.some((h) => h[2].length > 0)).toBe(true);
      // the second cabinet stands stock
      expect(held[1][2]).toEqual([]);
      tapButton('Next cabinet');
      expect(host.dataset.focus).toBe('1');
      const cameras = [cameraOf(host)];
      while (!button('Shelf below').disabled) {
        tapButton('Shelf below');
        cameras.push(cameraOf(host));
        expect(cameras.length).toBeLessThan(10);
      }
      // a stock Detolf has five levels; the wall's lowest band is reached at the fourth, so the fifth is not offered
      expect(host.dataset.shelf).toBe('3');
      for (let k = 0; k + 1 < cameras.length; k++) expect([cameras[k + 1].y, cameras[k + 1].z], `step ${k} -> ${k + 1}`).not.toEqual([cameras[k].y, cameras[k].z]);
      // and at the last step every cabinet's lowest surface (the base floor, 35 mm) is in the frame
      const last = cameras[cameras.length - 1];
      expect(project(last, [last.x, IKEA_DETOLF.surfaces[0].topMm, 0]).y).toBeLessThanOrEqual(frame.height);
      expect(project(last, [last.x, IKEA_DETOLF.surfaces[0].topMm, 0]).y).toBeGreaterThanOrEqual(0);
    });
  }
});

describe('SHELF-STEPS-1 (b) TOP1: an arrow press in the one-shelf view snaps to the straight-on view of that shelf', () => {
  const fixtures = getFixtureFigures(8);

  it('camera mode: a lifted camera goes back to the straight-on view on Shelf below, Shelf above and either cabinet arrow', () => {
    const fresh = (steps: (() => void)[]) => {
      cleanup();
      const host = scene(fixtures, { view: 'shelf', swipe: 'camera' });
      steps.forEach((s) => s());
      return host.dataset.camera;
    };
    const below = () => tapButton('Shelf below');
    const above = () => tapButton('Shelf above');
    const next = () => tapButton('Next cabinet');
    const lift = () => drag(document.querySelector('.cabinet-scene')!, 0, -120);
    for (const press of [below, next]) {
      const snapped = fresh([press]);
      // the drag really moves it...
      expect(fresh([lift]), 'a lift moves the camera').not.toEqual(fresh([]));
      // ...and the press takes it back to what a fresh scene shows there
      expect(fresh([lift, press])).toEqual(snapped);
    }
    const downThenUp = fresh([below, above]);
    expect(fresh([below, lift, above])).toEqual(downThenUp);
  });

  it('camera mode: a walk of the camera (a sideways drag) is snapped back to the focus cabinet on an arrow press too', () => {
    const host = scene(fixtures, { view: 'shelf', swipe: 'camera' });
    const start = host.dataset.camera;
    drag(host, -300);
    expect(host.dataset.camera).not.toEqual(start);
    const focus = Number(host.dataset.focus);
    tapButton('Shelf below');
    const snapped = host.dataset.camera;
    cleanup();
    const there = scene(fixtures, { view: 'shelf', swipe: 'camera' });
    for (let i = 0; i < focus; i++) tapButton('Next cabinet');
    tapButton('Shelf below');
    expect(there.dataset.camera).toEqual(snapped);
  });

  it('pan mode: the photo slid both ways comes back unslid on an arrow press', () => {
    const host = scene(fixtures, { view: 'shelf', swipe: 'pan' });
    drag(host, -60, 0);
    drag(host, 0, -50);
    expect([host.dataset.pan, host.dataset.panY]).not.toEqual(['0', '0']);
    tapButton('Shelf below');
    expect([host.dataset.pan, host.dataset.panY]).toEqual(['0', '0']);
    drag(host, -60, 0);
    drag(host, 0, -50);
    tapButton('Next cabinet');
    expect([host.dataset.pan, host.dataset.panY]).toEqual(['0', '0']);
  });

  it('a pinch zoom goes back to 1x on an arrow press', () => {
    const host = scene(fixtures, { view: 'shelf' });
    pinchOut(host);
    expect(zoomK(host)).toBeGreaterThan(1);
    tapButton('Shelf below');
    expect(zoomK(host)).toBe(1);
  });

  it('free movement is never overridden: after a snap a drag lifts (camera) or slides (pan) as the mode says, and a pinch zooms', () => {
    const camera = scene(fixtures, { view: 'shelf', swipe: 'camera' });
    tapButton('Shelf below');
    const snapped = cameraOf(camera).y;
    drag(camera, 0, -120);
    expect(cameraOf(camera).y).not.toBe(snapped);
    pinchOut(camera);
    expect(zoomK(camera)).toBeGreaterThan(1);
    cleanup();
    const pan = scene(fixtures, { view: 'shelf', swipe: 'pan' });
    tapButton('Shelf below');
    drag(pan, 0, -50);
    expect(pan.dataset.panY).not.toBe('0');
  });

  // CAB-FOCUS-1 (Ross 10-18): the one-cabinet view's arrows snap too (CabinetSceneCabFocus.test.tsx); the wall view's do not
  it('the shelf and the one-cabinet views snap: in the wall view a lifted camera keeps its height through the arrows', () => {
    const host = scene(fixtures, { view: 'wall', swipe: 'camera' });
    drag(host, 0, -120);
    const lifted = cameraOf(host).y;
    tapButton('Next cabinet');
    expect(cameraOf(host).y).toBe(lifted);
  });
});

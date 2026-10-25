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

// NAV-PTR-1 (Ross 10-25: "arrow movements weren't working"): a press on an arrow was also a press of the scene, so a thumb
// that travelled 8 px made it a lift or a walk and its click was swallowed (and Chrome makes no click past its own tap
// slop). An arrow now steps on the pointerup of a press that began on it, inside its box; the click that tap makes is
// ignored; a click with no pointerup before it (the keyboard's) steps.
describe('NAV-PTR-1: a tap on an arrow always steps, once', () => {
  const wall = () => scene(getFixtureFigures(40), { view: 'wall', swipe: 'camera' });
  /** The arrow's box on the screen (jsdom lays nothing out): 32 x 48 px at (400, 180). */
  const boxed = (name: string) => {
    const b = button(name);
    vi.spyOn(b, 'getBoundingClientRect').mockReturnValue({ x: 400, y: 180, left: 400, top: 180, right: 432, bottom: 228, width: 32, height: 48, toJSON: () => ({}) } as DOMRect);
    return b;
  };
  /** A finger's tap on the arrow that travels `dy` px before it lifts, and the click the browser then makes of it. */
  function tapWithTravel(name: string, dy: number, click = true) {
    const b = boxed(name);
    down(b, 5, { x: 416, y: 195 });
    move(b, 5, { x: 416, y: 195 + dy });
    up(b, 5, { x: 416, y: 195 + dy });
    if (click) fireEvent.click(b, { detail: 1 });
  }
  /** Where one press of Next and two take the wall view's camera: plain clicks on a fresh scene. */
  const opens = () => {
    const host = wall();
    const next = button('Next cabinet');
    fireEvent.click(next);
    const once = host.dataset.cameraX;
    fireEvent.click(next);
    const twice = host.dataset.cameraX;
    cleanup();
    return { once, twice };
  };
  afterEach(() => vi.restoreAllMocks());

  it('wall view: a tap on Next whose finger travels 10 px pages on exactly once, and the camera does not rise', () => {
    const { once, twice } = opens();
    expect(twice, 'a second step would show').not.toBe(once);
    const host = wall();
    const y = cameraOf(host).y;
    tapWithTravel('Next cabinet', 10);
    expect(host.dataset.cameraX, "the next page's opening, once").toBe(once);
    expect(cameraOf(host).y, 'no lift').toBe(y);
  });

  it('it steps on the pointerup alone (Chrome makes no click past its tap slop); Previous does the same', () => {
    const { once } = opens();
    const host = wall();
    const start = host.dataset.cameraX;
    tapWithTravel('Next cabinet', 10, false);
    expect(host.dataset.cameraX).toBe(once);
    tapWithTravel('Previous cabinet', -10, false);
    expect(host.dataset.cameraX).toBe(start);
  });

  it('a keyboard press (a click with no pointer) steps once', () => {
    const { once } = opens();
    const host = wall();
    fireEvent.click(button('Next cabinet'), { detail: 0 });
    expect(host.dataset.cameraX).toBe(once);
  });

  it('a click well after the tap is a press of its own and steps again', () => {
    const { once, twice } = opens();
    const host = wall();
    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    tapWithTravel('Next cabinet', 0, false);
    expect(host.dataset.cameraX).toBe(once);
    now.mockReturnValue(10_599);
    fireEvent.click(button('Next cabinet'), { detail: 1 });
    expect(host.dataset.cameraX, "that tap's own click: ignored").toBe(once);
    now.mockReturnValue(11_300);
    fireEvent.click(button('Next cabinet'), { detail: 0 });
    expect(host.dataset.cameraX).toBe(twice);
  });

  it('no step for a finger lifted off the arrow, a press that was cancelled, a press begun elsewhere or another mouse button', () => {
    const host = wall();
    const start = host.dataset.cameraX;
    const next = boxed('Next cabinet');
    // lifted outside its box
    down(next, 5, { x: 416, y: 195 });
    up(next, 5, { x: 416, y: 260 });
    // cancelled (the browser took the touch)
    down(next, 6, { x: 416, y: 195 });
    fireEvent.pointerCancel(next, { pointerId: 6 });
    up(next, 6, { x: 416, y: 195 });
    // another finger's move and lift-off
    down(next, 7, { x: 416, y: 195 });
    move(next, 8, { x: 300, y: 195 });
    up(next, 8, { x: 416, y: 195 });
    // the right mouse button
    fireEvent.pointerDown(next, { pointerId: 9, clientX: 416, clientY: 195, button: 2 });
    fireEvent.pointerUp(next, { pointerId: 9, clientX: 416, clientY: 195, button: 2 });
    expect(host.dataset.cameraX).toBe(start);
  });

  it('shelf view: Shelf below and Shelf above step on a tap that travels, once each; a disabled one does nothing', () => {
    const host = scene(getFixtureFigures(8), { view: 'shelf', swipe: 'camera' });
    const straight = host.dataset.camera;
    tapWithTravel('Shelf above', 10);
    expect([host.dataset.shelf, host.dataset.camera], 'Shelf above is disabled on the top step').toEqual(['0', straight]);
    tapWithTravel('Shelf below', 10);
    expect(host.dataset.shelf).toBe('1');
    tapWithTravel('Shelf above', -10);
    expect([host.dataset.shelf, host.dataset.camera]).toEqual(['0', straight]);
  });

  // NAV-PTR-1 (the hand-off): a swipe that starts on an arrow (a thumb starting a walk at the edge) is the scene's once it
  // leaves the arrow as a drag: it walks, lifts or pans as the same drag on the scene would, and steps nothing
  /** A finger down at (416, 195), on the arrow's box when `el` is a boxed arrow, moved by (dx, dy) in two moves, and lifted. */
  function dragFrom(el: Element, dx: number, dy: number) {
    down(el, 5, { x: 416, y: 195 });
    move(el, 5, { x: 416 + dx / 2, y: 195 + dy / 2 });
    move(el, 5, { x: 416 + dx, y: 195 + dy });
    up(el, 5, { x: 416 + dx, y: 195 + dy });
  }

  it('a swipe that starts on Next and leaves it walks the wall as the same swipe on the scene does, and does not step', () => {
    const { once } = opens();
    const plain = wall();
    const start = plain.dataset.cameraX;
    dragFrom(plain, -60, 0);
    const walked = plain.dataset.cameraX;
    expect(walked, 'a 60 px swipe on the scene walks').not.toBe(start);
    cleanup();
    const host = wall();
    dragFrom(boxed('Next cabinet'), -60, 0);
    expect(host.dataset.cameraX, 'walked, as from the scene').toBe(walked);
    expect(host.dataset.cameraX, 'not a step').not.toBe(once);
  });

  it('a drag down that starts on Next lifts the camera as the same drag on the scene does, and does not step', () => {
    const plain = wall();
    const x = plain.dataset.cameraX;
    const y = cameraOf(plain).y;
    dragFrom(plain, 0, 60);
    const lifted = plain.dataset.camera;
    expect(cameraOf(plain).y, 'a 60 px drag down on the scene lifts').not.toBe(y);
    cleanup();
    const host = wall();
    dragFrom(boxed('Next cabinet'), 0, 60);
    expect(host.dataset.camera, 'lifted, as from the scene').toBe(lifted);
    expect(host.dataset.cameraX, 'not a step').toBe(x);
  });

  it('zoomed: a swipe that starts on Next pans the magnified picture as the same swipe on the scene does', () => {
    const zoomed = () => {
      const host = wall();
      pinchOut(host);
      expect(zoomK(host)).toBeGreaterThan(1);
      return host;
    };
    const plain = zoomed();
    const before = plain.dataset.zoom;
    dragFrom(plain, -60, 0);
    const panned = plain.dataset.zoom;
    expect(panned, 'a 60 px swipe on the scene pans the magnified picture').not.toBe(before);
    cleanup();
    const host = zoomed();
    const camera = host.dataset.camera;
    dragFrom(boxed('Next cabinet'), -60, 0);
    expect(host.dataset.zoom).toBe(panned);
    expect(host.dataset.camera, 'no walk, no step').toBe(camera);
  });

  it('a drag off Next and back over it steps nothing, its click included', () => {
    const host = wall();
    const start = host.dataset.cameraX;
    const next = boxed('Next cabinet');
    down(next, 5, { x: 416, y: 195 });
    move(next, 5, { x: 380, y: 195 });
    move(next, 5, { x: 416, y: 195 });
    up(next, 5, { x: 416, y: 195 });
    fireEvent.click(next, { detail: 1 });
    expect(host.dataset.cameraX).toBe(start);
  });
});

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, screen, cleanup, act } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene } from '../CabinetScene';
import { DisplayToggle } from '../DisplayToggle';
import { CASE_PREFS_KEY, DEFAULT_CASE_PREFS, readCasePrefs, useCasePrefs, writeCasePrefs, type CasePrefs } from '../casePrefs';
import { goToFigure, type GoToFraming } from '../caseGoTo';
import { __clearAlphaMarginCache } from '../alphaMargin';
import { renderWithProviders } from '../../../test/testUtils';
import { renderHook } from '@testing-library/preact';

// NAV-SCOPE (nav U2, Ross 11-18: "we are removing the other two views ... there isn't a cabinet highlight mode nor a
// dedicated shelf mode, since someone can zoom to where they want"): ONE continuous view. No Case-views menu, no `view`
// pref, no shelf arrows or hidden step keys, no one-cabinet dimming; Go to always stands the eye at the figure's shelf
// framing; the Reset chip shows only while zoomed and clears only the zoom (plan section 9). jsdom lays nothing out: a
// client point is a frame point.

// Go to's framing, as the scene asked for it: the test reads what it was given, never works it out a second way
vi.mock('../caseGoTo', async (importOriginal) => {
  const real = await importOriginal<typeof import('../caseGoTo')>();
  return { ...real, goToFigure: vi.fn(real.goToFigure) };
});
const lastGoTo = (): GoToFraming => {
  const results = vi.mocked(goToFigure).mock.results;
  return results[results.length - 1].value as GoToFraming;
};

const COVER = { width: 443, height: 418 };
const sized = (i: number): Figure => ({ _id: `s${i}`, name: `Figure ${i}`, dimensions: { heightMm: 200, widthMm: 100 } }) as Figure;
const FIGURES = Array.from({ length: 120 }, (_, i) => sized(i));
/** The prefs a caller hands in; `stale` is what an old device may still carry (a `view`), handed through untyped. */
const prefs = (stale: Record<string, unknown> = {}): CasePrefs => ({ ...DEFAULT_CASE_PREFS, clearanceMm: 0, ...stale }) as CasePrefs;

type P = { x: number; y: number };
const host = () => document.querySelector('.cabinet-scene') as HTMLElement;
const down = (id: number, p: P, button = 0) => fireEvent.pointerDown(host(), { pointerId: id, clientX: p.x, clientY: p.y, button });
const move = (id: number, p: P) => fireEvent.pointerMove(host(), { pointerId: id, clientX: p.x, clientY: p.y });
const up = (id: number, p: P) => fireEvent.pointerUp(host(), { pointerId: id, clientX: p.x, clientY: p.y });
const tick = (ms = 20) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const pose = () => {
  const c = JSON.parse(host().dataset.camera!) as { x: number; y: number; z: number; yaw: number; pitch: number };
  return { x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch };
};
const zoomK = () => (JSON.parse(host().dataset.zoom!) as { k: number }).k;
/** The pose the framing stands the eye at, at the precision data-camera publishes (6 decimals). */
const poseOfFraming = (f: GoToFraming) => {
  const n = (v: number) => Number(v.toFixed(6));
  const c = f.framing.camera;
  return { x: n(c.x), y: n(c.y), z: n(c.z), yaw: n(c.yaw ?? 0), pitch: n(c.pitch) };
};
const resetChip = () => screen.queryByRole('button', { name: 'Reset view' });

/** A right drag: the mouse's Look, turning the eye at once. */
function look(from: P, to: P) {
  down(1, from, 2);
  for (let i = 1; i <= 6; i++) {
    move(1, { x: from.x + ((to.x - from.x) * i) / 6, y: from.y + ((to.y - from.y) * i) / 6 });
    tick(16);
  }
  up(1, to);
  tick(500);
}
/** Two fingers spread apart and lifted: a pinch to over 1x. */
function pinchOut() {
  down(11, { x: 180, y: 200 });
  down(12, { x: 260, y: 200 });
  move(11, { x: 120, y: 200 });
  move(12, { x: 320, y: 200 });
  up(11, { x: 120, y: 200 });
  up(12, { x: 320, y: 200 });
  tick(500);
}

function scene(stale: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const props = { figures: FIGURES, onSelect: vi.fn(), prefs: prefs(stale), frameFallback: COVER, ...extra };
  const utils = render(<CabinetScene {...props} />);
  const again = (more: Record<string, unknown>) => utils.rerender(<CabinetScene {...props} {...more} />);
  return { ...utils, again };
}

beforeEach(() => {
  __clearAlphaMarginCache();
  localStorage.clear();
  vi.mocked(goToFigure).mockClear();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('NAV-SCOPE (a): the Case button is a plain mode button', () => {
  it('no menu named Case views opens from it, active or not; it has no aria-haspopup; the Tiles menu stays', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const handlers = { onLayout: vi.fn(), onDensity: vi.fn(), onLabels: vi.fn() };
    const { unmount } = renderWithProviders(<DisplayToggle layout="case" density="compact" {...handlers} />) as unknown as { unmount: () => void };
    const caseButton = screen.getByRole('button', { name: /^Case/ });
    expect(caseButton).not.toHaveAttribute('aria-haspopup');
    expect(caseButton).not.toHaveAttribute('aria-expanded');
    await user.click(caseButton);
    expect(screen.queryByRole('menu', { name: 'Case views' })).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(handlers.onLayout).not.toHaveBeenCalled();
    unmount();
    renderWithProviders(<DisplayToggle layout="rows" density="compact" {...handlers} />);
    expect(screen.getByRole('button', { name: /^Case/ })).not.toHaveAttribute('aria-haspopup');
    await user.click(screen.getByRole('button', { name: /^Case/ }));
    expect(handlers.onLayout).toHaveBeenCalledWith('case');
    expect(screen.queryByRole('menu', { name: 'Case views' })).toBeNull();
  });
});

/** Go to each of these figures in turn: the eye stands at the framing each was given; returns how many needed a slide and how many none. */
function goToEach(again: (more: Record<string, unknown>) => void, ids: readonly string[], more: Record<string, unknown> = {}) {
  const walks = { slid: 0, none: 0 };
  ids.forEach((figureId, seq) => {
    again({ ...more, goTo: { figureId, seq: seq + 1 } });
    tick();
    const target = lastGoTo();
    if (target.walkX === null) walks.none++;
    else walks.slid++;
    expect(pose(), figureId).toEqual(poseOfFraming(target));
  });
  return walks;
}
const EVERY_SEVENTH = FIGURES.filter((_, i) => i % 7 === 0).map((f) => f._id);

describe('NAV-SCOPE (b): Go to lands at the figure\'s shelf framing, whatever the wall view frames', () => {
  it('with no stored view, each figure: the eye stands at its shelf framing, whether that slid toward it or not', () => {
    const { again } = scene();
    const wall = pose();
    const walks = goToEach(again, EVERY_SEVENTH);
    // both kinds were asked: a shelf framing with no slide is the one the wall view's own framing used to stand in for
    expect(walks.none).toBeGreaterThan(0);
    expect(walks.slid).toBeGreaterThan(0);
    expect(pose()).not.toEqual(wall);
  });

  it('after a fold, Go to stands the eye at the framing it gives at the new frame; first open frames the whole wall (Q2 a)', () => {
    let size = { width: 443, height: 418 };
    const proto = Element.prototype;
    const w = Object.getOwnPropertyDescriptor(proto, 'clientWidth');
    const h = Object.getOwnPropertyDescriptor(proto, 'clientHeight');
    Object.defineProperty(proto, 'clientWidth', { configurable: true, get(this: HTMLElement) { return this.classList.contains('cabinet-scene') ? size.width : 0; } });
    Object.defineProperty(proto, 'clientHeight', { configurable: true, get(this: HTMLElement) { return this.classList.contains('cabinet-scene') ? size.height : 0; } });
    try {
      // a first open at the unfolded size: the wall framing (what a scene with no Go to opens at)
      size = { width: 870, height: 475 };
      const { unmount } = scene();
      tick();
      const wallUnfolded = pose();
      unmount();
      size = { width: 443, height: 418 };
      const { again } = scene();
      tick();
      size = { width: 870, height: 475 };
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });
      tick();
      // the fold keeps the pose (spec 6.6): not the unfolded wall framing
      expect(pose()).not.toEqual(wallUnfolded);
      const walks = goToEach(again, EVERY_SEVENTH);
      expect(walks.none).toBeGreaterThan(0);
      const target = lastGoTo();
      expect(target.framing.camera.frame.width).toBe(870);
      // it stays there on later renders: the fold's pin never takes it back
      again({ goTo: { figureId: EVERY_SEVENTH[EVERY_SEVENTH.length - 1], seq: EVERY_SEVENTH.length }, labels: true });
      tick();
      expect(pose()).toEqual(poseOfFraming(target));
    } finally {
      Object.defineProperty(proto, 'clientWidth', w!);
      Object.defineProperty(proto, 'clientHeight', h!);
    }
  });
});

describe('NAV-SCOPE (c): a stored view is not read', () => {
  it('a stored view:\'shelf\' (or \'cabinet\') reads as no view, and the scene handed it opens at the wall framing', () => {
    const { unmount } = scene();
    const wall = pose();
    unmount();
    for (const view of ['shelf', 'cabinet']) {
      localStorage.setItem(CASE_PREFS_KEY, JSON.stringify({ view, pattern: 'ikea-detolf' }));
      const read = readCasePrefs();
      expect(read, view).not.toHaveProperty('view');
      expect(read.pattern, view).toBe('ikea-detolf');
      const { unmount: gone } = scene({ view });
      expect(pose(), view).toEqual(wall);
      expect(host().dataset.view, view).toBeUndefined();
      gone();
    }
  });
});

describe('NAV-SCOPE (d): no shelf arrows and no hidden step keys', () => {
  it('no .cabinet-scene__shelves node, no Shelf above or below, no Previous or Next cabinet, whatever view is handed in', () => {
    for (const view of [undefined, 'wall', 'cabinet', 'shelf']) {
      const { container, unmount } = scene(view === undefined ? {} : { view });
      expect(container.querySelector('.cabinet-scene__shelves'), String(view)).toBeNull();
      expect(container.querySelector('.cabinet-scene__step'), String(view)).toBeNull();
      for (const name of ['Shelf above', 'Shelf below', 'Previous cabinet', 'Next cabinet']) {
        expect(screen.queryByRole('button', { name }), `${String(view)}: ${name}`).toBeNull();
      }
      unmount();
    }
  });
});

describe('NAV-SCOPE (e): the Reset chip shows only while zoomed and clears only the zoom', () => {
  it('a look leaves no chip; a pinch shows it; its tap clears the zoom and leaves data-camera as it was', () => {
    scene();
    look({ x: 300, y: 200 }, { x: 120, y: 120 });
    const looked = pose();
    expect(Math.abs(looked.yaw)).toBeGreaterThan((10 * Math.PI) / 180);
    expect(resetChip()).toBeNull();
    pinchOut();
    expect(zoomK()).toBeGreaterThan(1);
    const zoomedCamera = host().dataset.camera;
    const chip = resetChip()!;
    expect(chip).not.toBeNull();
    fireEvent.click(chip);
    tick(500);
    expect(zoomK()).toBe(1);
    expect(host().dataset.camera).toBe(zoomedCamera);
    expect(pose()).toEqual(looked);
    expect(resetChip()).toBeNull();
  });

  it('a walk and a Go to show no chip; a double-tap zoom shows it and its tap clears it, the camera unchanged', () => {
    const { again } = scene();
    down(1, { x: 300, y: 300 });
    for (let i = 1; i <= 6; i++) {
      move(1, { x: 300 - i * 30, y: 300 - i * 30 });
      tick(16);
    }
    up(1, { x: 120, y: 120 });
    tick(500);
    expect(resetChip()).toBeNull();
    again({ goTo: { figureId: 's60', seq: 1 } });
    tick();
    expect(resetChip()).toBeNull();
    const at = host().dataset.camera;
    // a double-tap on the room (no figure): 2x at that point
    const room = host().querySelector('.cabinet-scene__frame')!;
    for (const t of [0, 1]) {
      fireEvent.pointerDown(room, { pointerId: 5 + t, clientX: 4, clientY: 4, button: 0 });
      fireEvent.pointerUp(room, { pointerId: 5 + t, clientX: 4, clientY: 4 });
      tick(50);
    }
    tick(500);
    expect(zoomK()).toBeGreaterThan(1);
    fireEvent.click(resetChip()!);
    tick(500);
    expect(zoomK()).toBe(1);
    expect(host().dataset.camera).toBe(at);
    expect(resetChip()).toBeNull();
  });
});

describe('NAV-SCOPE (f): no cabinet dimming, and no view in what the prefs write', () => {
  it('no dimming veil over the neighbours, even with a stale view:\'cabinet\', still or while moving', () => {
    const { container } = scene({ view: 'cabinet' });
    expect(container.querySelectorAll('.cabinet-scene__dim')).toHaveLength(0);
    down(1, { x: 300, y: 200 });
    for (let i = 1; i <= 6; i++) {
      move(1, { x: 300 - i * 30, y: 200 });
      tick(16);
    }
    expect(container.querySelectorAll('.cabinet-scene__dim')).toHaveLength(0);
    up(1, { x: 120, y: 200 });
    tick(500);
    expect(container.querySelectorAll('.cabinet-scene__dim')).toHaveLength(0);
  });

  it('a write drops a stored view; neither the defaults nor the hook carry one', () => {
    localStorage.setItem(CASE_PREFS_KEY, JSON.stringify({ view: 'cabinet', ceilingMm: 2700 }));
    writeCasePrefs({ showEstimated: true });
    const stored = JSON.parse(localStorage.getItem(CASE_PREFS_KEY)!) as Record<string, unknown>;
    expect(stored).not.toHaveProperty('view');
    expect(stored).toMatchObject({ ceilingMm: 2700, showEstimated: true });
    expect(DEFAULT_CASE_PREFS).not.toHaveProperty('view');
    localStorage.setItem(CASE_PREFS_KEY, JSON.stringify({ view: 'shelf' }));
    const { result } = renderHook(() => useCasePrefs());
    expect(result.current[0]).not.toHaveProperty('view');
    act(() => result.current[1]({ wall: 'seafoam' }));
    expect(JSON.parse(localStorage.getItem(CASE_PREFS_KEY)!) as Record<string, unknown>).not.toHaveProperty('view');
  });
});

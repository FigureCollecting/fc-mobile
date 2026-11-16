import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene } from '../CabinetScene';
import { DEFAULT_CASE_PREFS, type CasePrefs } from '../casePrefs';
import { __clearAlphaMarginCache } from '../alphaMargin';
import { FIGURE_TURN_CAP_RAD } from '../figureTurn';

// NAV-FLAT (Ross 11-15) in the scene: every drawn figure (its picture and its contact shadow, together) turned part of the
// way toward where the eye stands, with the Free camera (frame by frame as the eye moves) and the Classic camera alike;
// a look (the eye still) turns none; off draws the case as before. jsdom lays nothing out: a client point is a frame point.

const COVER = { width: 443, height: 418 };
const DEG = Math.PI / 180;
const sized = (i: number, more: Record<string, number> = {}): Figure => ({ _id: `s${i}`, name: `Figure ${i}`, dimensions: { heightMm: 200, widthMm: 100, ...more } }) as Figure;
const FIGURES = Array.from({ length: 120 }, (_, i) => sized(i));
const prefs = (patch: Partial<CasePrefs> = {}): CasePrefs => ({ ...DEFAULT_CASE_PREFS, clearanceMm: 0, freeCamera: true, ...patch });

type P = { x: number; y: number };
const host = () => document.querySelector('.cabinet-scene') as HTMLElement;
const tick = (ms = 20) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
function drag(from: P, to: P, { steps = 6, lift = true, button = 0 }: { steps?: number; lift?: boolean; button?: number } = {}) {
  fireEvent.pointerDown(host(), { pointerId: 1, clientX: from.x, clientY: from.y, button, shiftKey: false });
  for (let i = 1; i <= steps; i++) {
    fireEvent.pointerMove(host(), { pointerId: 1, clientX: from.x + ((to.x - from.x) * i) / steps, clientY: from.y + ((to.y - from.y) * i) / steps });
    tick(16);
  }
  if (lift) fireEvent.pointerUp(host(), { pointerId: 1, clientX: to.x, clientY: to.y });
}
const eye = () => JSON.parse(host().dataset.camera!) as { x: number; z: number; yaw?: number; pitch: number };
const buttons = () => Array.from(host().querySelectorAll<HTMLElement>('button.cab-figure'));
const yawOf = (el: HTMLElement) => {
  const m = /^y (-?[\d.e-]+)deg$/.exec(el.style.rotate);
  return m ? Number(m[1]) * DEG : 0;
};
const pivotOf = (b: HTMLElement) => {
  const w = JSON.parse(b.dataset.world!) as { x0: number; x1: number };
  const d = JSON.parse(b.dataset.depth!) as { front: number; back: number; slotFront: number; slotBack: number };
  return { x: (w.x0 + w.x1) / 2, z: d.front, ...d };
};
const turns = () => buttons().map((b) => `${b.dataset.figureId}:${b.style.rotate}|${b.style.translate}`);
const rule = (e: { x: number; z: number }, p: { x: number; z: number }, k: number) => {
  const yaw = k * Math.atan2(e.x - p.x, e.z - p.z);
  return Math.max(-FIGURE_TURN_CAP_RAD, Math.min(FIGURE_TURN_CAP_RAD, yaw));
};

/**
 * Every drawn figure turned no further than k x its angle to the eye (capped), toward the eye, its shadow turned with it;
 * how many are turned exactly by the rule (those its footprint clamp leaves alone).
 */
function expectTurned(k: number): number {
  const e = eye();
  let exact = 0;
  for (const b of buttons()) {
    const p = pivotOf(b);
    const yaw = yawOf(b);
    const want = rule(e, p, k);
    if (yaw !== 0) expect(Math.sign(yaw), b.dataset.figureId).toBe(Math.sign(want));
    expect(Math.abs(yaw)).toBeLessThanOrEqual(Math.abs(want) + 1e-6);
    if (Math.abs(yaw - want) < 1e-6) exact++;
    // nothing up or down: the base stays on its shelf
    if (b.style.translate) expect(b.style.translate).toMatch(/^-?[\d.e-]+px 0px -?[\d.e-]+px$/);
    // its shadow, just before it, turned with it
    const shadow = b.previousElementSibling as HTMLElement;
    expect(shadow.classList.contains('cab-shadow')).toBe(true);
    expect([shadow.style.rotate, shadow.style.translate]).toEqual([b.style.rotate, b.style.translate]);
  }
  return exact;
}

let onSelect = vi.fn();
function scene(patch: Partial<CasePrefs> = {}, figures: readonly Figure[] = FIGURES) {
  onSelect = vi.fn();
  return render(<CabinetScene figures={figures} onSelect={onSelect} prefs={prefs(patch)} frameFallback={COVER} />);
}

beforeEach(() => {
  __clearAlphaMarginCache();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('each figure\'s contact shadow', () => {
  it('every drawn figure has one, on its shelf, just before it', () => {
    scene();
    const drawn = buttons();
    expect(drawn.length).toBe(Number(host().dataset.drawnFigures));
    expect(drawn.length).toBeGreaterThan(10);
    expect(host().querySelectorAll('.cab-shadow')).toHaveLength(drawn.length);
    for (const b of drawn) expect((b.previousElementSibling as HTMLElement).classList.contains('cab-shadow')).toBe(true);
  });
});

describe('subtle (the default): each figure turned toward where the eye stands', () => {
  it('k 0.5 x its angle to the eye, capped, toward the eye; its shadow with it', () => {
    scene();
    const exact = expectTurned(0.5);
    expect(exact).toBeGreaterThan(buttons().length * 0.8);
    expect(buttons().filter((b) => yawOf(b) > 0).length).toBeGreaterThan(0);
    expect(buttons().filter((b) => yawOf(b) < 0).length).toBeGreaterThan(0);
  });

  it('strong: k 0.8', () => {
    scene({ figureTurn: 'strong' });
    expect(expectTurned(0.8)).toBeGreaterThan(buttons().length * 0.8);
  });

  it('off: no figure and no shadow turned (none carries a rotate or a translate)', () => {
    scene({ figureTurn: 'off' });
    for (const el of host().querySelectorAll<HTMLElement>('button.cab-figure, .cab-shadow')) {
      expect(el.style.rotate).toBe('');
      expect(el.style.translate).toBe('');
      expect(el.getAttribute('style')).not.toMatch(/rotate|translate:/);
    }
  });

  it('a change of the setting turns them at once', () => {
    const { rerender } = scene({ figureTurn: 'off' });
    expect(buttons().every((b) => yawOf(b) === 0)).toBe(true);
    rerender(<CabinetScene figures={FIGURES} onSelect={onSelect} prefs={prefs({ figureTurn: 'strong' })} frameFallback={COVER} />);
    expect(expectTurned(0.8)).toBeGreaterThan(buttons().length * 0.8);
    rerender(<CabinetScene figures={FIGURES} onSelect={onSelect} prefs={prefs({ figureTurn: 'off' })} frameFallback={COVER} />);
    expect(buttons().every((b) => b.style.rotate === '' && b.style.translate === '')).toBe(true);
  });
});

describe('the Free camera: they turn as the eye moves, never as it looks', () => {
  it('a MOVE (the eye walked sideways) turns them, frame by frame; a LOOK (the eye still) turns none', () => {
    scene();
    const before = turns();
    const x0 = eye().x;
    drag({ x: 300, y: 200 }, { x: 150, y: 200 }, { lift: false });
    expect(eye().x).toBeGreaterThan(x0 + 100);
    // mid-gesture, before the lift: every turn is the rule's at the eye drawn now
    expectTurned(0.5);
    expect(turns()).not.toEqual(before);
    fireEvent.pointerUp(host(), { pointerId: 1, clientX: 150, clientY: 200 });
    tick(300);
    const walked = turns();
    const at = eye();
    // a right drag turns the head only
    drag({ x: 220, y: 200 }, { x: 160, y: 200 }, { button: 2 });
    tick(300);
    expect(eye().yaw).not.toBe(0);
    expect([eye().x, eye().z]).toEqual([at.x, at.z]);
    // the turned frame culls its own figures: every one drawn both before and after the look is turned exactly as it was
    const now = turns();
    const both = now.filter((t) => walked.some((w) => w.split(':')[0] === t.split(':')[0]));
    expect(both.length).toBeGreaterThan(20);
    for (const t of both) expect(walked).toContain(t);
    expectTurned(0.5);
  });
});

describe('a gesture cancelled mid-walk', () => {
  it('puts every turn back with the eye: the frames turned them, the render that restores the pose turns them back', () => {
    scene();
    const before = turns();
    const x0 = eye().x;
    drag({ x: 300, y: 200 }, { x: 260, y: 200 }, { lift: false });
    expect(eye().x).toBeGreaterThan(x0);
    expect(turns()).not.toEqual(before);
    fireEvent.pointerCancel(host(), { pointerId: 1, clientX: 260, clientY: 200 });
    tick(300);
    expect(eye().x).toBe(x0);
    expect(turns()).toEqual(before);
    expectTurned(0.5);
  });
});

describe('after every render the DOM holds the render\'s turns', () => {
  it('a turn some frame left on a figure that the render did not change (so Preact writes nothing) is put back to the render\'s', () => {
    const { rerender } = scene();
    const before = turns();
    const [a, b] = buttons();
    // as a frame's write between two renders would leave them
    a.style.rotate = 'y 3deg';
    a.style.translate = '1px 0px 2px';
    (b.previousElementSibling as HTMLElement).style.rotate = 'y -7deg';
    rerender(<CabinetScene figures={FIGURES} onSelect={vi.fn()} prefs={prefs()} frameFallback={COVER} />);
    expect(turns()).toEqual(before);
    expectTurned(0.5);
  });
});

describe('the Classic camera: they turn toward its eye too', () => {
  it('turned by the rule at its eye, and again as a swipe walks it', () => {
    scene({ freeCamera: false });
    expectTurned(0.5);
    const before = turns();
    const x0 = eye().x;
    drag({ x: 300, y: 200 }, { x: 140, y: 200 });
    tick(600);
    expect(eye().x).not.toBe(x0);
    expectTurned(0.5);
    expect(turns()).not.toEqual(before);
  });
});

describe('the footprint clamp, in the scene', () => {
  it('a figure whose footprint already reaches its surface\'s inner back never turns, wherever the eye walks', () => {
    // as deep as the KLINGSBO's inside (335 mm) and its top (400 mm): no room behind them to turn into
    const deep = [...Array.from({ length: 20 }, (_, i) => sized(500 + i, { depthMm: 335 })), ...Array.from({ length: 20 }, (_, i) => sized(600 + i, { depthMm: 400 })), ...FIGURES.slice(0, 40)];
    scene({}, deep);
    const atBack = () => buttons().filter((b) => {
      const p = pivotOf(b);
      return p.back <= p.slotBack + 1e-6;
    });
    expect(atBack().length).toBeGreaterThan(0);
    for (const dx of [0, -150, 150]) {
      if (dx !== 0) drag({ x: 220, y: 200 }, { x: 220 + dx, y: 200 });
      tick(300);
      for (const b of atBack()) expect(b.style.rotate, b.dataset.figureId).toBe('');
      // the others turn
      expect(buttons().some((b) => b.style.rotate !== '')).toBe(true);
    }
  });
});

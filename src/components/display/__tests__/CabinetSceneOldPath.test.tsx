import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { render, fireEvent, screen, cleanup, act } from '@testing-library/preact';
import { CabinetScene } from '../CabinetScene';
import type { CasePrefs } from '../casePrefs';
import { LEGACY_PREFS } from '../../../test/legacyPrefs';
import { getFixtureFigures } from '../../../dev-fixtures/fixtures';
import { __clearAlphaMarginCache } from '../alphaMargin';

// NAV-1A (rulings R0.2): with the Free camera off (absent or false) the case is today's to the byte. The scene's whole DOM is
// hashed after each step of a script of drags (walk, lift, pan, pan up/down), arrows, a pinch, Reset and a double-tap in
// every view; the hashes were taken from develop fe967a7's CabinetScene before NAV-1A touched it.

const FRAME = { width: 443, height: 454 };
type P = { x: number; y: number };
const down = (el: Element, id: number, p: P) => fireEvent.pointerDown(el, { pointerId: id, clientX: p.x, clientY: p.y, button: 0 });
const move = (el: Element, id: number, p: P) => fireEvent.pointerMove(el, { pointerId: id, clientX: p.x, clientY: p.y });
const up = (el: Element, id: number, p: P) => fireEvent.pointerUp(el, { pointerId: id, clientX: p.x, clientY: p.y });

function drag(el: Element, dx: number, dy: number) {
  down(el, 1, { x: 200, y: 200 });
  for (const t of [0.25, 0.5, 0.75, 1]) move(el, 1, { x: 200 + dx * t, y: 200 + dy * t });
  up(el, 1, { x: 200 + dx, y: 200 + dy });
}

function pinch(el: Element) {
  down(el, 11, { x: 180, y: 260 });
  down(el, 12, { x: 260, y: 260 });
  move(el, 11, { x: 140, y: 260 });
  move(el, 12, { x: 300, y: 260 });
  up(el, 11, { x: 140, y: 260 });
  up(el, 12, { x: 300, y: 260 });
}

const hash = (el: Element) => createHash('sha256').update(el.outerHTML).digest('hex').slice(0, 16);

beforeEach(() => {
  __clearAlphaMarginCache();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function script(patch: Partial<CasePrefs>): string[] {
  const figures = getFixtureFigures(40);
  const prefs = (p: Partial<CasePrefs>): CasePrefs => ({ ...LEGACY_PREFS, ...patch, ...p });
  const props = { figures, onSelect: vi.fn(), frameFallback: FRAME };
  const { container, rerender } = render(<CabinetScene {...props} prefs={prefs({})} />);
  const host = () => container.querySelector('.cabinet-scene') as HTMLElement;
  const out: string[] = [];
  const snap = () => {
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    out.push(hash(host()));
  };
  const button = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
  snap();
  drag(host(), -140, 0);
  snap();
  drag(host(), 0, 60);
  snap();
  button('Next cabinet');
  snap();
  rerender(<CabinetScene {...props} prefs={prefs({ swipe: 'pan' })} />);
  drag(host(), 90, 0);
  snap();
  drag(host(), 0, -50);
  snap();
  rerender(<CabinetScene {...props} prefs={prefs({ view: 'cabinet' })} />);
  snap();
  drag(host(), -120, 30);
  snap();
  button('Next cabinet');
  snap();
  pinch(host());
  snap();
  button('Reset view');
  snap();
  rerender(<CabinetScene {...props} prefs={prefs({ view: 'shelf' })} />);
  snap();
  button('Shelf below');
  snap();
  drag(host(), 100, 0);
  snap();
  down(host(), 3, { x: 150, y: 150 });
  up(host(), 3, { x: 150, y: 150 });
  down(host(), 3, { x: 152, y: 150 });
  up(host(), 3, { x: 152, y: 150 });
  snap();
  return out;
}

/**
 * develop fe967a7, before NAV-1A; taken again at PACK1, which packs the case in its arrangement (series, then scale, then
 * name by default) and publishes it (data-arrange, data-order): with the list's order packed and those two left off, PACK1's
 * scene still gives fe967a7's hashes.
 */
const GOLDEN: string[] = ["70626e10a1b07860","d2e1de7dd65c3285","fedf418df81c3737","d0d4aa0fef59f755","500d5fe9e34db204","500d5fe9e34db204","4fad32c385f01196","2d79e85a31686d59","6d83c6ae6ff57fec","f7883af4d317fd5b","5a387671bedd6f27","9f32ad78dad6b402","d338ddfef848a450","47ee6b4c705658d7","dabdba75fa2d7b5d"];

// Each step hashes the scene's whole DOM: under coverage on CI's runner the first test took 4.0-4.4 s (Vitest's default
// is 5 s) and the second about 2.5 s. 20 s, as for the Free camera file's heavy tests
const SCRIPT_MS = 20_000;

describe('the old path, Free camera off: the scene\'s DOM is today\'s at every step', () => {
  it('prefs with no freeCamera', () => {
    const got = script({ freeCamera: undefined });
    if (process.env.PRINT_GOLDEN) console.log(JSON.stringify(got));
    expect(got).toEqual(GOLDEN);
  }, SCRIPT_MS);

  it('prefs with freeCamera: false', () => {
    expect(script({ freeCamera: false })).toEqual(GOLDEN);
  }, SCRIPT_MS);
});

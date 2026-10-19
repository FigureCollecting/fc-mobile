import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, act, cleanup } from '@testing-library/preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { CabinetScene, LONG_PRESS_MS, type CabinetSceneProps } from '../CabinetScene';
import { DEFAULT_CASE_PREFS, type CasePrefs } from '../casePrefs';
import { FIXTURE_FIGURES } from '../../../dev-fixtures/fixtures';
import { __clearAlphaMarginCache } from '../alphaMargin';

// MISFIT-CHIP-1 (Ross 10-18: the "N figures do not fit" banner "never goes away, and if it did, might not be recallable"):
// a small chip (a warning glyph and the count), bottom left, that opens the list; a dismiss on the list or a long press on
// the chip hides it until a figure that was not there misfits; the list is always recallable from outside (the View card).

beforeEach(() => __clearAlphaMarginCache());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const COVER = { width: 443, height: 558 };
const prefs = (patch: Partial<CasePrefs> = {}): CasePrefs => ({ ...DEFAULT_CASE_PREFS, ...patch });
/** Too tall for any place of the KLINGSBO (its tallest tier is 1351 mm). */
const tall = (i: number): Figure => ({ ...FIXTURE_FIGURES[0], _id: `tall-${i}`, name: `Tall Statue ${i}`, dimensions: { heightMm: 1500 } }) as Figure;
const tallOnes = (n: number, from = 0) => Array.from({ length: n }, (_, i) => tall(from + i));
/** Ross's collection has 16 misfits. */
const SIXTEEN = tallOnes(16);

function scene(figures: Figure[], patch: Partial<CasePrefs> = {}, props: Partial<CabinetSceneProps> = {}) {
  const view = (figs: Figure[], p: Partial<CasePrefs> = patch, extra: Partial<CabinetSceneProps> = props) => (
    <CabinetScene figures={figs} onSelect={vi.fn()} prefs={prefs(p)} frameFallback={COVER} {...extra} />
  );
  const utils = render(view(figures));
  const host = () => utils.container.querySelector('.cabinet-scene') as HTMLElement;
  return { ...utils, host: host(), view, rerenderWith: (figs: Figure[], p?: Partial<CasePrefs>, extra?: Partial<CabinetSceneProps>) => utils.rerender(view(figs, p, extra)) };
}
const chip = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('.cabinet-scene__misfit');
const list = (host: HTMLElement) => host.querySelector<HTMLElement>('.cabinet-scene__fit');
const dismissButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('.cabinet-scene__fit-dismiss');
const styleText = () => Array.from(document.querySelectorAll('style')).map((x) => x.textContent ?? '').join('\n');

describe('MISFIT-CHIP-1 (1): the red banner is a small chip with a warning glyph and the count; tapping it opens the list', () => {
  it('a chip, no banner: the count beside a glyph, the list closed', () => {
    const { host } = scene(SIXTEEN);
    const c = chip(host)!;
    expect(c).not.toBeNull();
    expect(c.textContent).toBe('16');
    expect(c.getAttribute('aria-label')).toBe('16 figures do not fit');
    expect(c.getAttribute('aria-expanded')).toBe('false');
    expect(c.querySelector('svg')).not.toBeNull();
    expect(list(host)).toBeNull();
    expect(host.querySelector('details')).toBeNull();
  });

  it('one misfit reads in the singular', () => {
    const { host } = scene([...FIXTURE_FIGURES, tall(0)]);
    expect(chip(host)!.textContent).toBe('1');
    expect(chip(host)!.getAttribute('aria-label')).toBe('1 figure does not fit');
  });

  it('no chip when everything fits', () => {
    expect(chip(scene(FIXTURE_FIGURES).host)).toBeNull();
  });

  it('tapping it opens the list of all sixteen, each with its reason, under a heading with the count; tapping it again closes the list', () => {
    const { host } = scene(SIXTEEN);
    fireEvent.click(chip(host)!);
    const l = list(host)!;
    expect(l).not.toBeNull();
    expect(l.dataset.count).toBe('16');
    expect(l.textContent).toContain('16 figures do not fit');
    const lines = Array.from(l.querySelectorAll('li'), (li) => li.textContent!);
    expect(lines).toHaveLength(16);
    // the 1351 mm tier less the 1 in the prefs keep above a figure (CLEAR-1)
    expect(lines[0]).toMatch(/^Tall Statue 0: too tall: 1500 mm, labeled; the most any place takes is 1325.6 mm, for the IKEA KLINGSBO glass-door cabinet$/);
    expect(chip(host)!.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(chip(host)!);
    expect(list(host)).toBeNull();
  });

  it('the long list scrolls inside its own box, short of the top of the scene', () => {
    scene(SIXTEEN);
    const css = styleText();
    const rule = /\.cabinet-scene__fit\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/overflow-y:\s*auto/);
    expect(rule).toMatch(/max-height:/);
    expect(rule).toMatch(/touch-action:\s*pan-y/);
    expect(rule).toMatch(/overscroll-behavior:\s*contain/);
  });

  it('the chip is bottom left, inset 24 px from the edge, never at the top (no frequent control up there), clear of the tab bar\'s raised +', () => {
    scene(SIXTEEN);
    const rule = /\.cabinet-scene__misfit\s*\{([^}]*)\}/.exec(styleText())?.[1] ?? '';
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/left:\s*24px/);
    expect(rule).toMatch(/bottom:\s*\d+px/);
    expect(rule).not.toMatch(/\btop:/);
  });

  it('the figures that overhang a shelf are in the count and the list too', () => {
    const deepish = Array.from({ length: 12 }, (_, i) => ({ ...FIXTURE_FIGURES[2], _id: `deepish-${i}`, name: `Deepish ${i}`, dimensions: { heightMm: 150, depthMm: 330 } }) as Figure);
    const { host } = scene([...deepish, tall(0)]);
    const over = host.querySelectorAll('.cab-figure--overhang').length;
    expect(over).toBeGreaterThan(0);
    expect(chip(host)!.textContent).toBe(String(over + 1));
    fireEvent.click(chip(host)!);
    expect(list(host)!.textContent).toContain('too deep for its shelf, it overhangs');
  });

  it('the count is published for the View card, and withdrawn when the scene goes', () => {
    const onMisfitCount = vi.fn();
    const { rerenderWith, unmount } = scene(SIXTEEN, {}, { onMisfitCount });
    expect(onMisfitCount).toHaveBeenLastCalledWith(16);
    rerenderWith(tallOnes(3), {}, { onMisfitCount });
    expect(onMisfitCount).toHaveBeenLastCalledWith(3);
    unmount();
    expect(onMisfitCount).toHaveBeenLastCalledWith(0);
  });
});

describe('MISFIT-CHIP-1 (2): a dismiss on the list, or a long press on the chip, hides the chip until a figure that was not there misfits', () => {
  it('× on the opened list closes it and hides the chip; the ids of what was dismissed go to the prefs', () => {
    const onPrefs = vi.fn();
    const { host } = scene(SIXTEEN, {}, { onPrefs });
    fireEvent.click(chip(host)!);
    fireEvent.click(dismissButton(host)!);
    expect(list(host)).toBeNull();
    expect(onPrefs).toHaveBeenCalledTimes(1);
    expect((onPrefs.mock.calls[0][0].misfitsDismissed as string[]).sort()).toEqual(SIXTEEN.map((f) => f._id).sort());
  });

  it('the dismissal holds with the prefs as the scene is given them: the chip stays away', () => {
    const { host } = scene(SIXTEEN, { misfitsDismissed: SIXTEEN.map((f) => f._id) });
    expect(chip(host)).toBeNull();
  });

  it('without a prefs hook the scene still keeps what was dismissed', () => {
    const { host } = scene(SIXTEEN);
    fireEvent.click(chip(host)!);
    fireEvent.click(dismissButton(host)!);
    expect(chip(host)).toBeNull();
  });

  it('a figure that newly misfits brings the chip back, with the new count; one that stops misfitting does not', () => {
    const ids = SIXTEEN.map((f) => f._id);
    const { host, rerenderWith } = scene(SIXTEEN, { misfitsDismissed: ids });
    expect(chip(host)).toBeNull();
    rerenderWith([...SIXTEEN, tall(16)], { misfitsDismissed: ids });
    expect(chip(host)!.textContent).toBe('17');
    // the set shrinks: nothing new misfits, it stays hidden
    rerenderWith(SIXTEEN.slice(1), { misfitsDismissed: ids });
    expect(chip(host)).toBeNull();
  });

  it('a long press on the chip hides it at once, without opening the list; a short tap opens it', () => {
    vi.useFakeTimers();
    const onPrefs = vi.fn();
    const { host } = scene(SIXTEEN, {}, { onPrefs });
    const press = (ms: number) => {
      fireEvent.pointerDown(chip(host)!, { pointerId: 3, clientX: 40, clientY: 500, button: 0 });
      act(() => {
        vi.advanceTimersByTime(ms);
      });
      fireEvent.pointerUp(chip(host) ?? host, { pointerId: 3, clientX: 40, clientY: 500 });
    };
    press(LONG_PRESS_MS - 100);
    fireEvent.click(chip(host)!);
    expect(list(host)).not.toBeNull();
    fireEvent.click(chip(host)!);
    expect(list(host)).toBeNull();
    expect(onPrefs).not.toHaveBeenCalled();
    press(LONG_PRESS_MS + 50);
    expect(chip(host)).toBeNull();
    expect(onPrefs).toHaveBeenCalledTimes(1);
    expect(list(host)).toBeNull();
  });

  it('the lift-off after a long press is not a tap on what lay beneath the chip: the click it makes is swallowed, the next tap is not', () => {
    vi.useFakeTimers();
    const { host } = scene([...FIXTURE_FIGURES, ...SIXTEEN], {}, { onPrefs: vi.fn() });
    fireEvent.pointerDown(chip(host)!, { pointerId: 3, clientX: 40, clientY: 500, button: 0 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS + 50);
    });
    expect(chip(host)).toBeNull();
    const figure = host.querySelector('button.cab-figure') as HTMLElement;
    const clicked = fireEvent.click(figure);
    // swallowed: the scene stopped it before the figure's own handler
    expect(clicked).toBe(false);
    // a new touch ends what was left to swallow
    fireEvent.pointerDown(host, { pointerId: 4, clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerUp(host, { pointerId: 4, clientX: 200, clientY: 200 });
    expect(fireEvent.click(figure)).toBe(true);
  });

  it('a press on the chip makes no context menu', () => {
    const { host } = scene(SIXTEEN);
    expect(fireEvent.contextMenu(chip(host)!)).toBe(false);
  });

  it('a press that wanders off the chip is no long press', () => {
    vi.useFakeTimers();
    const onPrefs = vi.fn();
    const { host } = scene(SIXTEEN, {}, { onPrefs });
    fireEvent.pointerDown(chip(host)!, { pointerId: 3, clientX: 40, clientY: 500, button: 0 });
    fireEvent.pointerMove(chip(host)!, { pointerId: 3, clientX: 40, clientY: 460 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS + 100);
    });
    expect(onPrefs).not.toHaveBeenCalled();
    expect(chip(host)).not.toBeNull();
  });
});

describe('MISFIT-CHIP-1 (3): the list is always recallable from outside, whether or not the chip is hidden', () => {
  it('opened from outside (the View card): the list shows with the chip dismissed, × closes it and says so', () => {
    const onMisfitsOpen = vi.fn();
    const ids = SIXTEEN.map((f) => f._id);
    const { host, rerenderWith } = scene(SIXTEEN, { misfitsDismissed: ids }, { misfitsOpen: false, onMisfitsOpen });
    expect(chip(host)).toBeNull();
    rerenderWith(SIXTEEN, { misfitsDismissed: ids }, { misfitsOpen: true, onMisfitsOpen });
    expect(list(host)).not.toBeNull();
    expect(list(host)!.querySelectorAll('li')).toHaveLength(16);
    fireEvent.click(dismissButton(host)!);
    expect(onMisfitsOpen).toHaveBeenLastCalledWith(false);
  });

  it('tapping the chip asks the owner of the open state to open the list', () => {
    const onMisfitsOpen = vi.fn();
    const { host } = scene(SIXTEEN, {}, { misfitsOpen: false, onMisfitsOpen });
    fireEvent.click(chip(host)!);
    expect(onMisfitsOpen).toHaveBeenLastCalledWith(true);
  });

  it('a list left open when the last misfit goes is not drawn', () => {
    const { host, rerenderWith } = scene(tallOnes(2), {}, { misfitsOpen: true });
    expect(list(host)).not.toBeNull();
    rerenderWith(FIXTURE_FIGURES, {}, { misfitsOpen: true });
    expect(list(host)).toBeNull();
    expect(chip(host)).toBeNull();
  });
});

describe('MISFIT-CHIP-1 (4): the scene\'s gestures leave the chip and its list alone', () => {
  it('a drag that starts on the open list scrolls the list: the camera does not move', () => {
    const { host } = scene(SIXTEEN, { view: 'cabinet', swipe: 'camera' }, { misfitsOpen: true });
    const before = host.dataset.camera;
    const l = list(host)!;
    fireEvent.pointerDown(l, { pointerId: 1, clientX: 200, clientY: 400, button: 0 });
    fireEvent.pointerMove(l, { pointerId: 1, clientX: 200, clientY: 330 });
    fireEvent.pointerMove(l, { pointerId: 1, clientX: 200, clientY: 250 });
    fireEvent.pointerUp(l, { pointerId: 1, clientX: 200, clientY: 250 });
    expect(host.dataset.camera).toBe(before);
    expect(host.dataset.zoom).toBe(JSON.stringify({ k: 1, x: 0, y: 0 }));
  });

  it('a tap on the chip right after a drag of the scene still opens the list: the drag\'s swallowed click does not eat it', () => {
    const { host } = scene(SIXTEEN, { view: 'cabinet', swipe: 'camera' });
    fireEvent.pointerDown(host, { pointerId: 1, clientX: 200, clientY: 200, button: 0 });
    fireEvent.pointerMove(host, { pointerId: 1, clientX: 140, clientY: 200 });
    fireEvent.pointerMove(host, { pointerId: 1, clientX: 80, clientY: 200 });
    fireEvent.pointerUp(host, { pointerId: 1, clientX: 80, clientY: 200 });
    fireEvent.pointerDown(chip(host)!, { pointerId: 2, clientX: 40, clientY: 500, button: 0 });
    fireEvent.pointerUp(chip(host)!, { pointerId: 2, clientX: 40, clientY: 500 });
    fireEvent.click(chip(host)!);
    expect(list(host)).not.toBeNull();
  });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissPreSplash, SPLASH_FADE_MS, SPLASH_GROW_MS, SPLASH_HANDOVER_MS, SPLASH_HOLD_MS, SPLASH_MIN_MS, SPLASH_SHOW_MS } from '../preSplash';

const ROOT = path.resolve(__dirname, '../../..');

const el = (): HTMLElement | null => document.getElementById('pre-splash');
const hidden = (): boolean => el()?.classList.contains('pre-splash--hidden') ?? false;

describe('dismissPreSplash', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="pre-splash" class="pre-splash"></div><div id="app"></div>';
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('holds a fast load until the figure has grown and held its beat, then fades for the fade duration: gone SPLASH_MIN_MS after first paint', () => {
    dismissPreSplash({ now: () => 150, firstPaintAt: 50, reducedMotion: false });
    // 100 ms since first paint: 2,400 ms of growth and beat to go.
    vi.advanceTimersByTime(SPLASH_SHOW_MS - 100 - 1);
    expect(hidden()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(hidden()).toBe(true);
    expect(el()).not.toBeNull();
    vi.advanceTimersByTime(SPLASH_FADE_MS - 1);
    expect(el()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(el()).toBeNull();
  });

  it('measures the growth and the beat from first paint, not from navigation start', () => {
    dismissPreSplash({ now: () => 1000, firstPaintAt: 900, reducedMotion: false });
    vi.advanceTimersByTime(SPLASH_SHOW_MS - 100 - 1);
    expect(hidden()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(hidden()).toBe(true);
  });

  it('a load that mounts part way through the growth waits only for the rest of it and the beat', () => {
    dismissPreSplash({ now: () => 2100, firstPaintAt: 100, reducedMotion: false });
    vi.advanceTimersByTime(SPLASH_SHOW_MS - 2000 - 1);
    expect(hidden()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(hidden()).toBe(true);
  });

  it('starts the fade at once on mount when the load took longer than the growth and the beat', () => {
    dismissPreSplash({ now: () => 5000, firstPaintAt: 100, reducedMotion: false });
    expect(hidden()).toBe(true); // no timer advanced: no extra wait
    vi.advanceTimersByTime(SPLASH_FADE_MS);
    expect(el()).toBeNull();
  });

  it('starts the fade at once when the growth and the beat have exactly elapsed', () => {
    dismissPreSplash({ now: () => 100 + SPLASH_SHOW_MS, firstPaintAt: 100, reducedMotion: false });
    expect(hidden()).toBe(true);
  });

  it('holds the whole growth and beat when first paint is unknown (nothing has painted yet)', () => {
    dismissPreSplash({ now: () => 80, reducedMotion: false });
    vi.advanceTimersByTime(SPLASH_SHOW_MS - 1);
    expect(hidden()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(hidden()).toBe(true);
  });

  it('with reduced motion holds 2.5 s from first paint (no growth), then disappears instantly, with no fade', () => {
    dismissPreSplash({ now: () => 100, firstPaintAt: 100, reducedMotion: true });
    vi.advanceTimersByTime(SPLASH_SHOW_MS - 1);
    expect(el()).not.toBeNull();
    expect(hidden()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(el()).toBeNull();
  });

  it('with reduced motion and a slow load, removes it on mount', () => {
    dismissPreSplash({ now: () => 5000, firstPaintAt: 100, reducedMotion: true });
    expect(el()).toBeNull();
  });

  it('reads the browser clock, first-paint entry and reduced-motion query by default', () => {
    const entry = { startTime: 40 } as PerformanceEntry;
    vi.spyOn(performance, 'getEntriesByName').mockReturnValue([entry]);
    vi.spyOn(performance, 'now').mockReturnValue(5040);
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(prefers-reduced-motion: reduce)' }));
    dismissPreSplash();
    expect(performance.getEntriesByName).toHaveBeenCalledWith('first-paint');
    expect(el()).toBeNull(); // slow load + reduced motion: gone on mount
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('copes with a browser that has no first-paint entry and no matchMedia', () => {
    vi.spyOn(performance, 'getEntriesByName').mockReturnValue([]);
    vi.stubGlobal('matchMedia', undefined);
    dismissPreSplash();
    vi.advanceTimersByTime(SPLASH_SHOW_MS);
    expect(hidden()).toBe(true);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does nothing when there is no splash (an in-app navigation, a second call)', () => {
    document.body.innerHTML = '';
    dismissPreSplash({ now: () => 0, firstPaintAt: 0, reducedMotion: false });
    vi.runAllTimers();
    expect(document.body.innerHTML).toBe('');
  });
});

describe('the static splash markup', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'src/styles/pre-splash.css'), 'utf8');

  const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // One rule's declarations, whitespace folded.
  const rule = (selector: string): string =>
    css.match(new RegExp(`(?:^|\\n)${escaped(selector)}\\s*\\{([^}]*)\\}`))?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
  const keyframes = (name: string): string =>
    css.match(new RegExp(`@keyframes ${escaped(name)}\\s*\\{([\\s\\S]*?\\})\\s*\\}`))?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
  const growth = `${SPLASH_GROW_MS - SPLASH_HANDOVER_MS}ms ease-out ${SPLASH_HANDOVER_MS}ms both`;

  /** The rules inside the @supports (height: 1cqh) block (the target geometry), whitespace folded. */
  const supported = (selector: string): string => {
    const block = css.match(/@supports \(height: 1cqh\) \{([\s\S]*?)\n\}\n/)?.[1] ?? '';
    return block.match(new RegExp(`\\n  ${escaped(selector)}\\s*\\{([^}]*)\\}`))?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
  };

  it('lasts 3 s (Ross, 10-18): the figure grows to its target by 2.2 s, holds a beat of 0.3 s, then the splash fades over 0.5 s', () => {
    expect(SPLASH_GROW_MS).toBe(2200);
    expect(SPLASH_HOLD_MS).toBe(300);
    expect(SPLASH_FADE_MS).toBe(500);
    expect(SPLASH_SHOW_MS).toBe(SPLASH_GROW_MS + SPLASH_HOLD_MS);
    expect(SPLASH_MIN_MS).toBe(3000);
    expect(SPLASH_SHOW_MS + SPLASH_FADE_MS).toBe(SPLASH_MIN_MS);
    expect(rule('.pre-splash')).toContain(`transition: opacity ${SPLASH_FADE_MS}ms`);
  });

  it("holds the system splash's size while Chrome fades its own splash (300 ms), then grows ease-out to its target", () => {
    // Chromium WebappSplashController.HIDE_ANIMATION_DURATION_MS, started at the page's first paint
    expect(SPLASH_HANDOVER_MS).toBe(300);
    expect(rule('.pre-splash__art')).toContain(`animation: pre-splash-grow ${growth};`);
    expect(keyframes('pre-splash-grow')).toBe('from { height: var(--pre-splash-start-height); }');
  });

  it('fades the name in with the growth', () => {
    expect(rule('.pre-splash__text')).toContain(`animation: pre-splash-name ${growth};`);
    expect(keyframes('pre-splash-name')).toBe('from { opacity: 0; } to { opacity: 1; }');
  });

  it("SPLASH-3: the figure's target is 84 % of the window's height (SP4, plan B), shrunk to keep the group inside the safe areas and a margin", () => {
    expect(supported('.pre-splash')).toContain('container-type: size;');
    for (const side of ['top', 'right', 'bottom', 'left']) expect(supported('.pre-splash')).toContain(`env(safe-area-inset-${side}, 0px)`);
    expect(supported('.pre-splash')).toContain('padding: var(--safe-t) var(--safe-r) var(--safe-b) var(--safe-l);');
    const target = supported('.pre-splash').match(/--pre-splash-figure: min\((.*)\);/)?.[1] ?? '';
    expect(supported('.pre-splash')).toContain('--pre-splash-target: 0.84;');
    expect(target).toContain('(100cqh + var(--safe-t) + var(--safe-b)) * var(--pre-splash-target)');
    expect(target).toContain('(100cqh - 2 * var(--pre-splash-margin)) / 1.1375');
    expect(target).toContain('(100cqw - 2 * var(--pre-splash-margin)) / 0.705');
    expect(supported('.pre-splash__art')).toBe('height: var(--pre-splash-figure);');
  });

  it('SPLASH-3: the name is 1.8x the old size (22 px to 0.0775 of the figure, 39.6 px at the target) and lower, a gap of 6 % of the figure below it', () => {
    const text = supported('.pre-splash__text');
    expect(text).toContain('font-size: calc(var(--pre-splash-figure) * 0.0775);');
    expect(text).toContain('margin-top: calc(var(--pre-splash-figure) * 0.06);');
    // in the 614 px window of the installed Fold8 cover: 84 % = 516 px figure, the name 40 px: 1.8 x 22 px
    expect(516 * 0.0775).toBeCloseTo(1.8 * 22, 0);
  });

  it("SPLASH-3: 84 % of the window is what the group allows: 90.1 % (Ross's 73 % of a screen the window is 81 % of) would need 102.5 % of it", () => {
    // the figure, the gap and the name are 1.1375 of the figure's height; the margin kept clear is 2 % of the box at each end
    expect(0.84 * 1.1375).toBeLessThanOrEqual(1 - 2 * 0.02);
    expect(0.901 * 1.1375).toBeGreaterThan(1);
    // Ross's 72.9 % of the screen is 83.3 % of the installed window (1726 of the screenshot's 1972 px: 87.5 %)
    expect(0.729 / (1726 / 1972)).toBeCloseTo(0.84, 1);
  });

  it("SPLASH-3: the figure, the gap and the name stand as one group centred in the usable box: the group lifts by half of what hangs below the figure as it grows", () => {
    // gap 0.06 + the name 0.0775 of the figure hang below it: half of 0.1375 is 0.06875
    expect(supported('.pre-splash__stack')).toContain(`animation: pre-splash-lift ${growth};`);
    expect(css).toMatch(/@keyframes pre-splash-lift \{\s*to \{ transform: translateY\(calc\(var\(--pre-splash-figure\) \* -0\.06875\)\); \}/);
    expect((0.06 + 0.0775) / 2).toBeCloseTo(0.06875, 9);
  });

  it("grows the figure about the screen's centre, where the system splash drew the icon: the name sits below it, out of the flow", () => {
    expect(rule('.pre-splash')).toMatch(/align-items: center;.*justify-content: center;/);
    expect(rule('.pre-splash__stack')).toContain('position: relative;');
    expect(rule('.pre-splash__text')).toMatch(/position: absolute;.*top: 100%;/);
  });

  it('has no growth, no name fade, no lift and no splash fade under reduced motion; the group stands centred where the lift would end', () => {
    const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/)?.[1]?.replace(/\s+/g, ' ') ?? '';
    expect(reduced).toContain('.pre-splash { transition: none; }');
    expect(reduced).toContain('.pre-splash__art, .pre-splash__text { animation: none; }');
    expect(reduced).toContain('.pre-splash__stack { animation: none; transform: translateY(calc(var(--pre-splash-figure) * -0.06875)); }');
  });

  it('shows the figure silhouette above the name, painted from the HTML itself', () => {
    const splash = html.slice(html.indexOf('id="pre-splash"'), html.indexOf('id="app"'));
    expect(splash).toMatch(/<svg[^>]*class="pre-splash__art"[^>]*viewBox="[-\d. ]+"/);
    expect(splash).toMatch(/<path d="M[^"]+"/);
    expect(splash.indexOf('<svg')).toBeLessThan(splash.indexOf('FigureCollecting'));
    // the art and the name in one stack, centred on the art
    expect(splash).toMatch(/<div class="pre-splash__stack">\s*<!-- brand:splash-art -->[\s\S]*<\/svg>\s*<!-- \/brand:splash-art -->\s*<span class="pre-splash__text">FigureCollecting<\/span>\s*<\/div>/);
  });

  it('is CSP-safe: no inline script, no style attribute, no inline <style>', () => {
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toMatch(/<style[\s>]/);
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/\son[a-z]+=/);
  });
});

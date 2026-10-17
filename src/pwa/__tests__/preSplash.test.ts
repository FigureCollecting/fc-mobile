import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissPreSplash, SPLASH_FADE_MS, SPLASH_GROW_MS, SPLASH_HANDOVER_MS, SPLASH_MIN_MS } from '../preSplash';

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

  it('holds a fast load until the figure has grown, then fades for the fade duration: gone SPLASH_MIN_MS after first paint', () => {
    dismissPreSplash({ now: () => 150, firstPaintAt: 50, reducedMotion: false });
    // 100 ms since first paint: 3,400 ms of growth to go.
    vi.advanceTimersByTime(SPLASH_GROW_MS - 100 - 1);
    expect(hidden()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(hidden()).toBe(true);
    expect(el()).not.toBeNull();
    vi.advanceTimersByTime(SPLASH_FADE_MS - 1);
    expect(el()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(el()).toBeNull();
  });

  it('measures the growth from first paint, not from navigation start', () => {
    dismissPreSplash({ now: () => 1000, firstPaintAt: 900, reducedMotion: false });
    vi.advanceTimersByTime(SPLASH_GROW_MS - 100 - 1);
    expect(hidden()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(hidden()).toBe(true);
  });

  it('a load that mounts part way through the growth waits only for the rest of it', () => {
    dismissPreSplash({ now: () => 2100, firstPaintAt: 100, reducedMotion: false });
    vi.advanceTimersByTime(SPLASH_GROW_MS - 2000 - 1);
    expect(hidden()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(hidden()).toBe(true);
  });

  it('starts the fade at once on mount when the load took longer than the growth', () => {
    dismissPreSplash({ now: () => 5000, firstPaintAt: 100, reducedMotion: false });
    expect(hidden()).toBe(true); // no timer advanced: no extra wait
    vi.advanceTimersByTime(SPLASH_FADE_MS);
    expect(el()).toBeNull();
  });

  it('starts the fade at once when the growth has exactly elapsed', () => {
    dismissPreSplash({ now: () => 100 + SPLASH_GROW_MS, firstPaintAt: 100, reducedMotion: false });
    expect(hidden()).toBe(true);
  });

  it('holds the whole growth when first paint is unknown (nothing has painted yet)', () => {
    dismissPreSplash({ now: () => 80, reducedMotion: false });
    vi.advanceTimersByTime(SPLASH_GROW_MS - 1);
    expect(hidden()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(hidden()).toBe(true);
  });

  it('with reduced motion holds 3.5 s from first paint (no growth), then disappears instantly, with no fade', () => {
    dismissPreSplash({ now: () => 100, firstPaintAt: 100, reducedMotion: true });
    vi.advanceTimersByTime(SPLASH_GROW_MS - 1);
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
    vi.advanceTimersByTime(SPLASH_GROW_MS);
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

  // One rule's declarations, whitespace folded.
  const rule = (selector: string): string =>
    css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`))?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
  const keyframes = (name: string): string =>
    css.match(new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?\\})\\s*\\}`))?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
  const growth = `${SPLASH_GROW_MS - SPLASH_HANDOVER_MS}ms ease-out ${SPLASH_HANDOVER_MS}ms both`;

  it('lasts 4 s (Ross, 10-16): the figure grows for 3.5 s, then the splash fades over 0.5 s', () => {
    expect(SPLASH_MIN_MS).toBe(4000);
    expect(SPLASH_GROW_MS).toBe(3500);
    expect(SPLASH_FADE_MS).toBe(500);
    expect(SPLASH_GROW_MS + SPLASH_FADE_MS).toBe(SPLASH_MIN_MS);
    expect(rule('.pre-splash')).toContain(`transition: opacity ${SPLASH_FADE_MS}ms`);
  });

  it("holds the system splash's size while Chrome fades its own splash (300 ms), then grows ease-out to full size", () => {
    // Chromium WebappSplashController.HIDE_ANIMATION_DURATION_MS, started at the page's first paint
    expect(SPLASH_HANDOVER_MS).toBe(300);
    expect(rule('.pre-splash__art')).toContain(`animation: pre-splash-grow ${growth};`);
    expect(rule('.pre-splash__art')).toContain('height: min(46vh, 22rem);');
    expect(keyframes('pre-splash-grow')).toBe('from { height: var(--pre-splash-start-height); }');
  });

  it('fades the name in with the growth', () => {
    expect(rule('.pre-splash__text')).toContain(`animation: pre-splash-name ${growth};`);
    expect(keyframes('pre-splash-name')).toBe('from { opacity: 0; } to { opacity: 1; }');
  });

  it("grows the figure about the screen's centre, where the system splash drew the icon: the name sits below it, out of the flow", () => {
    expect(rule('.pre-splash')).toMatch(/align-items: center;.*justify-content: center;/);
    expect(rule('.pre-splash__stack')).toContain('position: relative;');
    expect(rule('.pre-splash__text')).toMatch(/position: absolute;.*top: 100%;/);
  });

  it('has no growth, no name fade and no splash fade under reduced motion', () => {
    const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/)?.[1]?.replace(/\s+/g, ' ') ?? '';
    expect(reduced).toContain('.pre-splash { transition: none; }');
    expect(reduced).toContain('.pre-splash__art, .pre-splash__text { animation: none; }');
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

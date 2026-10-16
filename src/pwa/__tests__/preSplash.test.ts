import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissPreSplash, SPLASH_FADE_MS, SPLASH_MIN_MS } from '../preSplash';

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

  it('holds a fast load to the minimum, then fades for the fade duration and removes it', () => {
    dismissPreSplash({ now: () => 150, firstPaintAt: 50, reducedMotion: false });
    // 100 ms since first paint: 500 ms to go.
    vi.advanceTimersByTime(SPLASH_MIN_MS - 100 - 1);
    expect(hidden()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(hidden()).toBe(true);
    expect(el()).not.toBeNull();
    vi.advanceTimersByTime(SPLASH_FADE_MS - 1);
    expect(el()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(el()).toBeNull();
  });

  it('measures the minimum from first paint, not from navigation start', () => {
    dismissPreSplash({ now: () => 1000, firstPaintAt: 900, reducedMotion: false });
    vi.advanceTimersByTime(SPLASH_MIN_MS - 100 - 1);
    expect(hidden()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(hidden()).toBe(true);
  });

  it('starts the fade at once on mount when the load already took longer than the minimum', () => {
    dismissPreSplash({ now: () => 5000, firstPaintAt: 100, reducedMotion: false });
    expect(hidden()).toBe(true); // no timer advanced: no extra wait
    vi.advanceTimersByTime(SPLASH_FADE_MS);
    expect(el()).toBeNull();
  });

  it('starts the fade at once when the minimum has exactly elapsed', () => {
    dismissPreSplash({ now: () => 100 + SPLASH_MIN_MS, firstPaintAt: 100, reducedMotion: false });
    expect(hidden()).toBe(true);
  });

  it('holds the full minimum when first paint is unknown (nothing has painted yet)', () => {
    dismissPreSplash({ now: () => 80, reducedMotion: false });
    vi.advanceTimersByTime(SPLASH_MIN_MS - 1);
    expect(hidden()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(hidden()).toBe(true);
  });

  it('with reduced motion keeps the minimum, then disappears instantly, with no fade', () => {
    dismissPreSplash({ now: () => 100, firstPaintAt: 100, reducedMotion: true });
    vi.advanceTimersByTime(SPLASH_MIN_MS - 1);
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
    vi.advanceTimersByTime(SPLASH_MIN_MS);
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

  it('fades over SPLASH_FADE_MS in the stylesheet', () => {
    expect(SPLASH_MIN_MS).toBe(600);
    expect(SPLASH_FADE_MS).toBe(300);
    expect(css).toMatch(new RegExp(`transition:\\s*opacity ${SPLASH_FADE_MS}ms`));
  });

  it('has no fade under reduced motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{[^}]*\.pre-splash\s*{[^}]*transition:\s*none/);
  });

  it('shows the figure silhouette above the name, painted from the HTML itself', () => {
    const splash = html.slice(html.indexOf('id="pre-splash"'), html.indexOf('id="app"'));
    expect(splash).toMatch(/<svg[^>]*class="pre-splash__art"[^>]*viewBox="[-\d. ]+"/);
    expect(splash).toMatch(/<path d="M[^"]+"/);
    expect(splash.indexOf('<svg')).toBeLessThan(splash.indexOf('FigureCollecting'));
  });

  it('is CSP-safe: no inline script, no style attribute, no inline <style>', () => {
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toMatch(/<style[\s>]/);
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/\son[a-z]+=/);
  });
});

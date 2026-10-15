// The static splash in index.html (the figure silhouette over the name) is
// painted before any script runs. This holds it at least SPLASH_MIN_MS from
// first paint, then fades it over SPLASH_FADE_MS (src/styles/pre-splash.css
// uses the same figure). A slow load has already used the minimum, so the
// fade starts on mount with no extra wait. No inline script: a strict CSP
// forbids it.
export const SPLASH_MIN_MS = 600;
export const SPLASH_FADE_MS = 300;

export interface PreSplashOptions {
  doc?: Document;
  /** ms on the page's clock (performance.now) */
  now?: () => number;
  /** ms on the same clock when the splash first painted; unknown = nothing has painted yet, so now */
  firstPaintAt?: number;
  reducedMotion?: boolean;
}

function firstPaintTime(): number | undefined {
  return performance.getEntriesByName('first-paint')[0]?.startTime;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function dismissPreSplash(options: PreSplashOptions = {}): void {
  const doc = options.doc ?? document;
  const now = options.now ?? (() => performance.now());
  const el = doc.getElementById('pre-splash');
  if (el === null) return;

  const current = now();
  const paintedAt = options.firstPaintAt ?? firstPaintTime() ?? current;
  const reducedMotion = options.reducedMotion ?? prefersReducedMotion();

  const hide = (): void => {
    if (reducedMotion) {
      el.remove();
      return;
    }
    el.classList.add('pre-splash--hidden');
    setTimeout(() => el.remove(), SPLASH_FADE_MS);
  };

  const wait = Math.max(0, SPLASH_MIN_MS - (current - paintedAt));
  if (wait === 0) hide();
  else setTimeout(hide, wait);
}

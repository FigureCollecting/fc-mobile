// The static splash in index.html (the figure silhouette over the name) is
// painted before any script runs. Its figure starts at the size Android's
// system splash drew it (deploy/brandArt.ts splashStartHeight) and holds it for
// SPLASH_HANDOVER_MS, while Chrome fades its own splash out over the first
// paint, then grows to full size and the name fades in, SPLASH_GROW_MS from
// first paint (src/styles/pre-splash.css). This then fades the splash over
// SPLASH_FADE_MS: SPLASH_MIN_MS in all. A load slower than the growth fades it
// on mount with no extra wait. With reduced motion the figure stands at full
// size and the splash goes at once after SPLASH_GROW_MS. No inline script: a
// strict CSP forbids it.
/** Chromium WebappSplashController.HIDE_ANIMATION_DURATION_MS: Chrome's splash fades out over the page's first paint. */
export const SPLASH_HANDOVER_MS = 300;
/** Ross, 10-16: from first paint until the figure is full size (the hand-over hold, then the growth). */
export const SPLASH_GROW_MS = 3500;
export const SPLASH_FADE_MS = 500;
/** From first paint until the splash is gone: 4 s (Ross, 10-16: "at least 1 s longer" than 2 s, and the figure grows). */
export const SPLASH_MIN_MS = SPLASH_GROW_MS + SPLASH_FADE_MS;

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

  const wait = Math.max(0, SPLASH_GROW_MS - (current - paintedAt));
  if (wait === 0) hide();
  else setTimeout(hide, wait);
}

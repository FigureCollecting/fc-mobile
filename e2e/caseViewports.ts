/**
 * The one list of phone viewport sizes (CSS px) the case-view e2e and
 * screenshot tests run at. The Fold8 entries are Ross's measurements on his
 * Galaxy Z Fold8 (window.innerWidth x innerHeight, devicePixelRatio 2.8125),
 * in the four ways he holds it. The tests compare CSS pixels at a device
 * pixel ratio of 1; the layout is the same at any ratio.
 */
export interface CaseViewport {
  name: string;
  width: number;
  height: number;
}

export const CASE_VIEWPORTS: CaseViewport[] = [
  { name: 'fold8-cover', width: 443, height: 558 },
  { name: 'fold8-cover-sideways', width: 616, height: 357 },
  { name: 'fold8-open', width: 870, height: 475 },
  { name: 'fold8-open-rotated', width: 657, height: 687 },
  { name: 'android', width: 412, height: 915 },
];

/** Ross's Fold8 reports this devicePixelRatio on both screens. */
export const FOLD8_DPR = 2.8125;

/**
 * A sign-off size: one Playwright project each (playwright.config.ts), whose
 * full-frame PNGs (e2e/signoffShots.ts) come out at `png` device pixels,
 * within SHOT_TOLERANCE_PX.
 */
export interface ShotViewport extends CaseViewport {
  deviceScaleFactor: number;
  /** A phone: touch, and a mobile viewport. */
  mobile: boolean;
  png: { width: number; height: number };
}

/**
 * The Fold8's full panels (cover 1248 x 1972, main 2448 x 1848, and the main
 * screen turned), the upper bound for the installed app until its standalone
 * sizes are measured, and the desktop window.
 */
export const SHOT_VIEWPORTS: ShotViewport[] = [
  { name: 'fold8-cover-full', width: 444, height: 701, deviceScaleFactor: FOLD8_DPR, mobile: true, png: { width: 1248, height: 1972 } },
  { name: 'fold8-open-full', width: 870, height: 657, deviceScaleFactor: FOLD8_DPR, mobile: true, png: { width: 2448, height: 1848 } },
  { name: 'fold8-open-rotated-full', width: 657, height: 870, deviceScaleFactor: FOLD8_DPR, mobile: true, png: { width: 1848, height: 2448 } },
  { name: 'desktop', width: 1536, height: 730, deviceScaleFactor: 1, mobile: false, png: { width: 1536, height: 730 } },
];

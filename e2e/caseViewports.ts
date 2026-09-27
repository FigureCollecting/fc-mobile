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

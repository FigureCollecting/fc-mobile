/**
 * The one list of phone viewport sizes (CSS px) the case-view e2e and
 * screenshot tests run at. The Fold8 entries are ESTIMATES (device pixels
 * at an assumed DPR of 2.625); replace them with the values measured on the
 * device (window.innerWidth x innerHeight) and re-baseline the screenshots.
 */
export interface CaseViewport {
  name: string;
  width: number;
  height: number;
}

export const CASE_VIEWPORTS: CaseViewport[] = [
  { name: 'fold8-cover-est', width: 475, height: 751 },
  { name: 'fold8-open-portrait-est', width: 704, height: 933 },
  { name: 'fold8-open-landscape-est', width: 933, height: 704 },
  { name: 'fold5-cover', width: 344, height: 882 },
  { name: 'fold5-open', width: 690, height: 829 },
  { name: 'android', width: 412, height: 915 },
];

import { CASE_PREFS_KEY, DEFAULT_CASE_PREFS, type CasePrefs } from '../components/display/casePrefs';

// NAV-2A0: the case with Free camera off (the old path), for the tests written against it. NAV-2A makes Free camera the
// default; these tests keep testing the old path until NAV-GRADUATE-1 retires it.

/** The default case prefs with Free camera off. */
export const LEGACY_PREFS: CasePrefs = { ...DEFAULT_CASE_PREFS, freeCamera: false };

/** For a test that reads the case prefs from storage: Free camera off on this device, every other pref its default. */
export function storeLegacyCamera(): void {
  localStorage.setItem(CASE_PREFS_KEY, JSON.stringify({ freeCamera: false }));
}

import type { BrowserContext, Page } from '@playwright/test';
import { CASE_PREFS_KEY } from '../src/components/display/casePrefs';

// NAV-2A0: the specs written against the old case path (Free camera off) say so, so that making Free camera the
// default (NAV-2A) leaves each testing what it tests. NAV-GRADUATE-1 retires the old path, and these pins with it.

/** A spec's own case prefs (what it stores under fc-case-prefs), with Free camera off unless they say otherwise. */
export function legacyPrefs<T extends object>(prefs: T): { freeCamera: boolean } & T {
  return { freeCamera: false, ...prefs };
}

/**
 * For a spec that stores no case prefs of its own: Free camera off before the app reads its prefs, on every load, kept
 * with whatever the app has stored by then (a pref the test set, then a reload, still finds it).
 */
export async function pinLegacyCamera(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript((key) => {
    let stored: unknown = null;
    try {
      stored = JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
      /* unreadable: the app falls back to its defaults, as it would anyway */
    }
    localStorage.setItem(key, JSON.stringify({ ...(typeof stored === 'object' && stored !== null ? stored : {}), freeCamera: false }));
  }, CASE_PREFS_KEY);
}

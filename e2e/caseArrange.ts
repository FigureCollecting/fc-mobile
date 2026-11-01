import type { BrowserContext, Page } from '@playwright/test';
import { CASE_PREFS_KEY } from '../src/components/display/casePrefs';
import type { CaseArrangement } from '../src/components/display/caseArrangement';

/**
 * PACK1: the case stands its figures in `arrangement` on every load, kept with whatever else the app has stored in its
 * prefs by then. For a spec that tests something other than the arrangement but depends on what the wall opens with.
 */
export async function arrangeCase(target: Page | BrowserContext, arrangement: CaseArrangement): Promise<void> {
  await target.addInitScript(
    ([key, arrange]) => {
      let stored: unknown = null;
      try {
        stored = JSON.parse(localStorage.getItem(key) ?? 'null');
      } catch {
        /* unreadable: the app falls back to its defaults, as it would anyway */
      }
      localStorage.setItem(key, JSON.stringify({ ...(typeof stored === 'object' && stored !== null ? stored : {}), arrange }));
    },
    [CASE_PREFS_KEY, arrangement] as const,
  );
}

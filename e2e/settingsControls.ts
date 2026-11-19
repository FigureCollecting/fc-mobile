import type { Page, TestInfo } from '@playwright/test';
import { expect } from './fixtures';
import { signoffShot } from './signoffShots';

/**
 * DEAD-CONTROLS: Settings shows none of the controls whose keys nothing but Settings read (Sync Owned / Ordered /
 * Wished, Price Alerts, Sync Complete, Auto-Sync Interval), so no Notifications or Sync section in this build, and no
 * Delete Account button (it reached no server). Shared by e2e/settings-controls.spec.ts and settings.shots.spec.ts.
 */

export const DEAD_KEYS = ['fc-sync-owned', 'fc-sync-ordered', 'fc-sync-wished', 'fc-price-alerts', 'fc-sync-notifs', 'fc-sync-interval'] as const;
const DEAD_LABELS = ['Sync Owned', 'Sync Ordered', 'Sync Wished', 'Price Alerts', 'Sync Complete', 'Auto-Sync Interval'];

/** Opens Settings with the six old keys stored (non-default values), logging every read or write of them from the first script on. */
export async function openSettings(page: Page): Promise<void> {
  await page.addInitScript((keys) => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    for (const k of keys) localStorage.setItem(k, k === 'fc-sync-interval' ? 'daily' : 'false');
    const log: string[] = [];
    (window as unknown as { __deadKeyLog: string[] }).__deadKeyLog = log;
    for (const op of ['getItem', 'setItem', 'removeItem'] as const) {
      const orig = Storage.prototype[op] as (...a: unknown[]) => unknown;
      Storage.prototype[op] = function (this: Storage, ...a: unknown[]) {
        if ((keys as readonly string[]).includes(String(a[0]))) log.push(`${op} ${String(a[0])}`);
        return orig.apply(this, a);
      } as never;
    }
  }, DEAD_KEYS);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 3, name: 'Account' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
}

/**
 * Stills of the Data & Storage section (Notifications and Sync followed it) and the Account section, each scrolled to
 * the middle, as sign-off PNGs named `<prefix>-storage` and `<prefix>-account`.
 */
export async function settingsStills(page: Page, testInfo: TestInfo, prefix: string): Promise<string[]> {
  const paths: string[] = [];
  for (const [title, name] of [['Data & Storage', 'storage'], ['Account', 'account']] as const) {
    // Centred, clear of the header and the tab bar; the last section stops at the end of the scroll.
    await page.getByRole('heading', { level: 3, name: title }).evaluate((h) => h.closest('section')!.scrollIntoView({ block: 'center' }));
    paths.push((await signoffShot(page, testInfo, `${prefix}-${name}`)).path);
  }
  return paths;
}

/** Appearance, Data & Storage, About and Account stay; Account holds only Change Password; nothing reads the old keys. */
export async function expectNoDeadControls(page: Page): Promise<void> {
  const titles = (await page.getByRole('heading', { level: 3 }).allTextContents()).filter((t) => t !== 'Privacy');
  expect(titles).toEqual(['Appearance', 'Data & Storage', 'About', 'Account']);

  for (const label of DEAD_LABELS) await expect(page.getByText(label, { exact: true })).toHaveCount(0);
  // The only switch left is the Diagnostic ids one, in a build made with VITE_DIAG_IDS=true.
  await expect(page.locator('[role="switch"]:not([aria-labelledby="settings-diag-ids"])')).toHaveCount(0);
  await expect(page.getByRole('combobox')).toHaveCount(0);

  await expect(page.getByText(/delete (my )?account/i)).toHaveCount(0);
  const account = page.locator('section', { has: page.getByRole('heading', { level: 3, name: 'Account' }) });
  await expect(account.getByRole('button')).toHaveText(['Change Password']);

  // The controls that stay still work, and none of them touches the old keys.
  await page.getByRole('button', { name: 'Light' }).click();
  await page.getByRole('button', { name: 'Dark' }).click();
  for (const s of await page.getByRole('switch').all()) await s.click();
  expect(await page.evaluate(() => (window as unknown as { __deadKeyLog: string[] }).__deadKeyLog)).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('fc-theme'))).toBe('dark');
}

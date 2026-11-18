import type { Page, TestInfo } from '@playwright/test';
import { expect } from './fixtures';
import { signoffShot } from './signoffShots';

/**
 * DEAD-CONTROLS: Settings shows no Sync Owned / Sync Ordered / Sync Wished switch (nothing read their keys) and no
 * Delete Account button (it reached no server). Shared by e2e/settings-controls.spec.ts and settings.shots.spec.ts.
 */

export const DEAD_SYNC_KEYS = ['fc-sync-owned', 'fc-sync-ordered', 'fc-sync-wished'] as const;

/** Opens Settings with the three old keys stored as 'false', logging every read or write of them from the first script on. */
export async function openSettings(page: Page): Promise<void> {
  await page.addInitScript((keys) => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    for (const k of keys) localStorage.setItem(k, 'false');
    const log: string[] = [];
    (window as unknown as { __deadKeyLog: string[] }).__deadKeyLog = log;
    for (const op of ['getItem', 'setItem', 'removeItem'] as const) {
      const orig = Storage.prototype[op] as (...a: unknown[]) => unknown;
      Storage.prototype[op] = function (this: Storage, ...a: unknown[]) {
        if ((keys as readonly string[]).includes(String(a[0]))) log.push(`${op} ${String(a[0])}`);
        return orig.apply(this, a);
      } as never;
    }
  }, DEAD_SYNC_KEYS);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 3, name: 'Account' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
}

/** Stills of the Sync and Account sections, each scrolled to the middle, as sign-off PNGs named `<prefix>-sync` and `<prefix>-account`. */
export async function settingsStills(page: Page, testInfo: TestInfo, prefix: string): Promise<string[]> {
  const paths: string[] = [];
  for (const title of ['Sync', 'Account'] as const) {
    // Centred, clear of the header and the tab bar; the last section stops at the end of the scroll.
    await page.getByRole('heading', { level: 3, name: title }).evaluate((h) => h.closest('section')!.scrollIntoView({ block: 'center' }));
    paths.push((await signoffShot(page, testInfo, `${prefix}-${title.toLowerCase()}`)).path);
  }
  return paths;
}

/** The six sections stay; Sync keeps only Auto-Sync Interval; Account only Change Password; nothing reads the old keys. */
export async function expectNoDeadControls(page: Page): Promise<void> {
  const titles = (await page.getByRole('heading', { level: 3 }).allTextContents()).filter((t) => t !== 'Privacy');
  expect(titles).toEqual(['Appearance', 'Data & Storage', 'Notifications', 'Sync', 'About', 'Account']);

  for (const label of ['Sync Owned', 'Sync Ordered', 'Sync Wished']) await expect(page.getByText(label, { exact: true })).toHaveCount(0);
  const sync = page.locator('section', { has: page.getByRole('heading', { level: 3, name: 'Sync' }) });
  await expect(sync.getByRole('switch')).toHaveCount(0);
  await expect(sync.locator('.settings__label')).toHaveText(['Auto-Sync Interval']);
  await expect(sync.locator('select')).toBeVisible();

  await expect(page.getByText(/delete (my )?account/i)).toHaveCount(0);
  const account = page.locator('section', { has: page.getByRole('heading', { level: 3, name: 'Account' }) });
  await expect(account.getByRole('button')).toHaveText(['Change Password']);

  // The switches that stay still work, and none of them touches the old keys.
  for (const s of await page.getByRole('switch').all()) await s.click();
  await sync.locator('select').selectOption('daily');
  expect(await page.evaluate(() => (window as unknown as { __deadKeyLog: string[] }).__deadKeyLog)).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('fc-sync-interval'))).toBe('daily');
}

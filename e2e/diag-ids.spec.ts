import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';
import { e2eServers } from './e2eServers';

/**
 * LGMOB: Settings > Privacy (the Diagnostic ids switch and its link to /privacy) shows only in a build made with
 * VITE_DIAG_IDS=true (src/config/features.ts). No committed env file sets it, so both servers this config builds,
 * the --mode test one and the real production one, are without it unless this run's environment sets it, which
 * their builds inherit: `VITE_DIAG_IDS=true npx playwright test e2e/diag-ids.spec.ts` checks the build with ids.
 */

const WITH_IDS = process.env['VITE_DIAG_IDS'] === 'true';
const FOLD8 = CASE_VIEWPORTS.filter((v) => v.name === 'fold8-cover' || v.name === 'fold8-open');

async function openSettings(page: Page, size: { width: number; height: number }) {
  await page.addInitScript(() => localStorage.setItem('onboarding_complete', '1'));
  await page.setViewportSize(size);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 3, name: 'About' })).toBeVisible({ timeout: 15_000 });
}

async function expectPrivacy(page: Page) {
  const titles = await page.getByRole('heading', { level: 3 }).allTextContents();
  const privacyLinks = page.locator('a[href="/privacy"]');
  if (WITH_IDS) {
    expect(titles.slice(titles.indexOf('Sync'), titles.indexOf('About') + 1)).toEqual(['Sync', 'Privacy', 'About']);
    await expect(page.getByRole('switch', { name: 'Diagnostic ids' })).toBeVisible();
    await expect(privacyLinks).toHaveCount(1);
  } else {
    expect(titles).not.toContain('Privacy');
    expect(titles.slice(titles.indexOf('Sync'), titles.indexOf('About') + 1)).toEqual(['Sync', 'About']);
    await expect(page.getByRole('switch', { name: 'Diagnostic ids' })).toHaveCount(0);
    await expect(privacyLinks).toHaveCount(0);
  }
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('fc-diag-ids')))).toEqual([]);
}

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

for (const size of FOLD8) {
  test(`Settings, --mode test build: Privacy ${WITH_IDS ? 'shows' : 'is absent'}: ${size.name}`, async ({ page }) => {
    await openSettings(page, size);
    await expectPrivacy(page);
  });
}

test.describe('real production build', () => {
  test.use({ baseURL: e2eServers().prodUrl });

  for (const size of FOLD8) {
    test(`Settings: Privacy ${WITH_IDS ? 'shows' : 'is absent'}, no /privacy link unless it shows: ${size.name}`, async ({ page }) => {
      await page.route('https://figurecollecting.com/api/**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
      );
      await openSettings(page, size);
      await expectPrivacy(page);
    });
  }
});

import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';
import type { CaseViewport } from './caseViewports';

/**
 * Screenshot baselines of the display case: its three render branches at
 * every size in CASE_VIEWPORTS, and the three case styles at the Fold8
 * cover size. Fixture mode on the committed synthetic art (.env.test), so
 * no git-ignored file is involved. Baselines are recorded for the chromium
 * project; refresh them with
 *   npx playwright test e2e/case-screenshots.spec.ts --project=chromium --update-snapshots
 * after an intended visual change (or new measured Fold8 sizes).
 */

test.use({ hasTouch: true, isMobile: true });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'baselines are recorded for the chromium project');
});

async function openCase(page: Page, size: CaseViewport, query: string) {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.goto(`/?layout=case&density=compact${query}`);
  await page.waitForSelector('button.shelf-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0);
  // Every figure image decoded (the matted and framed branches).
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll<HTMLImageElement>('.case img')).every((img) => img.complete && img.naturalWidth > 0),
  );
}

const SHOT = { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixelRatio: 0.002 } as const;

const BRANCHES = [
  { branch: 'matted', query: '', figure: '.shelf-figure__img:not(.shelf-figure__img--photo)' },
  { branch: 'framed', query: '&fxbranch=framed', figure: '.shelf-figure__frame' },
  { branch: 'silhouette', query: '&fxbranch=silhouette', figure: '.shelf-figure__silhouette' },
] as const;

for (const size of CASE_VIEWPORTS) {
  for (const { branch, query, figure } of BRANCHES) {
    test(`case view, ${branch} figures, ${size.name} ${size.width}x${size.height}`, async ({ page }) => {
      await openCase(page, size, `&motif=detolf-dark${query}`);
      await expect(page.locator(figure)).toHaveCount(7);
      await expect(page.locator('.case')).toHaveScreenshot(`case-${branch}-${size.name}.png`, SHOT);
    });
  }
}

const STYLE_SIZE = CASE_VIEWPORTS[0];

for (const motif of ['detolf-dark', 'glass-clear', 'bookcase-wood']) {
  test(`case style ${motif}, matted figures, ${STYLE_SIZE.name}`, async ({ page }) => {
    await openCase(page, STYLE_SIZE, `&motif=${motif}`);
    await expect(page.locator('.case')).toHaveAttribute('data-motif', motif);
    await expect(page.locator('.case')).toHaveScreenshot(`case-style-${motif}-${STYLE_SIZE.name}.png`, SHOT);
  });
}

import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';
import type { CaseViewport } from './caseViewports';

/**
 * Screenshot baselines of the display case: its three render branches at
 * every size in CASE_VIEWPORTS, the three case styles at the Fold8 cover
 * size, and nameplates and the other two densities at two sizes. Fixture
 * mode on the committed synthetic art (.env.test), so no git-ignored file
 * is involved. Baselines are recorded for the chromium project; refresh
 * them with
 *   npx playwright test e2e/case-screenshots.spec.ts --project=chromium --update-snapshots
 * after an intended visual change (or new measured Fold8 sizes).
 */

test.use({ hasTouch: true, isMobile: true });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'baselines are recorded for the chromium project');
});

async function openCase(page: Page, size: CaseViewport, query: string, density = 'compact') {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.goto(`/?layout=case&density=${density}${query}`);
  await page.waitForSelector('button.shelf-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0);
  // Every figure image decoded (the matted and framed branches).
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll<HTMLImageElement>('.case img')).every((img) => img.complete && img.naturalWidth > 0),
  );
}

/**
 * Tight on purpose: renders repeat pixel for pixel (locally and in the
 * Playwright image), and a figure floating 2 px off its shelf must fail
 * every shot. Faint silhouettes on the dark case change by less than the
 * default per-pixel threshold (0.2), hence 0.05.
 */
const SHOT = { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixels: 10, threshold: 0.05 } as const;

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

/**
 * Plate text draws in whatever sans-serif the machine has (Inter is not
 * bundled) and wraps by that font's widths, so the labels shots hide the
 * glyphs and keep one line: the plate's box, colour and place are compared,
 * the same on every machine. An adopted sheet, as the CSP allows no inline
 * style element.
 */
async function hidePlateText(page: Page) {
  await page.evaluate(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(
      '.shelf-figure__plate-name, .shelf-figure__plate-mfr { color: transparent !important; white-space: nowrap !important; }',
    );
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  });
}

const VARIANT_SIZES = CASE_VIEWPORTS.filter((v) => v.name === 'fold8-cover-est' || v.name === 'fold8-open-landscape-est');

const VARIANTS = [
  { variant: 'labels', density: 'compact', query: '&labels=1' },
  { variant: 'comfortable', density: 'comfortable', query: '' },
  { variant: 'gallery', density: 'gallery', query: '' },
] as const;

for (const size of VARIANT_SIZES) {
  for (const { variant, density, query } of VARIANTS) {
    test(`case view, matted figures, ${variant}, ${size.name} ${size.width}x${size.height}`, async ({ page }) => {
      await openCase(page, size, `&motif=detolf-dark${query}`, density);
      await expect(page.locator('.shelf-figure__plate')).toHaveCount(variant === 'labels' ? 7 : 0);
      if (variant === 'labels') await hidePlateText(page);
      await expect(page.locator('.case')).toHaveScreenshot(`case-matted-${variant}-${size.name}.png`, SHOT);
    });
  }
}

import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS, type CaseViewport } from './caseViewports';

/**
 * Screenshot baselines of the faithful cabinets (CASE-CABINET, CASE-ADAPT,
 * CASE-FIX): the three views at every size in CASE_VIEWPORTS, the figure art
 * branches (masked, framed, plate) and the three cabinet profiles at the
 * Fold8 sizes, and the IC1 tabs with the raised +. Fixture mode on the
 * committed synthetic art (.env.test), so no git-ignored file is involved.
 * Baselines are recorded for the chromium project; refresh them with
 *   npx playwright test e2e/cabinet-screenshots.spec.ts --project=chromium --update-snapshots
 * after an intended visual change.
 */

test.use({ hasTouch: true, isMobile: true });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'baselines are recorded for the chromium project');
});

interface Prefs {
  view?: 'wall' | 'cabinet' | 'shelf';
  pattern?: string;
}

/**
 * Text draws in whatever sans-serif the machine has (Inter is not bundled),
 * so the shots hide every glyph and compare boxes, colours and places: the
 * step arrows, the plates' names, the fit flag and the tab labels. An
 * adopted sheet, as the CSP allows no inline style element.
 */
async function hideText(page: Page) {
  await page.evaluate(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(
      '.cabinet-scene__step, .cabinet-scene__shelves button, .cab-figure__plate, .cab-plate, .cabinet-scene__fit, .cabinet-scene__fit *, .case-tabs *, .tab-bar * { color: transparent !important; }',
    );
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  });
}

async function openCase(page: Page, size: CaseViewport, query = '', prefs: Prefs = {}) {
  await page.addInitScript((p) => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    if (Object.keys(p).length > 0) localStorage.setItem('fc-case-prefs', JSON.stringify(p));
  }, prefs);
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.goto(`/?layout=case${query}`);
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0);
  // every picture decoded and every figure grounded on its measured margin
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll<HTMLElement>('button.cab-figure')).every(
      (b) => b.dataset.grounded === '1' && Array.from(b.querySelectorAll('img')).every((img) => img.complete && img.naturalWidth > 0),
    ),
  );
  await hideText(page);
}

/**
 * Tight on purpose: a figure floating 2 px off its shelf, or a cabinet
 * stretched by a few px, must fail. Clear glass changes by less than the
 * default per-pixel threshold (0.2), hence 0.05.
 */
const SHOT = { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixels: 10, threshold: 0.05 } as const;

for (const size of CASE_VIEWPORTS) {
  for (const view of ['wall', 'cabinet', 'shelf'] as const) {
    test(`cabinets, ${view} view, ${size.name} ${size.width}x${size.height}`, async ({ page }) => {
      // three walls' worth of figures: several cabinets side by side, neighbours drawn true (CC4a)
      await openCase(page, size, '&fx=3', { view });
      await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-view', view);
      await expect(page.locator('.cabinet-scene')).toHaveScreenshot(`cabinet-${view}-${size.name}.png`, SHOT);
    });
  }
}

const FOLD8_PAIR = CASE_VIEWPORTS.filter((v) => v.name === 'fold8-cover' || v.name === 'fold8-open');

const BRANCHES = [
  { branch: 'masked', art: 'masked' },
  { branch: 'framed', art: 'framed' },
  { branch: 'silhouette', art: 'plate' },
] as const;

for (const size of FOLD8_PAIR) {
  for (const { branch, art } of BRANCHES) {
    test(`cabinets, ${branch} branch, ${size.name}`, async ({ page }) => {
      await openCase(page, size, `&fxbranch=${branch}`, { view: 'cabinet' });
      await expect(page.locator(`button.cab-figure[data-art="${art}"]`)).toHaveCount(7);
      await expect(page.locator('.cabinet-scene')).toHaveScreenshot(`cabinet-branch-${branch}-${size.name}.png`, SHOT);
    });
  }
}

const PATTERNS = [
  { name: 'detolf', pattern: 'ikea-detolf' },
  { name: 'rack', pattern: 'open-steel-rack' },
  { name: 'klingsbo-detolf-rack', pattern: 'ikea-klingsbo+ikea-detolf+open-steel-rack' },
] as const;

for (const size of FOLD8_PAIR) {
  for (const { name, pattern } of PATTERNS) {
    test(`cabinets, ${name} wall, ${size.name}`, async ({ page }) => {
      await openCase(page, size, '&fx=3', { view: 'wall', pattern });
      await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-pattern', pattern);
      await expect(page.locator('.cabinet-scene')).toHaveScreenshot(`cabinet-pattern-${name}-${size.name}.png`, SHOT);
    });
  }
}

test('IC1 tabs over the tab bar with the raised +, fold8-cover', async ({ page }) => {
  await openCase(page, CASE_VIEWPORTS[0]);
  await expect(page).toHaveScreenshot('cabinet-ic1-tabs-fold8-cover.png', {
    ...SHOT,
    clip: await page.locator('.case-tabs').evaluate((tabs) => {
      const bar = document.querySelector('.tab-bar')!.getBoundingClientRect();
      const t = tabs.getBoundingClientRect();
      return { x: 0, y: Math.floor(t.top) - 40, width: innerWidth, height: Math.ceil(bar.bottom - t.top) + 40 };
    }),
  });
});

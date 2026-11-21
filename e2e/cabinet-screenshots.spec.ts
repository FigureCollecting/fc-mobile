import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS, type CaseViewport } from './caseViewports';
import { navControls } from './navControls';

/**
 * Screenshot baselines of the faithful cabinets (CASE-CABINET, CASE-ADAPT,
 * CASE-FIX): the wall at every size in CASE_VIEWPORTS, the three cabinet
 * profiles at the Fold8 sizes, and the IC1 tabs with the raised +. NAV-SCOPE
 * (Ross 11-18): the wall is the case's one view, so the one-cabinet and
 * one-shelf views' baselines, and the art branches' (taken in the one-cabinet
 * view), are retired. Fixture mode on the
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
  pattern?: string;
}

/**
 * Text draws in whatever sans-serif the machine has (Inter is not bundled),
 * so the shots hide every glyph and compare boxes, colours and places: the
 * plates' names, the fit flag and the tab labels. An adopted sheet, as the
 * CSP allows no inline style element.
 */
async function hideText(page: Page) {
  await page.evaluate(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(
      '.cab-figure__plate, .cab-plate, .cabinet-scene__fit, .cabinet-scene__fit *, .case-tabs *, .tab-bar * { color: transparent !important; }',
    );
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  });
}

async function openCase(page: Page, size: CaseViewport, query = '', prefs: Prefs = {}) {
  await page.addInitScript((p) => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    // the baselines are of the wall as it was packed with no clearance above a figure; the new 1 in default (CLEAR-1) has its own e2e
    localStorage.setItem('fc-case-prefs', JSON.stringify({ clearanceMm: 0, ...p }));
  }, prefs);
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.goto(`/?layout=case${query}`);
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
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
/** NAV-FLOAT: the scene's baseline is the scene's alone: the floating hat and Z rail over it are masked. */
const shot = (page: Page) => ({ ...SHOT, mask: [navControls(page)] });

for (const size of CASE_VIEWPORTS) {
  const view = 'wall';
  test(`cabinets, ${view} view, ${size.name} ${size.width}x${size.height}`, async ({ page }) => {
    // three walls' worth of figures: several cabinets side by side, neighbours drawn true (CC4a)
    await openCase(page, size, '&fx=3');
    await expect(page.locator('.cabinet-scene')).toHaveScreenshot(`cabinet-${view}-${size.name}.png`, shot(page));
  });
}

const FOLD8_PAIR = CASE_VIEWPORTS.filter((v) => v.name === 'fold8-cover' || v.name === 'fold8-open');

const PATTERNS = [
  { name: 'detolf', pattern: 'ikea-detolf' },
  { name: 'rack', pattern: 'open-steel-rack' },
  { name: 'klingsbo-detolf-rack', pattern: 'ikea-klingsbo+ikea-detolf+open-steel-rack' },
] as const;

for (const size of FOLD8_PAIR) {
  for (const { name, pattern } of PATTERNS) {
    test(`cabinets, ${name} wall, ${size.name}`, async ({ page }) => {
      await openCase(page, size, '&fx=3', { pattern });
      await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-pattern', pattern);
      await expect(page.locator('.cabinet-scene')).toHaveScreenshot(`cabinet-pattern-${name}-${size.name}.png`, shot(page));
    });
  }
}

test('IC1 tabs over the tab bar (NAV-FLOAT: three together, no raised + among them), fold8-cover', async ({ page }) => {
  await openCase(page, CASE_VIEWPORTS[0]);
  await expect(page).toHaveScreenshot('cabinet-ic1-tabs-fold8-cover.png', {
    ...shot(page),
    clip: await page.locator('.case-tabs').evaluate((tabs) => {
      const bar = document.querySelector('.tab-bar')!.getBoundingClientRect();
      const t = tabs.getBoundingClientRect();
      return { x: 0, y: Math.floor(t.top) - 40, width: innerWidth, height: Math.ceil(bar.bottom - t.top) + 40 };
    }),
  });
});

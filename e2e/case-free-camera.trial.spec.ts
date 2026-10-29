import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS, FOLD8_DPR } from './caseViewports';
import { touchDown } from './touch';

/**
 * NAV-1A: a recorded run of the Free camera (trial) for Ross, at the Fold8's four panels: a video of each and a PNG
 * after each step (open, move, raise, a held look, a look held past the limit, let go, Reset, the jog), in this test's output
 * folder. Recorded on request only, never in CI:
 *   NAV_TRIAL=1 npx playwright test e2e/case-free-camera.trial.spec.ts --project=chromium
 */

test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: FOLD8_DPR, video: 'on' });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium' || !process.env.NAV_TRIAL, 'recorded on request (NAV_TRIAL=1), chromium project');
});

const FOLD8 = CASE_VIEWPORTS.filter((v) => v.name.startsWith('fold8'));
const settle = (page: Page, ms = 300) => page.evaluate((m) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, m)))), ms);
const frameBox = async (page: Page) => (await page.locator('.cabinet-scene__frame').boundingBox())!;

/** One finger from `from` along `path` (24 moves 16 ms apart a leg), held still `holdMs` first (Look arms at 250). */
async function finger(page: Page, from: { x: number; y: number }, path: { x: number; y: number }[], { holdMs = 0, lift = true } = {}) {
  const f = await touchDown(page, from.x, from.y);
  if (holdMs > 0) await page.waitForTimeout(holdMs);
  for (const p of path) await f.to(p.x, p.y, 24, 16);
  if (lift) {
    await f.end();
    await settle(page);
  }
  return f;
}

for (const panel of FOLD8) {
  test(`recorded trial ${panel.name}: open, move, raise, look (hold), look past the limit, let go, Reset, jog`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => {
      localStorage.setItem('onboarding_complete', '1');
      localStorage.setItem('fc-fixture-mode', 'on');
      localStorage.setItem('fc-case-prefs', JSON.stringify({ view: 'wall', swipe: 'camera', freeCamera: true }));
    });
    await page.setViewportSize({ width: panel.width, height: panel.height });
    await page.goto('/?layout=case&fx=40');
    await page.waitForSelector('button.cab-figure');
    await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 30_000 });
    await settle(page, 800);
    const steps: string[] = [];
    const shot = async (name: string) => {
      const path = testInfo.outputPath(`${panel.name}-${name}.png`);
      await page.screenshot({ path, animations: 'disabled' });
      await testInfo.attach(name, { path, contentType: 'image/png' });
      steps.push(`${name} ${await page.locator('.cabinet-scene').getAttribute('data-camera')}`);
    };
    await shot('1-opening');
    const f = await frameBox(page);
    const y = f.y + f.height * 0.5;
    await finger(page, { x: f.x + f.width * 0.8, y }, [{ x: f.x + f.width * 0.2, y }]);
    await shot('2-after-move');
    await finger(page, { x: f.x + f.width * 0.5, y: f.y + f.height * 0.2 }, [{ x: f.x + f.width * 0.5, y: f.y + f.height * 0.6 }]);
    await shot('3-after-raise');
    await finger(page, { x: f.x + f.width * 0.5, y }, [{ x: f.x + f.width * 0.3, y: y - f.height * 0.15 }], { holdMs: 300 });
    await shot('4-after-look');
    const held = await finger(page, { x: f.x + f.width - 3, y: f.y + f.height * 0.2 }, [{ x: f.x + 3, y: f.y + f.height * 0.2 }], { holdMs: 300, lift: false });
    await settle(page, 200);
    await shot('5-look-held-past-the-limit');
    await held.end();
    await page.waitForTimeout(400);
    await shot('6-let-go-eased-back');
    await page.locator('.cabinet-scene__reset').tap();
    await settle(page);
    await shot('7-reset');
    // NAV-JOG: the thumb on the bottom-centre button, dragged right and held: the eye walks right until the lift
    const jog = (await page.locator('.tab-bar__add[data-jog]').boundingBox())!;
    const thumb = await touchDown(page, jog.x + jog.width / 2, jog.y + jog.height / 2);
    await thumb.to(jog.x + jog.width / 2 + 48, jog.y + jog.height / 2, 6, 16);
    await page.waitForTimeout(700);
    await shot('8-jog-held-right');
    await thumb.end();
    await settle(page);
    await shot('9-jog-let-go');
    console.log(`TRIAL ${panel.name}\n${steps.join('\n')}`);
  });
}

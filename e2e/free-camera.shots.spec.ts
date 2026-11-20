import { test, expect } from './fixtures';
import { SHOT_VIEWPORTS } from './caseViewports';
import { shotSizeError, signoffShot } from './signoffShots';

/**
 * NAV-1A: sign-off shots of the Free camera as it opens (level, rulings R0.3) on the wall, one full frame per
 * SHOT_VIEWPORTS project, in fixture mode on the committed synthetic art. NAV-SCOPE (Ross 11-18): the wall is the case's
 * one view; the cabinet and shelf views' shots went with those views. They land beside the others in
 * test-results/signoff/<project>/free-camera-wall.png:
 *   npm run test:e2e:shots
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });
});

test("free camera, wall view: a full-frame sign-off PNG at the panel's own pixels", async ({ page }, testInfo) => {
  const v = SHOT_VIEWPORTS.find((s) => s.name === testInfo.project.name);
  if (v === undefined) throw new Error(`${testInfo.project.name} is not a SHOT_VIEWPORTS project`);
  await page.goto('/?layout=case');
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-free-camera', '1');
  await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0));
  const shot = await signoffShot(page, testInfo, 'free-camera-wall');
  expect(shotSizeError(shot, v.png), shot.path).toBeUndefined();
});

import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures';
import { SHOT_VIEWPORTS } from './caseViewports';
import type { ShotViewport } from './caseViewports';
import { SHOT_TOLERANCE_PX, pngSize, signoffShot } from './signoffShots';
import { HANDS_OFF_LAUNCH_ARGS } from './handsOff';

/**
 * Sign-off shots of today's collection and case view, one full frame per
 * SHOT_VIEWPORTS project (the Fold8's full panels at its pixel ratio, and the
 * desktop window), in fixture mode on the committed synthetic art. They land
 * in test-results/signoff/<project>/<name>.png for Ross's visual sign-off:
 *   npm run test:e2e:shots
 */

function shotViewport(project: string): ShotViewport {
  const found = SHOT_VIEWPORTS.find((v) => v.name === project);
  if (found === undefined) throw new Error(`${project} is not a SHOT_VIEWPORTS project`);
  return found;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });
});

test('this project is its panel: CSS size, pixel ratio, touch, and the hands-off resolver rules', async ({ page }, testInfo) => {
  const v = shotViewport(testInfo.project.name);
  expect(testInfo.project.use.launchOptions?.args ?? []).toEqual(expect.arrayContaining(HANDS_OFF_LAUNCH_ARGS));
  await page.goto('/?layout=rows');
  expect(
    await page.evaluate(() => ({ width: innerWidth, height: innerHeight, ratio: devicePixelRatio, touch: navigator.maxTouchPoints > 0 })),
  ).toEqual({ width: v.width, height: v.height, ratio: v.deviceScaleFactor, touch: v.mobile });
});

const SCREENS = [
  { name: 'collection', path: '/?layout=rows', ready: '.jrows__item' },
  { name: 'case', path: '/?layout=case&motif=detolf-dark&density=compact', ready: 'button.shelf-figure' },
] as const;

for (const screen of SCREENS) {
  test(`${screen.name}: a full-frame sign-off PNG at the panel's own pixels`, async ({ page }, testInfo) => {
    const v = shotViewport(testInfo.project.name);
    await page.goto(screen.path);
    await page.waitForSelector(screen.ready);
    await expect(page.locator('#pre-splash')).toHaveCount(0);
    await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0));

    const shot = await signoffShot(page, testInfo, screen.name);

    const header = pngSize(readFileSync(shot.path));
    expect(header).toEqual({ width: shot.width, height: shot.height });
    expect(Math.abs(header.width - v.png.width), `${header.width} wide, the panel is ${v.png.width}`).toBeLessThanOrEqual(SHOT_TOLERANCE_PX);
    expect(Math.abs(header.height - v.png.height), `${header.height} high, the panel is ${v.png.height}`).toBeLessThanOrEqual(SHOT_TOLERANCE_PX);
  });
}

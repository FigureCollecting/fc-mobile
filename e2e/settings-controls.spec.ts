import { test } from './fixtures';
import { expectNoDeadControls, openSettings, settingsStills } from './settingsControls';

/**
 * DEAD-CONTROLS: Settings shows no Sync Owned / Ordered / Wished switch and no Delete Account button, on the Fold
 * cover (443 x 558 at a pixel ratio of 3) and the default desktop window. Stills land in
 * test-results/signoff/chromium/settings-<size>-{sync,account}.png. The *-full and desktop projects run
 * e2e/settings.shots.spec.ts.
 */

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

test.describe('Fold cover', () => {
  test.use({ viewport: { width: 443, height: 558 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

  test('Settings shows no dead Sync switch or Delete Account button: fold-cover', async ({ page }, testInfo) => {
    await openSettings(page);
    await settingsStills(page, testInfo, 'settings-fold-cover');
    await expectNoDeadControls(page);
  });
});

test('Settings shows no dead Sync switch or Delete Account button: desktop chrome', async ({ page }, testInfo) => {
  await openSettings(page);
  await settingsStills(page, testInfo, 'settings-desktop-chrome');
  await expectNoDeadControls(page);
});

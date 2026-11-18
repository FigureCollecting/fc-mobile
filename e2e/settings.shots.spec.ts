import { test } from './fixtures';
import { expectNoDeadControls, openSettings, settingsStills } from './settingsControls';

/**
 * DEAD-CONTROLS: Settings shows no Sync Owned / Ordered / Wished switch and no Delete Account button, one run per
 * SHOT_VIEWPORTS project (the Fold8's full panels and the desktop window). Stills of the Sync and Account sections
 * land in test-results/signoff/<project>/settings-{sync,account}.png:
 *   npm run test:e2e:shots
 */

test('Settings shows no dead Sync switch or Delete Account button, with stills of Sync and Account', async ({ page }, testInfo) => {
  await openSettings(page);
  await settingsStills(page, testInfo, 'settings');
  await expectNoDeadControls(page);
});

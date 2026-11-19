import { test } from './fixtures';
import { expectNoDeadControls, openSettings, settingsStills } from './settingsControls';

/**
 * DEAD-CONTROLS: Settings shows none of the controls that did nothing (the Sync, Price Alerts and Sync Complete
 * switches, Auto-Sync Interval, Delete Account), one run per SHOT_VIEWPORTS project (the Fold8's full panels and the
 * desktop window). Stills of the Data & Storage and Account sections land in
 * test-results/signoff/<project>/settings-{storage,account}.png:
 *   npm run test:e2e:shots
 */

test('Settings shows no control that does nothing, with stills of Data & Storage and Account', async ({ page }, testInfo) => {
  await openSettings(page);
  await settingsStills(page, testInfo, 'settings');
  await expectNoDeadControls(page);
});

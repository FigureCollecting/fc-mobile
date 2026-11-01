import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { legacyPrefs } from './legacyCamera';
import { CASE_VIEWPORTS, FOLD8_DPR } from './caseViewports';
import { decodePng } from './paintCheck';
import { touchSwipe } from './touch';
import { watchPull } from './pullWatch';

/**
 * CASE-FB3a item 3 (Ross 10-17 11:10, his Fold8 open and turned: "if going to room top, display cuts ... you have to
 * move very slightly lower for room top to render fully"). Camera mode, raised as far as one up/down drag series goes
 * (the rack wall, fixture mode): the frame's top band is the room's ceiling, drawn, not the page behind the case. On
 * 8c565638 the camera rose to the ceiling's own height (data-camera y = data-room ceilingMm), where the ceiling is
 * edge-on and the band above the wall's top is blank, at every Fold8 panel. In pan mode the photo's slide ends with
 * the wall's gradient at the frame's top: held here too.
 */

test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: FOLD8_DPR });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

/** The darkest the page behind the case gets (its background is about 10 on a channel); the ceiling's gradient is 45 and up. */
const CEILING_MEAN_MIN = 28;
/** The band of the frame, as a share of its height, read from its top edge. */
const BAND = 0.05;

const settle = (page: Page, ms = 300) => page.evaluate((m) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, m)))), ms);

const camera = async (page: Page) => {
  const host = page.locator('.cabinet-scene');
  return {
    y: (JSON.parse((await host.getAttribute('data-camera'))!) as { y: number }).y,
    ceilingMm: (JSON.parse((await host.getAttribute('data-room'))!) as { ceilingMm: number }).ceilingMm,
    panY: Number(await host.getAttribute('data-pan-y')),
  };
};

/** The mean of a channel over the frame's top band, 0..255. */
async function topBandMean(page: Page): Promise<number> {
  const f = (await page.locator('.cabinet-scene__frame').boundingBox())!;
  const shot = decodePng(await page.screenshot({ clip: { x: f.x, y: f.y, width: f.width, height: Math.max(4, f.height * BAND) } }));
  let sum = 0;
  for (let i = 0; i < shot.data.length; i += 4) sum += (shot.data[i]! + shot.data[i + 1]! + shot.data[i + 2]!) / 3;
  return sum / (shot.data.length / 4);
}

async function openRack(page: Page, size: { width: number; height: number }, swipe: 'camera' | 'pan'): Promise<void> {
  await page.addInitScript((prefs) => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    localStorage.setItem('fc-case-prefs', JSON.stringify(prefs));
  }, legacyPrefs({ view: 'wall', swipe, pattern: 'open-steel-rack' }));
  await page.setViewportSize(size);
  await page.goto('/?layout=case&fx=170&labels=1');
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 30_000 });
  await settle(page, 800);
}

/** Drag down (raising the camera, or sliding the photo down) until nothing moves any more. */
async function toTop(page: Page): Promise<void> {
  const f = (await page.locator('.cabinet-scene__frame').boundingBox())!;
  const seen = await watchPull(page);
  let last = '';
  for (let i = 0; i < 16; i++) {
    await touchSwipe(page, f.x + f.width / 2, f.y + f.height * 0.2, 0, f.height * 0.6, 8, 16);
    await settle(page);
    const now = JSON.stringify(await camera(page));
    if (now === last) {
      // NAV-PTR-1: the down-swipes are the case's, never a pull to refresh
      await expect(page.locator('.pull-to-refresh__spinner--active')).toHaveCount(0);
      expect(await seen(), 'no pull to refresh on the way up').toEqual({ tallestPx: 0, refreshed: false });
      return;
    }
    last = now;
  }
  throw new Error('the picture never stopped rising');
}

for (const panel of CASE_VIEWPORTS) {
  test(`${panel.name}: camera mode raised as far as it goes shows the ceiling at the frame's top, not the page behind`, async ({ page }, testInfo) => {
    await openRack(page, panel, 'camera');
    const before = await topBandMean(page);
    await toTop(page);
    const c = await camera(page);
    const mean = await topBandMean(page);
    console.log(`case-room-top ${JSON.stringify({ panel: panel.name, swipe: 'camera', cameraY: c.y, ceilingMm: c.ceilingMm, bandMeanBefore: Math.round(before), bandMeanAtTop: Math.round(mean) })}`);
    await testInfo.attach('top limit', { body: await page.screenshot(), contentType: 'image/png' });
    expect(c.y, 'the camera stays under the ceiling').toBeLessThan(c.ceilingMm);
    expect(mean, "the frame's top band at the top limit").toBeGreaterThan(CEILING_MEAN_MIN);
  });
}

test('pan mode slid down as far as it goes shows the room at the frame top (as before)', async ({ page }) => {
  await openRack(page, CASE_VIEWPORTS.find((v) => v.name === 'fold8-open-rotated')!, 'pan');
  await toTop(page);
  expect((await camera(page)).panY, 'the photo slid down').toBeGreaterThan(0);
  expect(await topBandMean(page), "the frame's top band at the top limit").toBeGreaterThan(CEILING_MEAN_MIN);
});

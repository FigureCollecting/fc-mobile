import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS, FOLD8_DPR, SHOT_VIEWPORTS } from './caseViewports';
import { touchDown, touchTap } from './touch';
import { centreOf, depth, hat, orb } from './navControls';
import { DEPTH_RAIL_PX, ORB_PX } from '../src/components/display/navTuning';
import { TILT } from '../src/sensors/relativeOrientation';

/**
 * NAV-LOGPOSE (handoff FINAL 11-17 section 6; plan U8), in Chromium, fixture mode. A device is faked by script: its
 * deviceorientation events are dispatched every 33 ms from window.__tilt (the event path, as iOS and Chrome's own
 * deviceorientation; the Generic Sensor is taken away so the path is the same on every runner), its listeners counted,
 * and the page's visibility switchable. With no fake device (the desktop) the orb never shows.
 */

test.describe.configure({ mode: 'parallel' });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const COVER = CASE_VIEWPORTS.find((v) => v.name === 'fold8-cover')!;
const DESKTOP = SHOT_VIEWPORTS.find((v) => v.name === 'desktop')!;
const DEG = Math.PI / 180;

const settle = (page: Page, ms = 300) => page.evaluate((m) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, m)))), ms);

type Cam = { x: number; y: number; z: number; yaw: number; pitch: number };
const cameraOf = async (page: Page) => JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-camera'))!) as Cam;

/** A phone held upright (beta 90), turned `yaw` deg right and tipped back `up` deg. */
const tiltTo = (page: Page, yaw: number, up = 0) => page.evaluate(([yaw, up]) => void ((window as unknown as { __tilt: object }).__tilt = { alpha: -yaw, beta: 90 + up, gamma: 0 }), [yaw, up]);
const listeners = (page: Page) => page.evaluate(() => (window as unknown as { __orient: number }).__orient);
const setHidden = (page: Page, hidden: boolean) =>
  page.evaluate((h) => {
    (window as unknown as { __hidden: boolean }).__hidden = h;
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);

async function fakeDevice(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __tilt: object; __orient: number; __hidden: boolean; RelativeOrientationSensor?: unknown };
    Object.defineProperty(window, 'RelativeOrientationSensor', { value: undefined, configurable: true, writable: true });
    w.__tilt = { alpha: 0, beta: 90, gamma: 0 };
    w.__orient = 0;
    w.__hidden = false;
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    window.addEventListener = ((type: string, ...rest: unknown[]) => {
      if (type === 'deviceorientation') w.__orient++;
      return (add as (...a: unknown[]) => void)(type, ...rest);
    }) as typeof window.addEventListener;
    window.removeEventListener = ((type: string, ...rest: unknown[]) => {
      if (type === 'deviceorientation') w.__orient--;
      return (remove as (...a: unknown[]) => void)(type, ...rest);
    }) as typeof window.removeEventListener;
    Object.defineProperty(document, 'visibilityState', { get: () => (w.__hidden ? 'hidden' : 'visible'), configurable: true });
    Object.defineProperty(document, 'hidden', { get: () => w.__hidden, configurable: true });
    setInterval(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', w.__tilt as DeviceOrientationEventInit)), 33);
  });
}

async function openCase(page: Page, size: { width: number; height: number }) {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    localStorage.setItem('fc-case-prefs', JSON.stringify({ view: 'wall', clearanceMm: 0 }));
  });
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.goto('/?layout=case&fx=40');
  await ready(page);
}

async function ready(page: Page) {
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 30_000 });
  await expect(hat(page)).toHaveCount(1);
  await settle(page, 500);
}

test.describe('on the Fold8 cover with a (faked) motion sensor', () => {
  test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: FOLD8_DPR });

  test('NAV-LOGPOSE (a, c, d, h): the orb sits above the Z rail, OFF; ON a tilt held is a fixed offset; Off keeps the view; reload is OFF', async ({ page }) => {
    test.setTimeout(90_000);
    await fakeDevice(page);
    await openCase(page, COVER);
    await expect(orb(page)).toHaveCount(1);
    await expect(orb(page)).toHaveAttribute('role', 'switch');
    await expect(orb(page)).toHaveAttribute('aria-checked', 'false');
    await expect(orb(page)).toHaveAttribute('aria-label', 'Tilt to look: off');
    // the probe stopped its sampling: OFF, nothing listens
    expect(await listeners(page)).toBe(0);

    // placed: centred over the rail, its drawn bottom ORB_PX.gap above the rail's drawn top
    const o = (await orb(page).boundingBox())!;
    const r = (await depth(page).boundingBox())!;
    expect(o.width).toBeCloseTo(ORB_PX.hit, 1);
    expect(o.x + o.width / 2).toBeCloseTo(r.x + r.width / 2, 1);
    const orbDrawnBottom = o.y + o.height - (ORB_PX.hit - ORB_PX.size) / 2;
    const railDrawnTop = r.y + (DEPTH_RAIL_PX.hitHeight - DEPTH_RAIL_PX.height) / 2;
    expect(railDrawnTop - orbDrawnBottom).toBeCloseTo(ORB_PX.gap, 1);

    // OFF: tilting moves nothing
    const c0 = await cameraOf(page);
    await tiltTo(page, 5);
    await settle(page, 400);
    expect(await cameraOf(page)).toEqual(c0);
    await tiltTo(page, 0);

    // ON: the first sample is the neutral; 5 deg right is (5 - 1) x 0.6 = 2.4 deg of yaw, held without spinning
    await touchTap(page, (await centreOf(orb(page))).x, (await centreOf(orb(page))).y);
    await expect(orb(page)).toHaveAttribute('aria-checked', 'true');
    await expect(orb(page)).toHaveAttribute('aria-label', 'Tilt to look: on');
    // (the sampling starts in an effect, after the switch has painted)
    await expect.poll(() => listeners(page)).toBe(1);
    await settle(page, 300);
    expect((await cameraOf(page)).yaw).toBeCloseTo(c0.yaw, 6);
    await tiltTo(page, 5);
    await settle(page, 600);
    const want = (5 - TILT.deadDeg) * TILT.gain * DEG;
    const yaws: number[] = [];
    for (let i = 0; i < 8; i++) {
      yaws.push((await cameraOf(page)).yaw);
      await page.waitForTimeout(250);
    }
    for (const y of yaws) expect(y - c0.yaw).toBeCloseTo(want, 4);
    expect(Math.max(...yaws) - Math.min(...yaws)).toBeLessThan(1e-5);
    // the needle follows it (through the CSSOM)
    expect(Number(await orb(page).evaluate((n) => n.style.getPropertyValue('--orb-turn')))).toBeGreaterThan(0);

    // OFF: the view stays exactly where it was drawn, then and after
    const before = await cameraOf(page);
    await touchTap(page, (await centreOf(orb(page))).x, (await centreOf(orb(page))).y);
    await expect(orb(page)).toHaveAttribute('aria-checked', 'false');
    expect(await cameraOf(page)).toEqual(before);
    await tiltTo(page, -6);
    await settle(page, 400);
    expect(await cameraOf(page)).toEqual(before);
    expect(await listeners(page)).toBe(0);

    // ON again, then a reload: OFF (never stored)
    await touchTap(page, (await centreOf(orb(page))).x, (await centreOf(orb(page))).y);
    await expect(orb(page)).toHaveAttribute('aria-checked', 'true');
    await page.reload();
    await ready(page);
    await expect(orb(page)).toHaveAttribute('aria-checked', 'false');
    expect(await listeners(page)).toBe(0);
  });

  test('NAV-LOGPOSE (f): hidden stops the sampling and keeps the view; shown again, a new neutral, no jump', async ({ page }) => {
    test.setTimeout(60_000);
    await fakeDevice(page);
    await openCase(page, COVER);
    await touchTap(page, (await centreOf(orb(page))).x, (await centreOf(orb(page))).y);
    await expect(orb(page)).toHaveAttribute('aria-checked', 'true');
    await settle(page, 300);
    const c0 = await cameraOf(page);
    await tiltTo(page, 4);
    await settle(page, 600);
    const tilted = await cameraOf(page);
    expect(tilted.yaw - c0.yaw).toBeCloseTo((4 - TILT.deadDeg) * TILT.gain * DEG, 4);
    await setHidden(page, true);
    expect(await listeners(page)).toBe(0);
    await tiltTo(page, 9);
    await settle(page, 400);
    expect(await cameraOf(page)).toEqual(tilted);
    await setHidden(page, false);
    expect(await listeners(page)).toBe(1);
    await settle(page, 600);
    // the phone at 9 deg is the new neutral: the view stays put
    const back = await cameraOf(page);
    expect(back.yaw).toBeCloseTo(tilted.yaw, 6);
    await expect(orb(page)).toHaveAttribute('aria-checked', 'true');
  });

  test('NAV-LOGPOSE (g, the hat): a jog begun over the offset folds it: no jump at its start or after its lift', async ({ page }) => {
    test.setTimeout(60_000);
    await fakeDevice(page);
    await openCase(page, COVER);
    await touchTap(page, (await centreOf(orb(page))).x, (await centreOf(orb(page))).y);
    await settle(page, 300);
    const c0 = await cameraOf(page);
    await tiltTo(page, 6);
    await settle(page, 600);
    const tilted = await cameraOf(page);
    expect(tilted.yaw - c0.yaw).toBeCloseTo((6 - TILT.deadDeg) * TILT.gain * DEG, 4);
    const h = await centreOf(hat(page));
    const f = await touchDown(page, h.x, h.y);
    await f.to(h.x + 30, h.y, 6, 16);
    await page.waitForTimeout(300);
    // the jog moves the eye sideways; it turns nothing: the view keeps the yaw the tilt gave it
    expect((await cameraOf(page)).yaw).toBeCloseTo(tilted.yaw, 6);
    await f.end();
    await settle(page, 600);
    expect((await cameraOf(page)).yaw).toBeCloseTo(tilted.yaw, 6);
    // the phone still at 6 deg: the new neutral, the view does not turn again
    await page.waitForTimeout(400);
    expect((await cameraOf(page)).yaw).toBeCloseTo(tilted.yaw, 6);
  });
});

test.describe('on the desktop (no motion sensor)', () => {
  test('NAV-LOGPOSE (a, i): no orb once the probe has looked, the hat and the Z rail as ever; no location or absolute orientation in the bundle', async ({ page }) => {
    test.setTimeout(60_000);
    const scripts = new Set<string>();
    page.on('response', (res) => {
      if (res.request().resourceType() === 'script') scripts.add(res.url());
    });
    await openCase(page, DESKTOP);
    // the probe gives each API its first-sample wait
    await page.waitForTimeout(TILT.firstSampleMs * 2 + 500);
    await expect(orb(page)).toHaveCount(0);
    await expect(hat(page)).toHaveCount(1);
    await expect(depth(page)).toHaveCount(1);
    expect(scripts.size).toBeGreaterThan(0);
    let sawOrientation = false;
    for (const url of scripts) {
      const body = await (await page.request.get(url)).text();
      expect(body, url).not.toMatch(/geolocation|deviceorientationabsolute|AbsoluteOrientationSensor/i);
      sawOrientation ||= body.includes('deviceorientation');
    }
    // (the scan reads the code that does use the relative source)
    expect(sawOrientation).toBe(true);
  });
});

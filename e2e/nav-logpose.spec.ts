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

    // placed: centred over the rail, its target ORB_PX.clear above the rail's target (the two never overlap)
    const o = (await orb(page).boundingBox())!;
    const r = (await depth(page).boundingBox())!;
    expect(o.width).toBeCloseTo(ORB_PX.hit, 1);
    expect(o.x + o.width / 2).toBeCloseTo(r.x + r.width / 2, 1);
    expect(r.y - (o.y + o.height)).toBeCloseTo(ORB_PX.clear, 1);

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

  test('NAV-LOGPOSE: a Z pull begun anywhere in the rail\'s top, even with a broad thumb, goes to the rail, never to the orb', async ({ page }) => {
    test.setTimeout(300_000);
    await fakeDevice(page);
    await page.addInitScript(() => {
      const w = window as unknown as { __ev: string[] };
      w.__ev = [];
      for (const t of ['pointerdown', 'pointercancel'])
        document.addEventListener(t, (e) => {
          const el = e.target as Element | null;
          w.__ev.push(`${t}:${el?.closest?.('[data-nav]')?.getAttribute('data-nav') ?? `scene:${el?.tagName}.${el?.getAttribute?.('class') ?? ''}`}`);
        }, true);
    });
    await openCase(page, COVER);
    const opening = await cameraOf(page);
    const cdp = await page.context().newCDPSession(page);
    // Chromium's touch adjustment area is the contact clamped to 20..32 DIP: radius 1 is the least, 20 the most it takes
    let pulls = 0;
    for (const radius of [1, 20]) {
      // from the rail target's top row down to 2 px inside what is drawn
      for (const above of [19, 14, 10, 6, 2, 0, -2]) {
        const what = `radius ${radius}, ${above} px above the drawn top`;
        // every pull starts from the case just opened: the same camera, the orb shown and OFF, and no figure within
        // 16 px (the touch adjustment's reach) of where the pulls touch down, the rail's centre in its target's top
        // 22 px (a figure there could take the touch: a separate, known limit)
        if (pulls > 0) {
          await page.reload();
          await ready(page);
        }
        await expect(orb(page), what).toHaveCount(1);
        await expect(orb(page), what).toHaveAttribute('aria-checked', 'false');
        expect(await cameraOf(page), what).toEqual(opening);
        const r = (await depth(page).boundingBox())!;
        const top = { x: r.x + r.width / 2, y: r.y, width: 0, height: (DEPTH_RAIL_PX.hitHeight - DEPTH_RAIL_PX.height) / 2 + 2 };
        const nearest = await page.evaluate((t) => {
          let d = Infinity;
          let at = '';
          for (const f of Array.from(document.querySelectorAll('button.cab-figure'))) {
            const b = f.getBoundingClientRect();
            const e = Math.hypot(Math.max(0, t.x - b.right, b.left - (t.x + t.width)), Math.max(0, t.y - b.bottom, b.top - (t.y + t.height)));
            if (e < d) [d, at] = [e, `${b.left.toFixed(1)},${b.top.toFixed(1)} ${b.width.toFixed(1)}x${b.height.toFixed(1)}`];
          }
          return { d, at };
        }, top);
        expect(nearest.d, `${what}: nearest figure ${nearest.at}`).toBeGreaterThan(16);
        const x = r.x + r.width / 2;
        const y = r.y + (DEPTH_RAIL_PX.hitHeight - DEPTH_RAIL_PX.height) / 2 - above;
        // down and up in turn: each height is pulled both ways over the two radii
        const dy = pulls++ % 2 === 0 ? 40 : -40;
        const at = (yy: number) => [{ x, y: yy, radiusX: radius, radiusY: radius }];
        await page.evaluate(() => ((window as unknown as { __ev: string[] }).__ev.length = 0));
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(y) });
        for (let i = 1; i <= 10; i++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(y + (dy * i) / 10) });
          await page.waitForTimeout(16);
        }
        await page.waitForTimeout(500);
        const dz = (await cameraOf(page)).z - opening.z;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await settle(page, 300);
        const ev = await page.evaluate(() => (window as unknown as { __ev: string[] }).__ev);
        // the press went to the rail, never to the orb
        expect(ev, what).toEqual(['pointerdown:depth']);
        // a pull down backs the eye away, a pull up brings it closer (a pull the orb took moved it exactly 0)
        expect(dz, what).not.toBe(0);
        expect(Math.sign(dz), what).toBe(Math.sign(dy));
        await expect(orb(page), what).toHaveAttribute('aria-checked', 'false');
      }
    }
    // the orb itself still takes a broad thumb's tap
    const c = await centreOf(orb(page));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y, radiusX: 20, radiusY: 20 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(orb(page)).toHaveAttribute('aria-checked', 'true');
  });
});

/**
 * The close camera (CHALLENGE-3 SHOULD-1): walked closer until a large figure lies under the orb and the rail's top,
 * then back, 21 camera states. In each, touch-downs down the rail target's centre column, rows 0..14 of its target, at
 * radius 10, 16 and 20: none may go to the orb. A figure may take one (develop's rail is no tap candidate: a known,
 * separate limit); anything else fails. With the orb's target nearer the rail's than the touch adjustment's reach,
 * Chromium gives these touches to the orb.
 */
for (const size of [COVER, ...['android', 'fold8-cover-sideways'].map((n) => CASE_VIEWPORTS.find((v) => v.name === n)!)]) {
  test.describe(`close camera, ${size.name}`, () => {
    test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: FOLD8_DPR });

    test(`NAV-LOGPOSE: with a figure under the orb, no touch-down in the rail's top goes to the orb (${size.name})`, async ({ page }) => {
      test.setTimeout(600_000);
      await fakeDevice(page);
      await page.addInitScript(() => {
        const w = window as unknown as { __pd: string[] };
        w.__pd = [];
        document.addEventListener('pointerdown', (e) => {
          const el = e.target as Element | null;
          const nav = el?.closest?.('[data-nav]')?.getAttribute('data-nav');
          w.__pd.push(nav ?? (el?.closest?.('button.cab-figure') ? 'figure' : `scene:${el?.tagName}.${el?.getAttribute?.('class') ?? ''}`));
        }, true);
      });
      await openCase(page, size);
      await expect(orb(page)).toHaveCount(1);
      await expect(orb(page)).toHaveAttribute('aria-checked', 'false');
      const cdp = await page.context().newCDPSession(page);
      const taken = () => page.evaluate(() => (window as unknown as { __pd: string[] }).__pd.splice(0));
      const r = (await depth(page).boundingBox())!;
      const o = (await orb(page).boundingBox())!;
      const x = r.x + r.width / 2;
      const pull = async (y: number, dy: number, radius: number) => {
        await taken();
        const z0 = (await cameraOf(page)).z;
        const at = (yy: number) => [{ x, y: yy, radiusX: radius, radiusY: radius }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(y) });
        for (let i = 1; i <= 10; i++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(y + (dy * i) / 10) });
          await page.waitForTimeout(16);
        }
        await page.waitForTimeout(350);
        const dz = (await cameraOf(page)).z - z0;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await settle(page, 200);
        return { who: await taken(), dz };
      };
      const figureOverOrb = () =>
        page.evaluate((b) => Array.from(document.querySelectorAll('button.cab-figure')).some((f) => {
          const e = f.getBoundingClientRect();
          return e.left < b.x + b.width && e.right > b.x && e.top < b.y + b.height && e.bottom > b.y;
        }), o);
      // closer x8, then back x12, each pull begun at the rail's middle with a fine point: always the rail's
      const plan = [...Array(8).fill(-40), ...Array(12).fill(40)];
      const wrong: string[] = [];
      const tally: Record<string, number> = {};
      let covered = 0;
      let broad = '';
      for (let k = 0; k <= plan.length; k++) {
        if (k > 0) expect((await pull(r.y + r.height / 2, plan[k - 1], 1)).who, `walk pull ${k}`).toEqual(['depth']);
        const over = await figureOverOrb();
        if (over) covered++;
        for (const radius of [10, 16, 20]) {
          for (let row = 0; row <= 14; row++) {
            await taken();
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: r.y + row, radiusX: radius, radiusY: radius }] });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
            const who = (await taken()).join('|');
            tally[who] = (tally[who] ?? 0) + 1;
            if (who !== 'depth' && who !== 'figure') wrong.push(`state ${k}${over ? ' (figure over the orb)' : ''} r${radius} row ${row}: ${who || 'nothing'}`);
          }
        }
        // once, with a figure over the orb: a broad thumb's 40 px push from row 4, backing away (never clamped here)
        if (over && !broad) {
          const p = await pull(r.y + 4, 40, 20);
          broad = `state ${k}: ${p.who.join('|')} dz ${p.dz.toFixed(1)}`;
          if (p.who.join('|') === 'depth' ? p.dz <= 0 : p.who.join('|') !== 'figure') wrong.push(`broad push ${broad}`);
        }
        await expect(orb(page), `state ${k}`).toHaveAttribute('aria-checked', 'false');
      }
      console.log(`NAV-LOGPOSE close camera ${size.name}: clear ${ORB_PX.clear}, ${covered} of 21 states with a figure over the orb, broad push ${broad}, tally ${JSON.stringify(tally)}`);
      // the precondition: the walk reached the close camera this test is about
      expect(covered, 'states with a figure over the orb').toBeGreaterThan(0);
      expect(wrong, `touch-downs in the rail's top that went to the orb (or nowhere): ${wrong.length}`).toEqual([]);
    });
  });
}

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

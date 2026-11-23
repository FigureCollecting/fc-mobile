import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures';
import { depth, hat } from './navControls';

/**
 * NAV-EMPTY (Ross 11-22: at the room's top or bottom, after a "zoom away", "everything just becomes the backcolor/empty
 * room until I switch to card view and back"). The Free camera never leaves the wall behind: after every step here some
 * figure is in the frame. On 299682e the Z rail carried the eye at the room's top over the cabinets to the back wall
 * (0 figures in the frame), and a Look up from the top (a drag that begins with a still hold) or down from the bottom
 * turned the frame to the ceiling or the floor, where the rail and the hat kept it.
 *
 * The mouse drives every step, at the desktop's frame and at the Fold8's open one: a still mouse hold arms a Look on
 * either.
 */

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const SIZES = [
  { width: 1536, height: 730 },
  { width: 870, height: 475 },
] as const;

/** Longer than LOOK_HOLD_MS (250): the still press that turns a drag into a Look. */
const HOLD_MS = 400;
const DEG = 180 / Math.PI;

const settle = (page: Page, ms = 300) => page.evaluate((m) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, m)))), ms);

interface View {
  y: number;
  z: number;
  pitchDeg: number;
  ceilingMm: number;
  /** The figures whose box meets the frame. */
  figures: number;
}

async function view(page: Page): Promise<View> {
  return page.evaluate((deg) => {
    const host = document.querySelector<HTMLElement>('.cabinet-scene')!;
    const frame = document.querySelector<HTMLElement>('.cabinet-scene__frame')!.getBoundingClientRect();
    const cam = JSON.parse(host.dataset.camera!) as { y: number; z: number; pitch: number };
    const figures = Array.from(host.querySelectorAll('button.cab-figure')).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.right > frame.left && r.left < frame.right && r.bottom > frame.top && r.top < frame.bottom;
    }).length;
    return { y: cam.y, z: cam.z, pitchDeg: cam.pitch * deg, ceilingMm: (JSON.parse(host.dataset.room!) as { ceilingMm: number }).ceilingMm, figures };
  }, DEG);
}

async function open(page: Page, size: { width: number; height: number }): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    localStorage.setItem('fc-case-prefs', JSON.stringify({ view: 'wall', pattern: 'ikea-klingsbo+ikea-detolf+open-steel-rack' }));
  });
  await page.setViewportSize(size);
  await page.goto('/?layout=case&fx=622');
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 30_000 });
  await settle(page, 1000);
}

/** A left-button drag at the frame's centre by `dy` (down is +): a MOVE, or a Look when it holds still `holdMs` first. */
async function drag(page: Page, dy: number, holdMs = 0): Promise<void> {
  const f = (await page.locator('.cabinet-scene__frame').boundingBox())!;
  const x = f.x + f.width / 2;
  const y0 = f.y + f.height / 2 - dy / 2;
  await page.mouse.move(x, y0);
  await page.mouse.down();
  if (holdMs) await page.waitForTimeout(holdMs);
  for (let i = 1; i <= 12; i++) await page.mouse.move(x, y0 + (dy * i) / 12);
  await page.mouse.up();
  await settle(page, 500);
}

/** A right-button drag (a Look at once) from the frame's centre by (dx, dy). */
async function look(page: Page, dx: number, dy: number): Promise<void> {
  const f = (await page.locator('.cabinet-scene__frame').boundingBox())!;
  const x0 = f.x + f.width / 2;
  const y0 = f.y + f.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down({ button: 'right' });
  for (let i = 1; i <= 10; i++) await page.mouse.move(x0 + (dx * i) / 10, y0 + (dy * i) / 10);
  await page.mouse.up({ button: 'right' });
  await settle(page, 500);
}

/** MOVE drags one way (down raises the eye) until the eye stops: the room's top or bottom. */
async function toEnd(page: Page, end: 'top' | 'bottom'): Promise<void> {
  const f = (await page.locator('.cabinet-scene__frame').boundingBox())!;
  const dy = (end === 'top' ? 1 : -1) * f.height * 0.4;
  let last = NaN;
  for (let i = 0; i < 24; i++) {
    await drag(page, dy);
    const { y } = await view(page);
    if (y === last) return;
    last = y;
  }
  throw new Error(`the eye never reached the room's ${end}`);
}

/** The Z rail (push up: forward) or the hat (push up: the eye rises) held `ms` at `dy` from its centre. */
async function holdControl(page: Page, which: 'depth' | 'hat', dy: number, ms: number): Promise<void> {
  const b = (await (which === 'depth' ? depth(page) : hat(page)).boundingBox())!;
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x, y + (dy * i) / 6);
  await page.waitForTimeout(ms);
  await page.mouse.up();
  await settle(page, 600);
}

/** The frame as it stands, kept with the run; and the wall still in it. */
async function shows(page: Page, testInfo: TestInfo, step: string): Promise<View> {
  const f = (await page.locator('.cabinet-scene__frame').boundingBox())!;
  const path = testInfo.outputPath(`${step}.png`);
  await page.screenshot({ path, clip: { x: f.x, y: f.y, width: f.width, height: f.height } });
  await testInfo.attach(step, { path, contentType: 'image/png' });
  const v = await view(page);
  console.log(`case-room-empty ${JSON.stringify({ test: testInfo.title, step, ...v })}`);
  expect(v.figures, `figures in the frame after: ${step}`).toBeGreaterThan(0);
  return v;
}

for (const size of SIZES) {
  const at = `${size.width}x${size.height}`;

  test(`${at}: at the room's top the Z rail forward never flies over the cabinets to the back wall`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await open(page, size);
    await toEnd(page, 'top');
    const top = await shows(page, testInfo, 'top');
    expect(top.y, "the eye is at the room's top").toBeGreaterThan(top.ceilingMm - 60);
    expect(top.pitchDeg, 'no Look on the way up').toBe(0);
    await holdControl(page, 'depth', -40, 1000);
    const near = await shows(page, testInfo, 'top-rail-forward-1s');
    expect(near.z, 'the rail moved the eye forward').toBeLessThan(top.z - 100);
    await holdControl(page, 'depth', -40, 3000);
    await shows(page, testInfo, 'top-rail-forward-4s');
    await holdControl(page, 'depth', 40, 1000);
    await shows(page, testInfo, 'top-rail-back-1s');
  });

  test(`${at}: at the room's top a Look up keeps the wall in the frame, and so do the rail and the hat after it`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await open(page, size);
    await toEnd(page, 'top');
    const f = (await page.locator('.cabinet-scene__frame').boundingBox())!;
    await drag(page, f.height * 0.4, HOLD_MS);
    const once = await shows(page, testInfo, 'top-look-up');
    expect(once.pitchDeg, 'the held drag was a Look up').toBeLessThan(0);
    await drag(page, f.height * 0.4, HOLD_MS);
    await shows(page, testInfo, 'top-look-up-again');
    await holdControl(page, 'depth', 40, 3000);
    await shows(page, testInfo, 'top-look-up-rail-back');
    await holdControl(page, 'hat', -40, 2000);
    await shows(page, testInfo, 'top-look-up-hat-up');
    await holdControl(page, 'depth', -40, 3000);
    await shows(page, testInfo, 'top-look-up-rail-forward');
  });

  test(`${at}: at the room's top diagonal Looks (yaw and pitch together) keep the wall in the frame, and so does the rail back after them`, async ({ page }, testInfo) => {
    // CHALLENGE-1 B1: right drags from the frame's centre (the browser search's seq 34, as shares of the frame); on
    // 0098a73 the sixth left the frame on the ceiling at yaw -28.7, and the rail back 3 s kept it there
    test.setTimeout(120_000);
    await open(page, size);
    await toEnd(page, 'top');
    const f = (await page.locator('.cabinet-scene__frame').boundingBox())!;
    const steps = [[210, -317], [473, 323], [16, 186], [-713, 323], [30, 353], [690, 243]];
    for (const [k, [dx, dy]] of steps.entries()) {
      await look(page, (dx / 1536) * f.width, (dy / 730) * f.height);
      await shows(page, testInfo, `top-diagonal-look-${k + 1}`);
    }
    await holdControl(page, 'depth', 40, 3000);
    await shows(page, testInfo, 'top-diagonal-rail-back');
  });

  test(`${at}: at the room's bottom a Look down keeps the wall in the frame, and so does the rail after it`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await open(page, size);
    await toEnd(page, 'bottom');
    const bottom = await shows(page, testInfo, 'bottom');
    expect(bottom.y, "the eye is at the room's bottom").toBeLessThan(310);
    const f = (await page.locator('.cabinet-scene__frame').boundingBox())!;
    await drag(page, -f.height * 0.4, HOLD_MS);
    const once = await shows(page, testInfo, 'bottom-look-down');
    expect(once.pitchDeg, 'the held drag was a Look down').toBeGreaterThan(0);
    await drag(page, -f.height * 0.4, HOLD_MS);
    await shows(page, testInfo, 'bottom-look-down-again');
    await holdControl(page, 'depth', 40, 3000);
    await shows(page, testInfo, 'bottom-look-down-rail-back');
    await holdControl(page, 'hat', -40, 1000);
    await shows(page, testInfo, 'bottom-look-down-hat-up');
  });
}

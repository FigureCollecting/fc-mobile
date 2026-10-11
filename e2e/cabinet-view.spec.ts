import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';
import { project, type Camera } from '../src/components/display/caseCamera';
import { IKEA_KLINGSBO } from '../src/components/display/cabinetPresets';
import { wallLayout } from '../src/components/display/packCabinets';

/**
 * The faithful cabinets in a real browser (CASE-FIX, CASE-CABINET,
 * CASE-ADAPT): a tap on a figure opens it and a tap on the cabinet opens
 * nothing; the browser draws each figure exactly where the camera maths
 * puts it, standing on its surface; switching views relays out without
 * overlap; the CC4 swipe walks the camera or pans the picture; the IC1 tabs
 * sit above the raised +. Fixture mode on the committed synthetic art.
 */

test.use({ hasTouch: true, isMobile: true });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

interface Prefs {
  view?: 'wall' | 'cabinet' | 'shelf';
  pattern?: string;
  swipe?: 'camera' | 'pan';
}

async function openCase(page: Page, size: { width: number; height: number }, query = '', prefs: Prefs = {}) {
  await page.addInitScript((p) => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    if (Object.keys(p).length > 0) localStorage.setItem('fc-case-prefs', JSON.stringify(p));
  }, prefs);
  await page.setViewportSize(size);
  await page.goto(`/?layout=case${query}`);
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0);
  await settle(page);
}

/** Every picture decoded and every figure grounded (its transparent margin measured). */
async function settle(page: Page) {
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll<HTMLElement>('button.cab-figure')).every(
      (b) => b.dataset.grounded === '1' && Array.from(b.querySelectorAll('img')).every((img) => img.complete && img.naturalWidth > 0),
    ),
  );
}

interface World {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z: number;
  surface: number;
}

async function cameraOf(page: Page): Promise<Camera> {
  const c = JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-camera'))!);
  return { x: c.x, y: c.y, z: c.z, pitch: c.pitch, focalPx: c.focalPx, frame: { width: c.width, height: c.height } };
}

/** Each figure's on-screen box (CSS px, relative to the scene) and the box the camera maths predicts for it. */
async function drawnVsPredicted(page: Page) {
  const camera = await cameraOf(page);
  const scene = (await page.locator('.cabinet-scene').boundingBox())!;
  const figures = await page.locator('button.cab-figure').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { name: el.getAttribute('aria-label')!, world: (el as HTMLElement).dataset.world!, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }),
  );
  return figures.map((f) => {
    const w = JSON.parse(f.world) as World;
    const corners = [project(camera, [w.x0, w.y0, w.z]), project(camera, [w.x1, w.y0, w.z]), project(camera, [w.x0, w.y1, w.z]), project(camera, [w.x1, w.y1, w.z])];
    return {
      name: f.name,
      world: w,
      drawn: { left: f.left - scene.x, right: f.right - scene.x, top: f.top - scene.y, bottom: f.bottom - scene.y },
      predicted: {
        left: Math.min(...corners.map((c) => c.x)),
        right: Math.max(...corners.map((c) => c.x)),
        top: Math.min(...corners.map((c) => c.y)),
        bottom: Math.max(...corners.map((c) => c.y)),
      },
    };
  });
}

const FOLD8 = CASE_VIEWPORTS.filter((v) => v.name.startsWith('fold8'));

for (const size of CASE_VIEWPORTS) {
  test(`a tap on a figure opens it, a tap on the cabinet opens nothing: ${size.name} ${size.width}x${size.height}`, async ({ page }) => {
    await openCase(page, size, '', { view: 'cabinet' });
    const figure = page.locator('button.cab-figure').nth(2);
    const name = await figure.getAttribute('aria-label');
    // the cabinet itself, between two shelves, away from every figure: nothing opens
    const scene = (await page.locator('.cabinet-scene').boundingBox())!;
    await page.touchscreen.tap(scene.x + 6, scene.y + scene.height - 6);
    await page.waitForTimeout(250);
    await expect(page.locator('.pswp, .detail-pane')).toHaveCount(0);

    await figure.tap();
    const dual = size.width >= 640;
    const opened = page.locator(dual ? '.detail-pane' : '.pswp');
    await expect(opened).toBeVisible();
    await expect(page.locator(dual ? '.detail-pane' : '.figure-viewer-sheet')).toContainText(name!);
  });
}

for (const size of FOLD8) {
  for (const view of ['wall', 'cabinet', 'shelf'] as const) {
    test(`the browser draws every figure where the camera maths puts it: ${view}, ${size.name}`, async ({ page }) => {
      await openCase(page, size, '', { view });
      const rows = await drawnVsPredicted(page);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
          expect(Math.abs(r.drawn[edge] - r.predicted[edge]), `${r.name} ${edge}`).toBeLessThan(1.5);
        }
      }
    });
  }
}

test('views switch in place: no figure overlaps another on its surface, the scene keeps its size', async ({ page }) => {
  const size = FOLD8.find((v) => v.name === 'fold8-open')!;
  await openCase(page, size, '&fx=3');
  const sceneBox = await page.locator('.cabinet-scene').boundingBox();
  for (const view of ['One cabinet', 'One shelf', 'Whole cabinets', 'One cabinet'] as const) {
    await page.getByRole('button', { name: 'View' }).click();
    await page.getByRole('radio', { name: view }).click();
    await page.keyboard.press('Escape');
    await settle(page);
    expect(await page.locator('.cabinet-scene').boundingBox()).toEqual(sceneBox);
    const rows = await drawnVsPredicted(page);
    const bySurface = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = `${r.world.surface}:${Math.round(r.world.z)}:${Math.round((r.world.x0 + r.world.x1) / 2 / 400)}`;
      bySurface.set(key, [...(bySurface.get(key) ?? []), r]);
    }
    for (const group of bySurface.values()) {
      const sorted = [...group].sort((a, b) => a.world.x0 - b.world.x0);
      for (let i = 1; i < sorted.length; i++) {
        // neighbours keep their gap in the world: the drawing never overlaps them
        expect(sorted[i].world.x0, `${sorted[i - 1].name} / ${sorted[i].name}`).toBeGreaterThanOrEqual(sorted[i - 1].world.x1 - 1e-6);
      }
    }
  }
});

test('the case ends where the cabinets do: the room fills the rest, nothing stretches (Ross 09-26)', async ({ page }) => {
  const size = FOLD8.find((v) => v.name === 'fold8-cover')!;
  await openCase(page, size);
  const camera = await cameraOf(page);
  // one pinhole, one focal length: a small square facing the camera at the middle of the frame draws square
  const look = { x: camera.x, y: camera.y - camera.z * Math.tan(camera.pitch), z: 0 };
  const o = project(camera, [look.x, look.y, look.z]);
  const r = project(camera, [look.x + 10, look.y, look.z]);
  const u = project(camera, [look.x, look.y + 10, look.z]);
  const across = Math.hypot(r.x - o.x, r.y - o.y);
  const up = Math.hypot(u.x - o.x, u.y - o.y);
  expect(Math.abs(up / across - Math.cos(camera.pitch))).toBeLessThan(0.01);
  // and the browser draws the KLINGSBO's front post exactly there: 1645 mm of post over 155 mm legs, never resized to the screen
  const slot = wallLayout([IKEA_KLINGSBO]).cabinets[0];
  const sec = IKEA_KLINGSBO.base.leg!.sectionMm;
  const legTop = IKEA_KLINGSBO.base.heightMm;
  const H = IKEA_KLINGSBO.outer.heightMm;
  const corners = [
    project(camera, [slot.leftMm, legTop, 0]),
    project(camera, [slot.leftMm + sec, legTop, 0]),
    project(camera, [slot.leftMm, H, 0]),
    project(camera, [slot.leftMm + sec, H, 0]),
  ];
  const scene = (await page.locator('.cabinet-scene').boundingBox())!;
  const post = (await page.locator('.cab[data-index="0"] .cab-post').first().locator('.f-front').boundingBox())!;
  expect(Math.abs(post.y - scene.y - Math.min(...corners.map((c) => c.y)))).toBeLessThan(1.5);
  expect(Math.abs(post.y + post.height - scene.y - Math.max(...corners.map((c) => c.y)))).toBeLessThan(1.5);
  expect(Math.abs(post.x - scene.x - Math.min(...corners.map((c) => c.x)))).toBeLessThan(1.5);
  // the scene stops above the tabs; whatever the cabinets leave is room, not stretched shelves
  const tabs = (await page.locator('.case-tabs').boundingBox())!;
  expect(scene.y + scene.height).toBeLessThanOrEqual(tabs.y + 1);
});

async function swipe(page: Page, dx: number) {
  const scene = (await page.locator('.cabinet-scene').boundingBox())!;
  const x = scene.x + scene.width / 2;
  const y = scene.y + scene.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x + (dx * i) / 6, y);
  await page.mouse.up();
}

test('CC4 camera: a sideways swipe walks the camera along the wall; the perspective re-renders', async ({ page }) => {
  await openCase(page, FOLD8[0], '&fx=6', { view: 'cabinet', swipe: 'camera' });
  const before = await cameraOf(page);
  await swipe(page, -160);
  const after = await cameraOf(page);
  expect(after.x).toBeGreaterThan(before.x + 100);
  expect(await page.locator('.cabinet-scene').getAttribute('data-pan')).toBe('0');
  // and the drawing still follows the maths after the walk
  for (const r of await drawnVsPredicted(page)) expect(Math.abs(r.drawn.left - r.predicted.left)).toBeLessThan(1.5);
});

test('CC4 pan: a sideways swipe slides the drawn wall like a photo; the camera stays put', async ({ page }) => {
  await openCase(page, FOLD8[0], '&fx=6', { view: 'cabinet', swipe: 'pan' });
  // five cabinets: narrower than the frame at this zoom, but starting mid-screen, so the rest slides in
  const before = await cameraOf(page);
  const fig = page.locator('button.cab-figure').first();
  const x0 = (await fig.boundingBox())!.x;
  await swipe(page, -120);
  expect(await cameraOf(page)).toEqual(before);
  const pan = Number(await page.locator('.cabinet-scene').getAttribute('data-pan'));
  expect(pan).toBeLessThan(-100);
  expect((await fig.boundingBox())!.x).toBeCloseTo(x0 + pan, 0);
});

test('a swipe opens nothing; the next tap does', async ({ page }) => {
  await openCase(page, FOLD8[0], '&fx=6', { view: 'cabinet' });
  await swipe(page, -80);
  await page.waitForTimeout(200);
  await expect(page.locator('.pswp')).toHaveCount(0);
  await page.locator('button.cab-figure').first().tap();
  await expect(page.locator('.pswp')).toBeVisible();
});

test('IC1: View, an empty Reserved slot, the raised +, Info, Refine; the View card switches the swipe', async ({ page }) => {
  await openCase(page, FOLD8[0]);
  const tabs = page.locator('.case-tabs');
  const add = (await page.locator('.tab-bar__add').boundingBox())!;
  const bar = (await page.locator('.tab-bar').boundingBox())!;
  const tabBox = (await tabs.boundingBox())!;
  // the tabs rest on the tab bar; the + rises above the bar, between them
  expect(Math.abs(tabBox.y + tabBox.height - bar.y)).toBeLessThanOrEqual(1);
  expect(add.y).toBeLessThan(bar.y - add.height * 0.5);
  const order = await tabs.locator(':scope > [data-tab]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.tab));
  expect(order).toEqual(['view', 'reserved', 'dock', 'info', 'refine']);
  await expect(tabs.locator('[data-tab="reserved"]')).toHaveText('');
  const dock = (await tabs.locator('[data-tab="dock"]').boundingBox())!;
  expect(Math.abs(dock.x + dock.width / 2 - (add.x + add.width / 2))).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: 'View' }).click();
  await page.getByRole('radio', { name: 'Pan the wall' }).click();
  await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-swipe', 'pan');
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('fc-case-prefs')))!).swipe).toBe('pan');
});

test('masked art: the clean copy composited with its mask at display time (CSS mask-image)', async ({ page }) => {
  await openCase(page, FOLD8[0], '&fxbranch=masked', { view: 'shelf' });
  const art = page.locator('.cab-figure__art--masked').first();
  const style = await art.evaluate((el) => {
    const cs = getComputedStyle(el);
    const abs = (u: string) => new URL(u, location.href).href;
    return {
      mask: cs.getPropertyValue('mask-image') || cs.getPropertyValue('-webkit-mask-image'),
      bg: cs.backgroundImage,
      maskUrl: abs((el as HTMLElement).dataset.maskUrl!),
      imageUrl: abs((el as HTMLElement).dataset.imageUrl!),
    };
  });
  // the build fingerprints the file names: the clean copy and its mask are two different files, each where it belongs
  expect(style.maskUrl).not.toBe(style.imageUrl);
  expect(style.mask).toBe(`url("${style.maskUrl}")`);
  expect(style.bg).toBe(`url("${style.imageUrl}")`);
  // the picture takes no tap: the figure's tap box does
  expect(await art.evaluate((el) => getComputedStyle(el.closest('.cab-figure__box')!).pointerEvents)).toBe('none');
});


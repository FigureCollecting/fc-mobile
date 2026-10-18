import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';
import { frameMargins } from '../src/components/display/caseCamera';

/**
 * CAB-FOCUS-1 (Ross 10-18, Fold8): the one-cabinet view's arrows snap to the straight-on view that fits the whole focus
 * cabinet (by its height or its width, whichever dictates, never a crop), where a drag then moves the picture again; and
 * the cabinets either side of it are dimmed, only in this view, never over the focus cabinet or in the way of a tap.
 * Fixture mode, the mixed wall (KLINGSBO, Detolf, rack), at the Fold8's four panels.
 */

test.use({ hasTouch: true, isMobile: true });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const FOLD8 = CASE_VIEWPORTS.filter((v) => v.name.startsWith('fold8'));
const PATTERN = 'ikea-klingsbo+ikea-detolf+open-steel-rack';

async function openCabinetView(page: Page, size: { width: number; height: number }, view = 'cabinet') {
  await page.addInitScript(
    ([v, pattern]) => {
      localStorage.setItem('onboarding_complete', '1');
      localStorage.setItem('fc-fixture-mode', 'on');
      localStorage.setItem('fc-case-prefs', JSON.stringify({ view: v, swipe: 'camera', pattern }));
    },
    [view, PATTERN],
  );
  await page.setViewportSize(size);
  await page.goto('/?layout=case&fx=8');
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(300);
}

interface Cam {
  x: number;
  y: number;
  z: number;
  pitch: number;
  width: number;
  height: number;
}
const camera = async (page: Page): Promise<Cam> => JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-camera'))!);
const next = (page: Page) => page.getByRole('button', { name: 'Next cabinet' }).click();

async function lift(page: Page, dy: number) {
  const scene = (await page.locator('.cabinet-scene').boundingBox())!;
  const x = scene.x + scene.width / 2;
  const y = scene.y + scene.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x, y + (dy * i) / 8);
  await page.mouse.up();
  await page.waitForTimeout(60);
}

/** The focus cabinet's drawn extent on the screen: every face of it, in the frame's coordinates. */
async function focusBox(page: Page) {
  return page.evaluate(() => {
    const host = document.querySelector('.cabinet-scene') as HTMLElement;
    const frame = (document.querySelector('.cabinet-scene__frame') as HTMLElement).getBoundingClientRect();
    const cab = host.querySelector(`.cab[data-index="${host.dataset.focus}"]`)!;
    const rs = Array.from(cab.querySelectorAll('.q')).map((q) => q.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    return {
      left: Math.min(...rs.map((r) => r.left)) - frame.left,
      right: Math.max(...rs.map((r) => r.right)) - frame.left,
      top: Math.min(...rs.map((r) => r.top)) - frame.top,
      bottom: Math.max(...rs.map((r) => r.bottom)) - frame.top,
      frame: { width: frame.width, height: frame.height },
    };
  });
}

for (const size of FOLD8) {
  test(`the arrow shows the whole focus cabinet inside the frame, one margin touched, the other dimension showing more: ${size.name}`, async ({ page }) => {
    await openCabinetView(page, size);
    for (let i = 0; i < 4; i++) {
      await next(page);
      await page.waitForTimeout(80);
      const b = await focusBox(page);
      const m = frameMargins(b.frame);
      const at = `${size.name} focus ${i + 1}`;
      expect(b.left, `${at}: left`).toBeGreaterThanOrEqual(m.x - 2);
      expect(b.right, `${at}: right`).toBeLessThanOrEqual(b.frame.width - m.x + 2);
      expect(b.top, `${at}: top`).toBeGreaterThanOrEqual(m.y - 2);
      expect(b.bottom, `${at}: bottom`).toBeLessThanOrEqual(b.frame.height - m.y + 2);
      const slackX = Math.min(b.left - m.x, b.frame.width - m.x - b.right);
      const slackY = Math.min(b.top - m.y, b.frame.height - m.y - b.bottom);
      expect(Math.min(slackX, slackY), `${at}: a dimension dictates`).toBeLessThanOrEqual(3);
    }
  });
}

test('an arrow press snaps a lifted camera back to the straight-on fit of the cabinet; a drag lifts it again', async ({ page }) => {
  await openCabinetView(page, FOLD8.find((v) => v.name === 'fold8-open')!);
  const host = page.locator('.cabinet-scene');
  await next(page);
  await expect(host).toHaveAttribute('data-focus', '1');
  const straight = await camera(page);
  expect(straight.pitch).toBe(0);
  await lift(page, -120);
  expect((await camera(page)).y, 'a drag lifts the camera').not.toBeCloseTo(straight.y, 0);
  await page.getByRole('button', { name: 'Previous cabinet' }).click();
  await next(page);
  await expect(host).toHaveAttribute('data-focus', '1');
  expect(await camera(page), 'back at the straight-on fit').toEqual(straight);
  await lift(page, -120);
  expect((await camera(page)).y, 'free movement moves it again').not.toBeCloseTo(straight.y, 0);
});

test('a drag never re-fits the picture: the camera walked to a neighbour keeps its distance and height', async ({ page }) => {
  await openCabinetView(page, FOLD8.find((v) => v.name === 'fold8-open')!);
  const before = await camera(page);
  const scene = (await page.locator('.cabinet-scene').boundingBox())!;
  const y = scene.y + scene.height / 2;
  await page.mouse.move(scene.x + scene.width * 0.8, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(scene.x + scene.width * 0.8 - (scene.width * 0.6 * i) / 10, y);
  await page.mouse.up();
  await page.waitForTimeout(120);
  const after = await camera(page);
  expect(after.x, 'it walked').toBeGreaterThan(before.x);
  expect({ y: after.y, z: after.z, pitch: after.pitch }).toEqual({ y: before.y, z: before.z, pitch: before.pitch });
});

for (const size of FOLD8) {
  test(`the neighbours are dimmed from the focus cabinet's edges, never over it, and a tap goes through: ${size.name}`, async ({ page }) => {
    await openCabinetView(page, size);
    await next(page);
    await page.waitForTimeout(100);
    const info = await page.evaluate(() => {
      const frame = (document.querySelector('.cabinet-scene__frame') as HTMLElement).getBoundingClientRect();
      const veils = Array.from(document.querySelectorAll<HTMLElement>('.cabinet-scene__dim')).map((v) => {
        const r = v.getBoundingClientRect();
        const cs = getComputedStyle(v);
        return { side: v.dataset.side!, edge: Number(v.dataset.edge), left: r.left - frame.left, right: r.right - frame.left, color: cs.backgroundColor, events: cs.pointerEvents };
      });
      return { veils, frame: { width: frame.width } };
    });
    expect(info.veils.map((v) => v.side).sort()).toEqual(['left', 'right']);
    const box = await focusBox(page);
    const l = info.veils.find((v) => v.side === 'left')!;
    const r = info.veils.find((v) => v.side === 'right')!;
    // the veils end where the focus cabinet's drawn extent does (its glass and feet are in it)
    expect(Math.abs(l.right - box.left), 'the left veil ends at the focus cabinet\'s left').toBeLessThanOrEqual(3);
    expect(Math.abs(r.left - box.right), 'the right veil starts at its right').toBeLessThanOrEqual(3);
    for (const v of info.veils) {
      expect(v.color).toBe('rgba(0, 0, 0, 0.6)');
      expect(v.events).toBe('none');
    }
    // a neighbour's figure stays tappable: the topmost element at its middle is the figure's button, not a veil
    const hit = await page.evaluate(() => {
      const frame = (document.querySelector('.cabinet-scene__frame') as HTMLElement).getBoundingClientRect();
      const veils = Array.from(document.querySelectorAll<HTMLElement>('.cabinet-scene__dim'));
      const edges = veils.map((v) => v.getBoundingClientRect());
      const inVeil = (x: number) => edges.some((e) => x >= e.left && x <= e.right);
      for (const b of Array.from(document.querySelectorAll<HTMLElement>('button.cab-figure'))) {
        const r = b.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        if (!inVeil(x) || x < frame.left || x > frame.right || y < frame.top || y > frame.bottom) continue;
        return document.elementFromPoint(x, y)?.closest('button.cab-figure') !== null;
      }
      return null;
    });
    if (hit !== null) expect(hit, 'the topmost element over a neighbour\'s figure is its button').toBe(true);
  });
}

test('none in the wall view and none in the shelf view', async ({ page }) => {
  for (const view of ['wall', 'shelf']) {
    await openCabinetView(page, FOLD8.find((v) => v.name === 'fold8-open')!, view);
    await expect(page.locator('.cabinet-scene__dim'), view).toHaveCount(0);
  }
});

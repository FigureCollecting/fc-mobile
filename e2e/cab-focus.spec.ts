import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';
import { frameMargins } from '../src/components/display/caseCamera';
import { decodePng } from './paintCheck';
import { touchPinch } from './touch';

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

async function openCabinetView(page: Page, size: { width: number; height: number }, view = 'cabinet', more: Record<string, unknown> = {}) {
  await page.addInitScript(
    ([v, pattern, m]) => {
      localStorage.setItem('onboarding_complete', '1');
      localStorage.setItem('fc-fixture-mode', 'on');
      localStorage.setItem('fc-case-prefs', JSON.stringify({ view: v, swipe: 'camera', pattern, ...(m as object) }));
    },
    [view, PATTERN, more] as const,
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

/**
 * CAB-EDGE-DIM-1 (Ross 10-31, Fold8: "in one cabinet mode, the two ends don't darken beyond the cabinet's outer edge when
 * there isn't another adjacent cabinet"). Past the wall's first and last cabinet there is no neighbour, only the bare wall
 * or empty space, and it dims as a neighbour does. Read from the screen: a strip just past each side of the focus cabinet's
 * drawn extent, with the veils and with them hidden; the share of its luminance the veils leave is NEIGHBOUR_DIM's past
 * the inner edge (over the neighbour) and the same past the outer edge (over the bare wall). Before the fix the outer
 * strip kept all of it (a share of 1).
 */
const KEPT = 1 - 0.6; // 1 - NEIGHBOUR_DIM
const SHARE_TOLERANCE = 0.06;
const STRIP_PX = 8;
const GAP_PX = 5;

type Clip = { x: number; y: number; width: number; height: number };

/** Mean Rec. 709 luma (0 to 255) of a clip of the page. */
async function luma(page: Page, clip: Clip): Promise<number> {
  const shot = decodePng(await page.screenshot({ clip }));
  let sum = 0;
  for (let i = 0; i < shot.data.length; i += 4) sum += 0.2126 * shot.data[i]! + 0.7152 * shot.data[i + 1]! + 0.0722 * shot.data[i + 2]!;
  return sum / (shot.width * shot.height);
}

/**
 * The strip STRIP_PX wide, GAP_PX past one side of the focus cabinet's drawn extent, down the upper part of its height
 * (clear of the arrows at the frame's middle and the buttons at its foot), in page px.
 */
async function stripPast(page: Page, side: 'left' | 'right', at: string): Promise<Clip> {
  const b = await focusBox(page);
  const f = (await page.locator('.cabinet-scene__frame').boundingBox())!;
  const x = side === 'left' ? b.left - GAP_PX - STRIP_PX : b.right + GAP_PX;
  expect(x, `${at}: the frame shows past its ${side} edge`).toBeGreaterThanOrEqual(0);
  expect(x + STRIP_PX, `${at}: the frame shows past its ${side} edge`).toBeLessThanOrEqual(b.frame.width);
  const top = Math.max(0, b.top);
  const h = Math.min(b.frame.height, b.bottom) - top;
  return { x: f.x + x, y: f.y + top + h * 0.1, width: STRIP_PX, height: h * 0.25 };
}

const showVeils = (page: Page, shown: boolean) =>
  page.evaluate((s) => {
    for (const v of Array.from(document.querySelectorAll<HTMLElement>('.cabinet-scene__dim'))) v.style.visibility = s ? '' : 'hidden';
  }, shown);

/** The share of a strip's luminance the veils leave (with them over without them). */
async function keptPast(page: Page, side: 'left' | 'right', at: string): Promise<number> {
  const clip = await stripPast(page, side, at);
  const dimmed = await luma(page, clip);
  await showVeils(page, false);
  const bare = await luma(page, clip);
  await showVeils(page, true);
  expect(bare, `${at}: something to dim past the ${side} edge`).toBeGreaterThan(12);
  return dimmed / bare;
}

/** At the wall's first (outer side left) or last (outer side right) cabinet: past the outer edge dims as past the inner. */
async function endDimsAsNeighbour(page: Page, end: 'first' | 'last', at: string) {
  const [outer, inner] = end === 'first' ? (['left', 'right'] as const) : (['right', 'left'] as const);
  const keptInner = await keptPast(page, inner, at);
  const keptOuter = await keptPast(page, outer, at);
  expect(Math.abs(keptInner - KEPT), `${at}: past the inner edge (the neighbour) keeps ${keptInner.toFixed(3)}`).toBeLessThanOrEqual(SHARE_TOLERANCE);
  expect(Math.abs(keptOuter - keptInner), `${at}: past the wall's end keeps ${keptOuter.toFixed(3)}, past the neighbour ${keptInner.toFixed(3)}`).toBeLessThanOrEqual(
    SHARE_TOLERANCE,
  );
}

const wallLength = async (page: Page) => (JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-wall'))!) as unknown[]).length;

/** A mouse drag across the frame's middle by dx (a Move in Free camera; a right button's turns the eye). */
async function sweep(page: Page, dx: number, button: 'left' | 'right' = 'left') {
  const f = (await page.locator('.cabinet-scene__frame').boundingBox())!;
  const x = f.x + f.width / 2 - dx / 2;
  const y = f.y + f.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down({ button });
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + (dx * i) / 10, y);
  await page.mouse.up({ button });
  await page.waitForTimeout(150);
}

for (const size of FOLD8) {
  test(`at the wall's first and last cabinet the bare wall past the outer edge dims as the neighbour past the inner edge does: ${size.name}`, async ({ page }) => {
    await openCabinetView(page, size);
    const host = page.locator('.cabinet-scene');
    await expect(host).toHaveAttribute('data-focus', '0');
    await endDimsAsNeighbour(page, 'first', `${size.name} first`);
    const last = (await wallLength(page)) - 1;
    for (let i = 0; i < last; i++) await next(page);
    await expect(host).toHaveAttribute('data-focus', String(last));
    await page.waitForTimeout(100);
    await endDimsAsNeighbour(page, 'last', `${size.name} last`);
  });
}

for (const size of FOLD8.filter((v) => v.name === 'fold8-cover' || v.name === 'fold8-open')) {
  test(`Free camera: past the wall's ends dims as past a neighbour, straight on, turned and zoomed: ${size.name}`, async ({ page }) => {
    test.setTimeout(60_000);
    await openCabinetView(page, size, 'cabinet', { freeCamera: true });
    const host = page.locator('.cabinet-scene');
    await expect(host).toHaveAttribute('data-free-camera', '1');
    await expect(host).toHaveAttribute('data-focus', '0');
    await endDimsAsNeighbour(page, 'first', `${size.name} free first`);
    const yaw = async () => (JSON.parse((await host.getAttribute('data-camera'))!) as { yaw: number }).yaw;
    // turned a little toward the wall's end
    await sweep(page, 40, 'right');
    expect(await yaw(), 'turned').toBeLessThan(0);
    await endDimsAsNeighbour(page, 'first', `${size.name} free first turned`);
    await sweep(page, -40, 'right');
    expect(await yaw(), 'turned back').toBeCloseTo(0, 3);
    // walked to the last cabinet (Free camera retires the arrows: the frame centre's cabinet is the focus)
    const last = String((await wallLength(page)) - 1);
    for (let i = 0; i < 20 && (await host.getAttribute('data-focus')) !== last; i++) await sweep(page, -size.width * 0.5);
    await expect(host).toHaveAttribute('data-focus', last);
    await endDimsAsNeighbour(page, 'last', `${size.name} free last`);
    // turned toward the wall's end past Reset's 10 degrees, the last cabinet still the focus: its inner edge can leave the
    // frame; past its outer edge the veil keeps what it keeps over a neighbour
    await sweep(page, -120, 'right');
    expect(await yaw(), 'turned').toBeGreaterThan(10 * (Math.PI / 180));
    await expect(host).toHaveAttribute('data-focus', last);
    const kept = await keptPast(page, 'right', `${size.name} free last turned`);
    expect(Math.abs(kept - KEPT), `${size.name} free last turned: past the wall's end keeps ${kept.toFixed(3)}`).toBeLessThanOrEqual(SHARE_TOLERANCE);
    // Reset stands the eye at the last cabinet's framing (the walk overshoots it), and a pinch at its middle zooms in
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect.poll(yaw, { message: 'reset' }).toBe(0);
    await expect(host).toHaveAttribute('data-focus', last);
    const b = await focusBox(page);
    const f = (await page.locator('.cabinet-scene__frame').boundingBox())!;
    const cx = f.x + (b.left + b.right) / 2;
    const cy = f.y + (b.top + b.bottom) / 2;
    await touchPinch(page, { x: cx - 50, y: cy }, { x: cx + 50, y: cy }, { x: cx - 60, y: cy }, { x: cx + 60, y: cy });
    await page.waitForTimeout(300);
    expect((JSON.parse((await host.getAttribute('data-zoom'))!) as { k: number }).k, 'zoomed').toBeGreaterThan(1);
    await endDimsAsNeighbour(page, 'last', `${size.name} free last zoomed`);
  });
}

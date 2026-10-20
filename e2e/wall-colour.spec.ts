import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';

/**
 * WALL-COLOUR-1 (Ross 10-20, WALL1 = a): the View card chooses the wall's colour: Cream (the default), Off-white, White,
 * Seafoam or a custom colour, each with a dark-theme counterpart, kept on the device and drawn in every view. The View card
 * no longer carries the view (VIEWCARD-1: the header's Case menu does). At the Fold8 cover and open panels, both themes.
 * WALL_COLOUR_SHOTS=<dir> also writes a screenshot per choice and theme there (Ross's review sheet).
 */

test.use({ hasTouch: true, isMobile: true });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const FOLD8 = CASE_VIEWPORTS.filter((v) => v.name === 'fold8-cover' || v.name === 'fold8-open');

async function openCase(page: Page, size: { width: number; height: number }, scheme: 'light' | 'dark') {
  // the app's own theme setting (stores/theme.ts: dark unless fc-theme says otherwise)
  await page.addInitScript((theme) => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    localStorage.setItem('fc-theme', theme);
  }, scheme);
  await page.setViewportSize(size);
  await page.goto('/?layout=case&fx=6');
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
}

async function chooseWall(page: Page, name: string) {
  await page.getByRole('button', { name: 'View' }).click();
  await page.getByRole('group', { name: 'Wall', exact: true }).getByRole('radio', { name, exact: true }).click();
  await page.locator('.bottom-sheet__backdrop').click({ position: { x: 5, y: 5 } });
  await expect(page.getByRole('group', { name: 'Wall', exact: true })).toHaveCount(0);
}

const wallVar = (page: Page) => page.locator('.cabinet-scene').evaluate((el) => getComputedStyle(el).getPropertyValue('--wall').trim());

/** The brightest of a grid of points over the frame (some of them are the wall, whatever the view shows), as 0..255 grey. */
async function wallBrightness(page: Page): Promise<number> {
  const f = (await page.locator('.cabinet-scene__frame').boundingBox())!;
  let best = 0;
  for (const ky of [0.04, 0.5, 0.9]) {
    for (const kx of [0.03, 0.5, 0.97]) {
      const clip = { x: f.x + f.width * kx, y: f.y + f.height * ky, width: 2, height: 2 };
      const png = (await page.screenshot({ clip })).toString('base64');
      const v = await page.evaluate(async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, 1, 1).data;
        return (d[0]! + d[1]! + d[2]!) / 3;
      }, png);
      best = Math.max(best, v);
    }
  }
  return best;
}

const lightnessOf = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return (Math.max(...c) + Math.min(...c)) / 2;
};

for (const size of FOLD8) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`the wall takes the colour chosen in the View card, its ${scheme}-theme one, Cream until then: ${size.name}`, async ({ page }) => {
      await openCase(page, size, scheme);
      await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-wall-colour', 'cream');
      expect(await wallVar(page), 'Cream is the default').toBe(scheme === 'light' ? '#efe6d6' : '#3b342a');
      const shots = process.env['WALL_COLOUR_SHOTS'];
      if (shots) mkdirSync(shots, { recursive: true });
      const brightness: Record<string, number> = {};
      for (const [name, id, light, dark] of [
        ['Off-white', 'off-white', '#f2f1ec', '#34332f'],
        ['White', 'white', '#ffffff', '#2e2e2e'],
        ['Seafoam', 'seafoam', '#a8d8cc', '#2c4a44'],
        ['Cream', 'cream', '#efe6d6', '#3b342a'],
      ] as const) {
        await chooseWall(page, name);
        await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-wall-colour', id);
        expect(await wallVar(page), `${name} in the ${scheme} theme`).toBe(scheme === 'light' ? light : dark);
        brightness[id] = await wallBrightness(page);
        if (shots) await page.screenshot({ path: `${shots}/${size.name}-${scheme}-${id}.png` });
      }
      for (const [id, v] of Object.entries(brightness)) {
        if (scheme === 'light') expect(v, `${id}: a light wall is drawn light`).toBeGreaterThan(150);
        else expect(v, `${id}: its dark counterpart is drawn dark`).toBeLessThan(110);
      }
    });
  }

  test(`the wall colour is drawn in every view, the wall, one cabinet and one shelf: ${size.name}`, async ({ page }) => {
    for (const view of ['wall', 'cabinet', 'shelf'] as const) {
      await page.addInitScript((v) => localStorage.setItem('fc-case-prefs', JSON.stringify({ view: v, wall: 'seafoam' })), view);
      await openCase(page, size, 'light');
      await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-view', view);
      await expect(page.locator('.cabinet-scene .room-wall')).toHaveCount(1);
      expect(await wallVar(page), view).toBe('#a8d8cc');
      expect(await wallBrightness(page), `${view}: the wall is drawn in Seafoam, a light colour`).toBeGreaterThan(150);
    }
  });

  test(`a custom colour, kept on the device, with a dark counterpart: ${size.name}`, async ({ page }) => {
    await openCase(page, size, 'light');
    await page.getByRole('button', { name: 'View' }).click();
    await page.getByLabel('Custom wall colour').fill('#336699');
    await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-wall-colour', 'custom');
    expect(await wallVar(page)).toBe('#336699');
    await page.locator('.bottom-sheet__backdrop').click({ position: { x: 5, y: 5 } });
    // kept: a reload shows it again; the dark theme mixes it down
    await page.reload();
    await page.waitForSelector('button.cab-figure');
    await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-wall-colour', 'custom');
    expect(await wallVar(page)).toBe('#336699');
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('fc-case-prefs')))!)).toMatchObject({ wall: 'custom', wallCustom: '#336699' });
    await page.addInitScript(() => localStorage.setItem('fc-theme', 'dark')); // after the one that set light
    await page.reload();
    await page.waitForSelector('button.cab-figure');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const dark = await wallVar(page);
    expect(dark).toMatch(/^#[0-9a-f]{6}$/);
    // the same hue darkened to about 25 % lightness
    expect(Math.abs(lightnessOf(dark) - 0.25)).toBeLessThan(0.02);
    expect(dark).not.toBe('#336699');
  });

  test(`the View card no longer repeats the view: ${size.name}`, async ({ page }) => {
    await openCase(page, size, 'light');
    await page.getByRole('button', { name: 'View' }).click();
    await expect(page.getByRole('group', { name: 'Wall', exact: true })).toBeVisible();
    for (const name of ['Whole cabinets', 'One cabinet', 'One shelf']) await expect(page.getByRole('radio', { name })).toHaveCount(0);
    await page.keyboard.press('Escape');
    // the header's Case menu still does
    await page.getByRole('button', { name: /^Case,/ }).click();
    await page.getByRole('menuitemradio', { name: 'One cabinet' }).click();
    await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-view', 'cabinet');
  });
}

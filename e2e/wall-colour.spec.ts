import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';

/**
 * WALL-COLOUR-1 (Ross 10-20, WALL1 = a): the View card chooses the back wall's colour: Cream, Off-white, White, Seafoam or a
 * custom colour, each with a dark-theme counterpart, kept on the device; the old slate wall stays the default. The View card
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
  await page.getByRole('group', { name: 'Back wall' }).getByRole('radio', { name, exact: true }).click();
  await page.locator('.bottom-sheet__backdrop').click({ position: { x: 5, y: 5 } });
  await expect(page.getByRole('group', { name: 'Back wall' })).toHaveCount(0);
}

const wallVar = (page: Page) => page.locator('.cabinet-scene').evaluate((el) => getComputedStyle(el).getPropertyValue('--wall').trim());

/** The brightest of a few points near the top of the frame (the wall above the cabinets), as 0..255 grey. */
async function wallBrightness(page: Page): Promise<number> {
  const f = (await page.locator('.cabinet-scene__frame').boundingBox())!;
  const spots = [0.1, 0.5, 0.9].map((k) => ({ x: f.x + f.width * k, y: f.y + 14, width: 2, height: 2 }));
  let best = 0;
  for (const clip of spots) {
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
  return best;
}

for (const size of FOLD8) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`the back wall takes the colour chosen in the View card, its ${scheme}-theme one: ${size.name}`, async ({ page }, testInfo) => {
      await openCase(page, size, scheme);
      const slate = await wallBrightness(page);
      await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-wall-colour', 'slate');
      const shots = process.env['WALL_COLOUR_SHOTS'];
      if (shots) mkdirSync(shots, { recursive: true });
      const lights: Record<string, number> = {};
      for (const [name, id, light, dark] of [
        ['Cream', 'cream', '#f1e8d2', '#4a4333'],
        ['Off-white', 'off-white', '#efede6', '#45453f'],
        ['White', 'white', '#fbfbfa', '#4d4e50'],
        ['Seafoam', 'seafoam', '#cde7dd', '#304840'],
      ] as const) {
        await chooseWall(page, name);
        await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-wall-colour', id);
        expect(await wallVar(page), `${name} in the ${scheme} theme`).toBe(scheme === 'light' ? light : dark);
        lights[id] = await wallBrightness(page);
        if (shots) await page.screenshot({ path: `${shots}/${size.name}-${scheme}-${id}.png` });
      }
      if (scheme === 'light') {
        expect(lights['white']!, 'White is lighter than the slate wall').toBeGreaterThan(slate + 80);
        expect(lights['cream']!, 'and so is Cream').toBeGreaterThan(slate + 60);
      } else {
        expect(lights['white']!, 'the dark counterpart is a wall of its own, lighter than the shelves it stands behind').toBeGreaterThan(30);
      }
      void testInfo;
    });
  }

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
    expect(dark).not.toBe('#336699');
  });

  test(`the View card no longer repeats the view: ${size.name}`, async ({ page }) => {
    await openCase(page, size, 'light');
    await page.getByRole('button', { name: 'View' }).click();
    await expect(page.getByRole('group', { name: 'Back wall' })).toBeVisible();
    for (const name of ['Whole cabinets', 'One cabinet', 'One shelf']) await expect(page.getByRole('radio', { name })).toHaveCount(0);
    await page.keyboard.press('Escape');
    // the header's Case menu still does
    await page.getByRole('button', { name: /^Case,/ }).click();
    await page.getByRole('menuitemradio', { name: 'One cabinet' }).click();
    await expect(page.locator('.cabinet-scene')).toHaveAttribute('data-view', 'cabinet');
  });
}

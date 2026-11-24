import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * DESK1 (Ross 11-21: the Photos sheet on the desktop stood as blank tiles past the first): a tile whose photo is still loading
 * shows the photo's colour, and one whose photo cannot load says so and looks unlike a loading one. Fourteen photos
 * (?fxphotocount=14): the first answered at once, one answered 404, the rest held until the test lets them go. The slow
 * download itself is IMGREND's to fix (small renditions).
 */

// the app's service worker would fetch the photos itself, round the route below
test.use({ serviceWorkers: 'block', viewport: { width: 1536, height: 730 } });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const PICTURE = readFileSync(new URL('../src/dev-fixtures/synthetic/clean/dark-angel.png', import.meta.url));
const D = 'https://images.figurecollecting.com/d/';
const FIRST = `${D}${'a'.repeat(64)}`;
const MISSING = `${D}${'1'.repeat(64)}`;
/** The fixture photos' colours, in the order the sheet lists them (src/dev-fixtures/fixtures.ts FIXTURE_PHOTO_COLOURS). */
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
const COLOURS = ['#8a9bb0', '#7a5c6e', '#4f6f64', '#a0845c', '#5c6fa0', '#8c5c5c', '#5c8c8a', '#75608f', '#8f8a60', '#607d8f', '#8f6075', '#6b8f60', '#8f7460', '#60718f'].map(rgb);

/** Each tile's state, background colour, the edge of its "couldn't load" plate (none: no plate) and words. */
const tilesNow = (page: Page) =>
  page.locator('.photos-sheet__tile').evaluateAll((tiles) =>
    tiles.map((t) => {
      const style = getComputedStyle(t);
      const plate = t.querySelector('.photos-sheet__failed');
      return { state: (t as HTMLElement).dataset.state, colour: style.backgroundColor, outline: plate === null ? 'none' : getComputedStyle(plate).borderTopStyle, words: t.querySelector('.photos-sheet__failed')?.textContent?.trim() ?? '', drawn: (t.querySelector('img')?.naturalWidth ?? 0) > 0 };
    }),
  );

test('DESK1: a Photos tile still loading shows its photo\'s colour, a failed one says "Couldn\'t load" and looks different, and each becomes its photo as it arrives', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });
  let release!: () => void;
  const held = new Promise<void>((go) => (release = go));
  // the photos are on the public image address; answered here, never from the network
  await page.route(/^https:\/\/images\.figurecollecting\.com\//, async (route) => {
    const url = route.request().url();
    if (url === MISSING) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not made yet' });
    if (url !== FIRST) await held;
    await route.fulfill({ status: 200, contentType: 'image/png', body: PICTURE, headers: { 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' } });
  });
  await page.goto('/?layout=case&fxphotos=1&fxphotocount=14');
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
  // a figure the frame shows whole, then its Photos tab
  const frame = (await page.locator('.cabinet-scene').boundingBox())!;
  const figures = page.locator('button.cab-figure');
  let opened = false;
  for (let i = 0; i < (await figures.count()) && !opened; i++) {
    const b = await figures.nth(i).boundingBox();
    if (b && b.y >= frame.y && b.y + b.height <= frame.y + frame.height && b.x >= frame.x && b.x + b.width <= frame.x + frame.width) {
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      opened = true;
    }
  }
  expect(opened, 'a figure the frame shows whole').toBe(true);
  await page.getByRole('navigation', { name: 'Figure sections' }).getByRole('button', { name: 'Photos' }).first().click();
  await expect(page.locator('.photos-sheet__tile')).toHaveCount(14);

  // the first photo drawn, the 404 failed, the other twelve still on their way
  const missingAt = 3 + '0123456789f'.indexOf('1');
  await expect.poll(async () => (await tilesNow(page)).map((t) => t.state)).toEqual(Array.from({ length: 14 }, (_, i) => (i === 0 ? 'loaded' : i === missingAt ? 'failed' : 'loading')));
  const waiting = await tilesNow(page);
  for (const [i, t] of waiting.entries()) {
    if (t.state !== 'loading') continue;
    expect(t.colour, `tile ${i + 1} shows its photo's colour while it loads`).toBe(COLOURS[i]);
    expect(t.outline).not.toBe('dashed');
    expect(t.words).toBe('');
  }
  const failed = waiting[missingAt]!;
  expect(failed.words).toBe("Couldn't load");
  expect(failed.outline).toBe('dashed');
  expect(waiting.filter((t) => t.state === 'loading').map((t) => t.colour), 'unlike any loading tile').not.toContain(failed.colour);
  await expect(page.getByRole('button', { name: `Photo ${missingAt + 1} of 14, couldn't load` })).toBeVisible();
  await expect(page.locator('.photos-sheet__failed')).toBeVisible();

  // the photos arrive: each tile is its photo, and the failed one still says so
  release();
  await expect.poll(async () => (await tilesNow(page)).map((t) => t.state)).toEqual(Array.from({ length: 14 }, (_, i) => (i === missingAt ? 'failed' : 'loaded')));
  const arrived = await tilesNow(page);
  expect(arrived.filter((t) => t.state === 'loaded').every((t) => t.drawn)).toBe(true);
  expect(new Set(arrived.filter((t) => t.state === 'loaded').map((t) => t.colour)).size, 'no photo colour left behind a drawn photo').toBe(1);
});

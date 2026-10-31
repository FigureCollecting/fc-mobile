import type { Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { test, expect } from './fixtures';
import { pinLegacyCamera } from './legacyCamera';
import { CASE_VIEWPORTS } from './caseViewports';
import { touchTap } from './touch';

/**
 * STRETCH-FIX (Ross 10-18, Fold8 cover, Benichou Hoteri / Flare: "She's stretched"). The full-screen figure viewer laid a
 * photo out in the shape the app GUESSED for it (every real figure's display meta says 600 x 800) and stretched the real
 * picture into that box: x and y scaled differently, and the lower part ran under the Info sheet. Fixture mode with the
 * fixture's picture replaced by photos of other shapes (a landscape 3:2 and a tall 9:16, the shape of a product shot)
 * reproduces it: the fixtures' own declared shapes are not those. The whole photo must show above the sheet, scaled the
 * same both ways (sidebars where its shape differs from the room's), at the Fold8 panels: the cover and sideways cover
 * open the full-screen viewer, the open panels the detail pane beside the case.
 */

test.use({ hasTouch: true, isMobile: true });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const FOLD8 = CASE_VIEWPORTS.filter((v) => v.name.startsWith('fold8'));
/** Below this width Info is the viewer's pull-up sheet; at or above it, the pane beside the case (Collection.tsx). */
const DUAL_PANE_MIN_WIDTH = 640;
/** A displayed picture's aspect may differ from its natural one by this much (the issue's 1 %). */
const TOLERANCE = 0.01;

/** A PNG of w x h whose pixels say which way is up and which is wide (a gradient, so a stretch cannot hide). */
function photo(width: number, height: number): Buffer {
  const crc = (buf: Buffer): number => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8;
  head[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const dx = x - width / 2;
      const dy = y - height / 2;
      const inCircle = dx * dx + dy * dy < (Math.min(width, height) / 3) ** 2;
      raw[row + 1 + x * 3] = inCircle ? 240 : Math.round((255 * x) / width);
      raw[row + 2 + x * 3] = inCircle ? 240 : Math.round((255 * y) / height);
      raw[row + 3 + x * 3] = inCircle ? 240 : 90;
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const SHAPES = [
  { name: 'a landscape photo (3:2)', width: 900, height: 600 },
  { name: 'a tall product shot (9:16)', width: 540, height: 960 },
];

async function openCase(page: Page, size: { width: number; height: number }, shape: { width: number; height: number }) {
  // every fixture's picture is this photo, whatever shape the fixture says it is (a route cannot: the service worker may
  // answer first; so the photo goes in where a picture's src is set)
  const uri = `data:image/png;base64,${photo(shape.width, shape.height).toString('base64')}`;
  await page.addInitScript((replacement) => {
    const own = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...own,
      set(value: string) {
        const fixture = /\/(?:rem|dark-angel|miku-nendo|madoka|spike|miku-deepsea|ryuuko)[^/]*\.png(?:\?.*)?$/.test(String(value));
        own.set!.call(this, fixture ? replacement : value);
      },
    });
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  }, uri);
  await pinLegacyCamera(page);
  await page.setViewportSize(size);
  await page.goto('/?layout=case');
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
}

/** Touch-tap a figure the frame shows whole. */
async function openFigure(page: Page) {
  const frame = (await page.locator('.cabinet-scene').boundingBox())!;
  const figures = page.locator('button.cab-figure');
  for (let i = 0; i < (await figures.count()); i++) {
    const b = await figures.nth(i).boundingBox();
    if (b && b.y >= frame.y && b.y + b.height <= frame.y + frame.height && b.x >= frame.x && b.x + b.width <= frame.x + frame.width) {
      await touchTap(page, b.x + b.width / 2, b.y + b.height / 2);
      return;
    }
  }
  throw new Error('no figure stands whole in the frame');
}

/** The picture the viewer or pane shows: its box on the page and its natural size, once it has loaded and stood still. */
async function shown(page: Page, selector: string) {
  const img = page.locator(selector).first();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), { timeout: 10_000 }).toBe(true);
  // stood still: the same box on three samples 120 ms apart
  let last = '';
  let still = 0;
  await expect
    .poll(
      async () => {
        const b = await img.boundingBox();
        const now = JSON.stringify(b && [b.x, b.y, b.width, b.height].map((v) => Math.round(v * 10)));
        still = now === last ? still + 1 : 0;
        last = now;
        return still >= 3;
      },
      { intervals: [120], timeout: 10_000 },
    )
    .toBe(true);
  const box = (await img.boundingBox())!;
  const natural = await img.evaluate((el: HTMLImageElement) => ({ width: el.naturalWidth, height: el.naturalHeight, fit: getComputedStyle(el).objectFit }));
  // what is DRAWN: the element's box (fill: a box of another shape stretches the picture), or the picture fitted inside it (contain)
  const k = natural.fit === 'contain' ? Math.min(box.width / natural.width, box.height / natural.height) : null;
  const drawn = k === null ? { width: box.width, height: box.height } : { width: natural.width * k, height: natural.height * k };
  return { box, drawn, natural, distortion: drawn.width / drawn.height / (natural.width / natural.height) };
}

for (const size of FOLD8) {
  for (const shape of SHAPES) {
    test(`the picture is shown whole and in its own shape (distortion 1.00 within 1 %), ${shape.name}: ${size.name}`, async ({ page }) => {
      await openCase(page, size, shape);
      await openFigure(page);
      if (size.width < DUAL_PANE_MIN_WIDTH) {
        await expect(page.locator('.figure-viewer-sheet')).toBeVisible();
        const { box, natural, distortion } = await shown(page, '.pswp__item[aria-hidden="false"] img.pswp__img');
        expect({ width: natural.width, height: natural.height }, 'the photo the page was given').toEqual({ width: shape.width, height: shape.height });
        expect(Math.abs(distortion - 1), `displayed ${box.width.toFixed(1)} x ${box.height.toFixed(1)}, distortion ${distortion.toFixed(3)}x`).toBeLessThanOrEqual(TOLERANCE);
        // all of it is above the sheet and on the screen: nothing runs under the sheet or off an edge
        const sheetTop = (await page.locator('.figure-viewer-sheet').boundingBox())!.y;
        expect(box.y + box.height, 'its foot is above the Info sheet').toBeLessThanOrEqual(sheetTop + 1);
        expect(box.y).toBeGreaterThanOrEqual(-1);
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
      } else {
        await expect(page.locator('.detail-pane')).toBeVisible();
        const { box, distortion, natural } = await shown(page, '.detail-pane__image');
        expect({ width: natural.width, height: natural.height }, 'the photo the page was given').toEqual({ width: shape.width, height: shape.height });
        expect(Math.abs(distortion - 1), `displayed ${box.width.toFixed(1)} x ${box.height.toFixed(1)}, distortion ${distortion.toFixed(3)}x`).toBeLessThanOrEqual(TOLERANCE);
      }
    });
  }
}

// the same on the pictures the gallery has not shown yet, and zoomed in: no step lays a photo out in another shape
test('the next figure\'s photo and a zoomed photo keep their own shape too: fold8-cover', async ({ page }) => {
  const cover = FOLD8.find((v) => v.name === 'fold8-cover')!;
  await openCase(page, cover, SHAPES[1]!);
  await openFigure(page);
  const current = '.pswp__item[aria-hidden="false"] img.pswp__img';
  const first = await shown(page, current);
  expect(Math.abs(first.distortion - 1)).toBeLessThanOrEqual(TOLERANCE);
  // the next figure
  const counter = page.locator('.figure-viewer-sheet__counter');
  const before = await counter.innerText();
  await page.keyboard.press('ArrowRight');
  await expect(counter).not.toHaveText(before);
  const next = await shown(page, current);
  expect({ width: next.natural.width, height: next.natural.height }).toEqual({ width: SHAPES[1]!.width, height: SHAPES[1]!.height });
  expect(Math.abs(next.distortion - 1), `the next photo, distortion ${next.distortion.toFixed(3)}x`).toBeLessThanOrEqual(TOLERANCE);
  const sheetTop = (await page.locator('.figure-viewer-sheet').boundingBox())!.y;
  expect(next.box.y + next.box.height, 'its foot is above the sheet').toBeLessThanOrEqual(sheetTop + 1);
  // zoomed in: the box grows both ways alike
  await page.locator('.pswp__button--zoom').evaluate((b: HTMLElement) => b.click());
  await expect.poll(async () => (await page.locator(current).boundingBox())!.width, { timeout: 5000 }).toBeGreaterThan(next.box.width * 1.5);
  const zoomed = await shown(page, current);
  expect(Math.abs(zoomed.distortion - 1), `zoomed, distortion ${zoomed.distortion.toFixed(3)}x`).toBeLessThanOrEqual(TOLERANCE);
});

/** Every photo on screen that is forced to a box of another shape (object-fit fill, the default, with a box off its natural aspect by more than 1 %). */
async function stretchedPhotos(page: Page): Promise<string[]> {
  return page.evaluate((tolerance) => {
    const bad: string[] = [];
    for (const img of Array.from(document.querySelectorAll<HTMLImageElement>('img'))) {
      const r = img.getBoundingClientRect();
      if (!img.complete || img.naturalWidth === 0 || r.width < 2 || r.height < 2) continue;
      if (img.closest('.cabinet-scene')) continue; // the case lays its pictures out by its own 3D geometry
      if (r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight) continue;
      const fit = getComputedStyle(img).objectFit;
      if (fit !== 'fill' && fit !== '') continue; // contain / cover / scale-down keep the picture's own shape
      const distortion = r.width / r.height / (img.naturalWidth / img.naturalHeight);
      if (Math.abs(distortion - 1) > tolerance) bad.push(`${img.className.split(' ')[0] || img.tagName}: ${r.width.toFixed(0)} x ${r.height.toFixed(0)} for a ${img.naturalWidth} x ${img.naturalHeight} picture (${distortion.toFixed(3)}x)`);
    }
    return bad;
  }, TOLERANCE);
}

// STRETCH-2 (Ross 10-20, live TR3: "photos are still stretched to fill"). PhotoSwipe loads the pictures beside the open one
// (2 ahead) before it has a slide for them and never says loadComplete for those, so the slide made later, on a swipe, kept the
// guessed 600 x 800 shape. Swiping past the first neighbour reached it; the case above only went one figure.
test('every figure a swipe reaches shows its photo in its own shape, however early it loaded: fold8-cover', async ({ page }) => {
  const cover = FOLD8.find((v) => v.name === 'fold8-cover')!;
  await openCase(page, cover, SHAPES[1]!);
  await openFigure(page);
  const current = '.pswp__item[aria-hidden="false"] img.pswp__img';
  const counter = page.locator('.figure-viewer-sheet__counter');
  for (let step = 0; step < 5; step++) {
    const picture = await shown(page, current);
    expect(Math.abs(picture.distortion - 1), `slide ${step} after opening, distortion ${picture.distortion.toFixed(3)}x`).toBeLessThanOrEqual(TOLERANCE);
    expect(await stretchedPhotos(page), `slide ${step}: no photo on screen is stretched`).toEqual([]);
    const before = await counter.innerText();
    await page.keyboard.press('ArrowRight');
    await expect(counter).not.toHaveText(before);
  }
});

// the list (rows) on the cover and the open panels: its tiles letter-box a photo, never stretch it
for (const size of FOLD8.filter((v) => v.name === 'fold8-cover' || v.name === 'fold8-open')) {
  test(`no photo is stretched in the list: ${size.name}`, async ({ page }) => {
    await openCase(page, size, SHAPES[0]!);
    await page.goto('/?layout=rows');
    await page.waitForSelector('.jrows__img');
    await expect.poll(() => page.locator('.jrows__img').first().evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), { timeout: 10_000 }).toBe(true);
    expect(await page.locator('.jrows__img').count()).toBeGreaterThan(0);
    expect(await stretchedPhotos(page), 'the list').toEqual([]);
  });
}

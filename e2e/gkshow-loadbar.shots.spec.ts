import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { pinLegacyCamera } from './legacyCamera';
import { signoffShot } from './signoffShots';

/**
 * GKSHOW (Ross 11-03: GK slots sized as if a figure stood there, nothing drawn): a masked figure whose mask does not load
 * stands its picture framed, never as an empty gap the size of a figure; the fixtures' masked branch, every other figure's
 * mask answered 404 here. LOADBAR (Ross 11-03): while the catalogue loads, a bar along the top edge, the fixtures' load given
 * by ?fxloadbar=; it takes no tap from what lies under it. Its label is the collection's load strip just under the top bar
 * (LOADBAR-2, e2e/loadbar-strip.shots.spec.ts). Sign-off PNGs land in test-results/signoff/<project>/gkshow-*.png and loadbar-*.png.
 */

// the app's service worker would answer the masks itself, round the routes below
test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });
  await pinLegacyCamera(page);
});

async function ready(page: Page, path: string) {
  await page.goto(path);
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
}

test('GKSHOW: a figure whose mask does not load stands its picture framed; those whose masks load stay masked', async ({ page }, testInfo) => {
  const path = '/?layout=case&fxbranch=masked';
  await ready(page, path);
  const masks = await page.locator('.cab-figure__art--masked').evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLElement).dataset.maskUrl!))]);
  expect(masks.length).toBeGreaterThan(1);
  const missing = new Set(masks.filter((_, i) => i % 2 === 0).map((m) => new URL(m, page.url()).href));
  await page.route(
    (url) => missing.has(url.href),
    (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'no mask yet' }),
  );
  await ready(page, path);
  const figures = page.locator('button.cab-figure');
  await expect.poll(() => figures.evaluateAll((bs) => bs.every((b) => (b as HTMLElement).dataset.grounded === '1')), { timeout: 15_000 }).toBe(true);
  // the frame on the screen as Ross saw it: taken before the checks, so the run before the fix shows the gaps
  await page.waitForTimeout(500);
  await signoffShot(page, testInfo, 'gkshow-missing-masks');
  const arts = await figures.evaluateAll((bs) =>
    bs.map((b) => ({ art: (b as HTMLElement).dataset.art, mask: b.querySelector<HTMLElement>('.cab-figure__art--masked')?.dataset.maskUrl ?? null })),
  );
  const masked = arts.filter((a) => a.art === 'masked');
  expect(masked.length, 'the figures whose masks load stay masked').toBeGreaterThan(0);
  for (const a of masked) expect(missing.has(new URL(a.mask!, page.url()).href), `${a.mask} is drawn through a mask that does not load`).toBe(false);
  expect(arts.filter((a) => a.art === 'framed').length, 'those whose masks are missing stand framed').toBeGreaterThan(0);
  expect(arts.every((a) => a.art === 'masked' || a.art === 'framed')).toBe(true);
});

for (const load of [
  { name: 'cards', query: 'cards:120:400', label: 'Loading catalogue · 120 of 400', value: '120' },
  { name: 'pull', query: 'pull', label: 'Loading catalogue…', value: null },
] as const) {
  test(`LOADBAR (${load.name}): a bar along the top edge taking no tap, and the label under the top bar`, async ({ page }, testInfo) => {
    await ready(page, `/?layout=case&fxloadbar=${load.query}`);
    const bar = page.getByRole('progressbar', { name: 'Loading catalogue' });
    // the frame as it stands, taken before the checks (the run before the fix has no bar)
    await bar.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(300);
    await signoffShot(page, testInfo, `loadbar-${load.name}`);
    await expect(bar).toBeVisible();
    await expect(bar).toHaveText(load.label);
    if (load.value === null) await expect(bar).not.toHaveAttribute('aria-valuenow');
    else await expect(bar).toHaveAttribute('aria-valuenow', load.value);
    const width = await page.evaluate(() => innerWidth);
    const track = (await bar.locator('.catalogue-loadbar__track').boundingBox())!;
    // at the top: the track along the top bar's whole edge
    const header = (await page.locator('.slim-header').boundingBox())!;
    expect(track.y).toBeLessThan(4);
    expect(track.width).toBeCloseTo(width, 0);
    // an indicator, not a control: what lies under it takes the tap
    expect(await bar.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
    const under = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.catalogue-loadbar') ?? null, { x: track.x + track.width / 2, y: track.y + track.height / 2 });
    expect(under).toBeNull();
    // LOADBAR-2: the label is the load strip's, at the middle just under the top bar, its whole width
    const strip = page.locator('.catalogue-strip');
    await expect(strip).toHaveText(load.label);
    const label = (await strip.boundingBox())!;
    expect(Math.abs(label.x + label.width / 2 - width / 2)).toBeLessThan(2);
    expect(Math.abs(label.y - (header.y + header.height))).toBeLessThan(1);
  });
}

// LOADBAR (challenge r1): the bar's own label is left to screen readers on every screen (drawn over a control, the Search
// screen's field, it would hide it); LOADBAR-2: on the collection, in both its layouts, the load strip says it instead.
// Every tab: nothing a user taps or types in lies under a drawn bar label.
for (const { name, path } of [
  { name: 'collection-case', path: '/?layout=case' },
  { name: 'collection-rows', path: '/?layout=rows' },
  { name: 'search', path: '/discover' },
  { name: 'stats', path: '/stats' },
  { name: 'profile', path: '/profile' },
  { name: 'settings', path: '/settings' },
] as const) {
  test(`LOADBAR (${name}): no control lies under the label, and the bar and its text stay`, async ({ page }, testInfo) => {
    await page.goto(`${path}${path.includes('?') ? '&' : '?'}fxloadbar=cards:120:400`);
    await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
    const bar = page.getByRole('progressbar', { name: 'Loading catalogue' });
    await bar.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(500);
    await signoffShot(page, testInfo, `loadbar-tab-${name}`);
    await expect(bar).toBeVisible();
    await expect(bar).toHaveText('Loading catalogue · 120 of 400');
    const label = (await bar.locator('span').boundingBox())!;
    const drawn = label !== null && label.width > 2 && label.height > 2;
    const under = drawn
      ? await page.evaluate(({ x, y, width, height }) => {
          const hits = new Set<string>();
          for (let i = 0; i <= 4; i++)
            for (let j = 0; j <= 2; j++)
              for (const el of document.elementsFromPoint(x + (width * i) / 4, y + (height * j) / 2)) {
                if (el.closest('.catalogue-loadbar')) continue;
                const control = el.closest('input, textarea, select, button, a, [role="button"], [role="link"], [role="searchbox"]');
                if (control) hits.add(`${control.tagName.toLowerCase()}.${(control as HTMLElement).className}`);
              }
          return [...hits];
        }, label)
      : [];
    console.log(`LOADBAR ${name}: label drawn=${drawn} under=${JSON.stringify(under)}`);
    expect(under, 'controls under the drawn label').toEqual([]);
    expect(drawn, 'the bar draws no label of its own').toBe(false);
    // the collection, the screen Ross loads on, says it in its strip; the other tabs show the bar alone
    if (name.startsWith('collection-')) await expect(page.locator('.catalogue-strip')).toHaveText('Loading catalogue · 120 of 400');
    else await expect(page.locator('.catalogue-strip')).toHaveCount(0);
  });
}

import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { pinLegacyCamera } from './legacyCamera';
import { signoffShot } from './signoffShots';

/**
 * GKSHOW-2: a figure whose mask failed to load once (a 404, offline, a weak link) stands framed (GKSHOW). Once its mask can
 * load, it is drawn masked again with no reload: when the case is left and opened again in the app, and when the link comes
 * back. A CSS mask has no load event, so nothing else reads it again. Behaviour, not layout: the Fold8 cover alone. Sign-off
 * PNGs land in test-results/signoff/fold8-cover-full/gkshow-late-*.png.
 */

// the app's service worker would answer the masks itself, round the route below
test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'fold8-cover-full', 'behaviour, not layout: the Fold8 cover alone');
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });
  await pinLegacyCamera(page);
});

const PATH = '/?layout=case&fxbranch=masked';

async function grounded(page: Page) {
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
  const figures = page.locator('button.cab-figure');
  await expect.poll(() => figures.evaluateAll((bs) => bs.every((b) => (b as HTMLElement).dataset.grounded === '1')), { timeout: 15_000 }).toBe(true);
}

/** How many figures stand as each art (masked, framed, ...). */
const arts = (page: Page) =>
  page.locator('button.cab-figure').evaluateAll((bs) => {
    const count: Record<string, number> = {};
    for (const b of bs) {
      const art = (b as HTMLElement).dataset.art ?? 'none';
      count[art] = (count[art] ?? 0) + 1;
    }
    return count;
  });

/**
 * The case with every mask answering 404, each figure framed; returns how many figures stand and what serves the masks
 * from then on. The masks are read in a first load and the route set before a second, so the case starts with no read.
 */
async function masksMissing(page: Page): Promise<{ figures: number; serve: () => void }> {
  await page.goto(PATH);
  await grounded(page);
  const masks = await page.locator('.cab-figure__art--masked').evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLElement).dataset.maskUrl!))]);
  expect(masks.length).toBeGreaterThan(0);
  const figures = await page.locator('button.cab-figure').count();
  const urls = new Set(masks.map((m) => new URL(m, page.url()).href));
  let missing = true;
  // served: handed on to the hands-off guard's route, which sends it on
  await page.route(
    (url) => urls.has(url.href),
    (route) => (missing ? route.fulfill({ status: 404, contentType: 'text/plain', body: 'no mask yet' }) : route.fallback()),
  );
  await page.goto(PATH);
  await grounded(page);
  await expect.poll(() => arts(page), { timeout: 15_000 }).toEqual({ framed: figures });
  return {
    figures,
    serve: () => {
      missing = false;
    },
  };
}

/** How many still stand framed once `timeout` passes with any framed, or 0 as soon as none is. */
async function framedAfter(page: Page, timeout: number): Promise<number> {
  return expect
    .poll(async () => (await arts(page)).framed ?? 0, { timeout })
    .toBe(0)
    .then(
      () => 0,
      async () => (await arts(page)).framed ?? 0,
    );
}

test('GKSHOW-2: masks missing, then served: the case left and opened again in the app draws them masked, with no reload', async ({ page }, testInfo) => {
  const { figures, serve } = await masksMissing(page);
  await signoffShot(page, testInfo, 'gkshow-late-missing');
  serve();
  // to Stats and back in the app: the case unmounts and mounts again in the same document
  await page.getByRole('button', { name: 'Stats' }).click();
  await expect(page).toHaveURL(/\/stats$/);
  await page.getByRole('button', { name: 'Collection' }).click();
  await grounded(page);
  const framed = await framedAfter(page, 10_000);
  await page.waitForTimeout(300);
  await signoffShot(page, testInfo, 'gkshow-late-reopened');
  const reopened = await arts(page);
  console.log(`GKSHOW-2 reopened: framed before=${figures} after=${framed} arts=${JSON.stringify(reopened)} url=${page.url()}`);
  // positive control: the case loaded afresh draws every figure masked, so the masks really are served now
  await page.goto(PATH);
  await grounded(page);
  await expect.poll(() => arts(page), { timeout: 15_000 }).toEqual({ masked: figures });
  expect(framed, 'masks served now: the figures draw masked again without a reload').toBe(0);
  expect(reopened).toEqual({ masked: figures });
});

test('GKSHOW-2: masks missing, then served: the link coming back (online) draws them masked, the case left open', async ({ page, context }, testInfo) => {
  const { figures, serve } = await masksMissing(page);
  serve();
  await context.setOffline(true);
  await context.setOffline(false);
  const framed = await framedAfter(page, 10_000);
  await page.waitForTimeout(300);
  await signoffShot(page, testInfo, 'gkshow-late-online');
  const back = await arts(page);
  console.log(`GKSHOW-2 online: framed before=${figures} after=${framed} arts=${JSON.stringify(back)} url=${page.url()}`);
  expect(framed, 'masks served now and the link back: the figures draw masked again').toBe(0);
  expect(back).toEqual({ masked: figures });
});

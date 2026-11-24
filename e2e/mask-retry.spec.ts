import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * DESK1 (Ross 11-21: figures stood as boxed photos on the desktop until the case was opened again): a mask that failed to load
 * once is read again on its own after a backoff, so its figure is drawn as a cut-out once the mask can load, with no reload,
 * no reopen and no online or visibility event. The masks fail for 4 s after the case opens, then are served. A fresh desktop
 * (1536 x 730) with no service worker: every mask comes from the network, as on a first visit.
 */

// the app's service worker would answer the masks itself, round the route below
test.use({ serviceWorkers: 'block', viewport: { width: 1536, height: 730 } });

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });
});

const PATH = '/?layout=case&fxbranch=masked&fx=3&fxuniq=1';
/** How long the masks fail after the case opens. */
const OUTAGE_MS = 4000;
/** The app's first two waits before a failed mask is read again (alphaMargin.ts ALPHA_UNDECODED_RETRY_MS, doubling): 2 s, then 4 s. */
const RETRY_WAITS_MS = [2000, 4000];

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

test('DESK1: masks that fail for 4 s and are then served draw every figure as a cut-out within the backoff, with no reopen or event, for a bounded number of requests', async ({ page }) => {
  test.setTimeout(60_000);
  // the masks are read in a first load and the route set before a second, so the case starts with no read
  await page.goto(PATH);
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
  const figures = await page.locator('button.cab-figure').count();
  await expect.poll(() => arts(page), { timeout: 15_000 }).toEqual({ masked: figures });
  const masks = await page.locator('.cab-figure__art--masked').evaluateAll((els) => [...new Set(els.map((e) => new URL((e as HTMLElement).dataset.maskUrl!, location.href).href))]);
  expect(masks.length).toBe(figures);
  const urls = new Set(masks);
  let failing = true;
  const failed = new Map<string, number>();
  const served = new Map<string, number>();
  const count = (of: Map<string, number>, url: string) => of.set(url, (of.get(url) ?? 0) + 1);
  const total = (of: Map<string, number>) => [...of.values()].reduce((n, c) => n + c, 0);
  await page.route(
    (url) => urls.has(url.href),
    (route) => {
      const url = route.request().url();
      if (failing) {
        count(failed, url);
        return route.abort('failed');
      }
      count(served, url);
      // served: handed on to the hands-off guard's route, which sends it on
      return route.fallback();
    },
  );
  await page.goto(PATH);
  await page.waitForSelector('button.cab-figure');
  const opened = Date.now();
  await expect.poll(() => arts(page), { timeout: OUTAGE_MS }).toEqual({ framed: figures });
  await page.waitForTimeout(Math.max(0, OUTAGE_MS - (Date.now() - opened)));
  // 4 s in: each mask asked for by its figure's CSS (once or twice), read once, and read again once (the 2 s wait); no tight loop
  const failedInOutage = total(failed);
  console.log(`DESK1 masks=${masks.length} failed in the ${OUTAGE_MS} ms outage=${failedInOutage} most for one mask=${Math.max(...failed.values())}`);
  expect(Math.max(...failed.values()), 'requests for one mask while it fails').toBeLessThanOrEqual(4);
  expect(failedInOutage).toBeGreaterThan(masks.length);

  failing = false;
  // nothing is done to the page from here: no reload, no navigation, no event. The next read is due within the second wait.
  await expect.poll(() => arts(page), { timeout: RETRY_WAITS_MS[0] + RETRY_WAITS_MS[1] + 4000 }).toEqual({ masked: figures });
  const cutOutAfterMs = Date.now() - opened;
  expect(total(failed), 'no mask failed after the outage').toBe(failedInOutage);
  // once read, never asked for again: the read, and the figure's CSS mask
  const servedThen = total(served);
  await page.waitForTimeout(2 * RETRY_WAITS_MS[1]);
  console.log(`DESK1 cut-outs ${cutOutAfterMs} ms after the case opened; served=${total(served)} most for one mask=${Math.max(...served.values())}`);
  expect(total(served), 'no request once every mask is read').toBe(servedThen);
  expect(Math.max(...served.values()), 'requests for one mask once it is served').toBeLessThanOrEqual(2);
  expect(await arts(page)).toEqual({ masked: figures });
});

test('DESK1: masks that never load cost a bounded number of requests while the case stays open: no loop, no storm', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(PATH);
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
  const figures = await page.locator('button.cab-figure').count();
  await expect.poll(() => arts(page), { timeout: 15_000 }).toEqual({ masked: figures });
  const masks = await page.locator('.cab-figure__art--masked').evaluateAll((els) => [...new Set(els.map((e) => new URL((e as HTMLElement).dataset.maskUrl!, location.href).href))]);
  const urls = new Set(masks);
  const asked = new Map<string, number>();
  await page.route(
    (url) => urls.has(url.href),
    (route) => {
      asked.set(route.request().url(), (asked.get(route.request().url()) ?? 0) + 1);
      return route.fulfill({ status: 404, contentType: 'text/plain', body: 'no mask' });
    },
  );
  await page.goto(PATH);
  await page.waitForSelector('button.cab-figure');
  await expect.poll(() => arts(page), { timeout: 10_000 }).toEqual({ framed: figures });
  // 10 s more: the waits are 2, 4 and 8 s, so two reads again (2 and 6 s after the first read; the third is due at 14 s), after
  // the CSS mask (once or twice) and the first read
  await page.waitForTimeout(10_000);
  const most = Math.max(...asked.values());
  const all = [...asked.values()].reduce((n, c) => n + c, 0);
  console.log(`DESK1 dead masks=${masks.length} requests=${all} most for one mask=${most}`);
  expect(most, 'requests for one dead mask').toBeLessThanOrEqual(5);
  expect(all).toBeLessThanOrEqual(5 * masks.length);
  expect(all, 'each dead mask was read again on its own (twice by 6 s)').toBeGreaterThanOrEqual(3 * masks.length);
  expect(await arts(page)).toEqual({ framed: figures });
});

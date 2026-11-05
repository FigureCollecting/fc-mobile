import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS } from './caseViewports';
import { legacyPrefs, pinLegacyCamera } from './legacyCamera';
import { signoffShot } from './signoffShots';
import { CASE_PREFS_KEY } from '../src/components/display/casePrefs';

/**
 * LOADBAR-2 (Ross 11-04: "so loading is hidden if there are filters? Then we won't know it's loading... maybe better to
 * cover filters behind it with full-width bar of same background color while loading occurs instead?"): on the collection,
 * in the case and in rows, while the catalogue loads and a row of filter chips stands, the label stands as a full-width opaque
 * strip in the page's colour over the row, taking the taps that land on it, the row out of reach of the keyboard too. Where
 * no row stands no strip is drawn (challenge B1/S1: it covered the one-shelf view's Shelf above and the first figures and
 * tiles): the bar's own label says it in the case as LOADBAR drew it, taking no taps. Nothing below moves when it comes or
 * goes, the top bar's controls and menus stay above it, and once the load ends the chips are there and take taps again.
 * The fixtures' load is ?fxloadbar=, added to and dropped from the address in place (no reload), as a load starts and ends.
 * Sign-off PNGs land in test-results/signoff/<project>/loadbar2-*.png.
 */

const LOAD = 'cards:120:400';
const LABEL = 'Loading catalogue · 120 of 400';
const MFR = 'Good Smile Company';
const FILTER = `mfr=${encodeURIComponent(MFR)}`;
// every maker the fixtures have: a filter that hides no figure, so the case keeps all its shelves with the row standing
const EVERY_MAKER = `mfr=${encodeURIComponent(['Good Smile Company', 'Max Factory', 'Aniplex', 'MegaHouse', 'FREEing'].join('|'))}`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
  });
  await pinLegacyCamera(page);
});

type Layout = 'case' | 'rows';
const FIGURE: Record<Layout, string> = { case: 'button.cab-figure', rows: 'button.jrows__item' };

async function ready(page: Page, layout: Layout, query: string) {
  await page.goto(`/?layout=${layout}${query ? `&${query}` : ''}`);
  await page.waitForSelector(FIGURE[layout]);
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
  if (layout === 'case') {
    const figures = page.locator(FIGURE.case);
    await expect.poll(() => figures.evaluateAll((bs) => bs.every((b) => (b as HTMLElement).dataset.grounded === '1')), { timeout: 15_000 }).toBe(true);
  }
  await page.waitForTimeout(400);
}

/** The address with `params` set (a value) or dropped (null), in place: the page is not reloaded, as a load starts or ends. */
async function setParams(page: Page, params: Record<string, string | null>) {
  await page.evaluate((params) => {
    const q = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(params)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    history.replaceState(history.state, '', `${location.pathname}?${q.toString()}`);
  }, params);
}

/** A load starts (on) or ends. */
const setLoad = (page: Page, on: boolean) => setParams(page, { fxloadbar: on ? LOAD : null });

/** The manufacturer filter the address holds. */
const mfr = (page: Page) => new URL(page.url()).searchParams.get('mfr');

const strip = (page: Page) => page.locator('.catalogue-strip');
const bar = (page: Page) => page.getByRole('progressbar', { name: 'Loading catalogue' });

/** Where the first figure's top stands: what must not move as the strip comes and goes. */
const firstTop = (page: Page, layout: Layout) => page.locator(FIGURE[layout]).first().evaluate((el) => el.getBoundingClientRect().top);

const box = (l: Locator) => l.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
});

/** A tap where a finger would land: a touch on the phones, a click on the desktop. */
async function tapAt(page: Page, testInfo: TestInfo, x: number, y: number) {
  if (testInfo.project.use.hasTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/** The top bar's controls whose centre does not take a tap: the strip, or anything else, lies over it. */
async function blockedHeaderControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const blocked: string[] = [];
    for (const c of document.querySelectorAll<HTMLElement>('.slim-header :is(button, a, [role="button"])')) {
      const r = c.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (!hit || !c.contains(hit)) blocked.push(`${c.getAttribute('aria-label') ?? c.className} under ${hit?.className ?? 'nothing'}`);
    }
    return blocked;
  });
}

/** The controls under the strip (a 9 x 3 grid of its box) that are not the chips row's own: none may be (challenge B1). */
async function coveredControls(page: Page): Promise<string[]> {
  return strip(page).evaluate((s) => {
    const r = s.getBoundingClientRect();
    const hits = new Set<string>();
    for (let i = 0; i <= 8; i++)
      for (let j = 0; j <= 2; j++)
        for (const el of document.elementsFromPoint(r.x + 1 + ((r.width - 2) * i) / 8, r.y + 1 + ((r.height - 2) * j) / 2)) {
          if (el.closest('.catalogue-strip, .applied-chips')) continue;
          const c = el.closest('input, textarea, select, button, a, [role="button"], [role="link"]');
          if (c) hits.add(`${c.tagName.toLowerCase()}.${(c as HTMLElement).className.split(' ')[0]}${c.getAttribute('aria-label') ? ` "${c.getAttribute('aria-label')}"` : ''}`);
        }
    return [...hits];
  });
}

/** The chips and the count on the screen whose centre does not land on the strip: what of the row it leaves bare. */
async function bareOfRow(page: Page): Promise<string[]> {
  return page.locator('.applied-chips__chip, .applied-chips__count').evaluateAll((els) =>
    els.flatMap((el) => {
      const b = el.getBoundingClientRect();
      const [x, y] = [b.x + b.width / 2, b.y + b.height / 2];
      // a chip scrolled off the side of a long row is not on the screen to leave bare
      if (x < 0 || x >= innerWidth || y < 0 || y >= innerHeight) return [];
      const hit = document.elementFromPoint(x, y);
      return hit?.closest('.catalogue-strip') ? [] : [el.textContent ?? ''];
    }),
  );
}

/** The strip stands over the row and no more: full width, the row's own top and height, nothing but the row under it. */
async function expectOverTheRow(page: Page) {
  const row = await box(page.locator('.applied-chips'));
  const sb = await box(strip(page));
  const width = await page.evaluate(() => innerWidth);
  expect(sb.x).toBeCloseTo(0, 0);
  expect(sb.width).toBeCloseTo(width, 0);
  expect(Math.abs(sb.y - row.y)).toBeLessThan(0.5);
  expect(Math.abs(sb.height - row.height)).toBeLessThan(0.5);
  expect(await coveredControls(page), 'controls under the strip other than the chips row').toEqual([]);
  expect(await bareOfRow(page), 'chips or count the strip leaves bare').toEqual([]);
}

/** Where no row stands: no strip, and the bar's own label as LOADBAR drew it, drawn in the case and taking no tap. */
async function expectNoStrip(page: Page, layout: Layout) {
  await expect(bar(page)).toBeVisible();
  await expect(strip(page)).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: LABEL })).toHaveCount(1);
  const label = bar(page).locator('span');
  if (layout === 'rows') {
    await expect(label).toHaveClass('sr-only');
    return;
  }
  await expect(label).toHaveClass('catalogue-loadbar__label');
  await expect(label).toHaveText(LABEL);
  const through = await label.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { pointerEvents: getComputedStyle(el).pointerEvents, hitIsLabel: hit?.closest('.catalogue-loadbar') !== null };
  });
  expect(through).toEqual({ pointerEvents: 'none', hitIsLabel: false });
}

/** A first-row tile, tapped just under the top bar (15 px), opens: no strip lies over it (challenge S1). */
async function expectTopOfTilesTakesTaps(page: Page, testInfo: TestInfo) {
  const header = await box(page.locator('.slim-header'));
  const tile = await box(page.locator(FIGURE.rows).first());
  const y = Math.max(header.bottom, tile.y) + 15;
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.className ?? null, { x: tile.x + tile.width / 2, y });
  expect(hit).toContain('jrows__item');
  await tapAt(page, testInfo, tile.x + tile.width / 2, y);
  await expect.poll(async () => (await page.locator('.detail-pane').count()) + (await page.locator('.pswp').count())).toBeGreaterThan(0);
}

for (const layout of ['case', 'rows'] as const) {
  test(`LOADBAR-2 (${layout}, filtered): the strip covers the chips row and takes its taps and keys; nothing moves; the top bar and its menu keep theirs; the chips are back when the load ends`, async ({ page }, testInfo) => {
    await ready(page, layout, FILTER);
    const row = page.locator('.applied-chips');
    await expect(row).toBeVisible();
    const before = { top: await firstTop(page, layout), row: await box(row) };

    await setLoad(page, true);
    // the frame as it stands, taken before the checks
    await strip(page).waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(300);
    await signoffShot(page, testInfo, `loadbar2-${layout}-filtered`);

    const s = strip(page);
    await expect(s).toBeVisible();
    await expect(s).toHaveText(LABEL);
    await expect(s).toHaveAttribute('role', 'status');
    await expect(s).toHaveAttribute('aria-live', 'polite');
    const during = { top: await firstTop(page, layout), row: await box(row) };
    console.log(`LOADBAR-2 ${layout} filtered: row ${JSON.stringify(before.row)} strip ${JSON.stringify(await box(s))} first figure top ${before.top} -> ${during.top}`);
    await expectOverTheRow(page);
    // opaque, in the page's own colour
    const colours = await s.evaluate((el) => ({ strip: getComputedStyle(el).backgroundColor, page: getComputedStyle(document.body).backgroundColor }));
    expect(colours.strip).toBe(colours.page);
    expect(colours.strip).toMatch(/^rgb\(/);
    // it takes the taps on it: a tap at a chip leaves the chip be
    expect(await s.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('auto');
    const chip = page.getByRole('listitem', { name: 'Remove filter Good Smile Company' });
    const cb = await box(chip);
    await tapAt(page, testInfo, cb.x + cb.width / 2, cb.y + cb.height / 2);
    await page.waitForTimeout(300);
    await expect(chip).toHaveCount(1);
    expect(mfr(page)).toBe(MFR);
    // challenge S3: nor the keyboard: the covered chip takes no focus, and Enter removes nothing
    await chip.focus();
    expect(await chip.evaluate((el) => document.activeElement === el)).toBe(false);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    expect(mfr(page)).toBe(MFR);
    // the top bar's controls take their taps, and its menu opens over the strip, its items taking theirs
    expect(await blockedHeaderControls(page)).toEqual([]);
    await page.locator(`.display-toggle__btn[data-mode="${layout}"]`).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const items = await menu.getByRole('menuitemradio').evaluateAll((its) =>
      its.map((it) => {
        const r = it.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { item: it.textContent, takes: hit !== null && it.contains(hit) };
      }),
    );
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) expect(it.takes, `menu item ${it.item} takes its tap`).toBe(true);
    // closed by a second tap on its button
    await page.locator(`.display-toggle__btn[data-mode="${layout}"]`).click();
    await expect(menu).toHaveCount(0);
    // nothing below moved
    expect(Math.abs(during.top - before.top)).toBeLessThan(0.5);
    expect(during.row).toEqual(before.row);

    // the load ends: the strip goes, the chips are there and take taps and focus, nothing moved
    await setLoad(page, false);
    await expect(s).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Loading catalogue' })).toHaveCount(0);
    expect(Math.abs((await firstTop(page, layout)) - before.top)).toBeLessThan(0.5);
    expect(await box(row)).toEqual(before.row);
    await chip.focus();
    expect(await chip.evaluate((el) => document.activeElement === el)).toBe(true);
    const back = await box(chip);
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.applied-chips__chip')?.textContent ?? null, { x: back.x + back.width / 2, y: back.y + back.height / 2 })).toBe('Good Smile Company');
    await tapAt(page, testInfo, back.x + back.width / 2, back.y + back.height / 2);
    await expect(chip).toHaveCount(0);
    expect(mfr(page)).toBeNull();
  });

  test(`LOADBAR-2 (${layout}, nothing filtered): no strip, nothing under the top bar covered, nothing moves; it comes and goes with the row`, async ({ page }, testInfo) => {
    await ready(page, layout, '');
    await expect(page.locator('.applied-chips')).toHaveCount(0);
    const before = await firstTop(page, layout);
    // with no row, its slot takes no height
    const slot = page.locator('.catalogue-strip-slot');
    expect((await box(slot)).height).toBe(0);

    await setLoad(page, true);
    await expect(bar(page)).toBeVisible();
    await page.waitForTimeout(300);
    await signoffShot(page, testInfo, `loadbar2-${layout}-unfiltered`);
    await expectNoStrip(page, layout);
    expect(Math.abs((await firstTop(page, layout)) - before)).toBeLessThan(0.5);
    expect((await box(slot)).height).toBe(0);
    expect(await blockedHeaderControls(page)).toEqual([]);

    // a filter applied mid-load: the row stands, the strip over it; cleared, both go
    await setParams(page, { mfr: MFR });
    await expect(page.locator('.applied-chips')).toBeVisible();
    await expect(strip(page)).toBeVisible();
    await expectOverTheRow(page);
    await setParams(page, { mfr: null });
    await expect(page.locator('.applied-chips')).toHaveCount(0);
    await expectNoStrip(page, layout);

    // the load ends: nothing moved
    await setLoad(page, false);
    await expect(bar(page)).toHaveCount(0);
    expect(Math.abs((await firstTop(page, layout)) - before)).toBeLessThan(0.5);
  });
}

test('LOADBAR-2 (challenge S1: rows, nothing filtered, loading): a first-row tile tapped just under the top bar opens', async ({ page }, testInfo) => {
  await ready(page, 'rows', '');
  await setLoad(page, true);
  await expect(bar(page)).toBeVisible();
  await page.waitForTimeout(300);
  await expectTopOfTilesTakesTaps(page, testInfo);
});

/** The one-shelf view (where Go to takes him): moved down a shelf, Shelf above, at the scene's top right, takes a real tap. */
async function expectShelfAboveTakesItsTap(page: Page, testInfo: TestInfo, query: string, shot?: string) {
  await page.addInitScript(
    ({ key, prefs }) => localStorage.setItem(key, JSON.stringify(prefs)),
    { key: CASE_PREFS_KEY, prefs: legacyPrefs({ view: 'shelf', swipe: 'camera', pattern: 'ikea-detolf' }) },
  );
  await ready(page, 'case', query);
  const host = page.locator('.cabinet-scene');
  await page.getByRole('button', { name: 'Shelf below', exact: true }).click();
  await expect(host).toHaveAttribute('data-shelf', '1');
  await setLoad(page, true);
  await expect(bar(page)).toBeVisible();
  if (query) await expect(strip(page)).toBeVisible();
  await page.waitForTimeout(300);
  if (shot) await signoffShot(page, testInfo, shot);
  if (query) await expectOverTheRow(page);
  else await expect(strip(page)).toHaveCount(0);
  const above = await box(page.getByRole('button', { name: 'Shelf above', exact: true }));
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? null, { x: above.x + above.width / 2, y: above.y + above.height / 2 });
  expect(hit).toBe('Shelf above');
  await tapAt(page, testInfo, above.x + above.width / 2, above.y + above.height / 2);
  await expect(host).toHaveAttribute('data-shelf', '0');
}

for (const { name, query } of [
  { name: 'nothing filtered', query: '' },
  { name: 'filtered', query: EVERY_MAKER },
]) {
  test(`LOADBAR-2 (challenge B1: the one-shelf view, ${name}, loading): Shelf above takes its tap`, async ({ page }, testInfo) => {
    await expectShelfAboveTakesItsTap(page, testInfo, query, `loadbar2-shelf-view-${query ? 'filtered' : 'unfiltered'}`);
  });
}

// challenge S2/N1: a figure opened while it loads, filtered. Beside it (the Fold8's open panel, the desktop) the pane: the
// strip still covers the whole row, full width, and the pane's Close and the top bar take their taps. On the cover the
// figure opens full screen, over everything, the strip with it.
for (const layout of ['case', 'rows'] as const) {
  test(`LOADBAR-2 (${layout}, filtered, a figure opened while loading): the strip still covers the whole row; the pane's Close and the top bar take their taps; full screen, nothing of it shows`, async ({ page }, testInfo) => {
    await ready(page, layout, FILTER);
    await setLoad(page, true);
    const s = strip(page);
    await expect(s).toBeVisible();
    const sb = await box(s);
    // a figure whose centre lies clear below the strip
    const at = await page.locator(FIGURE[layout]).evaluateAll((bs, below) => {
      for (const b of bs) {
        const r = b.getBoundingClientRect();
        const x = r.x + r.width / 2;
        const y = r.y + r.height / 2;
        if (y > below && y < innerHeight - 80 && x > 40 && x < innerWidth - 40 && document.elementFromPoint(x, y)?.closest('button') === b) return { x, y };
      }
      return null;
    }, sb.bottom + 8);
    expect(at).not.toBeNull();
    await tapAt(page, testInfo, at!.x, at!.y);
    const pane = page.locator('.detail-pane');
    if ((await page.evaluate(() => innerWidth)) < 640) {
      // the cover: the figure opens full screen, over the strip
      await expect(page.locator('.pswp')).toBeVisible();
      await page.waitForTimeout(500);
      await expect(pane).toHaveCount(0);
      const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.catalogue-strip, .pswp')?.className ?? null, { x: sb.x + sb.width / 2, y: sb.y + sb.height / 2 });
      expect(hit).toContain('pswp');
      return;
    }
    await expect(pane).toBeVisible();
    await page.waitForTimeout(300);
    await signoffShot(page, testInfo, `loadbar2-${layout}-pane`);
    await expectOverTheRow(page);
    expect(await blockedHeaderControls(page)).toEqual([]);
    const close = page.getByRole('button', { name: 'Close detail' });
    const cb = await box(close);
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? null, { x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 });
    expect(hit).toBe('Close detail');
    await tapAt(page, testInfo, cb.x + cb.width / 2, cb.y + cb.height / 2);
    await expect(pane).toHaveCount(0);
  });
}

// challenge B1/C9: Ross's measured Fold8 sizes (e2e/caseViewports.ts), the four ways he holds it, set on one project
for (const size of CASE_VIEWPORTS.filter((v) => v.name.startsWith('fold8'))) {
  test(`LOADBAR-2 at the measured ${size.name} (${size.width} x ${size.height}): over the row exactly with one, nothing covered without, nothing moves; Shelf above takes its tap`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'fold8-cover-full', 'one project sets the measured sizes');
    test.setTimeout(180_000);
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const layout of ['case', 'rows'] as const) {
      for (const query of [FILTER, '']) {
        await ready(page, layout, query);
        const before = await firstTop(page, layout);
        await setLoad(page, true);
        await expect(bar(page)).toBeVisible();
        if (query) await expect(strip(page)).toBeVisible();
        await page.waitForTimeout(200);
        await signoffShot(page, testInfo, `loadbar2-${size.name}-${layout}-${query ? 'filtered' : 'unfiltered'}`);
        if (query) await expectOverTheRow(page);
        else await expectNoStrip(page, layout);
        expect(Math.abs((await firstTop(page, layout)) - before)).toBeLessThan(0.5);
        expect(await blockedHeaderControls(page)).toEqual([]);
        if (layout === 'rows' && !query) await expectTopOfTilesTakesTaps(page, testInfo);
      }
    }
    for (const query of [EVERY_MAKER, '']) await expectShelfAboveTakesItsTap(page, testInfo, query);
  });
}

// challenge N2: the strip and the bar keep one time for the load, so the collection opened part way through a load that
// already shows (from Stats) shows its strip with its row, not the delay after
test('LOADBAR-2: the collection opened mid-load shows its strip with its row, not the delay after', async ({ page }) => {
  await page.goto(`/stats?fxloadbar=${LOAD}`);
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
  await expect(bar(page)).toBeVisible();
  await page.waitForTimeout(800);
  const seen = await page.evaluate(async (path) => {
    history.pushState(null, '', path);
    dispatchEvent(new PopStateEvent('popstate'));
    const t0 = performance.now();
    let row: number | null = null;
    let strip: number | null = null;
    while (performance.now() - t0 < 3000 && strip === null) {
      await new Promise((r) => setTimeout(r, 20));
      const t = performance.now() - t0;
      if (row === null && document.querySelector('.applied-chips')) row = t;
      if (row !== null && strip === null && document.querySelector('.catalogue-strip')) strip = t;
    }
    return { row, strip };
  }, `/?layout=case&${FILTER}&fxloadbar=${LOAD}`);
  console.log(`LOADBAR-2 mid-load: row at ${seen.row} ms, strip at ${seen.strip} ms`);
  expect(seen.row).not.toBeNull();
  expect(seen.strip).not.toBeNull();
  expect(seen.strip! - seen.row!).toBeLessThan(200);
});

test('LOADBAR-2: the strip has no motion of its own, reduced motion or not; the bar\'s sweep stops under reduced motion', async ({ page }) => {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion });
    await ready(page, 'case', `${FILTER}&fxloadbar=pull`);
    const s = strip(page);
    await expect(s).toHaveText('Loading catalogue…');
    const motion = await s.evaluate((el) => ({ animation: getComputedStyle(el).animationName, transition: getComputedStyle(el).transitionDuration }));
    expect(motion).toEqual({ animation: 'none', transition: '0s' });
    const sweep = await page.locator('.catalogue-loadbar__fill').evaluate((el) => getComputedStyle(el).animationName);
    expect(sweep).toBe(reducedMotion === 'reduce' ? 'none' : 'catalogue-loadbar-sweep');
  }
});

test('LOADBAR-2: light and dark, the strip is the page\'s own colour', async ({ page }) => {
  // the theme the system asks for (Settings: System), each in turn
  await page.addInitScript(() => localStorage.setItem('fc-theme', 'system'));
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await ready(page, 'case', `${FILTER}&fxloadbar=${LOAD}`);
    await expect(strip(page)).toBeVisible();
    const c = await strip(page).evaluate((el) => ({
      theme: document.documentElement.dataset.theme,
      strip: getComputedStyle(el).backgroundColor,
      page: getComputedStyle(document.body).backgroundColor,
    }));
    expect(c.theme).toBe(colorScheme);
    expect(c.strip).toBe(c.page);
  }
});

// Search, Stats, Settings and Profile are as they were: the bar alone, no strip
for (const path of ['/discover', '/stats', '/settings', '/profile'] as const) {
  test(`LOADBAR-2 (${path}): the bar alone, no strip`, async ({ page }) => {
    await page.goto(`${path}?fxloadbar=${LOAD}`);
    await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 15_000 });
    await expect(bar(page)).toBeVisible();
    await expect(bar(page)).toHaveText(LABEL);
    await page.waitForTimeout(300);
    await expect(strip(page)).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Loading catalogue' })).toHaveCount(0);
  });
}

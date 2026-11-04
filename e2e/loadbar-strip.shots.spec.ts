import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures';
import { pinLegacyCamera } from './legacyCamera';
import { signoffShot } from './signoffShots';

/**
 * LOADBAR-2 (Ross 11-04: "so loading is hidden if there are filters? Then we won't know it's loading... maybe better to
 * cover filters behind it with full-width bar of same background color while loading occurs instead?"): on the collection,
 * in the case and in rows, while the catalogue loads its label stands as a full-width opaque strip in the page's colour over
 * the filter chips row, taking the taps that land on it; with no row, over the same height under the top bar. Nothing below
 * moves when it comes or goes, the top bar's controls and menus stay above it, and once the load ends the chips are there and
 * take taps again. The fixtures' load is ?fxloadbar=, added to and dropped from the address in place (no reload), as a load
 * starts and ends. Sign-off PNGs land in test-results/signoff/<project>/loadbar2-*.png.
 */

const LOAD = 'cards:120:400';
const LABEL = 'Loading catalogue · 120 of 400';
const MFR = 'Good Smile Company';
const FILTER = `mfr=${encodeURIComponent(MFR)}`;

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

/** Where the first figure's top stands, and the chips row's box: what must not move as the strip comes and goes. */
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

/** What lies under the strip (a 9 x 3 grid of its box): the controls, and the figures among them; logged for the report. */
async function underStrip(page: Page): Promise<string[]> {
  return page.locator('.catalogue-strip').evaluate((s) => {
    const r = s.getBoundingClientRect();
    const hits = new Set<string>();
    for (let i = 0; i <= 8; i++)
      for (let j = 0; j <= 2; j++)
        for (const el of document.elementsFromPoint(r.x + 1 + ((r.width - 2) * i) / 8, r.y + 1 + ((r.height - 2) * j) / 2)) {
          if (el.closest('.catalogue-strip')) continue;
          const c = el.closest('input, textarea, select, button, a, [role="button"]');
          if (c) hits.add(`${c.tagName.toLowerCase()}.${(c as HTMLElement).className.split(' ')[0]}${c.getAttribute('aria-label') ? ` "${c.getAttribute('aria-label')}"` : ''}`);
        }
    return [...hits];
  });
}

for (const layout of ['case', 'rows'] as const) {
  test(`LOADBAR-2 (${layout}, filtered): the strip covers the chips row and takes its taps; nothing moves; the chips are back when the load ends`, async ({ page }, testInfo) => {
    await ready(page, layout, FILTER);
    const row = page.locator('.applied-chips');
    await expect(row).toBeVisible();
    const before = { top: await firstTop(page, layout), row: await box(row) };

    await setLoad(page, true);
    // the frame as it stands, taken before the checks (the run before the fix has no strip)
    await strip(page).waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(300);
    await signoffShot(page, testInfo, `loadbar2-${layout}-filtered`);

    const s = strip(page);
    await expect(s).toBeVisible();
    await expect(s).toHaveText(LABEL);
    await expect(s).toHaveAttribute('role', 'status');
    await expect(s).toHaveAttribute('aria-live', 'polite');
    const width = await page.evaluate(() => innerWidth);
    const sb = await box(s);
    const during = { top: await firstTop(page, layout), row: await box(row) };
    console.log(`LOADBAR-2 ${layout} filtered: row ${JSON.stringify(before.row)} strip ${JSON.stringify(sb)} first figure top ${before.top} -> ${during.top}`);
    // full width, over the whole row: no more, no less
    expect(sb.x).toBeCloseTo(0, 0);
    expect(sb.width).toBeCloseTo(width, 0);
    expect(Math.abs(sb.y - before.row.y)).toBeLessThan(0.5);
    expect(Math.abs(sb.height - before.row.height)).toBeLessThan(0.5);
    // opaque, in the page's own colour
    const colours = await s.evaluate((el) => ({ strip: getComputedStyle(el).backgroundColor, page: getComputedStyle(document.body).backgroundColor }));
    expect(colours.strip).toBe(colours.page);
    expect(colours.strip).toMatch(/^rgb\(/);
    // it takes the taps on it: every chip's centre lands on the strip, and a tap at one leaves the chip be
    expect(await s.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('auto');
    const chip = page.getByRole('listitem', { name: 'Remove filter Good Smile Company' });
    const centres = await page.locator('.applied-chips__chip').evaluateAll((cs) =>
      cs.map((c) => {
        const r = c.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { chip: c.textContent, onStrip: hit?.closest('.catalogue-strip') !== null };
      }),
    );
    expect(centres.length).toBeGreaterThan(0);
    for (const c of centres) expect(c.onStrip, `${c.chip} under the strip`).toBe(true);
    const cb = await box(chip);
    await tapAt(page, testInfo, cb.x + cb.width / 2, cb.y + cb.height / 2);
    await page.waitForTimeout(300);
    await expect(chip).toHaveCount(1);
    expect(mfr(page)).toBe(MFR);
    // the top bar's controls take their taps
    expect(await blockedHeaderControls(page)).toEqual([]);
    // nothing below moved
    expect(Math.abs(during.top - before.top)).toBeLessThan(0.5);
    expect(during.row).toEqual(before.row);

    // the load ends: the strip goes, the chips are there and take taps, nothing moved
    await setLoad(page, false);
    await expect(s).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Loading catalogue' })).toHaveCount(0);
    expect(Math.abs((await firstTop(page, layout)) - before.top)).toBeLessThan(0.5);
    expect(await box(row)).toEqual(before.row);
    const back = await box(chip);
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.applied-chips__chip')?.textContent ?? null, { x: back.x + back.width / 2, y: back.y + back.height / 2 })).toBe('Good Smile Company');
    await tapAt(page, testInfo, back.x + back.width / 2, back.y + back.height / 2);
    await expect(chip).toHaveCount(0);
    expect(mfr(page)).toBeNull();
  });

  test(`LOADBAR-2 (${layout}, nothing filtered): the strip stands the row's height under the top bar without moving what is under it; the top bar and its menu keep their taps`, async ({ page }, testInfo) => {
    await ready(page, layout, '');
    await expect(page.locator('.applied-chips')).toHaveCount(0);
    const header = await box(page.locator('.slim-header'));
    const before = await firstTop(page, layout);
    // with no row, its slot takes no height: nothing is held for the strip
    const slot = page.locator('.page-collection__chips-slot');
    expect((await box(slot)).height).toBe(0);

    await setLoad(page, true);
    await strip(page).waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(300);
    await signoffShot(page, testInfo, `loadbar2-${layout}-unfiltered`);

    const s = strip(page);
    await expect(s).toBeVisible();
    await expect(s).toHaveText(LABEL);
    const sb = await box(s);
    const width = await page.evaluate(() => innerWidth);
    const during = await firstTop(page, layout);
    console.log(`LOADBAR-2 ${layout} unfiltered: header ${JSON.stringify(header)} strip ${JSON.stringify(sb)} first figure top ${before} -> ${during}; under the strip ${JSON.stringify(await underStrip(page))}`);
    expect(sb.x).toBeCloseTo(0, 0);
    expect(sb.width).toBeCloseTo(width, 0);
    expect(Math.abs(sb.y - header.bottom)).toBeLessThan(0.5);
    expect(Math.abs(during - before)).toBeLessThan(0.5);
    expect((await box(slot)).height).toBe(0);
    // drawn over what lies under it, all along: nothing of the page paints over it
    const onTop = await s.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return Array.from({ length: 9 }, (_, i) => document.elementFromPoint(r.x + 1 + ((r.width - 2) * i) / 8, r.y + r.height / 2)?.closest('.catalogue-strip') === el);
    });
    expect(onTop).toEqual(Array(9).fill(true));
    expect(await blockedHeaderControls(page)).toEqual([]);

    // the top bar's menu opens over the strip, and its items take their taps
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

    // the load ends: the strip goes, nothing moved
    await setLoad(page, false);
    await expect(s).toHaveCount(0);
    expect(Math.abs((await firstTop(page, layout)) - before)).toBeLessThan(0.5);

    // the strip stood as high as a row of chips stands, where one stands
    await setParams(page, { mfr: MFR });
    const row = page.locator('.applied-chips');
    await expect(row).toBeVisible();
    const rb = await box(row);
    expect(Math.abs(rb.y - sb.y)).toBeLessThan(0.5);
    expect(Math.abs(rb.height - sb.height)).toBeLessThan(0.5);
  });
}

// the Fold8's open panel shows a figure's detail as a pane on the right: with no row of chips, the strip stops short of it,
// so the pane's own controls at its top (Close) keep their taps
test('LOADBAR-2 (case, nothing filtered, detail pane open): the pane\'s Close takes its tap', async ({ page }, testInfo) => {
  await ready(page, 'case', '');
  await setLoad(page, true);
  const s = strip(page);
  await expect(s).toBeVisible();
  const below = (await box(s)).bottom + 8;
  // a figure whose centre lies clear below the strip
  const at = await page.locator(FIGURE.case).evaluateAll((bs, below) => {
    for (const b of bs) {
      const r = b.getBoundingClientRect();
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      if (y > below && y < innerHeight - 80 && x > 40 && x < innerWidth - 40 && document.elementFromPoint(x, y)?.closest('button') === b) return { x, y };
    }
    return null;
  }, below);
  expect(at).not.toBeNull();
  await tapAt(page, testInfo, at!.x, at!.y);
  const pane = page.locator('.detail-pane');
  if ((await page.evaluate(() => innerWidth)) < 640) {
    // a phone's cover: the figure opens full screen, over everything, the strip with it
    await expect(pane).toHaveCount(0);
    return;
  }
  await expect(pane).toBeVisible();
  await page.waitForTimeout(300);
  await signoffShot(page, testInfo, 'loadbar2-case-pane');
  const close = page.getByRole('button', { name: 'Close detail' });
  const cb = await box(close);
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? null, { x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 });
  expect(hit).toBe('Close detail');
  expect(await blockedHeaderControls(page)).toEqual([]);
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
    const bar = page.getByRole('progressbar', { name: 'Loading catalogue' });
    await expect(bar).toBeVisible();
    await expect(bar).toHaveText(LABEL);
    await page.waitForTimeout(300);
    await expect(strip(page)).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Loading catalogue' })).toHaveCount(0);
  });
}

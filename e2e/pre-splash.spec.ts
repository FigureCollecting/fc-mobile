import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { parseFigureArt, splashStartHeight } from '../deploy/brandArt';

// The static splash (index.html) shows the figure over the name from the first paint. The figure starts at
// the size Android's system splash drew it (deploy/brandArt.ts splashStartHeight), holds it while Chrome
// fades its own splash, grows ease-out to full size by 3.5 s as the name fades in, and the splash then
// fades for 0.5 s: 4 s in all (SPLASH_MIN_MS). With reduced motion it stands at full size for 3.5 s and
// goes at once. The fixtures fail any test on a CSP violation, so the inline art and the keyframes are
// also proven allowed by the shipped policy. At the Fold8 cover panel.
test.use({ serviceWorkers: 'block', viewport: { width: 444, height: 701 } });

const START = splashStartHeight(parseFigureArt(readFileSync(new URL('../src/assets/brand/final-E.svg', import.meta.url), 'utf8')));

interface Sample {
  t: number;
  height: number;
  centreY: number;
  nameOpacity: number;
}
interface Record {
  removedAt: number;
  mountedAt: number;
  firstPaint: number;
  hiddenClass: boolean;
  samples: Sample[];
}

/** Loads the app, recording the figure's height, its centre and the name's opacity every frame until the splash goes. */
async function watchSplash(page: Page): Promise<Record> {
  await page.addInitScript(() => {
    const w = window as unknown as { __splash: { removedAt?: number; mountedAt?: number; hiddenClass: boolean; samples: unknown[] } };
    w.__splash = { hiddenClass: false, samples: [] };
    let seen = false;
    const frame = () => {
      const art = document.querySelector('#pre-splash .pre-splash__art');
      const name = document.querySelector('#pre-splash .pre-splash__text');
      if (art === null || name === null) return;
      const box = art.getBoundingClientRect();
      w.__splash.samples.push({ t: performance.now(), height: box.height, centreY: box.top + box.height / 2, nameOpacity: Number(getComputedStyle(name).opacity) });
      requestAnimationFrame(frame);
    };
    new MutationObserver(() => {
      const splash = document.getElementById('pre-splash');
      if (splash !== null && !seen) {
        seen = true;
        requestAnimationFrame(frame);
      }
      if (splash?.classList.contains('pre-splash--hidden')) w.__splash.hiddenClass = true;
      if (splash === null && seen && w.__splash.removedAt === undefined) w.__splash.removedAt = performance.now();
      if (w.__splash.mountedAt === undefined && (document.getElementById('app')?.childElementCount ?? 0) > 0) w.__splash.mountedAt = performance.now();
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  await page.goto('/', { waitUntil: 'commit' });
  const splash = page.locator('#pre-splash');
  await expect(splash.locator('svg.pre-splash__art path')).toHaveCount(1);
  await expect(splash).toContainText('FigureCollecting');
  await expect(splash).toHaveCount(0, { timeout: 15_000 });
  return page.evaluate(() => ({
    ...(window as unknown as { __splash: Omit<Record, 'firstPaint'> }).__splash,
    firstPaint: performance.getEntriesByName('first-paint')[0]?.startTime ?? 0,
  }));
}

const fullHeight = (page: Page) => Math.min(0.46 * page.viewportSize()!.height, 22 * 16);

test("the figure starts at the system splash's size at the screen's centre, grows to full size by 3.5 s as the name fades in, and the splash is gone at 4 s", async ({ page }) => {
  const r = await watchSplash(page);
  const at = (s: Sample) => s.t - r.firstPaint;
  const first = r.samples[0]!;
  // the first frame: the system splash's figure, centred where the system drew the icon
  expect(at(first), 'a frame from the start').toBeLessThan(250);
  expect(Math.abs(first.height - START), `first frame ${first.height.toFixed(1)} px, the system splash ${START.toFixed(1)} px`).toBeLessThanOrEqual(1);
  expect(Math.abs(first.centreY - page.viewportSize()!.height / 2)).toBeLessThanOrEqual(1);
  expect(first.nameOpacity).toBeLessThan(0.05);
  // it holds through Chrome's own 300 ms splash fade, then grows smoothly: never smaller than the frame before
  for (const s of r.samples.filter((s) => at(s) < 280)) expect(Math.abs(s.height - START)).toBeLessThanOrEqual(1);
  for (let i = 1; i < r.samples.length; i++) expect(r.samples[i]!.height).toBeGreaterThanOrEqual(r.samples[i - 1]!.height - 0.5);
  const mid = r.samples.find((s) => at(s) >= 1500)!;
  expect(mid.height).toBeGreaterThan(START + 10);
  expect(mid.height).toBeLessThan(fullHeight(page) - 1);
  // full size and the whole name by 3.5 s, still centred
  const grown = r.samples.filter((s) => at(s) >= 3550);
  expect(grown.length, 'frames after the growth').toBeGreaterThan(0);
  for (const s of grown) {
    expect(Math.abs(s.height - fullHeight(page))).toBeLessThanOrEqual(1);
    expect(Math.abs(s.centreY - page.viewportSize()!.height / 2)).toBeLessThanOrEqual(1);
    expect(s.nameOpacity).toBeGreaterThan(0.99);
  }
  // 4 s from first paint, and no longer than it has to: the fade starts at 3.5 s, or on mount if that came later
  expect(r.hiddenClass).toBe(true);
  expect(r.removedAt - r.firstPaint).toBeGreaterThanOrEqual(4000 - 50);
  expect(r.removedAt - Math.max(r.firstPaint + 3500, r.mountedAt)).toBeLessThanOrEqual(500 + 250);
});

test('with reduced motion the figure stands at full size with its name for 3.5 s, then goes at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const r = await watchSplash(page);
  expect(r.samples.length).toBeGreaterThan(0);
  for (const s of r.samples) {
    expect(Math.abs(s.height - fullHeight(page)), 'no growth').toBeLessThanOrEqual(1);
    expect(s.nameOpacity).toBeGreaterThan(0.99);
  }
  expect(r.hiddenClass, 'no fade').toBe(false);
  expect(r.removedAt - r.firstPaint).toBeGreaterThanOrEqual(3500 - 50);
  expect(r.removedAt - Math.max(r.firstPaint + 3500, r.mountedAt)).toBeLessThanOrEqual(250);
});

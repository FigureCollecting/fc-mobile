import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { parseFigureArt, splashStartHeight } from '../deploy/brandArt';

// The static splash (index.html) shows the figure over the name from the first paint. SPLASH-3 (Ross 10-18): the
// figure starts at the size Android's system splash drew it (deploy/brandArt.ts splashStartHeight), holds it while
// Chrome fades its own splash, grows ease-out to the near full-frame target (about 73 % of the screen's height, the
// name 1.8x and lower below it, the figure, the gap and the name centred as one group inside the safe areas), holds a
// beat, and the splash then fades for 0.5 s: 3 s in all (SPLASH_MIN_MS). With reduced motion it stands at the target
// for the same time and goes at once. The fixtures fail any test on a CSP violation, so the inline art and the
// keyframes are also proven allowed by the shipped policy. At the Fold8's cover screen, and the four layouts below.
test.use({ serviceWorkers: 'block', viewport: { width: 444, height: 701 } });

const START = splashStartHeight(parseFigureArt(readFileSync(new URL('../src/assets/brand/final-E.svg', import.meta.url), 'utf8')));

/** From first paint: the figure full size, the beat it holds there, the fade, and the splash gone (src/pwa/preSplash.ts). */
const GROW_MS = 2200;
const HOLD_MS = 300;
const FADE_MS = 500;
const TOTAL_MS = GROW_MS + HOLD_MS + FADE_MS;

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
interface Sample {
  t: number;
  art: Box;
  text: Box;
  nameOpacity: number;
  nameFontPx: number;
}
interface Record {
  removedAt: number;
  mountedAt: number;
  hiddenAt: number | undefined;
  firstPaint: number;
  samples: Sample[];
}

/** Loads the app, recording the figure's and the name's boxes (and the name's opacity) every frame until the splash goes. */
async function watchSplash(page: Page): Promise<Record> {
  await page.addInitScript(() => {
    const w = window as unknown as { __splash: { removedAt?: number; mountedAt?: number; hiddenAt?: number; samples: unknown[] } };
    w.__splash = { samples: [] };
    let seen = false;
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    const frame = () => {
      const art = document.querySelector('#pre-splash .pre-splash__art');
      const name = document.querySelector('#pre-splash .pre-splash__text');
      if (art === null || name === null) return;
      const style = getComputedStyle(name);
      w.__splash.samples.push({ t: performance.now(), art: box(art), text: box(name), nameOpacity: Number(style.opacity), nameFontPx: parseFloat(style.fontSize) });
      requestAnimationFrame(frame);
    };
    new MutationObserver(() => {
      const splash = document.getElementById('pre-splash');
      if (splash !== null && !seen) {
        seen = true;
        requestAnimationFrame(frame);
      }
      if (splash?.classList.contains('pre-splash--hidden') && w.__splash.hiddenAt === undefined) w.__splash.hiddenAt = performance.now();
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

const height = (b: Box) => b.bottom - b.top;
/** The frames where the figure has reached its target and not yet begun to fade: the beat it holds. */
const held = (r: Record) => r.samples.filter((s) => s.t - r.firstPaint >= GROW_MS + 100 && s.t - r.firstPaint <= GROW_MS + HOLD_MS - 50);

test('the figure starts at the system splash\'s size at the screen\'s centre, grows to about 73 % of the screen\'s height, holds a beat and fades: gone at 3 s', async ({ page }) => {
  const r = await watchSplash(page);
  const H = page.viewportSize()!.height;
  const at = (s: Sample) => s.t - r.firstPaint;
  const first = r.samples[0]!;
  // the first frame: the system splash's figure, centred where the system drew the icon
  expect(at(first), 'a frame from the start').toBeLessThan(250);
  expect(Math.abs(height(first.art) - START), `first frame ${height(first.art).toFixed(1)} px, the system splash ${START.toFixed(1)} px`).toBeLessThanOrEqual(1);
  expect(Math.abs((first.art.top + first.art.bottom) / 2 - H / 2)).toBeLessThanOrEqual(1);
  expect(first.nameOpacity).toBeLessThan(0.05);
  // it holds through Chrome's own 300 ms splash fade, then grows smoothly: never smaller than the frame before
  for (const s of r.samples.filter((s) => at(s) < 280)) expect(Math.abs(height(s.art) - START)).toBeLessThanOrEqual(1);
  for (let i = 1; i < r.samples.length; i++) expect(height(r.samples[i]!.art)).toBeGreaterThanOrEqual(height(r.samples[i - 1]!.art) - 0.5);
  const mid = r.samples.find((s) => at(s) >= 1000)!;
  expect(height(mid.art)).toBeGreaterThan(START + 10);
  expect(height(mid.art)).toBeLessThan(0.7 * H);
  // the beat at the target: the silhouette 70-76 % of the height, its top 6-11 % down, the name whole
  const beat = held(r);
  expect(beat.length, 'frames in the beat').toBeGreaterThan(3);
  for (const s of beat) {
    expect(height(s.art) / H, 'the silhouette\'s share of the height').toBeGreaterThanOrEqual(0.7);
    expect(height(s.art) / H).toBeLessThanOrEqual(0.76);
    expect(s.art.top / H, 'its top').toBeGreaterThanOrEqual(0.06);
    expect(s.art.top / H).toBeLessThanOrEqual(0.11);
    expect(s.nameOpacity).toBeGreaterThan(0.99);
  }
  // the name: about 1.8x the old 22 px, and below the figure
  const name = beat[0]!;
  expect(name.nameFontPx, 'the name\'s size').toBeGreaterThanOrEqual(1.7 * 22);
  expect(name.nameFontPx).toBeLessThanOrEqual(1.9 * 22);
  expect(name.text.top).toBeGreaterThan(name.art.bottom);
  // the figure, the gap and the name are one group, centred: the margin above it and below it differ by under 2 % of the height
  const group = { top: name.art.top, bottom: name.text.bottom };
  expect(Math.abs(group.top - (H - group.bottom)) / H, 'margin above vs below the group').toBeLessThan(0.02);
  // 3 s from first paint: it holds the beat, then fades, and no longer than it has to
  expect(r.hiddenAt! - r.firstPaint, 'the fade starts after the beat').toBeGreaterThanOrEqual(GROW_MS + HOLD_MS - 50);
  expect(r.removedAt - r.firstPaint).toBeGreaterThanOrEqual(TOTAL_MS - 50);
  expect(r.removedAt - Math.max(r.firstPaint + GROW_MS + HOLD_MS, r.mountedAt)).toBeLessThanOrEqual(FADE_MS + 250);
});

// SPLASH-3: every Fold8 layout, folded or open, portrait or landscape: the group stays inside the safe areas (a punch-hole
// cutout is one) with a margin, centred in what is left, and the ear tips never reach the cutout. Chromium's own
// safe-area override stands in for the cutout the phone reports.
const LAYOUTS = [
  { name: 'cover portrait', viewport: { width: 444, height: 702 }, insets: { top: 40, bottom: 24, left: 0, right: 0 } },
  { name: 'open portrait', viewport: { width: 658, height: 871 }, insets: { top: 44, bottom: 24, left: 0, right: 0 } },
  { name: 'open landscape, cutout on the left', viewport: { width: 871, height: 658 }, insets: { top: 0, bottom: 24, left: 48, right: 0 } },
  { name: 'open landscape, cutout on the right', viewport: { width: 871, height: 658 }, insets: { top: 0, bottom: 24, left: 0, right: 48 } },
];

for (const layout of LAYOUTS) {
  test(`the group stands inside the safe areas, centred, with its top clear of the cutout: ${layout.name}`, async ({ page }) => {
    await page.setViewportSize(layout.viewport);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: layout.insets });
    const r = await watchSplash(page);
    const { width: W, height: H } = layout.viewport;
    const { top, bottom, left, right } = layout.insets;
    const beat = held(r);
    expect(beat.length, 'frames in the beat').toBeGreaterThan(3);
    for (const s of beat) {
      const group = { top: s.art.top, bottom: s.text.bottom, left: Math.min(s.art.left, s.text.left), right: Math.max(s.art.right, s.text.right) };
      // no overlap with any safe-area edge, a margin to spare
      expect(group.top, 'below the top inset (the ear tips clear of the cutout)').toBeGreaterThanOrEqual(top + 4);
      expect(group.bottom, 'above the bottom inset').toBeLessThanOrEqual(H - bottom - 4);
      expect(group.left, 'right of the left inset').toBeGreaterThanOrEqual(left + 4);
      expect(group.right, 'left of the right inset').toBeLessThanOrEqual(W - right - 4);
      // centred in the usable box, within 2 % of the height (and of the width across)
      expect(Math.abs(group.top - top - (H - bottom - group.bottom)) / H, 'above vs below').toBeLessThan(0.02);
      expect(Math.abs(group.left - left - (W - right - group.right)) / W, 'left vs right').toBeLessThan(0.02);
    }
    // never above 76 % of the screen's height either
    expect(height(beat[0]!.art) / H).toBeLessThanOrEqual(0.76);
  });
}

test('with reduced motion the figure stands at the target with its name for the same 2.5 s, then goes at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const r = await watchSplash(page);
  const H = page.viewportSize()!.height;
  expect(r.samples.length).toBeGreaterThan(0);
  const first = r.samples[0]!;
  for (const s of r.samples) {
    expect(Math.abs(height(s.art) - height(first.art)), 'no growth').toBeLessThanOrEqual(1);
    expect(s.nameOpacity).toBeGreaterThan(0.99);
  }
  expect(height(first.art) / H).toBeGreaterThanOrEqual(0.7);
  expect(height(first.art) / H).toBeLessThanOrEqual(0.76);
  const group = { top: first.art.top, bottom: first.text.bottom };
  expect(Math.abs(group.top - (H - group.bottom)) / H, 'centred as a group even without the motion').toBeLessThan(0.02);
  expect(r.hiddenAt, 'no fade').toBeUndefined();
  expect(r.removedAt - r.firstPaint).toBeGreaterThanOrEqual(GROW_MS + HOLD_MS - 50);
  expect(r.removedAt - Math.max(r.firstPaint + GROW_MS + HOLD_MS, r.mountedAt)).toBeLessThanOrEqual(250);
});

import fs from 'node:fs';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS, FOLD8_DPR } from './caseViewports';
import { pageLayers, percentile, swipeFrameTimes } from './caseMeasure';

/**
 * CASE-GL's acceptance, measured in a real Chromium through CDP at the Fold8's four panels, the canvas against the
 * classic view, on three walls: the seven fixtures (fx=170, about 1,200 figures), fx-spike in every slot, and a
 * 1,500-figure wall (fx=215). Per run: the composited layer area of the whole page (viewports of CSS px), the frame
 * intervals of a scripted swipe (3 walks of 240 px, a pointer move a frame), the canvas's GPU texture bytes and the
 * cards each visibility stage removes. Asserted: the case scene's layers (the canvas and the nav over it) at most
 * 1.5 viewports, the texture bytes within the 48 MB budget, and no layer growth with the figure count. The whole
 * page is recorded, not asserted: the app shell alone composites about 2.2 viewports whatever the case draws (the
 * document 1.0, the route's animated wrapper 0.9, the header and the tab bar). The frame times are asserted (p95 at
 * one 60 Hz frame, 16.7 ms, plus 0.5 ms of timer jitter) only when CASE_GL_STRICT_FRAMES=1: a GPU-less runner
 * draws WebGL on SwiftShader, on the CPU.
 * CASE_GL_MEASURE_OUT names a file each run appends its JSON line to (the PR's table).
 */

test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: FOLD8_DPR });
test.describe.configure({ timeout: 90_000 });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const FOLD8 = CASE_VIEWPORTS.filter((v) => v.name.startsWith('fold8'));
const BUDGET = 48 * 1024 * 1024;
const WALLS = [
  { name: 'fixtures', query: 'fx=170' },
  { name: 'fx-spike', query: 'fx=170&fxonly=spike' },
  { name: 'wall-1500', query: 'fx=215' },
] as const;

async function openCase(page: Page, size: { width: number; height: number }, renderer: 'canvas' | 'classic', query: string, pattern?: string) {
  await page.addInitScript(
    ([r, p]) => {
      localStorage.setItem('onboarding_complete', '1');
      localStorage.setItem('fc-fixture-mode', 'on');
      localStorage.setItem('fc-case-prefs', JSON.stringify({ renderer: r, swipe: 'camera', view: 'wall', ...(p ? { pattern: p } : {}) }));
    },
    [renderer, pattern ?? null] as const,
  );
  await page.setViewportSize(size);
  await page.goto(`/?layout=case&${query}`);
  await expect(page.locator('#pre-splash')).toHaveCount(0);
  if (renderer === 'canvas') {
    await expect(page.locator('canvas.case-gl')).toHaveAttribute('data-gl-ready', '1');
    await expect.poll(async () => Number(await page.locator('canvas.case-gl').getAttribute('data-gl-pages')), { timeout: 20_000 }).toBeGreaterThan(0);
  } else {
    await page.waitForSelector('button.cab-figure');
  }
  await page.waitForTimeout(800);
}

async function glData(page: Page) {
  return page.locator('canvas.case-gl').evaluate((c: HTMLCanvasElement) => ({
    stages: JSON.parse(c.dataset.glStages ?? '{}') as Record<string, number>,
    drawn: Number(c.dataset.glDrawn),
    placeholders: Number(c.dataset.glPlaceholders),
    drawCalls: Number(c.dataset.glDrawCalls),
    pages: Number(c.dataset.glPages),
    textureBytes: Number(c.dataset.glTextureBytes),
    budgetBytes: Number(c.dataset.glBudgetBytes),
    dpr: Number(c.dataset.glDpr),
    cullMs: Number(c.dataset.glCullMs),
    buffer: { width: c.width, height: c.height },
  }));
}

function record(testInfo: TestInfo, row: Record<string, unknown>) {
  const line = JSON.stringify(row);
  console.log(`case-gl-measure ${line}`);
  const out = process.env.CASE_GL_MEASURE_OUT;
  if (out) fs.appendFileSync(out, `${line}\n`);
  return testInfo.attach('case-gl measure', { body: line, contentType: 'application/json' });
}

for (const size of FOLD8) {
  for (const wall of WALLS) {
    for (const renderer of ['canvas', 'classic'] as const) {
      test(`${renderer}, ${wall.name}, ${size.name}: page layers, swipe frame times, texture bytes, cards per stage`, async ({ page }, testInfo) => {
        await openCase(page, size, renderer, wall.query);
        const viewport = size.width * size.height;
        const before = await pageLayers(page);
        const stagesOpen = renderer === 'canvas' ? (await glData(page)).stages : null;
        const frames = await swipeFrameTimes(page, -240);
        await page.waitForTimeout(800);
        const after = await pageLayers(page);
        const gl = renderer === 'canvas' ? await glData(page) : null;
        const vp = (a: number) => Number((a / viewport).toFixed(3));
        const row = {
          panel: size.name,
          wall: wall.name,
          renderer,
          layers: after.layers,
          pageViewports: vp(Math.max(before.area, after.area)),
          sceneLayers: Math.max(before.sceneLayers, after.sceneLayers),
          sceneViewports: vp(Math.max(before.sceneArea, after.sceneArea)),
          // the classic view's scene layers are its GPU memory: their px at the device pixel ratio, 4 bytes each
          sceneLayerBytes: Math.round(Math.max(before.sceneArea, after.sceneArea) * FOLD8_DPR * FOLD8_DPR * 4),
          frames: frames.length,
          // intervals longer than one and a half 60 Hz frames: a frame missed
          dropped: frames.filter((f) => f > 25).length,
          frameP50: Number(percentile(frames, 50).toFixed(2)),
          frameP95: Number(percentile(frames, 95).toFixed(2)),
          frameMax: Number(Math.max(...frames).toFixed(2)),
          ...(gl ? { textureBytes: gl.textureBytes, pages: gl.pages, drawCalls: gl.drawCalls, drawn: gl.drawn, placeholders: gl.placeholders, cullMs: gl.cullMs, dpr: gl.dpr, buffer: gl.buffer, stagesOpen, stagesSwiped: gl.stages } : {}),
        };
        await record(testInfo, row);
        expect(frames.length, 'the swipe drew frames').toBeGreaterThan(30);
        if (renderer === 'canvas') {
          expect(row.sceneViewports, 'the case scene composites at most 1.5 viewports with the canvas').toBeLessThanOrEqual(1.5);
          expect(row.sceneLayers, 'the canvas and the nav over it').toBeLessThanOrEqual(2);
          expect(gl!.textureBytes).toBeGreaterThan(0);
          expect(gl!.textureBytes, 'GPU texture bytes within the budget').toBeLessThanOrEqual(BUDGET);
          expect(gl!.dpr).toBe(2);
          if (process.env.CASE_GL_STRICT_FRAMES === '1') expect(row.frameP95, 'frame time p95 over the swipe').toBeLessThanOrEqual(16.7 + 0.5);
        }
      });
    }
  }

  // the stages past the frustum, where they have something to remove: opaque boards (the rack), opaque art (framed)
  for (const extra of [
    { name: 'rack wall', query: 'fx=170', pattern: 'open-steel-rack' },
    { name: 'framed art', query: 'fx=170&fxbranch=framed' },
    { name: 'mixed wall, framed', query: 'fx=170&fxbranch=framed', pattern: 'ikea-klingsbo+ikea-detolf+open-steel-rack' },
  ]) {
    test(`canvas, ${extra.name}, ${size.name}: cards each visibility stage removes`, async ({ page }, testInfo) => {
      await openCase(page, size, 'canvas', extra.query, extra.pattern);
      const open = await glData(page);
      await swipeFrameTimes(page, -240, 1, 12);
      await page.waitForTimeout(800);
      const swiped = await glData(page);
      await record(testInfo, { panel: size.name, wall: extra.name, renderer: 'canvas', stagesOpen: open.stages, stagesSwiped: swiped.stages, drawn: swiped.drawn, textureBytes: swiped.textureBytes });
      for (const g of [open, swiped]) {
        const s = g.stages;
        expect(g.drawn).toBe(s.total - s.frustum - s.cabinets - s.boards - s.figures);
        expect(g.textureBytes).toBeLessThanOrEqual(BUDGET);
      }
    });
  }

  test(`canvas, ${size.name}: no layer growth with the figure count (1,200, 1,500 and a spike wall)`, async ({ page }, testInfo) => {
    const seen: { query: string; layers: number; area: number; sceneLayers: number; sceneArea: number }[] = [];
    // the wall of 7 fits one page: its nav buttons are hidden, so its scene is the canvas alone
    for (const query of ['fx=1', 'fx=170', 'fx=215', 'fx=170&fxonly=spike']) {
      await openCase(page, size, 'canvas', query);
      seen.push({ query, ...(await pageLayers(page)) });
    }
    await record(testInfo, { panel: size.name, growth: seen });
    expect(seen[0].sceneLayers).toBe(1);
    for (const s of seen.slice(2)) expect({ layers: s.layers, area: s.area }).toEqual({ layers: seen[1].layers, area: seen[1].area });
  });
}

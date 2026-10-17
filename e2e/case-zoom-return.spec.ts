import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS, FOLD8_DPR } from './caseViewports';
import { touchPinch } from './touch';

/**
 * CASE-FB3a item 1 (Ross 10-17 11:0xC, his Fold8 open and open turned: "i could only trigger the memory redraw when
 * returning from zoom and only sometimes"; the 11:08 shot has the rack's room wall, boards and every figure but one
 * gone, the app's chrome with them). Chromium's own compositor accounting (a memory dump: the renderer's
 * cc/tile_memory) while the case zooms in and returns to 1x, as the case opens on a rack wall of cut-outs (fixture
 * mode, ?fxbranch=masked) at the Fold8's open panels:
 *   - the tiles the compositor holds after a return to 1x, and during it, stay near what the same picture held
 *     before it zoomed (the CSS transition that eased the zoom layer back made it raster every layer under it at the
 *     zoom's scale: 3 to 5x the tiles, kept for seconds), every return of three in a row;
 *   - a turn of the panel while zoomed starts the new picture at 1x, holding what a picture at 1x holds;
 *   - after every return every figure drawn before is drawn again as its cut-out, and the scene's layers stay under
 *     the ceiling of MOB-NAV-2 (3 viewports), zoomed, after each return and after a turn. (Reading the layer tree turns
 *     the compositor's own bookkeeping up for a while, so the layers are read in tests of their own.)
 * A desktop Chromium rasters in software, so its tiles are the memory the Fold8's GPU would hold, not its failure to
 * allocate them (that only the phone shows). On 8c565638 (develop) the returns held 33 to 58 MB against 8 to 9 MB
 * before them (fold8-open and fold8-open-rotated), the layers 1.5 viewports zoomed (under the ceiling all along).
 */

test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: FOLD8_DPR });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

/** MOB-NAV-2's ceiling on the scene's layers, in viewports of pixels (e2e/case-budget.spec.ts). */
const CEILING_VIEWPORTS = 3;
/** What the compositor holds of tiles at a return, as a multiple of what the picture held before it zoomed. */
const TILES_MAX_RATIO = 2;
/** A return is measured this long after its animation ends (the tiles a layer keeps are dropped within seconds). */
const AFTER_MS = 1200;
/** A resize leaves the old size's tiles to the compositor for a few seconds: a turn is measured once they are gone. */
const AFTER_TURN_MS = 6500;
/** Partway through a return's animation (it lasts about 200 ms). */
const DURING_MS = 100;
const CYCLES = 3;
const RACK = 'open-steel-rack';

const open = CASE_VIEWPORTS.find((v) => v.name === 'fold8-open')!;
const turned = CASE_VIEWPORTS.find((v) => v.name === 'fold8-open-rotated')!;

const settle = (page: Page, ms: number) => page.evaluate((m) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, m)))), ms);

/**
 * The renderer's tile memory now, in MB (a Chromium memory dump through CDP tracing: cc/tile_memory, what the
 * compositor holds of rastered tiles).
 */
async function tileMb(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  try {
    type Dump = { ph: string; args?: { dumps?: { allocators?: Record<string, { attrs?: Record<string, { value: string }> }> } } };
    const events: Dump[] = [];
    cdp.on('Tracing.dataCollected', (e: { value: Dump[] }) => events.push(...e.value));
    const done = new Promise<void>((resolve) => cdp.on('Tracing.tracingComplete', () => resolve()));
    await cdp.send('Tracing.start', { traceConfig: { includedCategories: ['disabled-by-default-memory-infra'], recordMode: 'recordAsMuchAsPossible', memoryDumpConfig: { triggers: [] } } } as never);
    await cdp.send('Tracing.requestMemoryDump' as never, { deterministic: true, levelOfDetail: 'light' } as never);
    await cdp.send('Tracing.end');
    await done;
    const bytes = events
      .filter((e) => e.ph === 'v')
      .map((e) => e.args?.dumps?.allocators?.['cc/tile_memory']?.attrs?.['effective_size']?.value ?? '0')
      .map((hex) => parseInt(hex, 16));
    const peak = Math.max(0, ...bytes);
    expect(peak, 'a memory dump with the renderer\'s cc/tile_memory').toBeGreaterThan(0);
    return Math.round(peak / 1e5) / 10;
  } finally {
    await cdp.detach();
  }
}

/** The case scene's composited layers, in viewports of pixels (CDP LayerTree, as e2e/case-budget.spec.ts reads them). */
async function sceneViewports(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  try {
    type Layer = { backendNodeId?: number; width: number; height: number; drawsContent: boolean };
    const trees: Layer[][] = [];
    cdp.on('LayerTree.layerTreeDidChange', (e: { layers?: Layer[] }) => e.layers && trees.push(e.layers.filter((l) => l.drawsContent && l.backendNodeId !== undefined)));
    await cdp.send('LayerTree.enable');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await expect.poll(() => trees.length, { timeout: 10_000, message: 'a LayerTree.layerTreeDidChange' }).toBeGreaterThan(0);
    await page.waitForTimeout(150);
    const layers = trees.reduce((a, b) => (b.length > a.length ? b : a));
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeIds: inScene } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '.cabinet-scene, .cabinet-scene *' });
    const { nodeIds } = await cdp.send('DOM.pushNodesByBackendIdsToFrontend', { backendNodeIds: layers.map((l) => l.backendNodeId!) });
    const scene = new Set(inScene);
    await cdp.send('LayerTree.disable');
    const area = layers.filter((_, i) => scene.has(nodeIds[i]!)).reduce((a, l) => a + l.width * l.height, 0);
    const viewport = page.viewportSize()!;
    return Math.round((area / (viewport.width * viewport.height)) * 100) / 100;
  } finally {
    await cdp.detach();
  }
}

/** The figures drawn, by id, with whether each is drawn as its cut-out (a masked, grounded picture). */
const figures = (page: Page) =>
  page.locator('button.cab-figure').evaluateAll((buttons) =>
    buttons.map((b) => ({ id: b.getAttribute('data-figure-id')!, cutOut: b.getAttribute('data-art') === 'masked' && b.querySelector('.cab-figure__art--masked') !== null })),
  );

/**
 * The drawn cabinets standing wholly in the frame that hold figures (data-held) yet draw none, by wall index (the case
 * draws every figure of a cabinet in view: e2e/case-budget's fill checks; Ross's 11:07 shot showed three such bays).
 */
const emptyInView = (page: Page): Promise<number[]> =>
  page.locator('.cabinet-scene').evaluate((host) => {
    const f = host.querySelector('.cabinet-scene__frame')!.getBoundingClientRect();
    const wall = JSON.parse(host.getAttribute('data-wall')!) as number[][];
    const held = JSON.parse(host.getAttribute('data-held')!) as [number, number, number[]][];
    const centres = Array.from(host.querySelectorAll('button.cab-figure'), (b) => {
      const w = JSON.parse(b.getAttribute('data-world')!) as { x0: number; x1: number };
      return (w.x0 + w.x1) / 2;
    });
    const out: number[] = [];
    for (const c of Array.from(host.querySelectorAll<HTMLElement>('.cab[data-index]'))) {
      const i = Number(c.dataset.index);
      let x0 = Infinity;
      let x1 = -Infinity;
      for (const q of Array.from(c.querySelectorAll('.q'))) {
        const r = q.getBoundingClientRect();
        if (r.width * r.height === 0) continue;
        x0 = Math.min(x0, r.left);
        x1 = Math.max(x1, r.right);
      }
      const whole = x0 >= f.left && x1 <= f.right;
      const drawn = centres.filter((x) => x > wall[i]![0]! && x < wall[i]![1]!).length;
      if (whole && held[i]![0] + held[i]![1] > 0 && drawn === 0) out.push(i);
    }
    return out;
  });

async function openRack(page: Page, size: { width: number; height: number }): Promise<void> {
  await page.addInitScript((pattern) => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    localStorage.setItem('fc-case-prefs', JSON.stringify({ view: 'wall', swipe: 'camera', pattern }));
  }, RACK);
  await page.setViewportSize(size);
  await page.goto('/?layout=case&fx=170&labels=1&fxbranch=masked');
  await ready(page);
}

/** The case drawn and the splash gone. */
async function ready(page: Page): Promise<void> {
  await page.waitForSelector('button.cab-figure');
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 30_000 });
  await settle(page, 1500);
}

/** Two pinches out about the frame's middle: 2x, then 4x. */
async function zoomIn(page: Page): Promise<void> {
  const f = (await page.locator('.cabinet-scene__frame').boundingBox())!;
  const m = { x: f.x + f.width / 2, y: f.y + f.height * 0.55 };
  for (let i = 0; i < 2; i++) {
    await touchPinch(page, { x: m.x - 20, y: m.y }, { x: m.x + 20, y: m.y }, { x: m.x - 40, y: m.y }, { x: m.x + 40, y: m.y });
    await expect(page.locator('.cabinet-scene__zoom--live')).toHaveCount(0);
    await settle(page, 400);
  }
  expect(JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-zoom'))!).k, 'zoomed to 4x').toBe(4);
}

const zoomOf = async (page: Page) => JSON.parse((await page.locator('.cabinet-scene').getAttribute('data-zoom'))!) as { k: number; x: number; y: number };

interface Reading {
  what: string;
  mb: number;
  limit: number;
}

/** Zoom in and return to 1x with Reset view `CYCLES` times, the tiles held during and after each return read against `idle`. */
async function tileCycles(page: Page, idle: number, drawn: Awaited<ReturnType<typeof figures>>, readings: Reading[], failures: string[]): Promise<void> {
  const limit = idle * TILES_MAX_RATIO;
  for (let i = 1; i <= CYCLES; i++) {
    await zoomIn(page);
    await page.getByRole('button', { name: 'Reset view' }).tap();
    await page.waitForTimeout(DURING_MS);
    readings.push({ what: `return ${i}, during`, mb: await tileMb(page), limit });
    await expect(page.getByRole('button', { name: 'Reset view' })).toHaveCount(0);
    await settle(page, AFTER_MS);
    readings.push({ what: `return ${i}, after`, mb: await tileMb(page), limit });
    expect(await zoomOf(page), `return ${i}: at 1x`).toEqual({ k: 1, x: 0, y: 0 });
    const again = await figures(page);
    if (JSON.stringify(again) !== JSON.stringify(drawn)) failures.push(`return ${i}: the figures drawn changed (${drawn.length} before, ${again.length} after), or one is no longer its cut-out`);
    const empty = await emptyInView(page);
    if (empty.length > 0) failures.push(`return ${i}: cabinets in view drawn empty: ${empty.join(', ')}`);
  }
}

async function report(testInfo: TestInfo, name: string, idle: number, readings: Reading[], failures: string[]): Promise<void> {
  for (const r of readings) if (r.mb > r.limit) failures.push(`${r.what}: the compositor holds ${r.mb} MB of tiles, over ${r.limit.toFixed(1)} (${TILES_MAX_RATIO}x the ${idle} MB the picture held at 1x before it zoomed)`);
  console.log(`case-zoom-return ${JSON.stringify({ panel: name, idleMb: idle, readings: readings.map((r) => `${r.what} ${r.mb}`) })}`);
  await testInfo.attach('case zoom return', { body: JSON.stringify({ panel: name, idleMb: idle, readings, failures }, null, 1), contentType: 'application/json' });
}

for (const panel of [open, turned]) {
  test(`${panel.name}: returning from 4x three times keeps the tiles near the picture's own, every cut-out drawn`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await openRack(page, panel);
    const drawn = await figures(page);
    expect(drawn.length, 'figures drawn').toBeGreaterThan(20);
    expect(drawn.every((f) => f.cutOut), 'every figure drawn is its cut-out').toBe(true);
    expect(await emptyInView(page), 'cabinets in view drawn empty at the start').toEqual([]);
    const idle = await tileMb(page);
    const readings: Reading[] = [];
    const failures: string[] = [];
    await tileCycles(page, idle, drawn, readings, failures);
    await report(testInfo, panel.name, idle, readings, failures);
    expect(failures).toEqual([]);
  });

  test(`${panel.name}: the scene's layers stay under ${CEILING_VIEWPORTS} viewports zoomed and after each of three returns`, async ({ page }) => {
    test.setTimeout(180_000);
    await openRack(page, panel);
    const seen: Record<string, number> = { 'at 1x': await sceneViewports(page) };
    for (let i = 1; i <= CYCLES; i++) {
      await zoomIn(page);
      seen[`zoomed ${i}`] = await sceneViewports(page);
      await page.getByRole('button', { name: 'Reset view' }).tap();
      await expect(page.getByRole('button', { name: 'Reset view' })).toHaveCount(0);
      await settle(page, AFTER_MS);
      seen[`return ${i}`] = await sceneViewports(page);
    }
    console.log(`case-zoom-return layers ${JSON.stringify({ panel: panel.name, viewports: seen })}`);
    for (const [what, viewports] of Object.entries(seen)) expect(viewports, `${what}: the scene's layers, in viewports`).toBeLessThanOrEqual(CEILING_VIEWPORTS);
  });
}

test('a turn of the panel while zoomed starts the new picture at 1x, holding what a picture at 1x holds', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  // each panel's own picture at 1x, from a fresh load: what it holds before anything zoomed
  const idle: Record<string, number> = {};
  await openRack(page, open);
  idle['open'] = await tileMb(page);
  await page.setViewportSize(turned);
  await page.reload();
  await ready(page);
  idle['turned'] = await tileMb(page);
  const readings: Reading[] = [];
  const failures: string[] = [];
  for (const [size, name] of [[open, 'open'], [turned, 'turned']] as const) {
    await page.setViewportSize(size);
    await page.reload();
    await ready(page);
    await zoomIn(page);
    await page.setViewportSize(size.name === open.name ? turned : open);
    await settle(page, AFTER_TURN_MS);
    const to = size.name === open.name ? 'turned' : 'open';
    expect(await zoomOf(page), `turn to ${to}: the picture starts at 1x`).toEqual({ k: 1, x: 0, y: 0 });
    readings.push({ what: `turn from ${name} to ${to}`, mb: await tileMb(page), limit: idle[to]! * TILES_MAX_RATIO });
    const now = await figures(page);
    if (now.length === 0 || !now.every((f) => f.cutOut)) failures.push(`turn to ${to}: ${now.length} figures drawn, not every one its cut-out`);
  }
  await report(testInfo, 'turns', idle['open']!, readings, failures);
  expect(failures).toEqual([]);
});

test('the scene\'s layers stay under the ceiling after a turn while zoomed, both ways', async ({ page }) => {
  test.setTimeout(180_000);
  await openRack(page, open);
  const seen: Record<string, number> = {};
  for (const [from, to] of [[open, turned], [turned, open]] as const) {
    await zoomIn(page);
    await page.setViewportSize(to);
    await settle(page, AFTER_MS);
    seen[`${from.name} to ${to.name}`] = await sceneViewports(page);
  }
  console.log(`case-zoom-return layers ${JSON.stringify({ turns: seen })}`);
  for (const [what, viewports] of Object.entries(seen)) expect(viewports, `${what}: the scene's layers, in viewports`).toBeLessThanOrEqual(CEILING_VIEWPORTS);
});

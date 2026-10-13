import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS, FOLD8_DPR } from './caseViewports';

/**
 * MOB-NAV-2: the case fits the Fold8's GPU tile budget. Chrome rasters a
 * layer under a perspective at no less than the device pixel ratio per
 * layer pixel, so every composited scene layer costs its own width x height
 * at 2.8125 whatever it draws on screen; the Fold8 ghosted the whole chrome
 * when the case cost some hundred viewports of tiles (MOB-NAV-1 680ff3f1).
 * Read from the compositor itself (CDP LayerTree), at the Fold8's two
 * panels, as the case opens, after 40 swipes walking the camera and after
 * 40 swipes panning the wall: at most 5 cabinets drawn, nothing drawn that
 * lies wholly outside the frame and half a viewport round it, and the scene's
 * layers at most 3 viewports of pixels. Fixture mode, about 1,200 figures.
 */

test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: FOLD8_DPR });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const MAX_CABINETS = 5;
/** The scene's composited layers, in viewports of pixels at the device pixel ratio. */
const CEILING_VIEWPORTS = 3;
/** What the case may draw past the frame on each side, as a share of the frame. */
const MARGIN = 0.5;

type State = { name: string; swipe: 'camera' | 'pan'; swipes: number };
const STATES: State[] = [
  { name: 'default', swipe: 'camera', swipes: 0 },
  { name: 'camera-40', swipe: 'camera', swipes: 40 },
  { name: 'pan-40', swipe: 'pan', swipes: 40 },
];

async function swipe(page: Page, dx: number) {
  const scene = (await page.locator('.cabinet-scene').boundingBox())!;
  const x = scene.x + scene.width * (dx < 0 ? 0.75 : 0.25);
  const y = scene.y + scene.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y);
  await page.mouse.up();
}

interface LayerTreeLayer {
  layerId: string;
  backendNodeId?: number;
  width: number;
  height: number;
  drawsContent: boolean;
}

/** The compositor's layers now: every one that draws, and those of the case scene, with their area (CSS px of layer space). */
async function compositedLayers(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const tree = new Promise<LayerTreeLayer[]>((resolve) => {
      cdp.on('LayerTree.layerTreeDidChange', (e: { layers?: LayerTreeLayer[] }) => {
        if (e.layers) resolve(e.layers);
      });
    });
    await cdp.send('LayerTree.enable');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const layers = await Promise.race([
      tree,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('no LayerTree.layerTreeDidChange within 10 s')), 10_000)),
    ]);
    const drawing = layers.filter((l) => l.drawsContent);
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeIds: inScene } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '.cabinet-scene, .cabinet-scene *' });
    const backed = drawing.filter((l) => l.backendNodeId !== undefined);
    const { nodeIds } = await cdp.send('DOM.pushNodesByBackendIdsToFrontend', { backendNodeIds: backed.map((l) => l.backendNodeId!) });
    const scene = new Set(inScene);
    const sceneLayers = backed.filter((_, i) => scene.has(nodeIds[i]));
    const area = (ls: LayerTreeLayer[]) => ls.reduce((a, l) => a + l.width * l.height, 0);
    await cdp.send('LayerTree.disable');
    return { layers: drawing.length, area: area(drawing), sceneLayers: sceneLayers.length, sceneArea: area(sceneLayers) };
  } finally {
    await cdp.detach();
  }
}

/**
 * What the scene draws: cabinets, figures, every element whose box lies wholly outside the frame and its margin,
 * and every cabinet face that reaches past them: a face is cut to the frame and its margin. A figure, its shadow
 * and its label are drawn whole or not at all; the room's wall and floor are drawn on a small texel grid, so what
 * they cost is that grid wherever their cut reaches (a cut is a rectangle on the face, round what the frame sees).
 */
async function drawn(page: Page) {
  return page.locator('.cabinet-scene').evaluate((host, margin) => {
    const f = host.getBoundingClientRect();
    const mx = f.width * margin;
    const my = f.height * margin;
    const outside: string[] = [];
    const spill: string[] = [];
    const at = (el: Element, r: DOMRect) => `${el.className} @${Math.round(r.left - f.left)},${Math.round(r.top - f.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
    for (const el of Array.from(host.querySelectorAll<HTMLElement>('.cabinet-scene__root .q'))) {
      const r = el.getBoundingClientRect();
      if (r.right < f.left - mx || r.left > f.right + mx || r.bottom < f.top - my || r.top > f.bottom + my) outside.push(at(el, r));
      const face = !el.matches('.cab-figure, .cab-shadow, .cab-plate, .room-wall, .room-floor');
      // 2 px for the rounding of a face cut at the margin
      if (face && (r.left < f.left - mx - 2 || r.right > f.right + mx + 2 || r.top < f.top - my - 2 || r.bottom > f.bottom + my + 2)) spill.push(at(el, r));
    }
    return {
      cabinets: host.querySelectorAll('.cab').length,
      figures: host.querySelectorAll('button.cab-figure').length,
      quads: host.querySelectorAll('.cabinet-scene__root .q').length,
      outside,
      spill,
      cameraX: Number(host.dataset.cameraX),
      pan: Number(host.dataset.pan),
    };
  }, MARGIN);
}

for (const size of CASE_VIEWPORTS.filter((v) => v.name === 'fold8-cover' || v.name === 'fold8-open')) {
  for (const state of STATES) {
    test(`the case fits the tile budget: at most ${MAX_CABINETS} cabinets, nothing far off frame, layers <= ${CEILING_VIEWPORTS} viewports: ${state.name}, ${size.name}`, async ({ page }, testInfo) => {
      test.setTimeout(180_000);
      await page.addInitScript((swipeMode) => {
        localStorage.setItem('onboarding_complete', '1');
        localStorage.setItem('fc-fixture-mode', 'on');
        localStorage.setItem('fc-case-prefs', JSON.stringify({ view: 'wall', swipe: swipeMode }));
      }, state.swipe);
      await page.setViewportSize(size);
      await page.goto('/?layout=case&fx=170');
      await page.waitForSelector('button.cab-figure');
      await expect(page.locator('#pre-splash')).toHaveCount(0);
      const x0 = Number(await page.locator('.cabinet-scene').getAttribute('data-camera-x'));
      for (let i = 0; i < state.swipes; i++) await swipe(page, -400);
      if (state.swipes > 0) {
        // the walk and the pan went a long way down the wall
        await expect.poll(async () => Number(await page.locator('.cabinet-scene').getAttribute('data-camera-x'))).toBeGreaterThan(x0 + 20_000);
      }
      await page.waitForTimeout(500);
      const scene = await drawn(page);
      const layers = await compositedLayers(page);
      const viewport = size.width * size.height;
      const report = {
        state: state.name,
        viewport: size.name,
        dpr: FOLD8_DPR,
        cabinets: scene.cabinets,
        figures: scene.figures,
        quads: scene.quads,
        cameraX: scene.cameraX,
        pan: scene.pan,
        layers: layers.layers,
        sceneLayers: layers.sceneLayers,
        sceneLayerAreaPx: Math.round(layers.sceneArea),
        sceneLayerAreaViewports: Number((layers.sceneArea / viewport).toFixed(3)),
        allLayerAreaViewports: Number((layers.area / viewport).toFixed(3)),
        sceneLayerDevicePx: Math.round(layers.sceneArea * FOLD8_DPR * FOLD8_DPR),
        outside: scene.outside.length,
        spill: scene.spill.length,
      };
      console.log(`case-budget ${JSON.stringify(report)}`);
      await testInfo.attach('case budget', { body: JSON.stringify({ ...report, outsideFirst: scene.outside.slice(0, 20), spillFirst: scene.spill.slice(0, 20) }, null, 1), contentType: 'application/json' });
      expect(scene.figures, 'figures are drawn').toBeGreaterThan(0);
      expect.soft(scene.cabinets, 'cabinets drawn').toBeLessThanOrEqual(MAX_CABINETS);
      expect.soft(scene.outside, 'scene elements wholly outside the frame and half a viewport round it').toEqual([]);
      expect.soft(scene.spill, 'faces reaching past the frame and half a viewport round it').toEqual([]);
      expect(layers.sceneArea / viewport, 'the scene layers, in viewports of pixels').toBeLessThanOrEqual(CEILING_VIEWPORTS);
    });
  }
}

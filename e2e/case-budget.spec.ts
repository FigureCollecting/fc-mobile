import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS, FOLD8_DPR } from './caseViewports';
import type { Camera, Vec3 } from '../src/components/display/caseCamera';
import { IKEA_KLINGSBO } from '../src/components/display/cabinetPresets';
import { wallLayout } from '../src/components/display/packCabinets';
import { cabinetBox, type Box } from '../src/components/display/caseFraming';
import { nearestCabinets, trimFace } from '../src/components/display/caseCull';

/**
 * MOB-NAV-2: the case fits the Fold8's GPU tile budget. Chrome rasters a
 * layer under a perspective at no less than the device pixel ratio per
 * layer pixel, so every composited scene layer costs its own width x height
 * at 2.8125 whatever it draws on screen; the Fold8 ghosted the whole chrome
 * when the case cost some hundred viewports of tiles (MOB-NAV-1 680ff3f1).
 * Read from the compositor itself (CDP LayerTree), at the Fold8's four
 * panels, as the case opens, two swipes into the wall (its loaded middle)
 * and 40 swipes on (its far end), walking the camera or panning the wall:
 * at most 5 cabinets and 250 figures drawn (Ross 12:2xC), nothing drawn that
 * lies wholly outside the frame and half a viewport round it, and the scene's
 * layers at most 3 viewports of pixels; and once the swipe settles the case
 * culls for the settled picture: the drawn cabinets are the 5 nearest its
 * centre. That the frame shows no more than the 5 it draws (Ross 12:1xC)
 * waits on the framing decision (test.fixme below). Fixture mode, about
 * 1,200 figures.
 */

test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: FOLD8_DPR });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

const MAX_CABINETS = 5;
/** Ross 12:2xC: the most figures the case draws at a time. */
const MAX_FIGURES = 250;
/** The loaded middle of the wall: a picture two swipes in shows at least this many figures. */
const MID_FIGURES = 60;
/** The scene's composited layers, in viewports of pixels at the device pixel ratio. */
const CEILING_VIEWPORTS = 3;
/** What the case may draw past the frame on each side, as a share of the frame. */
const MARGIN = 0.5;

type State = { name: string; swipe: 'camera' | 'pan'; swipes: number };
const STATES: State[] = [
  { name: 'default', swipe: 'camera', swipes: 0 },
  { name: 'camera-2', swipe: 'camera', swipes: 2 },
  { name: 'pan-2', swipe: 'pan', swipes: 2 },
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
    // each drawn cabinet's span across the frame, as the browser draws its faces
    const spans = Array.from(host.querySelectorAll<HTMLElement>('.cab')).map((c) => {
      let x0 = Infinity;
      let x1 = -Infinity;
      for (const q of Array.from(c.querySelectorAll('.q'))) {
        const r = q.getBoundingClientRect();
        if (r.width * r.height === 0) continue;
        x0 = Math.min(x0, r.left - f.left);
        x1 = Math.max(x1, r.right - f.left);
      }
      return { i: Number(c.dataset.index), x0, x1 };
    });
    return {
      spans,
      wall: JSON.parse(host.dataset.wall ?? '[]') as number[][],
      camera: JSON.parse(host.dataset.camera!) as Record<string, number>,
      cullX: Number(host.dataset.cullX),
      cullPan: Number(host.dataset.cullPan),
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

const faces = (b: Box): [Vec3, Vec3, Vec3][] => [
  [[b.x0, b.y0, b.z1], [b.x1 - b.x0, 0, 0], [0, b.y1 - b.y0, 0]],
  [[b.x0, b.y0, b.z0], [b.x1 - b.x0, 0, 0], [0, b.y1 - b.y0, 0]],
  [[b.x0, b.y0, b.z0], [0, 0, b.z1 - b.z0], [0, b.y1 - b.y0, 0]],
  [[b.x1, b.y0, b.z0], [0, 0, b.z1 - b.z0], [0, b.y1 - b.y0, 0]],
  [[b.x0, b.y1, b.z0], [b.x1 - b.x0, 0, 0], [0, 0, b.z1 - b.z0]],
  [[b.x0, b.y0, b.z0], [b.x1 - b.x0, 0, 0], [0, 0, b.z1 - b.z0]],
];

/**
 * The frame against the wall it shows, from the numbers the scene publishes (its camera, its pan, the wall's
 * cabinets): the cabinets any part of which draws inside the frame (exact, face by face), the five nearest its
 * centre, and the widest stretch inside the frame where the wall stands but no drawn cabinet is drawn.
 */
function frameCheck(scene: Awaited<ReturnType<typeof drawn>>) {
  const c = scene.camera;
  const camera: Camera = { x: c.x, y: c.y, z: c.z, pitch: c.pitch, focalPx: c.focalPx, frame: { width: c.width, height: c.height } };
  const panPx = scene.pan;
  // the fixture wall is KLINGSBOs side by side; the scene publishes each one's box, so the two must agree
  const layout = wallLayout(scene.wall.map(() => IKEA_KLINGSBO));
  const boxes = layout.cabinets.map((slot) => cabinetBox(slot, 0));
  const published = scene.wall.map(([x0, x1, y1, z0, z1]) => ({ x0, x1, y0: 0, y1, z0, z1 }));
  const rect = { x0: 0, x1: camera.frame.width, y0: 0, y1: camera.frame.height };
  const framed = boxes.flatMap((b, i) => (faces(b).some(([a, u, v]) => trimFace({ camera, panPx }, a, u, v, rect)) ? [i] : []));
  const nearest = nearestCabinets({ camera, panPx }, layout, []);
  // the drawn spans, inside the frame, against the stretch of it the framed cabinets cover
  const spans = scene.spans.map((s) => [Math.max(0, s.x0), Math.min(camera.frame.width, s.x1)] as const).filter(([a, b]) => b > a);
  spans.sort((a, b) => a[0] - b[0]);
  const narrowest = Math.min(...scene.spans.map((s) => s.x1 - s.x0));
  let blank = 0;
  if (spans.length > 0) {
    const lo = framed.includes(0) ? spans[0][0] : 0;
    const hi = framed.includes(boxes.length - 1) ? spans[spans.length - 1][1] : camera.frame.width;
    let reach = lo;
    for (const [a, b] of spans) {
      blank = Math.max(blank, a - reach);
      reach = Math.max(reach, b);
    }
    blank = Math.max(blank, hi - reach);
  } else blank = camera.frame.width;
  return { published, boxes, framed, nearest, blank, narrowest };
}

/** Open the case at `size` in fixture mode, swipe it into `state`, and let it settle: what it draws, against its frame. */
async function settled(page: Page, size: { width: number; height: number }, state: State) {
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
    // the walk and the pan went down the wall: forty swipes a long way
    const past = state.swipes >= 40 ? x0 + 20_000 : x0;
    await expect.poll(async () => Number(await page.locator('.cabinet-scene').getAttribute('data-camera-x')) - Number(await page.locator('.cabinet-scene').getAttribute('data-pan'))).toBeGreaterThan(past);
  }
  await page.waitForTimeout(500);
  const scene = await drawn(page);
  return { scene, frame: frameCheck(scene), drawnSet: scene.spans.map((x) => x.i).sort((a, b) => a - b) };
}

for (const size of CASE_VIEWPORTS.filter((v) => v.name.startsWith('fold8'))) {
  for (const state of STATES) {
    test(`the case fits the tile budget: at most ${MAX_CABINETS} cabinets and ${MAX_FIGURES} figures, the five nearest the settled frame centre, layers <= ${CEILING_VIEWPORTS} viewports: ${state.name}, ${size.name}`, async ({ page }, testInfo) => {
      test.setTimeout(180_000);
      const { scene, frame, drawnSet } = await settled(page, size, state);
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
        drawnCabinets: drawnSet,
        framed: frame.framed,
        nearest: frame.nearest,
        blankPx: Math.round(frame.blank),
        cullX: scene.cullX,
        cullPan: scene.cullPan,
      };
      console.log(`case-budget ${JSON.stringify(report)}`);
      await testInfo.attach('case budget', { body: JSON.stringify({ ...report, outsideFirst: scene.outside.slice(0, 20), spillFirst: scene.spill.slice(0, 20) }, null, 1), contentType: 'application/json' });
      expect(scene.figures, 'figures are drawn').toBeGreaterThan(0);
      expect.soft(scene.figures, 'figures drawn (Ross 12:2xC)').toBeLessThanOrEqual(MAX_FIGURES);
      if (state.swipes === 2) expect.soft(scene.figures, 'the loaded middle of the wall').toBeGreaterThanOrEqual(MID_FIGURES);
      expect.soft(scene.cabinets, 'cabinets drawn').toBeLessThanOrEqual(MAX_CABINETS);
      // settled: the case culls for the picture it shows, not one from partway through the swipe
      expect.soft(scene.cullX, 'the cull is the settled camera').toBeCloseTo(scene.cameraX, 3);
      expect.soft(Math.round(scene.cullPan), 'the cull is the settled pan').toBe(scene.pan);
      // the scene publishes the wall the e2e checks against
      expect(frame.published.length).toBe(frame.boxes.length);
      frame.published.forEach((b, i) => {
        for (const k of ['x0', 'x1', 'y1', 'z0', 'z1'] as const) expect.soft(b[k], `cabinet ${i} ${k}`).toBeCloseTo(frame.boxes[i][k], 0);
      });
      // the drawn cabinets are the five nearest the settled frame centre
      expect.soft(drawnSet, 'the drawn cabinets are the five nearest the settled frame centre').toEqual(frame.nearest);
      expect.soft(scene.outside, 'scene elements wholly outside the frame and half a viewport round it').toEqual([]);
      expect.soft(scene.spill, 'faces reaching past the frame and half a viewport round it').toEqual([]);
      expect(layers.sceneArea / viewport, 'the scene layers, in viewports of pixels').toBeLessThanOrEqual(CEILING_VIEWPORTS);
    });

    test(`the frame shows at most ${MAX_CABINETS} cabinets, every one drawn, no blank wall where one stands: ${state.name}, ${size.name}`, async ({ page }) => {
      // MOB-NAV-2 close-out 2: BLOCKED on the framing decision. Framing five cabinets steps the camera in, and a frame
      // filled with cabinets costs 2.3 to 4.7 viewports of layers (ceiling 3); a candidate is on wip/mob-nav-2-frame-cap
      test.fixme(true, 'BLOCKED on the framing decision (MOB-NAV-2 close-out 2)');
      test.setTimeout(180_000);
      const { frame, drawnSet } = await settled(page, size, state);
      expect.soft(frame.framed.length, `cabinets the frame shows: ${frame.framed.join(',')}`).toBeLessThanOrEqual(MAX_CABINETS);
      expect.soft(frame.framed.filter((i) => !drawnSet.includes(i)), 'cabinets the frame shows but the case does not draw').toEqual([]);
      expect(frame.blank, `blank wall inside the frame where a cabinet stands (px; a cabinet is ${Math.round(frame.narrowest)} px)`).toBeLessThan(frame.narrowest / 2);
    });
  }
}

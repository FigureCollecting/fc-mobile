import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures';
import { CASE_VIEWPORTS, FOLD8_DPR } from './caseViewports';
import { boxCorners, project, unprojectToPlaneZ, type Camera, type Vec3 } from '../src/components/display/caseCamera';
import { wallLayout } from '../src/components/display/packCabinets';
import { cabinetBox, type Box } from '../src/components/display/caseFraming';
import { wallPatternProfiles } from '../src/components/display/casePrefs';
import { DRAWN_CABINETS_LIMIT, DRAWN_FIGURES_LIMIT, FLAT_GRID, GRADIENT_GRID, MAX_DRAWN_CABINETS, nearestCabinets, trimFace } from '../src/components/display/caseCull';

/**
 * MOB-NAV-2: the case fits the Fold8's GPU tile budget. Chrome rasters a
 * layer under a perspective at no less than the device pixel ratio per
 * layer pixel, so every composited scene layer costs its own width x height
 * at 2.8125 whatever it draws on screen; the Fold8 ghosted the whole chrome
 * when the case cost some hundred viewports of tiles (MOB-NAV-1 680ff3f1).
 * Read from the compositor itself (CDP LayerTree), at the Fold8's four
 * panels, as the case opens, two swipes into the wall (its loaded middle)
 * and 40 swipes on (its far end), walking the camera or panning the wall:
 * at most the panel's cap of cabinets (CF1 a: as many as its full-height frame
 * shows fronts, from 5 up to DRAWN_CABINETS_LIMIT) and as many figures as those
 * cabinets hold (G1: Ross's 250 at five, scaled with them), nothing drawn that lies wholly outside the frame and half a viewport
 * round it, and the scene's layers at most 3 viewports of pixels; once the
 * swipe settles the case culls for the settled picture: the drawn cabinets are
 * the cap's nearest its centre. And the frame is framed to them (Ross 12:1xC):
 * it shows the fronts of at most the cabinets the case draws, every one drawn,
 * and no blank wall where a cabinet stands. Fixture mode, about 1,200 figures.
 *
 * The ceiling binds where the figures are dense: a wall of one small figure
 * (fx-spike, 35 mm wide, in every slot), and one denser still (framed at half
 * its labelled width) that once drew past the 250 the case capped it at. The
 * shelf view (walked), the cabinet view (as it opens) and a rack wall are held
 * to the same ceiling and cull to the frame and its margin. G1 and G3
 * (close-out 2): on both dense walls, labels on, every wall pattern (the
 * KLINGSBO, the Detolf, the mixed wall and the rack) in the wall, cabinet and
 * shelf views is held to the ceiling on its scene layers (every layer's area
 * logged), and no cabinet standing wholly inside the frame is drawn empty.
 */

test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: FOLD8_DPR });
// every test opens its own page: they run side by side on as many workers as the run has
test.describe.configure({ mode: 'parallel' });

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'runs in the chromium project');
});

/**
 * The loaded middle of the wall: a picture two swipes in draws at least this many figures; the sideways cover's
 * frame is 143 px tall, so the tops and the open shelves of its five cabinets lie past it and its margin (55 drawn).
 */
const MID_FIGURES = (panel: string) => (panel === 'fold8-cover-sideways' ? 50 : 60);
/** The scene's composited layers, in viewports of pixels at the device pixel ratio. */
const CEILING_VIEWPORTS = 3;
/** What the case may draw past the frame on each side, as a share of the frame. */
const MARGIN = 0.5;

type State = { name: string; swipe: 'camera' | 'pan'; swipes: number; view?: 'wall' | 'cabinet' | 'shelf'; pattern?: string };
const STATES: State[] = [
  { name: 'default', swipe: 'camera', swipes: 0 },
  { name: 'camera-2', swipe: 'camera', swipes: 2 },
  { name: 'pan-2', swipe: 'pan', swipes: 2 },
  { name: 'camera-40', swipe: 'camera', swipes: 40 },
  { name: 'pan-40', swipe: 'pan', swipes: 40 },
];

/** The fixture wall: about 1,200 figures of the seven fixtures, or of one in every slot (?fxonly). */
type Wall = { name: string; query: string };
const SPARSE: Wall = { name: 'fixtures', query: 'fx=170' };
const DENSE: Wall[] = [
  // a wall of one small figure: 35 mm wide, its cut-out drawn
  { name: 'spike wall', query: 'fx=170&fxonly=spike' },
  // denser: the same figure framed at half its width (17 mm), past the 250 the case once capped it at
  { name: 'spike wall at the 250 cap', query: 'fx=170&fxonly=spike&fxwidth=narrow&fxbranch=framed' },
];
const DENSE_STATES = STATES.filter((x) => x.swipes < 40);
/**
 * SHOULD 29: real users see the name plates (labels on unless in fixture mode): each plate is culled by its own box
 * and spends the figures' budget, so with labels on nothing is drawn past the frame and its margin either.
 */
const LABELLED: Wall[] = [
  { name: 'fixtures, labels on', query: 'fx=170&labels=1' },
  { name: 'spike wall, labels on', query: 'fx=170&fxonly=spike&labels=1' },
];
/**
 * The other views, and another wall, under the same ceiling (the shelf view cost 3.1-4.7 viewports before the figures'
 * budget: their pictures, close in), culled to the frame and its margin.
 */
/**
 * CULL-LEAK-1 (tracked): the KLINGSBO's open mesh shelf, a level face seen from above, is cut to a rectangle on the face
 * round what the frame and its margin see, wider at the back: its near corners reach past the margin. CF1 (a) draws
 * more cabinets on a wide panel, so up to two of them do (measured: the cabinet view as it opens and 40 swipes on).
 */
const MESH_SPILL_MAX = 2;
/**
 * G1 and G3 (close-out 2): every wall pattern on the two dense walls, labels on, as the wall view opens and two swipes
 * in, and as the cabinet and the shelf views open.
 */
const MIXED = 'ikea-klingsbo+ikea-detolf+open-steel-rack';
const PATTERNS = ['ikea-klingsbo', 'ikea-detolf', MIXED, 'open-steel-rack'];
const DENSE_LABELLED: Wall[] = [
  { name: 'spike wall, labels on', query: 'fx=170&fxonly=spike&labels=1' },
  { name: 'spike wall at the 250 cap, labels on', query: 'fx=170&fxonly=spike&fxwidth=narrow&fxbranch=framed&labels=1' },
];
const PATTERN_STATES: State[] = [
  { name: 'wall as it opens', view: 'wall', swipe: 'camera', swipes: 0 },
  { name: 'wall two swipes in', view: 'wall', swipe: 'camera', swipes: 2 },
  { name: 'cabinet view as it opens', view: 'cabinet', swipe: 'camera', swipes: 0 },
  { name: 'shelf view as it opens', view: 'shelf', swipe: 'camera', swipes: 0 },
];
const VIEW_STATES: State[] = [
  { name: 'shelf view walked', view: 'shelf', swipe: 'camera', swipes: 2 },
  { name: 'cabinet view as it opens', view: 'cabinet', swipe: 'camera', swipes: 0 },
  { name: 'rack wall as it opens', view: 'wall', pattern: 'open-steel-rack', swipe: 'camera', swipes: 0 },
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
    const { nodeIds: inFigures } = await cdp.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: '.cab-figure, .cab-figure *, .cab-shadow, .cab-plate',
    });
    const scene = new Set(inScene);
    const figures = new Set(inFigures);
    const sceneLayers = backed.filter((_, i) => scene.has(nodeIds[i]));
    const figureLayers = backed.filter((_, i) => figures.has(nodeIds[i]));
    const area = (ls: LayerTreeLayer[]) => ls.reduce((a, l) => a + l.width * l.height, 0);
    await cdp.send('LayerTree.disable');
    return { layers: drawing.length, area: area(drawing), sceneLayers: sceneLayers.length, sceneArea: area(sceneLayers), figureArea: area(figureLayers) };
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
  return page.locator('.cabinet-scene').evaluate((host, [margin, grid]) => {
    // the frame the picture is drawn in (CASE-FB1: centred in the scene, cropped narrower on a wide panel)
    const f = (host.querySelector('.cabinet-scene__frame') ?? host).getBoundingClientRect();
    const mx = f.width * margin;
    const my = f.height * margin;
    const outside: string[] = [];
    const spill: string[] = [];
    const at = (el: Element, r: DOMRect) => `${el.className} @${Math.round(r.left - f.left)},${Math.round(r.top - f.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
    for (const el of Array.from(host.querySelectorAll<HTMLElement>('.cabinet-scene__root .q'))) {
      // a figure draws its tap box and the picture hanging from it
      const art = el.matches('.cab-figure') ? el.querySelector('.cab-figure__box')?.getBoundingClientRect() : undefined;
      const own = el.getBoundingClientRect();
      const r = art
        ? new DOMRect(Math.min(own.left, art.left), Math.min(own.top, art.top), Math.max(own.right, art.right) - Math.min(own.left, art.left), Math.max(own.bottom, art.bottom) - Math.min(own.top, art.top))
        : own;
      if (r.right < f.left - mx || r.left > f.right + mx || r.bottom < f.top - my || r.top > f.bottom + my) outside.push(at(el, r));
      // a face on a texel grid (a flat colour or a gradient) costs its grid wherever its cut reaches
      const gridded = el.offsetWidth * el.offsetHeight <= grid;
      const face = !gridded && !el.matches('.cab-figure, .cab-shadow, .cab-plate, .room-wall, .room-floor, .room-ceiling');
      // 2 px for the rounding of a face cut at the margin
      if (face && (r.left < f.left - mx - 2 || r.right > f.right + mx + 2 || r.top < f.top - my - 2 || r.bottom > f.bottom + my + 2)) spill.push(at(el, r));
    }
    // the figures drawn coarser than the scene (past their budget, the farthest from the frame centre first), and how many of them the frame shows
    const s = Number(host.dataset.pxPerMm);
    const coarse = Array.from(host.querySelectorAll<HTMLElement>('button.cab-figure')).filter((b) => Number(b.style.getPropertyValue('--s')) < s);
    const coarseInFrame = coarse.filter((b) => {
      const r = b.getBoundingClientRect();
      return r.right > f.left && r.left < f.right && r.bottom > f.top && r.top < f.bottom;
    }).length;
    // each figure's layer in the world (its tap box and its clipped picture) and its px per mm, for SHOULD 28
    const layers = Array.from(host.querySelectorAll<HTMLElement>('button.cab-figure')).map((b) => {
      const art = b.querySelector<HTMLElement>('.cab-figure__box')!;
      // the browser writes the inset as short as it can (top, right = top, bottom = top, left = right)
      const v = (/^inset\((.*)\)$/.exec(art.style.clipPath)?.[1].trim().split(/\s+/) ?? ['0%']).map((x) => parseFloat(x) / 100);
      const right = v[1] ?? v[0];
      return { tap: JSON.parse(b.dataset.world!), art: JSON.parse(b.dataset.artBox!), right, left: v[3] ?? right, k: Number(b.style.getPropertyValue('--s')) };
    });
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
      cap: Number(host.dataset.drawnCap),
      figureCap: Number(host.dataset.figureCap),
      pattern: host.dataset.pattern ?? '',
      figures: host.querySelectorAll('button.cab-figure').length,
      plates: host.querySelectorAll('.cab-plate').length,
      quads: host.querySelectorAll('.cabinet-scene__root .q').length,
      outside,
      spill,
      cameraX: Number(host.dataset.cameraX),
      pan: Number(host.dataset.pan),
      coarse: coarse.length,
      coarseInFrame,
      layers,
    };
  }, [MARGIN, Math.max(FLAT_GRID.u * FLAT_GRID.v, GRADIENT_GRID.u * GRADIENT_GRID.v)] as const);
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
 * cabinets): the cabinets whose front (feet to top, splayed feet included, on the front plane) draws inside the
 * frame, those any part of which does (exact, face by face: a neighbour's back seen through the glass at the
 * frame's edge too), the cap's nearest its centre, the widest stretch inside the frame where the wall stands
 * but no drawn cabinet is drawn, and how wide (px) the widest neighbour not drawn shows, through the glass.
 */
function frameCheck(scene: Awaited<ReturnType<typeof drawn>>) {
  const c = scene.camera;
  const camera: Camera = { x: c.x, y: c.y, z: c.z, pitch: c.pitch, focalPx: c.focalPx, frame: { width: c.width, height: c.height } };
  const panPx = scene.pan;
  // the wall is its pattern's cabinets in turn; the scene publishes each one's box, so the two must agree
  const profiles = wallPatternProfiles(scene.pattern);
  const layout = wallLayout(scene.wall.map((_, i) => profiles[i % profiles.length]));
  const boxes = layout.cabinets.map((slot) => cabinetBox(slot, 0));
  const published = scene.wall.map(([x0, x1, y1, z0, z1]) => ({ x0, x1, y0: 0, y1, z0, z1 }));
  const rect = { x0: 0, x1: camera.frame.width, y0: 0, y1: camera.frame.height };
  const meets = ([a, u, v]: [Vec3, Vec3, Vec3]) => trimFace({ camera, panPx }, a, u, v, rect) !== null;
  const framed = boxes.flatMap((b, i) => (meets([[b.x0, b.y0, 0], [b.x1 - b.x0, 0, 0], [0, b.y1 - b.y0, 0]]) ? [i] : []));
  const seen = boxes.flatMap((b, i) => (faces(b).some(meets) ? [i] : []));
  // the cap's nearest; where two stand equally near (a walk settles midway between cabinets) either is: a pick that
  // favours the drawn ones by a hair (1e-4 of the frame) is the drawn ones themselves unless one is truly farther
  const nearest = nearestCabinets({ camera, panPx }, layout, scene.spans.map((x) => x.i), scene.cap, 1e-4);
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
  // a neighbour the frame sees only through the glass of the cabinets drawn, at its edge: how wide it shows
  const drawnIdx = new Set(scene.spans.map((s) => s.i));
  let throughGlass = 0;
  for (const i of seen.filter((k) => !drawnIdx.has(k))) {
    for (const [a, u, v] of faces(boxes[i])) {
      const t = trimFace({ camera, panPx }, a, u, v, rect);
      if (!t) continue;
      const xs = [t.s0, t.s1].flatMap((s) => [t.t0, t.t1].map((q) => project(camera, [a[0] + s * u[0] + q * v[0], a[1] + s * u[1] + q * v[1], a[2] + s * u[2] + q * v[2]]).x + panPx));
      throughGlass = Math.max(throughGlass, Math.min(camera.frame.width, Math.max(...xs)) - Math.max(0, Math.min(...xs)));
    }
  }
  // the cabinets whose body stands whole across the frame, side to side on the front plane at the height it aims at
  const lookY = unprojectToPlaneZ(camera, camera.frame.width / 2, camera.frame.height / 2, 0)?.[1] ?? 0;
  const whole = layout.cabinets.flatMap((slot, i) =>
    [slot.leftMm, slot.rightMm].every((x) => {
      const p = project(camera, [x, lookY, 0]).x + panPx;
      return p >= 0 && p <= camera.frame.width;
    })
      ? [i]
      : [],
  );
  // SHOULD 28: the figures drawn coarser lie farther from the frame centre than every one drawn finer (byFrameCentre:
  // the middle of each figure's layer, in the culled picture); how many finer ones lie farther out than a coarser one
  const cull: Camera = { ...camera, x: scene.cullX };
  const order = scene.layers.map(({ tap, art, left, right, k }) => {
    const artW = art.x1 - art.x0;
    const mid = project(cull, [(Math.min(tap.x0, art.x0 + left * artW) + Math.max(tap.x1, art.x1 - right * artW)) / 2, (tap.y0 + tap.y1) / 2, tap.z]);
    return { d: Math.hypot(mid.x + scene.cullPan - camera.frame.width / 2, mid.y - camera.frame.height / 2), k };
  });
  // a figure whose distance cannot be read counts against it too
  const coarseNearer = order.filter((a) => !Number.isFinite(a.d) || !(a.k > 0) || order.some((b) => b.k > a.k && b.d > a.d + 1e-3)).length;
  return { published, boxes, framed, seen, nearest, blank, narrowest, throughGlass, whole, coarseNearer };
}

/**
 * G1 (the challenger's C3): the figures drawn in each cabinet standing wholly inside the frame (side to side, at its
 * feet and at its top), by the middle of each figure's tap box; those drawn with none, and those drawn with fewer
 * than the most any cabinet of its kind shows.
 */
function fill(scene: Awaited<ReturnType<typeof drawn>>) {
  const c = scene.camera;
  const camera: Camera = { x: c.x, y: c.y, z: c.z, pitch: c.pitch, focalPx: c.focalPx, frame: { width: c.width, height: c.height } };
  const counts = scene.wall.map(([x0, x1]) => scene.layers.filter(({ tap }) => (tap.x0 + tap.x1) / 2 > x0 && (tap.x0 + tap.x1) / 2 < x1).length);
  const xAt = (x: number, y: number) => project(camera, [x, y, 0]).x + scene.pan;
  const whole = scene.wall.flatMap(([x0, x1, y1], i) =>
    Math.min(xAt(x0, 0), xAt(x0, y1)) >= 0 && Math.max(xAt(x1, 0), xAt(x1, y1)) <= camera.frame.width ? [i] : [],
  );
  const kinds = wallPatternProfiles(scene.pattern).length;
  const full = (i: number) => Math.max(...counts.filter((_, k) => k % kinds === i % kinds));
  return {
    whole,
    counts,
    empty: whole.filter((i) => counts[i] === 0),
    short: whole.filter((i) => counts[i] < full(i)).map((i) => `${i}:${counts[i]}/${full(i)}`),
  };
}

/**
 * Ruling 33: the widest stretch (px) of the frame where the wall stands, from where its camera and pan put the wall's
 * two ends (the published boxes, any wall), that no drawn cabinet covers as the browser draws it; and the narrowest
 * drawn cabinet.
 */
function wallCover(scene: Awaited<ReturnType<typeof drawn>>) {
  const c = scene.camera;
  const camera: Camera = { x: c.x, y: c.y, z: c.z, pitch: c.pitch, focalPx: c.focalPx, frame: { width: c.width, height: c.height } };
  const xs = (b: number[]) => boxCorners(b[0], b[1], 0, b[2], b[3], b[4]).map((p) => project(camera, p).x + scene.pan);
  const lo = Math.max(0, Math.min(...xs(scene.wall[0])));
  const hi = Math.min(camera.frame.width, Math.max(...xs(scene.wall[scene.wall.length - 1])));
  const spans = scene.spans.map((s) => [Math.max(lo, s.x0), Math.min(hi, s.x1)] as const).filter(([a, b]) => b > a);
  spans.sort((a, b) => a[0] - b[0]);
  let reach = lo;
  let blank = 0;
  for (const [a, b] of spans) {
    blank = Math.max(blank, a - reach);
    reach = Math.max(reach, b);
  }
  return { blank: Math.max(blank, hi - reach), narrowest: Math.min(...scene.spans.map((s) => s.x1 - s.x0)) };
}

/** Open the case at `size` in fixture mode, swipe it into `state`, and let it settle: what it draws, against its frame. */
async function settled(page: Page, size: { width: number; height: number }, state: State, wall: Wall = SPARSE) {
  await page.addInitScript((prefs) => {
    localStorage.setItem('onboarding_complete', '1');
    localStorage.setItem('fc-fixture-mode', 'on');
    localStorage.setItem('fc-case-prefs', JSON.stringify(prefs));
  }, { view: state.view ?? 'wall', swipe: state.swipe, ...(state.pattern ? { pattern: state.pattern } : {}) });
  await page.setViewportSize(size);
  const t0 = Date.now();
  await page.goto(`/?layout=case&${wall.query}`);
  await page.waitForSelector('button.cab-figure');
  // G1: a dense wall draws every figure its drawn cabinets hold (up to DRAWN_FIGURES_LIMIT), so its first picture
  // takes longer: how long is logged (loadMs)
  await expect(page.locator('#pre-splash')).toHaveCount(0, { timeout: 30_000 });
  const loadMs = Date.now() - t0;
  const x0 = Number(await page.locator('.cabinet-scene').getAttribute('data-camera-x'));
  for (let i = 0; i < state.swipes; i++) await swipe(page, -400);
  if (state.swipes > 0) {
    // the walk and the pan went down the wall: forty swipes a long way
    const past = state.swipes >= 40 ? x0 + 20_000 : x0;
    await expect.poll(async () => Number(await page.locator('.cabinet-scene').getAttribute('data-camera-x')) - Number(await page.locator('.cabinet-scene').getAttribute('data-pan'))).toBeGreaterThan(past);
  }
  await page.waitForTimeout(500);
  const scene = await drawn(page);
  return { scene, frame: frameCheck(scene), drawnSet: scene.spans.map((x) => x.i).sort((a, b) => a - b), loadMs };
}

/** What the scene draws and the layers it costs, logged and attached to the test. */
async function measured(page: Page, size: (typeof CASE_VIEWPORTS)[number], state: State, wall: Wall, testInfo: TestInfo) {
  const { scene, frame, drawnSet, loadMs } = await settled(page, size, state, wall);
  const layers = await compositedLayers(page);
  const viewport = size.width * size.height;
  const report = {
    wall: wall.name,
    state: state.name,
    viewport: size.name,
    dpr: FOLD8_DPR,
    cabinets: scene.cabinets,
    pattern: scene.pattern,
    loadMs,
    cap: scene.cap,
    figureCap: scene.figureCap,
    figures: scene.figures,
    plates: scene.plates,
    figuresCoarse: scene.coarse,
    figuresCoarseInFrame: scene.coarseInFrame,
    figuresCoarseNearer: frame.coarseNearer,
    quads: scene.quads,
    cameraX: scene.cameraX,
    pan: scene.pan,
    layers: layers.layers,
    sceneLayers: layers.sceneLayers,
    sceneLayerAreaPx: Math.round(layers.sceneArea),
    sceneLayerAreaViewports: Number((layers.sceneArea / viewport).toFixed(3)),
    figureLayerAreaViewports: Number((layers.figureArea / viewport).toFixed(3)),
    allLayerAreaViewports: Number((layers.area / viewport).toFixed(3)),
    sceneLayerDevicePx: Math.round(layers.sceneArea * FOLD8_DPR * FOLD8_DPR),
    outside: scene.outside.length,
    spill: scene.spill.length,
    drawnCabinets: drawnSet,
    framed: frame.framed,
    seen: frame.seen,
    nearest: frame.nearest,
    whole: frame.whole,
    blankPx: Math.round(frame.blank),
    throughGlassPx: Math.round(frame.throughGlass),
    cullX: scene.cullX,
    cullPan: scene.cullPan,
  };
  const filled = fill(scene);
  Object.assign(report, { whole: filled.whole, empty: filled.empty, short: filled.short });
  console.log(`case-budget ${JSON.stringify(report)}`);
  await testInfo.attach('case budget', { body: JSON.stringify({ ...report, outsideFirst: scene.outside.slice(0, 20), spillFirst: scene.spill.slice(0, 20) }, null, 1), contentType: 'application/json' });
  return { scene, frame, drawnSet, layers, viewport, filled };
}

/** G1: at most the panel's figure cap (what its drawn cabinets hold), itself at most the limit the budget was measured at. */
function figureChecks(scene: Awaited<ReturnType<typeof drawn>>) {
  expect.soft(scene.figures, 'figures drawn, at most the figure cap (G1)').toBeLessThanOrEqual(scene.figureCap);
  expect.soft(scene.figureCap, 'the figure cap, at most its limit').toBeLessThanOrEqual(DRAWN_FIGURES_LIMIT);
}

/** The tile budget of a wall view: cabinets and figures capped, the settled cull, nothing outside, the scene layers under the ceiling. */
function budgetChecks(m: Awaited<ReturnType<typeof measured>>, state: State) {
  const { scene, frame, drawnSet, layers, viewport } = m;
  figureChecks(scene);
  expect.soft(scene.cap, 'the panel\'s cap (CF1 a)').toBeGreaterThanOrEqual(MAX_DRAWN_CABINETS);
  expect.soft(scene.cap, 'the panel\'s cap (CF1 a)').toBeLessThanOrEqual(DRAWN_CABINETS_LIMIT);
  expect.soft(scene.cabinets, 'cabinets drawn').toBeLessThanOrEqual(scene.cap);
  // settled: the case culls for the picture it shows, not one from partway through the swipe
  expect.soft(scene.cullX, 'the cull is the settled camera').toBeCloseTo(scene.cameraX, 3);
  expect.soft(Math.round(scene.cullPan), 'the cull is the settled pan').toBe(scene.pan);
  // the scene publishes the wall the e2e checks against
  expect(frame.published.length).toBe(frame.boxes.length);
  frame.published.forEach((b, i) => {
    for (const k of ['x0', 'x1', 'y1', 'z0', 'z1'] as const) expect.soft(b[k], `cabinet ${i} ${k}`).toBeCloseTo(frame.boxes[i][k], 0);
  });
  // the drawn cabinets are the cap's nearest the settled frame centre
  expect.soft(drawnSet, 'the drawn cabinets are the cap\'s nearest the settled frame centre').toEqual(frame.nearest);
  expect.soft(scene.outside, 'scene elements wholly outside the frame and half a viewport round it').toEqual([]);
  // CULL-LEAK-1 (MESH_SPILL_MAX): full height (CASE-FB1) the wall view sees the mesh shelf from above too
  const mesh = scene.spill.filter((x) => x.startsWith('q m-mesh '));
  expect.soft(scene.spill.filter((x) => !mesh.includes(x)), 'faces reaching past the frame and half a viewport round it').toEqual([]);
  expect.soft(mesh.length, 'mesh shelves reaching past it (CULL-LEAK-1)').toBeLessThanOrEqual(MESH_SPILL_MAX);
  // a settled walk or pan stands at least three cabinets whole (Ross 12:1xC, desk MN2 a; NOTE 31); at the wall's end
  // (close-out 3, ruling 27) it stands its end cabinet whole (CF1 a: the whole panel again, so two swipes never reach it)
  if (state.swipes > 0 && (state.view ?? 'wall') === 'wall') {
    const last = frame.boxes.length - 1;
    if (frame.framed.includes(last) && state.swipes >= 40) expect.soft(frame.whole, 'the wall\'s end cabinet whole').toContain(last);
    else expect.soft(frame.whole.length, `cabinets whole across the frame: ${frame.whole.join(',')}`).toBeGreaterThanOrEqual(3);
  }
  // SHOULD 28: the coarser figures are the outermost
  expect.soft(frame.coarseNearer, 'figures drawn finer than one nearer the frame centre').toBe(0);
  expect(layers.sceneArea / viewport, 'the scene layers, in viewports of pixels').toBeLessThanOrEqual(CEILING_VIEWPORTS);
}

for (const size of CASE_VIEWPORTS.filter((v) => v.name.startsWith('fold8'))) {
  for (const wall of DENSE) {
    for (const state of DENSE_STATES) {
      test(`a dense wall fits the tile budget too, its figures' cost bounded wherever the camera stands: ${wall.name}, ${state.name}, ${size.name}`, async ({ page }, testInfo) => {
        test.setTimeout(180_000);
        const m = await measured(page, size, state, wall, testInfo);
        expect(m.scene.figures, 'figures are drawn').toBeGreaterThan(0);
        // G1: no cabinet standing wholly inside the frame is drawn empty (the old 250 left the outer ones bare)
        expect.soft(m.filled.empty, 'cabinets wholly inside the frame drawn with no figure').toEqual([]);
        budgetChecks(m, state);
      });
    }
  }

  for (const wall of LABELLED) {
    for (const state of [...DENSE_STATES, ...VIEW_STATES]) {
      test(`${wall.name}: ${state.name} draws no plate past the frame and its margin, its layers <= ${CEILING_VIEWPORTS} viewports: ${size.name}`, async ({ page }, testInfo) => {
        test.setTimeout(180_000);
        const { scene, layers, viewport } = await measured(page, size, state, wall, testInfo);
        expect(scene.figures, 'figures are drawn').toBeGreaterThan(0);
        expect(scene.plates, 'name plates are drawn').toBeGreaterThan(0);
        expect.soft(scene.outside, 'scene elements wholly outside the frame and half a viewport round it').toEqual([]);
        const mesh = scene.spill.filter((x) => x.startsWith('q m-mesh '));
        expect.soft(scene.spill.filter((x) => !mesh.includes(x)), 'faces reaching past the frame and half a viewport round it').toEqual([]);
        expect.soft(mesh.length, 'mesh shelves reaching past it (CULL-LEAK-1)').toBeLessThanOrEqual(MESH_SPILL_MAX);
        expect.soft(frameCheck(scene).coarseNearer, 'figures drawn finer than one nearer the frame centre').toBe(0);
        expect(layers.sceneArea / viewport, 'the scene layers, in viewports of pixels').toBeLessThanOrEqual(CEILING_VIEWPORTS);
      });
    }
  }

  for (const pattern of PATTERNS) {
    for (const wall of DENSE_LABELLED) {
      for (const at of PATTERN_STATES) {
        const state: State = { ...at, pattern };
        test(`every pattern on a dense wall: no cabinet wholly in the frame drawn empty, scene layers <= ${CEILING_VIEWPORTS} viewports: ${pattern}, ${wall.name}, ${at.name}, ${size.name}`, async ({ page }, testInfo) => {
          test.setTimeout(180_000);
          const { scene, layers, viewport, filled } = await measured(page, size, state, wall, testInfo);
          expect(scene.pattern).toBe(pattern);
          expect(scene.figures, 'figures are drawn').toBeGreaterThan(0);
          figureChecks(scene);
          expect.soft(scene.cabinets, 'cabinets drawn').toBeLessThanOrEqual(scene.cap);
          expect.soft(filled.empty, `cabinets wholly inside the frame drawn with no figure (counts ${filled.counts.join(',')})`).toEqual([]);
          expect.soft(scene.outside, 'scene elements wholly outside the frame and half a viewport round it').toEqual([]);
          const mesh = scene.spill.filter((x) => x.startsWith('q m-mesh '));
          expect.soft(scene.spill.filter((x) => !mesh.includes(x)), 'faces reaching past the frame and half a viewport round it').toEqual([]);
          expect.soft(mesh.length, 'mesh shelves reaching past it (CULL-LEAK-1)').toBeLessThanOrEqual(MESH_SPILL_MAX);
          expect.soft(frameCheck(scene).coarseNearer, 'figures drawn finer than one nearer the frame centre').toBe(0);
          // the ruled metric: the scene's layers; every layer's area is logged with it (allLayerAreaViewports)
          expect(layers.sceneArea / viewport, 'the scene layers, in viewports of pixels').toBeLessThanOrEqual(CEILING_VIEWPORTS);
        });
      }
    }
  }

  // G1: the densest wall the fixtures make (one 17 mm figure in every slot, 1,750 of them, labels on): on the sideways
  // cover the drawn cabinets hold DRAWN_FIGURES_LIMIT, the most the scene was measured drawing under the ceiling
  for (const view of ['wall', 'cabinet'] as const) {
    test(`the densest wall: at most DRAWN_FIGURES_LIMIT figures, none of the cabinets wholly in the frame empty, scene layers <= ${CEILING_VIEWPORTS} viewports, ${view} view: ${size.name}`, async ({ page }, testInfo) => {
      test.setTimeout(240_000);
      const wall: Wall = { name: 'densest wall, labels on', query: 'fx=250&fxonly=spike&fxwidth=narrow&fxbranch=framed&labels=1' };
      const { scene, layers, viewport, filled } = await measured(page, size, { name: `densest ${view}`, view, swipe: 'camera', swipes: 0 }, wall, testInfo);
      figureChecks(scene);
      if (size.name === 'fold8-cover-sideways' && view === 'wall') expect.soft(scene.figureCap, 'the sideways cover\'s fifteen KLINGSBOs hold the limit').toBe(DRAWN_FIGURES_LIMIT);
      expect.soft(filled.empty, `cabinets wholly inside the frame drawn with no figure (counts ${filled.counts.join(',')})`).toEqual([]);
      expect(layers.sceneArea / viewport, 'the scene layers, in viewports of pixels').toBeLessThanOrEqual(CEILING_VIEWPORTS);
    });
  }

  for (const state of VIEW_STATES) {
    test(`${state.name} costs no more than ${CEILING_VIEWPORTS} viewports of scene layers and draws nothing past the frame and its margin: ${size.name}`, async ({ page }, testInfo) => {
      test.setTimeout(180_000);
      const { scene, layers, viewport } = await measured(page, size, state, SPARSE, testInfo);
      expect(scene.figures, 'figures are drawn').toBeGreaterThan(0);
      figureChecks(scene);
      expect.soft(scene.cabinets, 'cabinets drawn').toBeLessThanOrEqual(scene.cap);
      expect.soft(scene.outside, 'scene elements wholly outside the frame and half a viewport round it').toEqual([]);
      const mesh = scene.spill.filter((x) => x.startsWith('q m-mesh '));
      expect.soft(scene.spill.filter((x) => !mesh.includes(x)), 'faces reaching past the frame and half a viewport round it').toEqual([]);
      expect.soft(mesh.length, 'mesh shelves reaching past it (CULL-LEAK-1)').toBeLessThanOrEqual(MESH_SPILL_MAX);
      expect.soft(frameCheck(scene).coarseNearer, 'figures drawn finer than one nearer the frame centre').toBe(0);
      expect(layers.sceneArea / viewport, 'the scene layers, in viewports of pixels').toBeLessThanOrEqual(CEILING_VIEWPORTS);
    });
  }

  for (const state of STATES) {
    test(`the case fits the tile budget: at most its cap of cabinets and of figures, the cap's nearest the settled frame centre, layers <= ${CEILING_VIEWPORTS} viewports: ${state.name}, ${size.name}`, async ({ page }, testInfo) => {
      test.setTimeout(180_000);
      const m = await measured(page, size, state, SPARSE, testInfo);
      const { scene } = m;
      // the far end of the wall may stand empty; as it opens and in its middle figures are drawn
      if (state.swipes < 40) expect(scene.figures, 'figures are drawn').toBeGreaterThan(0);
      else expect(scene.cabinets, 'cabinets are drawn').toBeGreaterThan(0);
      if (state.swipes === 2) expect.soft(scene.figures, 'the loaded middle of the wall').toBeGreaterThanOrEqual(MID_FIGURES(size.name));
      budgetChecks(m, state);
    });

    test(`the frame shows the fronts of at most the cabinets drawn, every one drawn, no blank wall where one stands: ${state.name}, ${size.name}`, async ({ page }) => {
      test.setTimeout(180_000);
      const { scene, frame, drawnSet } = await settled(page, size, state);
      expect.soft(frame.framed.length, `cabinet fronts the frame shows: ${frame.framed.join(',')}`).toBeLessThanOrEqual(scene.cap);
      expect.soft(frame.framed.filter((i) => !drawnSet.includes(i)), 'cabinets the frame shows but the case does not draw').toEqual([]);
      expect(frame.blank, `blank wall inside the frame where a cabinet stands (px; a cabinet is ${Math.round(frame.narrowest)} px)`).toBeLessThan(frame.narrowest / 2);
    });
  }

  // close-out 4, ruling 33: a press of Next or Prev (the button taking focus) once scrolled the scene's clipped overflow
  // sideways, so the picture and the pager slid ~200 px off the frame and half of it showed bare wall while the camera
  // it reported stayed right; the scene never scrolls, its picture is drawn where its camera and pan put it, and its
  // cabinets cover the frame wherever the wall stands in it. The mixed wall, pressed as soon as the case shows (the
  // challenger's repro: 2 runs in 5)
  for (const mode of ['camera', 'pan'] as const) {
    test(`swipes and presses never scroll the scene: its cabinets fill the frame where its camera puts them, ${mode} mode: ${size.name}`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.addInitScript((prefs) => {
        localStorage.setItem('onboarding_complete', '1');
        localStorage.setItem('fc-fixture-mode', 'on');
        localStorage.setItem('fc-case-prefs', JSON.stringify(prefs));
      }, { view: 'wall', swipe: mode, pattern: 'ikea-klingsbo+ikea-detolf+open-steel-rack' });
      await page.setViewportSize(size);
      // a wall long enough for the steps' pages (CF1 a: a wide panel's page holds a dozen cabinets)
      await page.goto('/?layout=case&fx=170');
      await page.waitForSelector('button.cab-figure');
      const host = page.locator('.cabinet-scene');
      const next = page.getByRole('button', { name: 'Next cabinet' });
      const prev = page.getByRole('button', { name: 'Previous cabinet' });
      const steps: [string, () => Promise<void>][] = [
        ['Next', () => next.click()],
        ['Next', () => next.click()],
        ['swipe -150', () => swipe(page, -150)],
        ['Next', () => next.click()],
        ['Prev', () => prev.click()],
        ['swipe 200', () => swipe(page, 200)],
        ['Prev', () => prev.click()],
        ['swipe -400', () => swipe(page, -400)],
        ['Next', () => next.click()],
      ];
      for (const [k, [name, step]] of steps.entries()) {
        await step();
        await page.waitForTimeout(200);
        const at = `step ${k} ${name}`;
        const placed = await host.evaluate((h) => {
          const f = h.getBoundingClientRect();
          const left = (sel: string) => h.querySelector(sel)!.getBoundingClientRect().left - f.left;
          // the picture slides within the frame it is drawn in (CASE-FB1: centred, cropped on a wide panel)
          return { scroll: [h.scrollLeft, h.scrollTop], picture: left('.cabinet-scene__viewport') - left('.cabinet-scene__frame'), prev: left('.cabinet-scene__step--prev') };
        });
        const scene = await drawn(page);
        expect.soft(placed.scroll, `${at}: the scene scrolled`).toEqual([0, 0]);
        expect.soft(placed.picture, `${at}: the picture's left edge against its pan ${scene.pan}`).toBeCloseTo(scene.pan, 0);
        expect.soft(placed.prev, `${at}: the Previous button's left edge`).toBeCloseTo(4, 0);
        const { blank, narrowest } = wallCover(scene);
        expect.soft(blank, `${at}: bare wall inside the frame where the wall stands (px; a cabinet is ${Math.round(narrowest)} px)`).toBeLessThan(narrowest / 2);
      }
    });
  }
}

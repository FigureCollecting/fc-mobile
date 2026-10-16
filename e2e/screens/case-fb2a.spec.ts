// CASE-FB2a on the local full stack (Ross 10-16 morning, after seeing his real collection on the Fold8): user C's
// 8 Ordered and 40 Wished with their images (FB-QUICK's holdings, IMG-SHOW-1's image doubles; heldCase.ts), in the
// case view at the Fold8's cover and open panels, labels on (as for every real user):
//   (a) a filter to Ordered, from the wall's start and again after a walk to its far end: the 8 are packed alone from
//       the wall's start, in the order the full wall had them, with no gap (a shelf left empty only when the next
//       figure is too tall for it; a later cabinet opened only for a top, when no shelf takes a figure), and the view
//       starts again at the wall's start, every one of the 8 drawn in the frame; the filter cleared, the full layout
//       returns as it was, from the wall's start; a tap still opens a figure;
//   (b) the labels: one line high (the plate is the line plus at most 3 px each side), a brass plate, and nothing
//       of the case covers a label at its centre (elementFromPoint, with every face of the case hit-testable); a 4x
//       pinch close-up of the lowest row of the first cabinet;
//   (c) each figure's base is centred in its surface's usable depth, the picture standing at the base's front.
// On 4d3333b3 (develop): every label 30 mm on an 11 mm line, flat beige; the KLINGSBO floor's labels covered at their
// centre by its steel front (div.q.m-steel.f-front), the label 3 mm behind it; no figure said where its base stood
// (its picture stood at the middle of the depth); and Ordered after a walk drew none of the 8 (an empty room past the
// one-cabinet wall, data-focus 3). Ordered from the wall's start was already packed alone, without gaps.
import { expect, test } from '../fixtures';
import type { Page, TestInfo } from '@playwright/test';
import { SHOT_VIEWPORTS } from '../caseViewports';
import { shotSizeError, signoffShot } from '../signoffShots';
import { touchDown, touchPinch, touchTap } from '../touch';
import { surfaceSlots } from '../../src/components/display/packCabinets';
import { IKEA_KLINGSBO } from '../../src/components/display/cabinetPresets';
import { HELD_ORDERED, HELD_WISHED, heldImages, heldStack, openHeld, showHoldings, type HeldStack } from './heldCase';

/** A label's padding above and below its line, at most (CSS px on screen; Ross: "fairly minimal space"). */
const LABEL_PAD_MAX_PX = 3;
/** World lengths compared within this (mm). */
const MM = 0.5;

let held: HeldStack;

test.describe.configure({ mode: 'default' });

test.beforeAll(async () => {
  test.setTimeout(240_000);
  held = await heldStack();
});

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem('onboarding_complete', '1'));
  await held.stack.edge.clearFaults();
  await held.stack.issuer.configure({ accessTokenTtlSeconds: 600, offlineAccess: true });
});

interface Placed {
  id: string;
  /** Its place in the list the case shows (the sort order), when the scene gives it. */
  index: number | null;
  /** The cabinet it stands in (by the wall's boxes). */
  cab: number;
  /** Its surface's top, mm. */
  surface: number;
  x0: number;
  x1: number;
  heightMm: number;
  /** The picture's plane. */
  z: number;
  /** Its base's front and back and the surface's usable depth (CASE-FB2a), when the scene gives them. */
  depth: { front: number; back: number; slotFront: number; slotBack: number } | null;
}

/** Every figure the case draws now, where it stands. */
const placements = (page: Page): Promise<Placed[]> =>
  page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('.cabinet-scene')!;
    const wall = JSON.parse(host.dataset.wall!) as number[][];
    return Array.from(document.querySelectorAll<HTMLElement>('button.cab-figure')).map((b) => {
      const w = JSON.parse(b.dataset.world!) as { x0: number; x1: number; y0: number; y1: number; z: number; surface: number };
      const cx = (w.x0 + w.x1) / 2;
      return {
        id: b.dataset.figureId!,
        index: b.dataset.index === undefined ? null : Number(b.dataset.index),
        cab: wall.findIndex((c) => cx >= c[0]! && cx <= c[1]!),
        surface: w.surface,
        x0: w.x0,
        x1: w.x1,
        heightMm: w.y1 - w.y0,
        z: w.z,
        depth: b.dataset.depth ? (JSON.parse(b.dataset.depth) as Placed['depth']) : null,
      };
    });
  });

const scene = (page: Page) => page.locator('.cabinet-scene');
const camera = async (page: Page) => JSON.parse((await scene(page).getAttribute('data-camera'))!) as { x: number; y: number; z: number };

/** Every figure drawn is grounded on its read picture, and where they stand no longer changes. */
async function settled(page: Page): Promise<Placed[]> {
  let last = '';
  await expect
    .poll(
      async () => {
        const grounded = await page.locator('button.cab-figure').evaluateAll((bs) => bs.length > 0 && bs.every((b) => (b as HTMLElement).dataset.grounded === '1'));
        const now = JSON.stringify(await placements(page));
        const same = grounded && now === last;
        last = now;
        return same;
      },
      { timeout: 60_000, intervals: [500] },
    )
    .toBe(true);
  return JSON.parse(last) as Placed[];
}

/** Reading order: cabinet, then its surfaces top to bottom, each left to right. */
const reading = (a: Placed, b: Placed) => a.cab - b.cab || b.surface - a.surface || a.x0 - b.x0;

/**
 * Where the filtered figures leave a gap along the wall (the packer's rules, design v3 and CC9): the shelves, cabinet
 * by cabinet and each top to bottom, are filled in turn, a shelf left empty only when the figure that comes next is
 * too tall for it; a top past the first cabinet holds a figure no shelf takes (too tall for every one), unless the
 * shelves have reached its cabinet.
 */
function gaps(all: readonly Placed[], ceilingMm: number): string[] {
  const slots = surfaceSlots(IKEA_KLINGSBO, ceilingMm);
  const shelfSlots = slots.filter((s) => !s.isTop);
  const tallestShelf = Math.max(...shelfSlots.map((s) => s.maxHeightMm));
  const cabinets = Math.max(0, ...all.map((p) => p.cab)) + 1;
  const shelves = Array.from({ length: cabinets }, (_, cab) =>
    shelfSlots.map((slot) => ({ cab, slot, on: all.filter((p) => p.cab === cab && Math.abs(p.surface - slot.topMm) < MM).sort(reading) })),
  ).flat();
  const lastUsed = shelves.reduce((m, s, k) => (s.on.length > 0 ? k : m), -1);
  const out: string[] = [];
  for (let k = 0; k < lastUsed; k++) {
    if (shelves[k]!.on.length > 0) continue;
    const next = shelves.slice(k + 1).find((s) => s.on.length > 0)!.on[0]!;
    const { cab, slot } = shelves[k]!;
    if (next.heightMm <= slot.maxHeightMm + MM) out.push(`cabinet ${cab}'s shelf at ${slot.topMm} mm is empty, yet ${next.id} (${next.heightMm} mm) fits it`);
  }
  const shelvesReach = lastUsed < 0 ? 0 : shelves[lastUsed]!.cab;
  const top = slots.find((s) => s.isTop)!;
  for (const p of all.filter((x) => x.cab > shelvesReach && Math.abs(x.surface - top.topMm) < MM)) {
    if (p.heightMm <= tallestShelf + MM) out.push(`${p.id} (${p.heightMm} mm) stands on cabinet ${p.cab}'s top, yet a shelf takes it`);
  }
  return out;
}

interface LabelProbe {
  id: string;
  text: string;
  /** On screen, CSS px. */
  box: { x: number; y: number; width: number; height: number };
  /** In the plate's own px: its height, its line's, and its padding above and below. */
  heightPx: number;
  linePx: number;
  padTopPx: number;
  padBottomPx: number;
  /** Screen px per plate px, up and down. */
  scaleY: number;
  background: string;
  color: string;
  /** What elementFromPoint finds at its centre: the label itself, a face of the case (its classes), or an overlay. */
  at: string;
  hit: 'label' | 'case' | 'overlay' | 'off';
}

/**
 * Each label in the frame: its box and line, and what is drawn at its centre with every face of the case made
 * hit-testable (the case's faces take no pointer events, so elementFromPoint would see through them).
 */
async function probeLabels(page: Page): Promise<LabelProbe[]> {
  return page.evaluate(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('.cabinet-scene__root, .cabinet-scene__root * { pointer-events: auto !important; }');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    try {
      const frame = document.querySelector('.cabinet-scene__frame')!.getBoundingClientRect();
      const root = document.querySelector('.cabinet-scene__root')!;
      return Array.from(document.querySelectorAll<HTMLElement>('.cab-plate')).map((plate) => {
        const face = plate.querySelector<HTMLElement>('.cab-plate__face') ?? plate;
        const r = face.getBoundingClientRect();
        const cs = getComputedStyle(face);
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        const inFrame = cx > frame.left && cx < frame.right && cy > frame.top && cy < frame.bottom;
        const el = inFrame ? document.elementFromPoint(cx, cy) : null;
        const hit = !inFrame ? 'off' : el && (el === face || face.contains(el) || el === plate) ? 'label' : el && root.contains(el) ? 'case' : 'overlay';
        const lh = cs.lineHeight === 'normal' ? parseFloat(cs.fontSize) * 1.2 : parseFloat(cs.lineHeight);
        return {
          id: plate.dataset.figureId!,
          text: face.textContent ?? '',
          box: { x: r.x, y: r.y, width: r.width, height: r.height },
          heightPx: face.offsetHeight,
          linePx: lh,
          padTopPx: parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth),
          padBottomPx: parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth),
          scaleY: face.offsetHeight > 0 ? r.height / face.offsetHeight : 0,
          background: `${cs.backgroundImage} ${cs.backgroundColor}`,
          color: cs.color,
          at: el ? `${el.tagName.toLowerCase()}.${Array.from(el.classList).join('.')}` : 'none',
          hit,
        } as const;
      });
    } finally {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
    }
  });
}

/** What is wrong with the labels in view (one line, padding, brass, uncovered). */
function labelFaults(labels: readonly LabelProbe[]): string[] {
  const out: string[] = [];
  for (const l of labels.filter((x) => x.hit !== 'off')) {
    const name = `${l.id} "${l.text}"`;
    if (l.heightPx > l.linePx + l.padTopPx + l.padBottomPx + 0.5) out.push(`${name}: ${l.heightPx} px high, more than its line (${l.linePx}) and padding`);
    if (l.heightPx > 2 * l.linePx) out.push(`${name}: ${l.heightPx} px high, more than one line of ${l.linePx}`);
    for (const [side, px] of [['top', l.padTopPx], ['bottom', l.padBottomPx]] as const) {
      if (px * l.scaleY > LABEL_PAD_MAX_PX) out.push(`${name}: ${(px * l.scaleY).toFixed(1)} px of padding at its ${side} on screen`);
    }
    if (!/gradient/.test(l.background)) out.push(`${name}: not a brass plate (${l.background})`);
    if (l.hit === 'case') out.push(`${name}: covered at its centre by ${l.at}`);
  }
  return out;
}

/** What is wrong with where the figures stand in depth (CASE-FB2a item 3). */
function depthFaults(all: readonly Placed[]): string[] {
  const out: string[] = [];
  for (const p of all) {
    if (!p.depth) {
      out.push(`${p.id}: the scene gives no base depth (picture plane at z ${p.z})`);
      continue;
    }
    const { front, back, slotFront, slotBack } = p.depth;
    const off = (front + back) / 2 - (slotFront + slotBack) / 2;
    if (Math.abs(off) > MM && front - back <= slotFront - slotBack) out.push(`${p.id}: its base is ${off.toFixed(1)} mm off the middle of its surface`);
    if (Math.abs(p.z - front) > MM) out.push(`${p.id}: its picture stands at z ${p.z}, not its base's front ${front}`);
    if (front > slotFront + MM) out.push(`${p.id}: its base's front ${front} is past the surface's front ${slotFront}`);
  }
  return out;
}

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const panel = SHOT_VIEWPORTS.find((v) => testInfo.project.name.endsWith(v.name.replace(/-full$/, '')))!;
  await page.waitForTimeout(300);
  const png = await signoffShot(page, testInfo, name);
  expect(shotSizeError(png, panel.png), png.path).toBeUndefined();
}

/** A close-up of the labels: the band round the lowest row of labels in the frame, at the device's pixels. */
async function labelCloseUp(page: Page, testInfo: TestInfo, labels: readonly LabelProbe[], name: string): Promise<void> {
  const shown = labels.filter((l) => l.hit !== 'off');
  if (shown.length === 0) return;
  const frame = (await page.locator('.cabinet-scene__frame').boundingBox())!;
  const y = Math.max(...shown.map((l) => l.box.y + l.box.height / 2));
  const top = Math.max(frame.y, y - 70);
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, clip: { x: frame.x, y: top, width: frame.width, height: Math.min(140, frame.y + frame.height - top) }, scale: 'device' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

/** The Ordered figures the case draws in the frame (each one's tap box centred in it). */
const inFrame = async (page: Page): Promise<string[]> => {
  const frame = (await page.locator('.cabinet-scene__frame').boundingBox())!;
  return page.locator('button.cab-figure').evaluateAll(
    (bs, f) =>
      bs
        .filter((b) => {
          const r = b.getBoundingClientRect();
          const cx = r.x + r.width / 2;
          const cy = r.y + r.height / 2;
          return cx > f.x && cx < f.x + f.width && cy > f.y && cy < f.y + f.height;
        })
        .map((b) => (b as HTMLElement).dataset.figureId!),
    frame,
  );
};

/** Where each figure stands, by id: its cabinet, surface and left edge. */
const where = (all: readonly Placed[]) => Object.fromEntries([...all].sort(reading).map((p) => [p.id, `${p.cab}/${p.surface}/${p.x0.toFixed(1)}`]));

/**
 * A close-up of the labels as Ross would look: a 4x pinch (PINCH-1) about the label lowest in the first cabinet
 * (the cabinet floor's, which its steel front hid on 4d3333b3), the frame shot once the zoom has settled.
 */
async function zoomedLabels(page: Page, testInfo: TestInfo, labels: readonly LabelProbe[], name: string): Promise<void> {
  const frame = (await page.locator('.cabinet-scene__frame').boundingBox())!;
  const firstCab = labels.filter((l) => l.hit !== 'off' && l.box.x + l.box.width / 2 < frame.x + frame.width / 2);
  if (firstCab.length === 0) return;
  const low = firstCab.reduce((a, b) => (b.box.y > a.box.y ? b : a));
  const m = { x: low.box.x + low.box.width / 2, y: low.box.y + low.box.height / 2 };
  await touchPinch(page, { x: m.x - 20, y: m.y }, { x: m.x + 20, y: m.y }, { x: m.x - 80, y: m.y }, { x: m.x + 80, y: m.y });
  await expect(page.locator('.cabinet-scene__zoom--live')).toHaveCount(0);
  await page.waitForTimeout(600);
  testInfo.annotations.push({ type: `${name} zoom`, description: (await scene(page).getAttribute('data-zoom')) ?? '' });
  await shot(page, testInfo, name);
}

/** A walk along the wall to its far end: sideways swipes until the camera stops. */
async function walkToEnd(page: Page): Promise<void> {
  const box = (await scene(page).boundingBox())!;
  for (let i = 0; i < 8; i++) {
    const before = (await camera(page)).x;
    // the finger comes to rest before it lifts: a lift on the move flings, and Chrome swallows the next tap to stop it
    const finger = await touchDown(page, box.x + box.width * 0.8, box.y + box.height * 0.5);
    await finger.to(box.x + box.width * 0.2, box.y + box.height * 0.5);
    await page.waitForTimeout(150);
    await finger.end();
    await page.waitForTimeout(300);
    if ((await camera(page)).x === before) break;
  }
}

test('(a) filtered to Ordered, from the start and after a walk, the 8 are packed alone from the wall\'s start with no gap and are in view; cleared, the full layout returns; (b) labels; (c) depth', async ({ context, page }, testInfo) => {
  test.setTimeout(300_000);
  const soft = expect.configure({ soft: true });
  await heldImages(context, page, held.heads);
  await openHeld(page, held);

  // the full wall: every holding C has
  await showHoldings(page, ['Ordered', 'Wished']);
  await expect(page.locator('button.cab-figure').first()).toBeVisible({ timeout: 30_000 });
  const full = await settled(page);
  const startCamera = await camera(page);
  const ceilingMm = (JSON.parse((await scene(page).getAttribute('data-room'))!) as { ceilingMm: number }).ceilingMm;
  testInfo.annotations.push({
    type: 'full wall',
    description: JSON.stringify({ drawn: full.length, cabinets: new Set(full.map((p) => p.cab)).size, camera: startCamera, pxPerMm: await scene(page).getAttribute('data-px-per-mm') }),
  });
  await shot(page, testInfo, 'fb2a-wall');

  // (b) the labels on the full wall
  const labels = await probeLabels(page);
  testInfo.annotations.push({
    type: 'labels',
    description: JSON.stringify(
      labels
        .filter((l) => l.hit !== 'off')
        .map(({ id, text, heightPx, linePx, padTopPx, padBottomPx, scaleY, at, hit }) => ({ id, text, heightPx, linePx, padTopPx, padBottomPx, scaleY: Number(scaleY.toFixed(3)), at, hit })),
    ),
  });
  soft(labels.filter((l) => l.hit !== 'off').length, 'labels in the frame').toBeGreaterThan(4);
  soft(labelFaults(labels), 'labels').toEqual([]);
  await labelCloseUp(page, testInfo, labels, 'fb2a-labels');
  // (the filter below starts the picture at 1x again: PINCH-1)
  await zoomedLabels(page, testInfo, labels, 'fb2a-labels-zoom');

  // (c) depth on the full wall
  soft(depthFaults(full), 'depth').toEqual([]);

  // (a) filtered to Ordered from the wall's start: packed alone, in the full wall's order, from the first cabinet
  await showHoldings(page, ['Ordered']);
  await expect(page.locator('button.cab-figure'), 'the Ordered are drawn').toHaveCount(HELD_ORDERED, { timeout: 30_000 });
  const ordered = await settled(page);
  testInfo.annotations.push({ type: 'ordered', description: JSON.stringify(where(ordered)) });
  await shot(page, testInfo, 'fb2a-ordered');
  soft([...(await inFrame(page))].sort(), 'every Ordered figure is drawn in the frame').toEqual([...held.ordered].sort());
  // from the wall's start: the first cabinet's shelves first; a later cabinet only for a top no shelf can stand in for
  soft(ordered.filter((p) => p.cab === 0).length, 'the first cabinet holds Ordered figures').toBeGreaterThan(0);
  soft(gaps(ordered, ceilingMm), 'no gap along the wall').toEqual([]);
  // in the full wall's sort order: the list the case packs keeps the order the figures had in the full one
  const byIndex = (all: readonly Placed[]) => [...all].sort((a, b) => (a.index ?? -1) - (b.index ?? -1)).map((p) => p.id);
  soft(ordered.every((p) => p.index !== null), 'the scene gives each figure its place in the list').toBe(true);
  // (of those the full wall draws in its first view: the cover's leaves some past the frame undrawn)
  const both = (id: string) => full.some((p) => p.id === id) && ordered.some((p) => p.id === id);
  soft(byIndex(ordered).filter(both), "in the full wall's order").toEqual(byIndex(full).filter(both));
  soft(depthFaults(ordered), 'depth, filtered').toEqual([]);
  const orderedLabels = await probeLabels(page);
  soft(labelFaults(orderedLabels), 'labels, filtered').toEqual([]);
  await labelCloseUp(page, testInfo, orderedLabels, 'fb2a-labels-ordered');

  // cleared: the full layout returns
  await showHoldings(page, ['Ordered', 'Wished']);
  await expect(page.locator('button.cab-figure').first()).toBeVisible({ timeout: 30_000 });
  soft(where(await settled(page)), 'the full layout returns').toEqual(where(full));

  // a walk to the wall's far end, then Ordered again: the view starts again at the wall's start, the 8 in it
  await walkToEnd(page);
  const walked = await camera(page);
  testInfo.annotations.push({ type: 'walked', description: JSON.stringify(walked) });
  expect(walked.x, 'the walk moved the camera along the wall').toBeGreaterThan(startCamera.x);
  await showHoldings(page, ['Ordered']);
  await page.waitForTimeout(500);
  await shot(page, testInfo, 'fb2a-ordered-after-walk');
  // on 4d3333b3 the camera stayed where the walk left it, past the one cabinet they fill: an empty room, none drawn
  await soft(page.locator('button.cab-figure'), 'the Ordered are drawn after a walk').toHaveCount(HELD_ORDERED, { timeout: 15_000 });
  soft([...(await inFrame(page))].sort(), 'every Ordered figure is in the frame after a walk').toEqual([...held.ordered].sort());
  soft(await scene(page).getAttribute('data-focus'), "the view starts at the wall's start").toBe('0');
  if ((await page.locator('button.cab-figure').count()) === HELD_ORDERED) soft(where(await settled(page)), 'the same places as from the start').toEqual(where(ordered));

  // cleared after the walk: the full layout returns, seen from the wall's start
  await showHoldings(page, ['Ordered', 'Wished']);
  await expect(page.locator('button.cab-figure').first()).toBeVisible({ timeout: 30_000 });
  const back = await settled(page);
  soft(where(back), 'the full layout returns after a walk').toEqual(where(full));
  soft(await camera(page), "from the wall's start").toEqual(startCamera);

  // a tap still opens the figure it lands on
  const target = page.locator(`button.cab-figure[data-figure-id="${[...back].sort(reading)[0]!.id}"]`);
  const box = (await target.boundingBox())!;
  const name = (await target.getAttribute('aria-label'))!;
  await touchTap(page, box.x + box.width / 2, box.y + box.height * 0.6);
  await expect(page.locator('.figure-viewer-sheet__name').first()).toHaveText(name, { timeout: 10_000 });
  testInfo.annotations.push({ type: 'held', description: `${HELD_ORDERED} ordered, ${HELD_WISHED} wished` });
});

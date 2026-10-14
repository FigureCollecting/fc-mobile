// CASE-GL measurement helpers, read from the compositor and the page itself (CDP, a real Chromium):
// the layers the whole page composites, and the frame times of a scripted swipe.
import type { Page } from '@playwright/test';

interface LayerTreeLayer {
  layerId: string;
  width: number;
  height: number;
  drawsContent: boolean;
}

/** Every layer of the page that draws, and their area (CSS px of layer space). */
export async function pageLayers(page: Page): Promise<{ layers: number; area: number }> {
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
    await cdp.send('LayerTree.disable');
    const drawing = layers.filter((l) => l.drawsContent);
    return { layers: drawing.length, area: drawing.reduce((a, l) => a + l.width * l.height, 0) };
  } finally {
    await cdp.detach();
  }
}

/** The nearest-rank percentile of `xs`. */
export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return Number.NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

/**
 * A scripted swipe, a finger's pace: `swipes` drags of `dx` CSS px across the middle of `.cabinet-scene`, one
 * pointer move a frame (`steps` each), the frame intervals the page's requestAnimationFrame saw meanwhile (ms).
 */
export async function swipeFrameTimes(page: Page, dx: number, swipes = 3, steps = 24): Promise<number[]> {
  const box = (await page.locator('.cabinet-scene').boundingBox())!;
  await page.evaluate(() => {
    const w = window as unknown as { __caseFrames: number[]; __caseRecording: boolean };
    w.__caseFrames = [];
    w.__caseRecording = true;
    let last = 0;
    const tick = (t: number) => {
      if (last) w.__caseFrames.push(t - last);
      last = t;
      if (w.__caseRecording) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const nextFrame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  for (let s = 0; s < swipes; s++) {
    const x = box.x + box.width * (dx < 0 ? 0.8 : 0.2);
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(x + (dx * i) / steps, y);
      await nextFrame();
    }
    await page.mouse.up();
    await nextFrame();
  }
  return page.evaluate(() => {
    const w = window as unknown as { __caseFrames: number[]; __caseRecording: boolean };
    w.__caseRecording = false;
    return w.__caseFrames;
  });
}

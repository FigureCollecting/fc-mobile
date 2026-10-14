import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';
import { BufferGeometry, Material, Texture, Vector3 } from 'three';
import type { Figure } from '@figurecollecting/fc-shared';
import { project, type Camera } from '../../caseCamera';
import { wallLayout } from '../../packCabinets';
import { IKEA_KLINGSBO } from '../../cabinetPresets';
import type { FigureDraw } from '../../caseFigures';
import type { FigureArt } from '../../figureArt';
import { buildCards } from '../cards';
import { cabinetQuads, roomQuads } from '../cabinetQuads';
import { DPR_CAP, CaseGL, toThreeCamera, type CaseGLOptions, type RendererLike } from '../glScene';
import { TEXTURE_BUDGET_BYTES } from '../lod';

const camera: Camera = { x: 225, y: 1300, z: 1900, pitch: 0.18, focalPx: 520, frame: { width: 443, height: 558 } };

function fakeCtx() {
  return {
    calls: [] as string[],
    drawImage(...args: unknown[]) {
      this.calls.push(`drawImage:${args.length}`);
    },
    fillRect() {
      this.calls.push('fillRect');
    },
    clearRect() {
      this.calls.push('clearRect');
    },
    fillText() {
      this.calls.push('fillText');
    },
    measureText: (t: string) => ({ width: t.length * 6 }),
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arcTo() {},
    rect() {},
    clip() {},
    fill() {},
    strokeRect() {},
    set fillStyle(_: unknown) {},
    set strokeStyle(_: unknown) {},
    set lineWidth(_: unknown) {},
    set font(_: unknown) {},
    set textAlign(_: unknown) {},
    set textBaseline(_: unknown) {},
    set globalCompositeOperation(_: unknown) {},
  };
}

type FakeCanvas = { width: number; height: number; ctx: ReturnType<typeof fakeCtx>; getContext: () => ReturnType<typeof fakeCtx>; still?: boolean };
const pages: FakeCanvas[] = [];
/** The atlas pages made, not the still frame. */
const atlasPages = () => pages.filter((p) => !p.still);
function makeCanvas(w: number, h: number) {
  const ctx = fakeCtx();
  const c: FakeCanvas = { width: w, height: h, ctx, getContext: () => ctx };
  pages.push(c);
  return c as unknown as HTMLCanvasElement;
}

function fakeRenderer(canvas: HTMLCanvasElement) {
  return {
    domElement: canvas,
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
    forceContextLoss: vi.fn(),
    info: { render: { calls: 0 }, memory: { textures: 0, geometries: 0 } },
  } satisfies RendererLike;
}

const figure = (id: string, name: string) => ({ _id: id, name }) as unknown as Figure;
const slot = wallLayout([IKEA_KLINGSBO]).cabinets[0];
const surfaces = [5, 4, 3].map((i) => ({ surfaceIndex: i, isTop: false, topMm: IKEA_KLINGSBO.surfaces[i].topMm, maxHeightMm: 380, widthMm: 382, depthMm: 335, frontZMm: -12 }));

function scene(n = 6, art: FigureArt = { kind: 'cutout', url: 'https://img.test/a.png', alphaUrl: 'https://img.test/a.png' }) {
  const draws = Array.from({ length: n }, (_, i): { draw: FigureDraw; cab: number } => ({
    cab: 0,
    draw: {
      cx: 60 + (i % 4) * 90,
      slot: surfaces[i % 3],
      placed: {
        item: { figure: figure(`f${i}`, `Figure ${i}`), index: i, heightMm: 180, widthMm: 80, billboardWidthMm: 90, depthMm: 60, heightEstimated: false },
        xMm: 0,
        zMm: -160,
        heightMm: 180,
        tooDeep: false,
      },
    },
  }));
  const built = buildCards(draws, () => ({ art, aspect: 0.5, margins: { top: 0.05, bottom: 0.05 } }), true);
  return {
    quads: [...roomQuads(wallLayout([IKEA_KLINGSBO])), ...cabinetQuads(slot)],
    ...built,
    cabinets: [{ x0: slot.leftMm - 60, x1: slot.rightMm + 60, y0: 0, y1: 1800, z0: -400, z1: 50, opaqueFront: false }],
    boards: () => [],
  };
}

let made: CaseGL[] = [];
function make(extra: Partial<CaseGLOptions> = {}) {
  const canvas = document.createElement('canvas');
  let renderer!: ReturnType<typeof fakeRenderer>;
  const still = makeCanvas(443, 558);
  (still as unknown as FakeCanvas).still = true;
  const log = vi.fn();
  const onLost = vi.fn();
  const gl = new CaseGL({
    canvas,
    still,
    createRenderer: (c) => (renderer = fakeRenderer(c)),
    makeCanvas,
    loadImage: async (url) => ({ width: 200, height: 400, url }) as unknown as CanvasImageSource,
    schedule: (f) => f(),
    log,
    onLost,
    ...extra,
  });
  made.push(gl);
  return { gl, canvas, renderer, still: still as unknown as FakeCanvas, log, onLost };
}

afterEach(() => {
  for (const g of made) g.dispose();
  made = [];
  pages.length = 0;
  vi.restoreAllMocks();
});

describe('toThreeCamera: the canvas camera is the case camera (caseCamera, CC2)', () => {
  it('a property: three projects every point where project() does, panned or not', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -2000, max: 2000, noNaN: true }),
        fc.double({ min: 0, max: 2400, noNaN: true }),
        fc.double({ min: -500, max: 400, noNaN: true }),
        fc.double({ min: -120, max: 120, noNaN: true }),
        (x, y, z, pan) => {
          const cam3 = toThreeCamera(camera, pan);
          cam3.updateMatrixWorld();
          const ndc = new Vector3(x, y, z).project(cam3);
          const want = project(camera, [x, y, z]);
          if (want.depth < 20) return;
          const sx = ((ndc.x + 1) / 2) * camera.frame.width;
          const sy = ((1 - ndc.y) / 2) * camera.frame.height;
          expect(sx).toBeCloseTo(want.x + pan, 4);
          expect(sy).toBeCloseTo(want.y, 4);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('CaseGL', () => {
  it('caps the device pixel ratio at 2 and sizes the drawing buffer to the frame', () => {
    expect(DPR_CAP).toBe(2);
    const { gl, renderer } = make();
    gl.setScene(scene());
    gl.setView({ camera, panPx: 0, dpr: 2.8125, settled: true });
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(2);
    expect(renderer.setSize).toHaveBeenLastCalledWith(443, 558, false);
    gl.setView({ camera, panPx: 0, dpr: 1, settled: true });
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(1);
    expect(gl.stats.dpr).toBe(1);
  });

  it('renders once per view, only when asked, and draws the wall in a handful of calls', async () => {
    const { gl, renderer } = make();
    gl.setScene(scene(40));
    gl.setView({ camera, panPx: 0, dpr: 2, settled: true });
    await gl.ready();
    expect(renderer.render).toHaveBeenCalled();
    const s = gl.stats;
    // the room and the cabinets' opaque faces, their glass, one call per atlas page, the shadows
    expect(s.drawCalls).toBe(3 + s.pages);
    expect(s.pages).toBe(1);
    expect(s.stages.total).toBe(80);
    expect(s.cardsDrawn).toBeGreaterThan(0);
    expect(s.cardsDrawn).toBe(s.stages.total - s.stages.frustum - s.stages.cabinets - s.stages.boards - s.stages.figures);
  });

  it('keeps the atlas within the texture budget and logs it', async () => {
    const { gl, log } = make();
    gl.setScene(scene(12));
    gl.setView({ camera, panPx: 0, dpr: 2, settled: true });
    await gl.ready();
    expect(gl.stats.budgetBytes).toBe(TEXTURE_BUDGET_BYTES);
    expect(gl.stats.textureBytes).toBeGreaterThan(0);
    expect(gl.stats.textureBytes).toBeLessThanOrEqual(TEXTURE_BUDGET_BYTES);
    expect(log).toHaveBeenCalledWith('texture budget', expect.objectContaining({ bytes: gl.stats.textureBytes, budget: TEXTURE_BUDGET_BYTES, pages: gl.stats.pages }));
    // a budget too small for one page: every card a placeholder, no page
    const tight = make({ budgetBytes: 1024 });
    tight.gl.setScene(scene(12));
    tight.gl.setView({ camera, panPx: 0, dpr: 2, settled: true });
    await tight.gl.ready();
    expect(tight.gl.stats.pages).toBe(0);
    expect(tight.gl.stats.textureBytes).toBe(0);
  });

  it('paints each atlas cell from its picture: a cut-out once however many cards draw it, a label as drawn text', async () => {
    const { gl } = make();
    gl.setScene(scene(12));
    gl.setView({ camera, panPx: 0, dpr: 2, settled: true });
    await gl.ready();
    expect(atlasPages()).toHaveLength(1);
    const page = atlasPages()[0];
    expect(page.ctx.calls.filter((c) => c.startsWith('drawImage')).length).toBe(1);
    expect(page.ctx.calls.filter((c) => c === 'fillText').length).toBeGreaterThan(0);
  });

  it('a tap picks the nearest drawn figure under it; a card the cull dropped takes no tap', async () => {
    const { gl } = make();
    const sc = scene(6);
    gl.setScene(sc);
    gl.setView({ camera, panPx: 0, dpr: 2, settled: true });
    const card = sc.cards.find((c) => c.role === 'figure' && gl.visibleIds().includes(c.id))!;
    const p = project(camera, [(card.tap!.x0 + card.tap!.x1) / 2, (card.tap!.y0 + card.tap!.y1) / 2, card.z]);
    expect(gl.pick(p.x, p.y)).toBe(card.figure);
    expect(gl.pick(2, 2)).toBeNull();
    // the same card panned off the frame
    gl.setView({ camera, panPx: 2000, dpr: 2, settled: true });
    expect(gl.pick(p.x, p.y)).toBeNull();
  });

  it('names where a tap lands on each of the first drawn figures (what the e2e taps), each picking back its figure', () => {
    const { gl } = make();
    gl.setScene(scene(12));
    gl.setView({ camera, panPx: 30, dpr: 2, settled: true });
    const points = gl.tapPoints(3);
    expect(points).toHaveLength(3);
    for (const p of points) {
      expect(gl.pick(p.x, p.y)).toBe(p.figure);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(camera.frame.width);
    }
    expect(gl.tapPoints(0)).toEqual([]);
  });

  it('captures a still frame of each settled picture, not of every frame of a swipe', () => {
    const { gl, still } = make();
    gl.setScene(scene(6));
    gl.setView({ camera, panPx: 0, dpr: 2, settled: false });
    expect(still.ctx.calls.filter((c) => c.startsWith('drawImage'))).toHaveLength(0);
    gl.setView({ camera, panPx: 10, dpr: 2, settled: true });
    expect(still.ctx.calls.filter((c) => c.startsWith('drawImage'))).toHaveLength(1);
  });

  it('context lost: stops drawing and says so; restored: rebuilds the atlas pages from the picture cache and draws again', async () => {
    const loadImage = vi.fn(async () => ({ width: 200, height: 400 }) as unknown as CanvasImageSource);
    const { gl, canvas, renderer, onLost } = make({ loadImage });
    gl.setScene(scene(6));
    gl.setView({ camera, panPx: 0, dpr: 2, settled: true });
    await gl.ready();
    const page = atlasPages()[0];
    const before = page.ctx.calls.filter((c) => c.startsWith('drawImage')).length;
    const textures = gl.pageTextures();
    const versions = textures.map((t) => t.version);
    // the page's pixels are on the GPU: its canvas is let go
    expect(page.width * page.height).toBeLessThanOrEqual(1);

    const lost = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    expect(onLost).toHaveBeenLastCalledWith(true);
    expect(gl.stats.lost).toBe(true);
    renderer.render.mockClear();
    gl.setView({ camera, panPx: 5, dpr: 2, settled: true });
    expect(renderer.render).not.toHaveBeenCalled();

    canvas.dispatchEvent(new Event('webglcontextrestored'));
    await gl.ready();
    expect(onLost).toHaveBeenLastCalledWith(false);
    expect(gl.stats.lost).toBe(false);
    // repainted from the decoded pictures, never fetched again
    expect(loadImage).toHaveBeenCalledTimes(1);
    expect(page.ctx.calls.filter((c) => c.startsWith('drawImage')).length).toBeGreaterThan(before);
    gl.pageTextures().forEach((t, i) => expect(t.version).toBeGreaterThan(versions[i]));
    expect(renderer.render).toHaveBeenCalled();
  });

  it('dispose: every geometry, material and texture it made let go, the renderer and its context too, no listener left', async () => {
    const geo = vi.spyOn(BufferGeometry.prototype, 'dispose');
    const mat = vi.spyOn(Material.prototype, 'dispose');
    const tex = vi.spyOn(Texture.prototype, 'dispose');
    const { gl, canvas, renderer, onLost } = make();
    gl.setScene(scene(12));
    gl.setView({ camera, panPx: 0, dpr: 2, settled: true });
    await gl.ready();
    // a new scene lets the old one's buffers go at once
    gl.setScene(scene(8));
    const owned = gl.resources();
    expect(owned.geometries).toBeGreaterThan(0);
    expect(owned.materials).toBeGreaterThan(0);
    expect(owned.textures).toBeGreaterThan(0);
    geo.mockClear();
    mat.mockClear();
    tex.mockClear();
    gl.dispose();
    expect(geo).toHaveBeenCalledTimes(owned.geometries);
    expect(mat).toHaveBeenCalledTimes(owned.materials);
    expect(tex).toHaveBeenCalledTimes(owned.textures);
    expect(gl.resources()).toEqual({ geometries: 0, materials: 0, textures: 0 });
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(renderer.forceContextLoss).toHaveBeenCalledTimes(1);
    // its own context loss on the way out is not a loss to recover from
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(onLost).not.toHaveBeenCalled();
    // twice is harmless
    gl.dispose();
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
  });
});

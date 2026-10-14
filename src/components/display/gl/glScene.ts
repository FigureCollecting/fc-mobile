/**
 * CASE-GL: the case on one WebGL2 canvas, drawn the way games draw.
 *
 * - One screen-sized drawing buffer at min(devicePixelRatio, 2): GPU memory
 *   is that buffer plus the texture budget, whatever the wall holds.
 * - The room and every cabinet face batched into two meshes (opaque, glass);
 *   the figures as instanced cards, one draw call per atlas page; their
 *   shadows one more; the name plates drawn text in the same atlas.
 * - Visibility first (visibility.ts): frustum, cabinets, boards, figures;
 *   what is left drawn front to back, the depth buffer resolving the rest.
 * - Distance LOD and an explicit texture budget (lod.ts): RGBA atlas pages
 *   with generated mipmaps, packed from the cards on screen and half a frame
 *   round it once a swipe settles; a card with no cell yet, or too small to
 *   show a picture, is a flat placeholder.
 * - Robust: a lost context stops drawing (a still frame of the last settled
 *   picture stands in) and, restored, the atlas pages are repainted from the
 *   decoded pictures, never fetched again; dispose() lets every geometry,
 *   material, texture and the context go.
 *
 * Colours are the classic view's sRGB values drawn as they are (no colour
 * management), as CSS draws them.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearSRGBColorSpace,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
  type Material,
  type Texture,
} from 'three';
import { project, type Camera } from '../caseCamera';
import type { Board } from '../caseCull';
import { cullCards, type CabinetBounds, type CullStages } from './visibility';
import { planAtlas, ATLAS_PAGE_PX, TEXTURE_BUDGET_BYTES, type AtlasPlan } from './lod';
import { hitCard } from './hitTest';
import type { ColoredQuad, RGBA } from './cabinetQuads';
import type { CardPaint, FigureCard, ShadowCard } from './cards';

/** The drawing buffer's device pixel ratio at most: the Fold8's 2.8125 draws at 2. */
export const DPR_CAP = 2;
/** The camera's near and far planes, mm. */
const NEAR_MM = 20;
const FAR_MM = 200_000;
/** What the atlas packs: the cards on screen and this share of the frame round it. */
const PREFETCH_MARGIN = 0.5;
const BACKGROUND: RGBA = [0x0b / 255, 0x0c / 255, 0x0f / 255, 1];

/** The part of three's WebGLRenderer the case uses (tests give a fake). */
export interface RendererLike {
  readonly domElement: HTMLCanvasElement;
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  render(scene: Scene, camera: PerspectiveCamera): void;
  dispose(): void;
  forceContextLoss(): void;
  readonly info: { render: { calls: number }; memory: { textures: number; geometries: number } };
}

export interface CaseGLOptions {
  readonly canvas: HTMLCanvasElement;
  /** A 2D canvas the last settled picture is copied to: what stands in while the context is lost. */
  readonly still?: HTMLCanvasElement | null;
  readonly createRenderer?: (canvas: HTMLCanvasElement) => RendererLike;
  /** Atlas pages: a 2D canvas of this size. */
  readonly makeCanvas?: (width: number, height: number) => HTMLCanvasElement;
  /** A decoded picture (CORS: the atlas reads its pixels). */
  readonly loadImage?: (url: string) => Promise<CanvasImageSource>;
  readonly budgetBytes?: number;
  readonly dprCap?: number;
  readonly log?: (message: string, data: Record<string, unknown>) => void;
  readonly onLost?: (lost: boolean) => void;
  /** When to draw (requestAnimationFrame; tests: at once). */
  readonly schedule?: (draw: () => void) => void;
  /** Hears what each frame drew. */
  readonly onDrawn?: (stats: GLStats) => void;
}

export interface GLSceneInput {
  readonly quads: readonly ColoredQuad[];
  readonly cards: readonly FigureCard[];
  readonly shadows: readonly ShadowCard[];
  readonly cabinets: readonly CabinetBounds[];
  readonly boards: (cab: number) => readonly Board[];
}

export interface GLView {
  readonly camera: Camera;
  readonly panPx: number;
  readonly dpr: number;
  /** No finger moving: pack the atlas for this picture and keep a still of it. */
  readonly settled: boolean;
}

export interface GLStats {
  readonly stages: CullStages;
  readonly cardsDrawn: number;
  readonly placeholders: number;
  readonly drawCalls: number;
  readonly pages: number;
  readonly textureBytes: number;
  readonly budgetBytes: number;
  readonly dpr: number;
  readonly lost: boolean;
  /** The CPU's time for the last frame's cull and instance writes, ms. */
  readonly cullMs: number;
}

/** The three camera that draws exactly what caseCamera.project() says, the pan a slide of the picture. */
export function toThreeCamera(camera: Camera, panPx: number, target?: PerspectiveCamera): PerspectiveCamera {
  const { width, height } = camera.frame;
  const fov = (2 * Math.atan(height / 2 / camera.focalPx) * 180) / Math.PI;
  const cam = target ?? new PerspectiveCamera(fov, width / height, NEAR_MM, FAR_MM);
  cam.fov = fov;
  cam.aspect = width / height;
  cam.near = NEAR_MM;
  cam.far = FAR_MM;
  cam.position.set(camera.x, camera.y, camera.z);
  cam.rotation.set(-camera.pitch, 0, 0);
  if (panPx !== 0) cam.setViewOffset(width, height, -panPx, 0, width, height);
  else cam.clearViewOffset();
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return cam;
}

// ------------------------------------------------------------------ shaders

const COLOR_VERT = `
attribute vec4 aColor;
varying vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const COLOR_FRAG = `
varying vec4 vColor;
void main() { gl_FragColor = vColor; }`;

const CARD_VERT = `
attribute vec4 aUv;
attribute vec4 aTint;
varying vec2 vUv;
varying vec4 vTint;
void main() {
  vUv = aUv.xy + uv * aUv.zw;
  vTint = aTint;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
/** A card's cell (premultiplied: its mip levels average without dark fringes), cut where it is clear; a tinted card is a placeholder. */
const CARD_FRAG = `
uniform sampler2D map;
uniform bool textured;
varying vec2 vUv;
varying vec4 vTint;
void main() {
  vec4 c = textured && vTint.a == 0.0 ? texture2D(map, vUv) : vec4(vTint.rgb, 1.0);
  if (c.a < 0.5) discard;
  gl_FragColor = vec4(c.rgb / c.a, 1.0);
}`;

/** radial-gradient(ellipse at 50% 50%, rgba(0,0,0,.62) 0%, rgba(0,0,0,.3) 45%, transparent 72%), the classic view's shadow. */
const SHADOW_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const SHADOW_FRAG = `
varying vec2 vUv;
void main() {
  float r = length(vUv * 2.0 - 1.0) / sqrt(2.0);
  float a = r < 0.45 ? mix(0.62, 0.3, r / 0.45) : r < 0.72 ? mix(0.3, 0.0, (r - 0.45) / 0.27) : 0.0;
  if (a <= 0.0) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}`;

// ------------------------------------------------------------------ geometry

/** A unit square, (0,0) to (1,1) in x and y, its uv the same. */
function unitQuad(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** Faces as one mesh's triangles, each gradient stop a band along v. */
function quadGeometry(quads: readonly ColoredQuad[]): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const at = (q: ColoredQuad, s: number, t: number) => [0, 1, 2].map((k) => q.a[k] + s * q.u[k] + t * q.v[k]);
  for (const q of quads) {
    const stops = q.colors.length === 1 ? [[0, q.colors[0][1]] as const, [1, q.colors[0][1]] as const] : q.colors;
    for (let i = 0; i + 1 < stops.length; i++) {
      const [t0, c0] = stops[i];
      const [t1, c1] = stops[i + 1];
      const base = pos.length / 3;
      pos.push(...at(q, 0, t0), ...at(q, 1, t0), ...at(q, 1, t1), ...at(q, 0, t1));
      col.push(...c0, ...c0, ...c1, ...c1);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aColor', new BufferAttribute(new Float32Array(col), 4));
  g.setIndex(idx);
  return g;
}

const m4 = new Matrix4();
/** The matrix taking the unit square onto the face a + s u + t v. */
function faceMatrix(a: readonly number[], u: readonly number[], v: readonly number[]): Matrix4 {
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const ln = Math.hypot(n[0], n[1], n[2]) || 1;
  return m4.set(u[0], v[0], n[0] / ln, a[0], u[1], v[1], n[1] / ln, a[1], u[2], v[2], n[2] / ln, a[2], 0, 0, 0, 1);
}

/** A flat colour per kind for a card drawn without its cell. */
function tintOf(p: CardPaint): RGBA {
  if (p.kind === 'label') return [0xd9 / 255, 0xcf / 255, 0xb8 / 255, 1];
  if (p.kind === 'plate') return [0x3a / 255, 0x3d / 255, 0x45 / 255, 1];
  if (p.kind === 'framed') return [0xf4 / 255, 0xf1 / 255, 0xea / 255, 1];
  return [0x6b / 255, 0x6f / 255, 0x78 / 255, 1];
}

// ------------------------------------------------------------------ atlas painting

type Ctx = CanvasRenderingContext2D;

function wrapLines(ctx: Ctx, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxW || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

/** Paint one cell: the picture (its clip of it), through its mask, in its frame, or a plate or label of text. */
function paintCell(ctx: Ctx, p: CardPaint, x: number, y: number, w: number, h: number, image: (url: string) => CanvasImageSource | null): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const src = (img: CanvasImageSource) => {
    const iw = Number((img as { width: number }).width) || 1;
    const ih = Number((img as { height: number }).height) || 1;
    const { top, right, bottom, left } = p.clip;
    return [left * iw, top * ih, Math.max(1e-3, iw * (1 - left - right)), Math.max(1e-3, ih * (1 - top - bottom))] as const;
  };
  const text = (bg: string, fg: string, size: number, lines: number, name: string) => {
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = fg;
    ctx.font = `600 ${Math.max(6, Math.round(size))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const rows = wrapLines(ctx, name, w * 0.84, lines);
    rows.forEach((row, i) => ctx.fillText(row, x + w / 2, y + h / 2 + (i - (rows.length - 1) / 2) * size * 1.2, w * 0.92));
  };
  const plate = (name: string) => text('#3a3d45', '#e6e8ee', Math.min(h * 0.1, w * 0.16), 4, name);
  if (p.kind === 'label') text('#d9cfb8', '#2b2620', h * 0.37, 1, p.name);
  else if (p.kind === 'plate') plate(p.name);
  else {
    const img = image(p.url);
    if (!img) plate('');
    else if (p.kind === 'cutout') ctx.drawImage(img, ...src(img), x, y, w, h);
    else if (p.kind === 'masked') {
      const mask = image(p.maskUrl);
      ctx.drawImage(img, ...src(img), x, y, w, h);
      if (mask) {
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(mask, ...src(mask), x, y, w, h);
        ctx.globalCompositeOperation = 'source-over';
      }
    } else {
      // framed: the picture contained in a 5 % mat, a thin rim round it
      ctx.fillStyle = '#f4f1ea';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#b9b2a4';
      const rim = Math.max(1, Math.round(h * 0.012));
      ctx.lineWidth = rim;
      ctx.strokeRect(x + rim / 2, y + rim / 2, w - rim, h - rim);
      const [sx, sy, sw, sh] = src(img);
      const ix = x + w * 0.05;
      const iy = y + h * 0.05;
      const bw = w * 0.9;
      const bh = h * 0.9;
      const k = Math.min(bw / sw, bh / sh);
      ctx.drawImage(img, sx, sy, sw, sh, ix + (bw - sw * k) / 2, iy + (bh - sh * k) / 2, sw * k, sh * k);
    }
  }
  ctx.restore();
}

function defaultLoadImage(url: string): Promise<CanvasImageSource> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.src = url;
  return img.decode().then(() => img);
}

// ------------------------------------------------------------------ the renderer

interface Page {
  canvas: HTMLCanvasElement;
  texture: CanvasTexture;
  material: ShaderMaterial;
  mesh: InstancedMesh;
}

const EMPTY_STAGES: CullStages = { total: 0, frustum: 0, cabinets: 0, boards: 0, figures: 0 };

export class CaseGL {
  private readonly canvas: HTMLCanvasElement;
  private readonly still: HTMLCanvasElement | null;
  private readonly renderer: RendererLike;
  private readonly makeCanvas: (w: number, h: number) => HTMLCanvasElement;
  private readonly loadImage: (url: string) => Promise<CanvasImageSource>;
  private readonly budget: number;
  private readonly dprCap: number;
  private readonly log: (message: string, data: Record<string, unknown>) => void;
  private readonly onLost: (lost: boolean) => void;
  private readonly schedule: (draw: () => void) => void;
  private readonly onDrawn: (stats: GLStats) => void;

  private readonly scene = new Scene();
  private readonly camera3 = new PerspectiveCamera(50, 1, NEAR_MM, FAR_MM);
  private readonly geometries = new Set<BufferGeometry>();
  private readonly materials = new Set<Material>();
  private readonly textures = new Set<Texture>();

  private input: GLSceneInput | null = null;
  private byKey = new Map<string, CardPaint>();
  private opaque: Mesh | null = null;
  private glass: Mesh | null = null;
  private placeholders: InstancedMesh | null = null;
  private shadows: InstancedMesh | null = null;
  private pages: Page[] = [];
  private plan: AtlasPlan | null = null;
  private building: Promise<void> = Promise.resolve();
  private buildToken = 0;
  private release = false;
  private readonly images = new Map<string, Promise<CanvasImageSource | null>>();
  private readonly decoded = new Map<string, CanvasImageSource | null>();

  private view: GLView | null = null;
  private appliedSize = '';
  private visible: number[] = [];
  private lastStages: CullStages = EMPTY_STAGES;
  private lastDrawCalls = 0;
  private lastPlaceholders = 0;
  private lastCullMs = 0;
  private lost = false;
  private disposed = false;
  private pending = false;
  private loggedBytes = -1;

  private readonly lostListener = (e: Event) => {
    e.preventDefault();
    this.lost = true;
    this.onLost(true);
  };
  private readonly restoredListener = () => {
    this.lost = false;
    // the GPU forgot every texture: the pages are painted again from the pictures already decoded
    if (this.plan) this.applyPlan(this.plan);
    this.onLost(false);
    this.requestRender();
  };

  constructor(o: CaseGLOptions) {
    this.canvas = o.canvas;
    this.still = o.still ?? null;
    this.makeCanvas = o.makeCanvas ?? ((w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }));
    this.loadImage = o.loadImage ?? defaultLoadImage;
    this.budget = o.budgetBytes ?? TEXTURE_BUDGET_BYTES;
    this.dprCap = o.dprCap ?? DPR_CAP;
    this.log = o.log ?? ((message, data) => console.info(`[case-gl] ${message}`, data));
    this.onLost = o.onLost ?? (() => undefined);
    this.schedule = o.schedule ?? ((draw) => requestAnimationFrame(draw));
    this.onDrawn = o.onDrawn ?? (() => undefined);
    this.canvas.addEventListener('webglcontextlost', this.lostListener);
    this.canvas.addEventListener('webglcontextrestored', this.restoredListener);
    this.renderer =
      o.createRenderer?.(this.canvas) ??
      ((): RendererLike => {
        const r = new WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: false, depth: true, stencil: false, preserveDrawingBuffer: false });
        r.outputColorSpace = LinearSRGBColorSpace;
        return r;
      })();
    this.scene.background = new Color().setRGB(BACKGROUND[0], BACKGROUND[1], BACKGROUND[2], LinearSRGBColorSpace);
    this.scene.matrixWorldAutoUpdate = false;
  }

  // ---- resources

  private own<T extends BufferGeometry | Material | Texture>(r: T): T {
    if (r instanceof BufferGeometry) this.geometries.add(r);
    else if ('isTexture' in r) this.textures.add(r as Texture);
    else this.materials.add(r as Material);
    return r;
  }

  private free(r: BufferGeometry | Material | Texture | null | undefined): void {
    if (!r) return;
    r.dispose();
    this.geometries.delete(r as BufferGeometry);
    this.materials.delete(r as Material);
    this.textures.delete(r as Texture);
  }

  private freeMesh(mesh: Mesh | InstancedMesh | null): void {
    if (!mesh) return;
    this.scene.remove(mesh);
    if (mesh instanceof InstancedMesh) mesh.dispose();
    this.free(mesh.geometry);
    this.free(mesh.material as Material);
  }

  /** What it holds now (tests: every one let go on dispose). */
  resources(): { geometries: number; materials: number; textures: number } {
    return { geometries: this.geometries.size, materials: this.materials.size, textures: this.textures.size };
  }

  private cardMaterial(texture: Texture | null): ShaderMaterial {
    return this.own(
      new ShaderMaterial({
        vertexShader: CARD_VERT,
        fragmentShader: CARD_FRAG,
        uniforms: { map: { value: texture }, textured: { value: texture !== null } },
        side: DoubleSide,
      }),
    );
  }

  private cardMesh(material: ShaderMaterial, capacity: number, order: number): InstancedMesh {
    const g = this.own(unitQuad());
    g.setAttribute('aUv', new InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
    g.setAttribute('aTint', new InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
    const mesh = new InstancedMesh(g, material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.matrixAutoUpdate = false;
    this.scene.add(mesh);
    return mesh;
  }

  // ---- the scene

  /** A new wall, its cards or its labels: the old buffers are let go at once. */
  setScene(input: GLSceneInput): void {
    this.freeMesh(this.opaque);
    this.freeMesh(this.glass);
    this.freeMesh(this.placeholders);
    this.freeMesh(this.shadows);
    this.input = input;
    this.byKey = new Map(input.cards.map((c) => [c.key, c.paint]));
    const opaque = input.quads.filter((q) => q.colors.every(([, c]) => c[3] >= 1));
    const glass = input.quads.filter((q) => q.colors.some(([, c]) => c[3] < 1));
    this.opaque = new Mesh(this.own(quadGeometry(opaque)), this.own(new ShaderMaterial({ vertexShader: COLOR_VERT, fragmentShader: COLOR_FRAG, side: DoubleSide })));
    this.opaque.renderOrder = 0;
    this.glass = new Mesh(
      this.own(quadGeometry(glass)),
      this.own(new ShaderMaterial({ vertexShader: COLOR_VERT, fragmentShader: COLOR_FRAG, side: DoubleSide, transparent: true, depthWrite: false })),
    );
    this.glass.renderOrder = 3;
    for (const m of [this.opaque, this.glass]) {
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      this.scene.add(m);
    }
    const capacity = Math.max(1, input.cards.length);
    this.placeholders = this.cardMesh(this.cardMaterial(null), capacity, 1);
    const sg = this.own(unitQuad());
    this.shadows = new InstancedMesh(sg, this.own(new ShaderMaterial({ vertexShader: SHADOW_VERT, fragmentShader: SHADOW_FRAG, transparent: true, depthWrite: false })), Math.max(1, input.shadows.length));
    this.shadows.count = 0;
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 2;
    this.shadows.matrixAutoUpdate = false;
    this.scene.add(this.shadows);
    // pages hold as many cards as the wall has
    for (const page of this.pages) {
      this.freeMesh(page.mesh);
      page.material = this.cardMaterial(page.texture);
      page.mesh = this.cardMesh(page.material, capacity, 1);
    }
    this.plan = this.plan && [...this.plan.tiers.keys()].every((k) => this.byKey.has(k)) ? this.plan : null;
    if (this.view) this.setView(this.view);
  }

  setView(view: GLView): void {
    if (this.disposed || !this.input) return;
    this.view = view;
    const { width, height } = view.camera.frame;
    const dpr = Math.min(view.dpr, this.dprCap);
    const size = `${width}x${height}@${dpr}`;
    if (size !== this.appliedSize) {
      this.appliedSize = size;
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(width, height, false);
      if (this.still) {
        this.still.width = width;
        this.still.height = height;
      }
    }
    toThreeCamera(view.camera, view.panPx, this.camera3);
    const t0 = performance.now();
    const cull = cullCards({ camera: view.camera, panPx: view.panPx, cabinets: this.input.cabinets, boards: this.input.boards, cards: this.input.cards });
    this.visible = cull.visible;
    this.lastStages = cull.stages;
    this.writeInstances();
    this.lastCullMs = performance.now() - t0;
    if (!this.plan || view.settled) this.replan();
    this.requestRender();
  }

  /** Card ids drawn, front to back. */
  visibleIds(): number[] {
    return [...this.visible];
  }

  figureCards(): FigureCard[] {
    return (this.input?.cards ?? []).filter((c) => c.role === 'figure');
  }

  pageTextures(): Texture[] {
    return this.pages.map((p) => p.texture);
  }

  /** The figure index under (sx, sy), CSS px from the canvas's top left; null when no drawn figure is. */
  pick(sx: number, sy: number): number | null {
    if (!this.input || !this.view) return null;
    const cards = this.input.cards;
    const taps = this.visible.flatMap((id) => (cards[id].tap ? [cards[id].tap!] : []));
    const id = hitCard(this.view.camera, this.view.panPx, taps, sx, sy);
    return id === null ? null : cards[id].figure;
  }

  /** The atlas build in flight, if any, done. */
  ready(): Promise<void> {
    return this.building;
  }

  get stats(): GLStats {
    const textureBytes = this.plan?.bytes ?? 0;
    return {
      stages: this.lastStages,
      cardsDrawn: this.visible.length,
      placeholders: this.lastPlaceholders,
      drawCalls: this.lastDrawCalls,
      pages: this.plan?.pack.pages ?? 0,
      textureBytes,
      budgetBytes: this.budget,
      dpr: Math.min(this.view?.dpr ?? 1, this.dprCap),
      lost: this.lost,
      cullMs: this.lastCullMs,
    };
  }

  // ---- instances

  private writeInstances(): void {
    const input = this.input!;
    const counts = new Map<InstancedMesh, number>();
    const put = (mesh: InstancedMesh, card: FigureCard, uv: readonly number[], tint: readonly number[]) => {
      const n = counts.get(mesh) ?? 0;
      counts.set(mesh, n + 1);
      mesh.setMatrixAt(n, faceMatrix([card.x0, card.y0, card.z], [card.x1 - card.x0, 0, 0], [0, card.y1 - card.y0, 0]));
      (mesh.geometry.getAttribute('aUv') as InstancedBufferAttribute).set(uv, n * 4);
      (mesh.geometry.getAttribute('aTint') as InstancedBufferAttribute).set(tint, n * 4);
    };
    const P = this.plan?.pack.pageSize ?? ATLAS_PAGE_PX;
    let placeholders = 0;
    let shadows = 0;
    const shadowOf = new Map(input.shadows.map((s) => [s.figure, s]));
    for (const id of this.visible) {
      const card = input.cards[id];
      const place = this.plan?.pack.places.get(card.key);
      const page = place ? this.pages[place.page] : undefined;
      if (place && page) put(page.mesh, card, [place.x / P, 1 - (place.y + place.h) / P, place.w / P, place.h / P], [0, 0, 0, 0]);
      else {
        put(this.placeholders!, card, [0, 0, 0, 0], tintOf(card.paint));
        placeholders++;
      }
      const shadow = card.role === 'figure' ? shadowOf.get(card.figure) : undefined;
      if (shadow) this.shadows!.setMatrixAt(shadows++, faceMatrix(shadow.a, shadow.u, shadow.v));
    }
    for (const mesh of [this.placeholders!, ...this.pages.map((p) => p.mesh)]) {
      mesh.count = counts.get(mesh) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.geometry.getAttribute('aUv').needsUpdate = true;
      mesh.geometry.getAttribute('aTint').needsUpdate = true;
    }
    this.shadows!.count = shadows;
    this.shadows!.instanceMatrix.needsUpdate = true;
    this.lastPlaceholders = placeholders;
  }

  // ---- the atlas

  private image(url: string): Promise<CanvasImageSource | null> {
    let p = this.images.get(url);
    if (!p) {
      p = this.loadImage(url).then(
        (img) => (this.decoded.set(url, img), img),
        () => (this.decoded.set(url, null), null),
      );
      this.images.set(url, p);
    }
    return p;
  }

  /** Plan the atlas for this picture and half a frame round it; repaint only when a card needs a cell or a finer one. */
  private replan(): void {
    const input = this.input!;
    const view = this.view!;
    const dpr = Math.min(view.dpr, this.dprCap);
    const near = cullCards({ camera: view.camera, panPx: view.panPx, cabinets: input.cabinets, boards: input.boards, cards: input.cards, margin: PREFETCH_MARGIN });
    const requests = near.visible.map((id) => {
      const c = input.cards[id];
      const depth = project(view.camera, [(c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2, c.z]).depth;
      return { key: c.key, aspect: c.aspect, screenPx: depth > 0 ? ((view.camera.focalPx * (c.y1 - c.y0)) / depth) * dpr : 0 };
    });
    const plan = planAtlas(requests, this.budget, ATLAS_PAGE_PX);
    const held = this.plan;
    if (held && [...plan.tiers].every(([k, t]) => t === null || (held.tiers.get(k) ?? 0) >= t)) return;
    const token = ++this.buildToken;
    const urls = new Set<string>();
    for (const key of plan.pack.places.keys()) {
      const p = this.byKey.get(key);
      if (p && (p.kind === 'cutout' || p.kind === 'framed' || p.kind === 'masked')) urls.add(p.url);
      if (p?.kind === 'masked') urls.add(p.maskUrl);
    }
    this.building = Promise.all([...urls].map((u) => this.image(u))).then(() => {
      if (token !== this.buildToken || this.disposed) return;
      this.applyPlan(plan);
      this.requestRender();
    });
  }

  /** Paint the pages of this plan from the decoded pictures and hand them to the GPU. */
  private applyPlan(plan: AtlasPlan): void {
    const P = plan.pack.pageSize;
    const capacity = Math.max(1, this.input?.cards.length ?? 1);
    while (this.pages.length > plan.pack.pages) {
      const page = this.pages.pop()!;
      this.freeMesh(page.mesh);
      this.free(page.texture);
    }
    for (let i = 0; i < plan.pack.pages; i++) {
      let page = this.pages[i];
      if (!page) {
        const canvas = this.makeCanvas(P, P);
        const texture = this.own(new CanvasTexture(canvas));
        texture.generateMipmaps = true;
        texture.minFilter = LinearMipmapLinearFilter;
        texture.magFilter = LinearFilter;
        texture.premultiplyAlpha = true;
        const material = this.cardMaterial(texture);
        page = { canvas, texture, material, mesh: this.cardMesh(material, capacity, 1) };
        this.pages.push(page);
      }
      page.canvas.width = P;
      page.canvas.height = P;
      const ctx = page.canvas.getContext('2d') as Ctx | null;
      if (!ctx) continue;
      ctx.clearRect(0, 0, P, P);
      for (const place of plan.pack.places.values()) {
        if (place.page !== i) continue;
        const paint = this.byKey.get(place.key);
        if (paint) paintCell(ctx, paint, place.x, place.y, place.w, place.h, (url) => this.decoded.get(url) ?? null);
      }
      page.texture.needsUpdate = true;
    }
    this.plan = plan;
    // the pages' pixels go to the GPU at the next draw; their canvases are let go after it
    this.release = true;
    if (plan.bytes !== this.loggedBytes) {
      this.loggedBytes = plan.bytes;
      this.log('texture budget', { bytes: plan.bytes, budget: this.budget, pages: plan.pack.pages, cells: plan.pack.places.size, downgraded: plan.downgraded });
    }
    if (this.view) this.writeInstances();
  }

  // ---- drawing

  private requestRender(): void {
    if (this.pending || this.disposed) return;
    this.pending = true;
    this.schedule(() => {
      this.pending = false;
      this.draw();
    });
  }

  private draw(): void {
    if (this.disposed || this.lost || !this.view) return;
    this.renderer.render(this.scene, this.camera3);
    const meshes = [this.opaque, this.glass, this.shadows, this.placeholders, ...this.pages.map((p) => p.mesh)];
    this.lastDrawCalls = meshes.filter((m) => {
      if (!m) return false;
      if (m instanceof InstancedMesh) return m.count > 0;
      return (m.geometry.index?.count ?? 0) > 0;
    }).length;
    if (this.release) {
      this.release = false;
      for (const page of this.pages) {
        page.canvas.width = 1;
        page.canvas.height = 1;
      }
    }
    if (this.view.settled && this.still) {
      const ctx = this.still.getContext('2d');
      ctx?.drawImage(this.canvas, 0, 0, this.still.width, this.still.height);
    }
    this.onDrawn(this.stats);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.lostListener);
    this.canvas.removeEventListener('webglcontextrestored', this.restoredListener);
    this.freeMesh(this.opaque);
    this.freeMesh(this.glass);
    this.freeMesh(this.placeholders);
    this.freeMesh(this.shadows);
    for (const page of this.pages) {
      this.freeMesh(page.mesh);
      this.free(page.texture);
      page.canvas.width = 1;
      page.canvas.height = 1;
    }
    this.pages = [];
    for (const r of [...this.geometries, ...this.materials, ...this.textures]) this.free(r);
    this.images.clear();
    this.decoded.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

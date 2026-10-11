/**
 * The faithful display case (CASE-CABINET, CASE-ADAPT, FIT-CHECK): real
 * cabinets from the profile library standing side by side along a wall,
 * drawn in true scale through one pinhole camera (caseCamera, caseFraming),
 * the collection packed onto their surfaces (packCabinets). Ross 2026-09-26:
 * never stretched or padded to the screen; the sides, the usable top and the
 * legs show; wide screens show several cabinets. Ross 2026-10-09: clear,
 * see-through glass (CC13), neighbours drawn true (CC4a), the camera steps
 * back at a cabinet's top (CC4b), and a sideways swipe either walks the
 * camera or pans the picture, a toggle kept per device (CC4, CC14).
 *
 * The world is authored in CSS px at 1 px per mm (x right, y down = -world
 * y, z toward the viewer); every face is a flat element placed with
 * matrix3d (quadStyle). The viewport's perspective is the lens's focal
 * length in px and the root's transform is the camera (cssSceneTransform),
 * so the browser's own perspective divide draws exactly what project() says.
 * Only figures take pointer events: the cabinet never catches a tap.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { Style } from '../../styles/Style';
import { getDisplayMeta } from './displayMeta';
import { framingHeadroomMm, sideOverhangMm, type CabinetProfile, type CabinetSurface } from './cabinetProfile';
import {
  FIGURE_GAP_MM,
  measureCaseFigure,
  packCabinets,
  wallLayout,
  type PackedCabinet,
  type PlacedFigure,
  type SurfaceSlot,
  type Violator,
  type WallSlot,
} from './packCabinets';
import { cssSceneTransform } from './caseCamera';
import { cabinetsInReach, frameCase, panLimitsPx, swipeCamera, wallPages, wallReachMm } from './caseFraming';
import { figureArt, pictureBox, type FigureArt, type FigureImageRef, type PictureMargins } from './figureArt';
import { wallPatternProfiles, type CasePrefs } from './casePrefs';
import { useAlphaMarginsOf, useContactBand, type AlphaMargins } from './alphaMargin';

/** A sideways move this long (CSS px) turns a press into a swipe; shorter stays a tap. */
export const SWIPE_START_PX = 8;
/** px per mm in the authored world: figures are drawn at their own pixels, never resampled small. */
const S = 1;
const DEFAULT_FRAME = { width: 360, height: 480 };
/** A nameplate's full width; a narrower figure's plate is its own width, so neighbours' plates never meet. */
const PLATE_MAX_MM = 110;
/** What may hang past a cabinet's box along the wall (pictures' clear margins, plates, shadows): drawn this far out of view. */
const REACH_MARGIN_MM = 600;

type V3 = readonly [number, number, number];

const fmt = (v: number): string => {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? '0' : String(r);
};
const num = (v: number): number => Number(fmt(v));

/**
 * One flat face: corner `a` (world mm), its local x along `u` and local y
 * (down the element) along `v`. The element is |u| x |v| px; matrix3d maps
 * it onto the face. null when the face has no area.
 */
export function quadStyle(a: V3, u: V3, v: V3): { width: string; height: string; transform: string } | null {
  const lu = Math.hypot(u[0], u[1], u[2]);
  const lv = Math.hypot(v[0], v[1], v[2]);
  if (!(lu > 0) || !(lv > 0)) return null;
  const U = [u[0] / lu, -u[1] / lu, u[2] / lu];
  const V = [v[0] / lv, -v[1] / lv, v[2] / lv];
  const n = [U[1] * V[2] - U[2] * V[1], U[2] * V[0] - U[0] * V[2], U[0] * V[1] - U[1] * V[0]];
  const ln = Math.hypot(n[0], n[1], n[2]) || 1;
  const N = n.map((c) => c / ln);
  const cols = [...U, 0, ...V, 0, ...N, 0, a[0] * S, -a[1] * S, a[2] * S, 1];
  return { width: `${fmt(lu * S)}px`, height: `${fmt(lv * S)}px`, transform: `matrix3d(${cols.map(fmt).join(',')})` };
}

function Quad({ a, u, v, cls, style }: { a: V3; u: V3; v: V3; cls: string; style?: JSX.CSSProperties }) {
  const q = quadStyle(a, u, v);
  if (!q) return null;
  return <div class={`q ${cls}`} style={{ ...q, ...style }} />;
}

interface BoxProps {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
  cls: string;
  /** Which faces to draw; all six by default. */
  faces?: readonly ('front' | 'back' | 'left' | 'right' | 'top' | 'bottom')[];
}

/** An axis-aligned box as up to six faces, each carrying `cls` plus its own face class for shading. */
function Box({ x0, x1, y0, y1, z0, z1, cls, faces = ['front', 'back', 'left', 'right', 'top', 'bottom'] }: BoxProps) {
  const w = x1 - x0;
  const h = y1 - y0;
  const d = z1 - z0;
  const out: ComponentChildren[] = [];
  for (const f of faces) {
    if (f === 'front') out.push(<Quad key={f} cls={`${cls} f-front`} a={[x0, y1, z1]} u={[w, 0, 0]} v={[0, -h, 0]} />);
    if (f === 'back') out.push(<Quad key={f} cls={`${cls} f-back`} a={[x0, y1, z0]} u={[w, 0, 0]} v={[0, -h, 0]} />);
    if (f === 'left') out.push(<Quad key={f} cls={`${cls} f-side`} a={[x0, y1, z0]} u={[0, 0, d]} v={[0, -h, 0]} />);
    if (f === 'right') out.push(<Quad key={f} cls={`${cls} f-side`} a={[x1, y1, z0]} u={[0, 0, d]} v={[0, -h, 0]} />);
    if (f === 'top') out.push(<Quad key={f} cls={`${cls} f-top`} a={[x0, y1, z0]} u={[w, 0, 0]} v={[0, 0, d]} />);
    if (f === 'bottom') out.push(<Quad key={f} cls={`${cls} f-bottom`} a={[x0, y0, z0]} u={[w, 0, 0]} v={[0, 0, d]} />);
  }
  return <>{out}</>;
}

/** A wrapper that keeps its children in the scene's one 3D context and names a part. */
function Part({ cls, children }: { cls: string; children: ComponentChildren }) {
  return <div class={`part ${cls}`}>{children}</div>;
}

// ------------------------------------------------------------------ cabinets

function caseFloor(p: CabinetProfile): CabinetSurface {
  return p.surfaces.find((s) => !s.outsideDoor) ?? p.surfaces[0];
}

/** Glass sides, back and door: clear panes with lit edges (CC13: see-through, one glass box per cabinet). */
function Panes({ slot }: { slot: WallSlot }) {
  const p = slot.profile;
  const { leftMm: x0, rightMm: x1 } = slot;
  const D = p.outer.depthMm;
  const floor = caseFloor(p);
  const top = p.surfaces[p.surfaces.length - 1];
  const lo = floor.material === 'wood' ? floor.topMm : floor.topMm - floor.thicknessMm;
  const hi = top.topMm - top.thicknessMm;
  const h = hi - lo;
  const inset = p.panels.sideMm / 2;
  const out: ComponentChildren[] = [];
  if (p.materials.sides === 'glass') {
    out.push(<Quad key="l" cls="cab-pane cab-pane--side" a={[x0 + inset, hi, -D]} u={[0, 0, D]} v={[0, -h, 0]} />);
    out.push(<Quad key="r" cls="cab-pane cab-pane--side" a={[x1 - inset, hi, -D]} u={[0, 0, D]} v={[0, -h, 0]} />);
  }
  if (p.materials.back === 'glass') {
    out.push(<Quad key="b" cls="cab-pane cab-pane--back" a={[x0, hi, -D + p.panels.backMm / 2]} u={[x1 - x0, 0, 0]} v={[0, -h, 0]} />);
  }
  if (p.materials.front === 'glassDoor') {
    out.push(<Quad key="d" cls="cab-pane cab-pane--door" a={[x0, hi, -1]} u={[x1 - x0, 0, 0]} v={[0, -h, 0]} />);
  }
  return <>{out}</>;
}

/** The surfaces inside the body: plates of glass, framed floors, open mesh shelves, wood boards. */
function Surfaces({ slot }: { slot: WallSlot }) {
  const p = slot.profile;
  const { leftMm: x0, rightMm: x1, centerMm: cx } = slot;
  const D = p.outer.depthMm;
  const post = p.panels.sideMm;
  const last = p.surfaces.length - 1;
  return (
    <>
      {p.surfaces.map((s, i) => {
        const y0 = s.topMm - s.thicknessMm;
        if (i === last) {
          // the top: outside the case, a display surface of its own
          const wood = s.material === 'wood';
          return (
            <Part key={i} cls={`cab-top ${wood ? 'cab-board' : 'cab-top--framed'}`}>
              <Box x0={x0} x1={x1} y0={y0} y1={s.topMm} z0={-D} z1={0} cls={wood ? 'm-wood' : 'm-steel'} faces={['front', 'left', 'right', 'bottom']} />
              <Quad cls={wood ? 'm-wood f-top' : 'm-glass-top'} a={[x0, s.topMm, -D]} u={[x1 - x0, 0, 0]} v={[0, 0, D]} />
            </Part>
          );
        }
        if (s.material === 'wood') {
          return (
            <Part key={i} cls="cab-board">
              <Box x0={x0} x1={x1} y0={y0} y1={s.topMm} z0={-D} z1={0} cls="m-wood" faces={['front', 'left', 'right', 'top']} />
            </Part>
          );
        }
        if (s.plate && p.plate) {
          const w = p.plate.widthMm;
          const zf = -p.plate.frontInsetMm;
          const zb = zf - p.plate.depthMm;
          const framed = s.thicknessMm > 8;
          return (
            <Part key={i} cls="cab-shelf cab-shelf--glass">
              <Quad cls="m-glass-plate" a={[cx - w / 2, s.topMm, zb]} u={[w, 0, 0]} v={[0, 0, zf - zb]} />
              <Quad cls={framed ? 'm-steel f-front' : 'm-glass-edge'} a={[cx - w / 2, s.topMm, zf]} u={[w, 0, 0]} v={[0, -s.thicknessMm, 0]} />
            </Part>
          );
        }
        const ix0 = x0 + post;
        const ix1 = x1 - post;
        if (s.outsideDoor) {
          return (
            <Part key={i} cls="cab-shelf cab-shelf--open">
              <Quad cls="m-mesh" a={[ix0, s.topMm, -D + post]} u={[ix1 - ix0, 0, 0]} v={[0, 0, D - 2 * post]} />
              <Quad cls="m-steel f-front" a={[x0, s.topMm, 0]} u={[x1 - x0, 0, 0]} v={[0, -s.thicknessMm, 0]} />
            </Part>
          );
        }
        return (
          <Part key={i} cls="cab-shelf cab-shelf--floor">
            <Quad cls={s.material === 'glass' ? 'm-glass-plate' : 'm-mesh'} a={[ix0, s.topMm, -D + post]} u={[ix1 - ix0, 0, 0]} v={[0, 0, D - 2 * post]} />
            <Quad cls="m-steel f-front" a={[x0, s.topMm, 0]} u={[x1 - x0, 0, 0]} v={[0, -s.thicknessMm, 0]} />
          </Part>
        );
      })}
    </>
  );
}

/** A steel-framed glass cabinet on legs (the KLINGSBO): corner posts, splayed legs below the body. */
function FrameAndLegs({ slot }: { slot: WallSlot }) {
  const p = slot.profile;
  const { leftMm: x0, rightMm: x1 } = slot;
  const D = p.outer.depthMm;
  const H = p.outer.heightMm;
  const sec = p.base.leg?.sectionMm ?? p.panels.sideMm;
  const legTop = p.base.heightMm;
  const side = sideOverhangMm(p);
  const front = p.footprint?.frontOverhangMm ?? 0;
  const splay = p.base.leg?.splay === true;
  const corners: { x: number; z: number; dx: number; dz: number }[] = [
    { x: x0, z: -sec, dx: -side, dz: front },
    { x: x1 - sec, z: -sec, dx: side, dz: front },
    { x: x0, z: -D, dx: -side, dz: 0 },
    { x: x1 - sec, z: -D, dx: side, dz: 0 },
  ];
  return (
    <>
      {corners.map((c, i) => (
        <Part key={`p${i}`} cls="cab-post">
          <Box x0={c.x} x1={c.x + sec} y0={legTop} y1={H} z0={c.z} z1={c.z + sec} cls="m-steel" faces={['front', 'left', 'right']} />
        </Part>
      ))}
      {corners.map((c, i) => (
        <Part key={`l${i}`} cls={`cab-leg ${splay ? 'cab-leg--splay' : ''}`}>
          <Quad cls="m-steel f-front" a={[c.x, legTop, c.z + sec]} u={[sec, 0, 0]} v={[c.dx, -legTop, c.dz]} />
          <Quad cls="m-steel f-side" a={[c.dx < 0 ? c.x : c.x + sec, legTop, c.z]} u={[0, 0, sec]} v={[c.dx, -legTop, c.dz]} />
          <Quad cls="m-steel f-top cab-foot" a={[c.x + c.dx - 6, 0.5, c.z + c.dz - 4]} u={[sec + 12, 0, 0]} v={[0, 0, sec + 8]} />
        </Part>
      ))}
    </>
  );
}

/** The Detolf's shelf-support ladders: four thin rods at the plate corners. */
function Rods({ slot }: { slot: WallSlot }) {
  const p = slot.profile;
  if (!p.plate) return null;
  const floor = caseFloor(p);
  const top = p.surfaces[p.surfaces.length - 1];
  const w = p.plate.widthMm;
  const zf = -p.plate.frontInsetMm;
  const zb = zf - p.plate.depthMm;
  const xs = [slot.centerMm - w / 2 + 3, slot.centerMm + w / 2 - 9];
  const zs = [zf - 9, zb + 3];
  return (
    <>
      {xs.flatMap((x) =>
        zs.map((z) => (
          <Part key={`${x}:${z}`} cls="cab-rod">
            <Box x0={x} x1={x + 6} y0={floor.topMm} y1={top.topMm - top.thicknessMm} z0={z} z1={z + 6} cls="m-rod" faces={['front', 'left']} />
          </Part>
        )),
      )}
    </>
  );
}

/** An open boltless rack: corner posts are the legs; a beam and a board at every level. */
function Rack({ slot }: { slot: WallSlot }) {
  const p = slot.profile;
  const { leftMm: x0, rightMm: x1 } = slot;
  const D = p.outer.depthMm;
  const H = p.outer.heightMm;
  const post = p.rack?.postMm ?? 38;
  return (
    <>
      {[x0, x1 - post].flatMap((x) =>
        [-post, -D].map((z) => (
          <Part key={`${x}:${z}`} cls="cab-post">
            <Box x0={x} x1={x + post} y0={0} y1={H} z0={z} z1={z + post} cls="m-steel" faces={['front', 'left', 'right']} />
          </Part>
        )),
      )}
      {p.surfaces.map((s, i) => (
        <Part key={i} cls={`cab-beam ${i === p.surfaces.length - 1 ? 'cab-top' : ''}`}>
          <Box x0={x0} x1={x1} y0={s.topMm - s.thicknessMm} y1={s.topMm} z0={-D} z1={0} cls="m-steel" faces={['front', 'left', 'right', 'bottom']} />
          <Quad cls="m-board" a={[x0 + post / 2, s.topMm, -D + post / 2]} u={[x1 - x0 - post, 0, 0]} v={[0, 0, D - post]} />
        </Part>
      ))}
    </>
  );
}

function Cabinet({ slot, index }: { slot: WallSlot; index: number }) {
  const p = slot.profile;
  return (
    <div class="cab" data-profile={p.id} data-index={index}>
      {p.frame === 'open-rack' ? (
        <Rack slot={slot} />
      ) : (
        <>
          {p.base.style === 'legs' && <FrameAndLegs slot={slot} />}
          {p.base.style !== 'legs' && <Rods slot={slot} />}
          <Surfaces slot={slot} />
          <Panes slot={slot} />
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- figures

interface FigureDraw {
  readonly placed: PlacedFigure;
  readonly slot: SurfaceSlot;
  /** World x of the footprint's centre. */
  readonly cx: number;
}

function ArtBody({ art, name }: { art: FigureArt; name: string }) {
  if (art.kind === 'masked') {
    return (
      <div
        class="cab-figure__art cab-figure__art--masked"
        data-image-url={art.url}
        data-mask-url={art.maskUrl}
        style={{
          backgroundImage: `url(${JSON.stringify(art.url)})`,
          WebkitMaskImage: `url(${JSON.stringify(art.maskUrl)})`,
          maskImage: `url(${JSON.stringify(art.maskUrl)})`,
        }}
      />
    );
  }
  if (art.kind === 'cutout') return <img class="cab-figure__art cab-figure__art--cutout" src={art.url} alt="" draggable={false} />;
  if (art.kind === 'framed') {
    return (
      <div class="cab-figure__frame">
        <img class="cab-figure__art" src={art.url} alt="" draggable={false} />
      </div>
    );
  }
  return <div class="cab-figure__plate">{name}</div>;
}

/** Aspect of what the figure draws: the image's own when the list gives it, else the display meta's. */
function artAspect(art: FigureArt, image: FigureImageRef | undefined, metaAspect: number): number {
  if (art.kind === 'plate') return 0.75;
  if (image?.width && image.height) return image.width / image.height;
  return metaAspect;
}

/** No picture alpha to read (framed, plate): nothing clear around the figure, known at once. */
const OPAQUE: PictureMargins = { top: 0, bottom: 0 };

/**
 * The clear margins of what the case draws for a figure: the image list's
 * bottom when it gives one, the rest from the picture's alpha; null while
 * the alpha is still being read.
 */
function pictureMargins(art: FigureArt, alpha: ReadonlyMap<string, AlphaMargins> | null): PictureMargins | null {
  if (!art.alphaUrl) return OPAQUE;
  const read = alpha?.get(art.alphaUrl);
  if (!read) return null;
  return { top: read.top, bottom: art.bottomMarginFrac ?? read.bottom, left: read.left, right: read.right };
}

function SceneFigure({
  draw,
  art,
  aspect,
  margins,
  labels,
  onSelect,
}: {
  draw: FigureDraw;
  art: FigureArt;
  aspect: number;
  /** null while its picture's alpha is still being read: drawn meanwhile on what the image list says, not grounded. */
  margins: PictureMargins | null;
  labels: boolean;
  onSelect: () => void;
}) {
  const { placed, slot, cx } = draw;
  const { item } = placed;
  const band = useContactBand(art.contactBand ? undefined : art.alphaUrl);
  const grounded = margins !== null;
  const picture = pictureBox(art.kind, placed.heightMm, aspect, margins ?? { top: 0, bottom: art.bottomMarginFrac ?? 0 }, item.widthMm);
  const boxH = picture.heightMm;
  const boxW = picture.widthMm;
  const yBottom = slot.topMm - picture.belowMm;
  const z = placed.zMm;
  // the tap box: the figure standing on its surface, never wider than its footprint and half the gap each side,
  // so neighbours' boxes meet at most; the picture hangs from it by its transparent margins and takes no taps
  const tapW = Math.min(boxW, item.widthMm + FIGURE_GAP_MM);
  const tapX0 = cx - tapW / 2;
  const q = quadStyle([tapX0, slot.topMm + placed.heightMm, z], [tapW, 0, 0], [0, -placed.heightMm, 0]);
  const contact = art.contactBand ?? band ?? { centerXFrac: 0.5, widthFrac: art.kind === 'cutout' || art.kind === 'masked' ? 0.6 : 0.9 };
  const shadowW = Math.max(20, contact.widthFrac * boxW * 1.15);
  const shadowD = Math.min(slot.depthMm, Math.max(40, item.depthMm));
  const shadowX = cx - boxW / 2 + contact.centerXFrac * boxW;
  const plateW = Math.min(PLATE_MAX_MM, item.widthMm);
  const box = (x0: number, x1: number, y0: number, y1: number) =>
    JSON.stringify({ x0: num(x0), x1: num(x1), y0: num(y0), y1: num(y1), z: num(z), surface: slot.topMm });
  return (
    <>
      <Quad cls="cab-shadow" a={[shadowX - shadowW / 2, slot.topMm + 0.6, z - shadowD / 2]} u={[shadowW, 0, 0]} v={[0, 0, shadowD]} />
      <button
        type="button"
        class={`q cab-figure ${placed.tooDeep ? 'cab-figure--overhang' : ''}`}
        style={q ?? undefined}
        aria-label={item.figure.name}
        data-art={art.kind}
        data-figure-id={item.figure._id}
        data-grounded={grounded ? '1' : '0'}
        data-world={box(tapX0, tapX0 + tapW, slot.topMm, slot.topMm + placed.heightMm)}
        data-art-box={box(cx - boxW / 2, cx + boxW / 2, yBottom, yBottom + boxH)}
        onClick={onSelect}
      >
        <span
          class="cab-figure__box"
          style={{
            left: `${fmt(cx - boxW / 2 - tapX0)}px`,
            // the button's top is the figure's head; the picture rises above it by its clear top margin
            top: `${fmt(slot.topMm + placed.heightMm - (yBottom + boxH))}px`,
            width: `${fmt(boxW)}px`,
            height: `${fmt(boxH)}px`,
            pointerEvents: 'none',
          }}
        >
          <ArtBody art={art} name={item.figure.name} />
        </span>
      </button>
      {labels && (
        <div class="q cab-plate" style={quadStyle([cx - plateW / 2, slot.topMm + 1, slot.frontZMm + 1], [plateW, 0, 0], [0, -30, 0]) ?? undefined}>
          {item.figure.name}
        </div>
      )}
    </>
  );
}

// --------------------------------------------------------------------- scene

export interface CabinetSceneProps {
  figures: readonly Figure[];
  onSelect: (figure: Figure, index: number) => void;
  prefs: CasePrefs;
  labels?: boolean;
  /** The image list's entry for a figure (GetProductImages); absent = resolveFigureImageUrl. */
  imageFor?: (figure: Figure) => FigureImageRef | undefined;
  /** The frame where nothing can be measured (tests). */
  frameFallback?: { width: number; height: number };
}

const REASON: Record<Violator['reason'], string> = { 'too-tall': 'too tall', 'too-wide': 'too wide', 'too-deep': 'too deep' };

function useFrame(ref: { current: HTMLElement | null }, fallback: { width: number; height: number }) {
  const [frame, setFrame] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (width > 0 && height > 0) setFrame((f) => (f.width === width && f.height === height ? f : { width, height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref]);
  return frame;
}

export function CabinetScene({
  figures,
  onSelect,
  prefs,
  labels = false,
  imageFor,
  frameFallback = DEFAULT_FRAME,
}: CabinetSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const frame = useFrame(hostRef, frameFallback);
  const ceilingMm = prefs.ceilingMm;
  const pattern = useMemo(() => wallPatternProfiles(prefs.pattern), [prefs.pattern]);

  // what the case draws for each figure, in the shape it draws it (the image list's own size when it gives one)
  const arts = useMemo(
    () =>
      figures.map((f) => {
        const meta = getDisplayMeta(f);
        const image = imageFor?.(f);
        const art = figureArt(f, meta, image);
        return { meta, art, aspect: artAspect(art, image, meta.aspect) };
      }),
    [figures, imageFor],
  );
  const alphaUrls = useMemo(() => [...new Set(arts.flatMap(({ art }) => (art.alphaUrl ? [art.alphaUrl] : [])))], [arts]);
  // every picture's clear margins, known all at once: the case lays out once on them, never on a part of the list
  const alpha = useAlphaMarginsOf(alphaUrls);

  const packed = useMemo(() => {
    // each figure is packed by what the case draws for it: its label, or what its cut-out draws at true scale when wider
    const items = figures.map((f, i) => {
      const { meta, art, aspect } = arts[i];
      const drawn = art.alphaUrl ? pictureMargins(art, alpha) : null;
      return measureCaseFigure(f, i, { ...meta, aspect }, drawn ?? undefined);
    });
    return packCabinets(items, pattern, ceilingMm);
  }, [figures, arts, alpha, pattern, ceilingMm]);

  const cabinets: readonly (PackedCabinet | null)[] = packed.cabinets.length > 0 ? packed.cabinets : [null];
  const wall = useMemo(() => wallLayout(cabinets.map((c, i) => c?.profile ?? pattern[i % pattern.length])), [cabinets, pattern]);
  const headroomMm = useMemo(
    () =>
      wall.cabinets.map((slot, i) => {
        const top = cabinets[i]?.surfaces.find((s) => s.slot.isTop);
        const tallest = top && top.items.length > 0 ? Math.max(...top.items.map((p) => p.heightMm)) : null;
        return framingHeadroomMm(slot.profile, tallest, ceilingMm);
      }),
    [wall, cabinets, ceilingMm],
  );

  const [focus, setFocus] = useState(0);
  const [shelf, setShelf] = useState(0);
  const [walkX, setWalkX] = useState<number | null>(null);
  const [pan, setPan] = useState(0);
  const [liveDx, setLiveDx] = useState(0);

  // a new view, wall or swipe mode starts from its own framing
  useEffect(() => {
    setWalkX(null);
    setPan(0);
  }, [prefs.view, prefs.pattern, prefs.swipe]);

  const lastIndex = wall.cabinets.length - 1;
  const focusIdx = Math.min(focus, lastIndex);
  const framingInput = { frame, wall, headroomMm, view: prefs.view, focus: focusIdx, shelf, ceilingMm };
  const base = frameCase(framingInput);
  const pages = prefs.view === 'wall' ? wallPages(framingInput) : wall.cabinets.map((_, i) => [i]);
  const pageIdx = pages.findIndex((p) => p.includes(focusIdx));
  const walked = walkX === null ? base : { ...base, camera: { ...base.camera, x: walkX }, look: [walkX, base.look[1], base.look[2]] as const };
  const swiping = prefs.swipe === 'camera' && liveDx !== 0;
  const framing = swiping ? swipeCamera(walked, wall, liveDx) : walked;
  const [panMin, panMax] = panLimitsPx(framing, wall);
  const clampPan = (v: number) => Math.min(panMax, Math.max(panMin, v));
  const panPx = prefs.swipe === 'pan' ? clampPan(pan + liveDx) : 0;
  const { camera } = framing;

  // draw only the cabinets that can draw into the frame where the panned picture now sits: never the whole wall
  // (a hundred cabinets of preserve-3d faces stall the browser); the room's far floor reaches widest
  const room = useMemo(
    () => ({
      y0: 0,
      y1: Math.max(ceilingMm, ...wall.cabinets.map((c) => c.profile.outer.heightMm)),
      z0: -Math.max(...wall.cabinets.map((c) => c.profile.outer.depthMm)),
      z1: Math.max(...wall.cabinets.map((c) => c.profile.footprint?.frontOverhangMm ?? 0)),
    }),
    [wall, ceilingMm],
  );
  const visible = cabinetsInReach(wall, wallReachMm(camera, panPx, room, REACH_MARGIN_MM)).map((i) => ({ slot: wall.cabinets[i], i }));

  // --- swipe (CC4) and tap
  const press = useRef<{ id: number; x0: number; active: boolean } | null>(null);
  const swallowClick = useRef(false);
  const onPointerDown = useCallback((e: PointerEvent) => {
    press.current = { id: e.pointerId, x0: e.clientX, active: false };
    // a touch swipe makes no click: whatever it left to swallow ends with the next press
    swallowClick.current = false;
  }, []);
  const onPointerMove = useCallback((e: PointerEvent) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x0;
    if (!p.active && Math.abs(dx) >= SWIPE_START_PX) {
      p.active = true;
      try {
        hostRef.current?.setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic pointer cannot be captured */
      }
    }
    if (p.active) setLiveDx(dx);
  }, []);
  const endPress = (e: PointerEvent, commit: boolean) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    if (!p.active) return;
    const dx = e.clientX - p.x0;
    swallowClick.current = true;
    setLiveDx(0);
    if (!commit) return;
    if (prefs.swipe === 'pan') {
      setPan(clampPan(pan + dx));
      return;
    }
    const moved = swipeCamera(walked, wall, dx);
    setWalkX(moved.camera.x);
    let nearest = 0;
    wall.cabinets.forEach((c, i) => {
      if (Math.abs(c.centerMm - moved.camera.x) < Math.abs(wall.cabinets[nearest].centerMm - moved.camera.x)) nearest = i;
    });
    setFocus(nearest);
  };
  const onClickCapture = (e: MouseEvent) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.stopPropagation();
    e.preventDefault();
  };

  const goCabinet = (to: number) => {
    setFocus(Math.max(0, Math.min(lastIndex, to)));
    setWalkX(null);
    setPan(0);
  };
  const goPage = (step: number) => {
    const target = pages[Math.max(0, Math.min(pages.length - 1, pageIdx + step))];
    goCabinet(target[0]);
  };
  const shelfCount = wall.cabinets[focusIdx].profile.surfaces.length - (wall.cabinets[focusIdx].profile.top.usable ? 0 : 1);
  const shelfIdx = Math.min(shelf, shelfCount - 1);

  // --- figures
  const draws: { draw: FigureDraw; cab: number }[] = [];
  cabinets.forEach((cab, ci) => {
    if (!cab) return;
    const ws = wall.cabinets[ci];
    for (const surf of cab.surfaces) {
      const left = ws.centerMm - surf.slot.widthMm / 2;
      for (const placed of surf.items) {
        draws.push({ cab: ci, draw: { placed, slot: surf.slot, cx: left + placed.xMm + placed.item.widthMm / 2 } });
      }
    }
  });
  const shownCabs = new Set(visible.map((v) => v.i));
  const overhangs = draws.filter((d) => d.draw.placed.tooDeep);
  const flagged = packed.violators.length + overhangs.length;
  const activeName = pattern[0].name;

  const maxDepth = Math.max(...wall.cabinets.map((c) => c.profile.outer.depthMm));
  const zBack = -maxDepth - 450;
  const roomX0 = wall.leftMm - 6000;
  const roomW = wall.rightMm - wall.leftMm + 12000;

  return (
    <div
      ref={hostRef}
      class="cabinet-scene"
      role="region"
      aria-label="Display cabinets"
      data-view={prefs.view}
      data-swipe={prefs.swipe}
      data-pattern={prefs.pattern}
      data-focus={String(focusIdx)}
      data-shelf={String(shelfIdx)}
      data-camera-x={fmt(camera.x)}
      data-camera={JSON.stringify({
        x: num(camera.x),
        y: num(camera.y),
        z: num(camera.z),
        pitch: num(camera.pitch),
        focalPx: num(camera.focalPx),
        width: camera.frame.width,
        height: camera.frame.height,
      })}
      data-pan={String(Math.round(panPx))}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endPress(e, true)}
      onPointerCancel={(e) => endPress(e, false)}
      onClickCapture={onClickCapture}
    >
      <div
        class="cabinet-scene__viewport"
        style={{ perspective: `${fmt(camera.focalPx)}px`, transform: panPx ? `translateX(${panPx}px)` : undefined }}
      >
        <div class="cabinet-scene__root" style={{ transform: cssSceneTransform(camera, S) }}>
          <Quad cls="room-wall" a={[roomX0, 3200, zBack]} u={[roomW, 0, 0]} v={[0, -3200, 0]} />
          <Quad cls="room-floor" a={[roomX0, 0, zBack]} u={[roomW, 0, 0]} v={[0, 0, 6500]} />
          {visible.map(({ slot, i }) => (
            <Cabinet key={`${i}:${slot.profile.id}`} slot={slot} index={i} />
          ))}
          {draws
            .filter((d) => shownCabs.has(d.cab))
            .map(({ draw }) => {
              const { figure, index } = draw.placed.item;
              const { art, aspect } = arts[index];
              return (
                <SceneFigure
                  key={figure._id}
                  draw={draw}
                  art={art}
                  aspect={aspect}
                  margins={pictureMargins(art, alpha)}
                  labels={labels}
                  onSelect={() => onSelect(figure, index)}
                />
              );
            })}
        </div>
      </div>

      <div class="cabinet-scene__nav">
        <button
          type="button"
          class="cabinet-scene__step cabinet-scene__step--prev"
          aria-label="Previous cabinet"
          disabled={prefs.view === 'wall' ? pageIdx <= 0 : focusIdx <= 0}
          onClick={() => (prefs.view === 'wall' ? goPage(-1) : goCabinet(focusIdx - 1))}
        >
          ‹
        </button>
        <button
          type="button"
          class="cabinet-scene__step cabinet-scene__step--next"
          aria-label="Next cabinet"
          disabled={prefs.view === 'wall' ? pageIdx >= pages.length - 1 : focusIdx >= lastIndex}
          onClick={() => (prefs.view === 'wall' ? goPage(1) : goCabinet(focusIdx + 1))}
        >
          ›
        </button>
        {prefs.view === 'shelf' && (
          <div class="cabinet-scene__shelves">
            <button type="button" aria-label="Shelf above" disabled={shelfIdx <= 0} onClick={() => setShelf(Math.max(0, shelfIdx - 1))}>
              ˄
            </button>
            <button
              type="button"
              aria-label="Shelf below"
              disabled={shelfIdx >= shelfCount - 1}
              onClick={() => setShelf(Math.min(shelfCount - 1, shelfIdx + 1))}
            >
              ˅
            </button>
          </div>
        )}
      </div>

      {flagged > 0 && (
        <details class="cabinet-scene__fit" data-count={String(flagged)}>
          <summary>{flagged === 1 ? '1 figure does not fit' : `${flagged} figures do not fit`}</summary>
          <ul>
            {packed.violators.map((v) => (
              <li key={v.item.figure._id}>
                {v.item.figure.name}: {REASON[v.reason]} for the {activeName}
              </li>
            ))}
            {overhangs.map(({ draw }) => (
              <li key={draw.placed.item.figure._id}>
                {draw.placed.item.figure.name}: too deep for its shelf, it overhangs
              </li>
            ))}
          </ul>
        </details>
      )}
      <Style css={styles} />
    </div>
  );
}

// The page sizes the scene (Collection: down to the pull-up tabs); 60vh only where nothing does.
const styles = `
  .cabinet-scene {
    position: relative;
    overflow: hidden;
    height: 60vh;
    background: #0b0c0f;
    touch-action: pan-y;
    user-select: none;
    -webkit-user-select: none;
  }
  .cabinet-scene__viewport { position: absolute; inset: 0; perspective-origin: 50% 50%; }
  .cabinet-scene__root { position: absolute; left: 0; top: 0; width: 0; height: 0; transform-origin: 0 0 0; transform-style: preserve-3d; }
  .cabinet-scene .cab, .cabinet-scene .part { position: absolute; left: 0; top: 0; width: 0; height: 0; transform-style: preserve-3d; pointer-events: none; }
  .cabinet-scene .q { position: absolute; left: 0; top: 0; transform-origin: 0 0 0; pointer-events: none; box-sizing: border-box; }
  .cabinet-scene .room-wall { background: linear-gradient(180deg, #2d3037 0%, #23262c 55%, #1a1c21 100%); }
  .cabinet-scene .room-floor { background: linear-gradient(180deg, #121317 0%, #1b1d22 45%, #262930 100%); }
  .cabinet-scene .m-steel { background: #1d1e22; }
  .cabinet-scene .m-steel.f-side { background: #131417; }
  .cabinet-scene .m-steel.f-top { background: #2b2d32; }
  .cabinet-scene .m-steel.f-bottom { background: #0d0e10; }
  .cabinet-scene .m-wood { background: #2f2825; }
  .cabinet-scene .m-wood.f-side { background: #221c1a; }
  .cabinet-scene .m-wood.f-top { background: #3b332f; }
  .cabinet-scene .m-rod { background: #747b83; }
  .cabinet-scene .m-board { background: linear-gradient(0deg, #5a4a3a, #47392d); }
  .cabinet-scene .m-mesh {
    background:
      repeating-linear-gradient(45deg, rgba(0, 0, 0, 0.55) 0 3px, transparent 3px 11px),
      repeating-linear-gradient(-45deg, rgba(0, 0, 0, 0.55) 0 3px, transparent 3px 11px),
      #2c2e33;
  }
  /* CC13: glass is clear, edges only, no reflections or tint to speak of (Ross 09-27) */
  .cabinet-scene .m-glass-plate { background: rgba(190, 226, 230, 0.07); box-shadow: inset 0 0 0 2px rgba(196, 236, 236, 0.45); }
  .cabinet-scene .m-glass-top { background: rgba(190, 226, 230, 0.10); box-shadow: inset 0 0 0 3px #1d1e22; }
  .cabinet-scene .m-glass-edge { background: rgba(176, 232, 232, 0.8); }
  .cabinet-scene .cab-pane { background: rgba(190, 226, 230, 0.035); box-shadow: inset 0 0 0 1px rgba(190, 236, 236, 0.22); }
  .cabinet-scene .cab-shadow {
    background: radial-gradient(ellipse at 50% 50%, rgba(0, 0, 0, 0.62) 0%, rgba(0, 0, 0, 0.3) 45%, rgba(0, 0, 0, 0) 72%);
  }
  .cabinet-scene .cab-figure {
    pointer-events: auto;
    padding: 0;
    margin: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .cabinet-scene .cab-figure__box { position: absolute; display: block; }
  .cabinet-scene .cab-figure:focus-visible { outline: 3px solid var(--brand-400, #5aa0ff); outline-offset: 2px; }
  .cabinet-scene .cab-figure__art { display: block; width: 100%; height: 100%; max-width: none; object-fit: fill; }
  .cabinet-scene .cab-figure__art--masked {
    background-size: 100% 100%;
    background-repeat: no-repeat;
    -webkit-mask-size: 100% 100%;
    mask-size: 100% 100%;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
  }
  .cabinet-scene .cab-figure__frame {
    width: 100%;
    height: 100%;
    padding: 5%;
    box-sizing: border-box;
    background: #f4f1ea;
    box-shadow: inset 0 0 0 3px #b9b2a4;
  }
  .cabinet-scene .cab-figure__frame img { width: 100%; height: 100%; object-fit: contain; }
  .cabinet-scene .cab-figure__plate {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8%;
    box-sizing: border-box;
    background: #3a3d45;
    border-radius: 6px;
    color: #e6e8ee;
    font: 600 22px/1.2 var(--font-sans, system-ui);
    text-align: center;
    overflow: hidden;
  }
  .cabinet-scene .cab-plate {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #d9cfb8;
    color: #2b2620;
    font: 600 11px/1 var(--font-sans, system-ui);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0 4px;
  }
  .cabinet-scene__nav { position: absolute; inset: 0; pointer-events: none; }
  .cabinet-scene__step {
    position: absolute;
    top: 50%;
    width: 32px;
    height: 48px;
    margin-top: -24px;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.35);
    color: rgba(255, 255, 255, 0.85);
    font: 600 24px/1 var(--font-sans, system-ui);
    pointer-events: auto;
  }
  .cabinet-scene__step:disabled { opacity: 0; pointer-events: none; }
  .cabinet-scene__step--prev { left: 4px; }
  .cabinet-scene__step--next { right: 4px; }
  .cabinet-scene__shelves { position: absolute; right: 4px; top: 8px; display: flex; flex-direction: column; gap: 4px; pointer-events: auto; }
  .cabinet-scene__shelves button {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.35);
    color: rgba(255, 255, 255, 0.85);
    font: 600 18px/1 var(--font-sans, system-ui);
  }
  .cabinet-scene__shelves button:disabled { opacity: 0.25; }
  .cabinet-scene__fit {
    position: absolute;
    left: 8px;
    top: 8px;
    max-width: calc(100% - 64px);
    padding: 4px 8px;
    border-radius: 8px;
    background: rgba(120, 30, 20, 0.85);
    color: #fff;
    font: 600 12px/1.3 var(--font-sans, system-ui);
  }
  .cabinet-scene__fit ul { margin: 4px 0 0; padding-left: 16px; font-weight: 500; }
`;

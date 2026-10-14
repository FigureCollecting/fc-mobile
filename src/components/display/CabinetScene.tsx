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
 *
 * MOB-NAV-2 (caseCull): at most five cabinets are drawn, the ones nearest the
 * frame centre; each face is cut to the frame and half a viewport round it;
 * a figure past it, or hidden under a board, is not drawn; and the world is
 * drawn at the px per mm the screen shows it (texelScale), never at 1 px per
 * mm, as Chrome rasters each face at the device pixel ratio per element px.
 */
import { createContext } from 'preact';
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
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
import { cabinetBox, frameCase, panFraming, panLimitsPx, settleWalk, swipeCamera, wallPages } from './caseFraming';
import {
  FIGURE_BUDGET_VIEWPORTS,
  FLAT_GRID,
  GRADIENT_GRID,
  cullRect,
  figureScales,
  figuresToDraw,
  nearestCabinets,
  opaqueBoards,
  stickyView,
  texelScale,
  trimFace,
  type CullView,
  type FigureBox,
  type Rect,
  type TexelGrid,
} from './caseCull';
import { figureArt, pictureBox, pictureOffsetMm, type FigureArt, type FigureImageRef, type PictureMargins } from './figureArt';
import { wallPatternProfiles, type CasePrefs } from './casePrefs';
import { alphaPictureLoaded, useAlphaMarginsOf, useContactBand, type AlphaMargins } from './alphaMargin';
import { useBrokenImages } from '../../hooks/useBrokenImages';

/** A sideways move this long (CSS px) turns a press into a swipe; shorter stays a tap. */
export const SWIPE_START_PX = 8;
const DEFAULT_FRAME = { width: 360, height: 480 };
/** A nameplate's full width; a narrower figure's plate is its own width, so neighbours' plates never meet. */
const PLATE_MAX_MM = 110;

type V3 = readonly [number, number, number];

const fmt = (v: number): string => {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? '0' : String(r);
};
const num = (v: number): number => Number(fmt(v));

/**
 * The room's wall and floor are flat gradients, so they are drawn on this
 * small grid and stretched onto the room by their matrix (MOB-NAV-1). At
 * 1 px per mm they were the wall plus 12 m wide: a 1,190-figure wall made a
 * 105 m x 6.5 m floor element, whose tiles at the Fold8's 2.8125 ran Chrome's
 * compositor out of tile memory and left the screen's chrome undrawn.
 */
const ROOM_GRID: TexelGrid = { u: 64, v: 256 };

/**
 * One flat face: corner `a` (world mm), its local x along `u` and local y
 * (down the element) along `v`, in a world drawn at `s` px per mm. The
 * element is |u| x |v| mm at s px per mm, or `grid`'s size when given;
 * matrix3d maps it onto the face. null when the face has no area.
 */
export function quadStyle(a: V3, u: V3, v: V3, grid?: TexelGrid, s = 1): { width: string; height: string; transform: string } | null {
  const lu = Math.hypot(u[0], u[1], u[2]);
  const lv = Math.hypot(v[0], v[1], v[2]);
  if (!(lu > 0) || !(lv > 0)) return null;
  const pu = grid?.u ?? lu * s;
  const pv = grid?.v ?? lv * s;
  // world px per element px along each side: 1 off a grid
  const su = (lu * s) / pu;
  const sv = (lv * s) / pv;
  const U = [u[0] / lu, -u[1] / lu, u[2] / lu];
  const V = [v[0] / lv, -v[1] / lv, v[2] / lv];
  const n = [U[1] * V[2] - U[2] * V[1], U[2] * V[0] - U[0] * V[2], U[0] * V[1] - U[1] * V[0]];
  const ln = Math.hypot(n[0], n[1], n[2]) || 1;
  const N = n.map((c) => c / ln);
  const cols = [...U.map((c) => c * su), 0, ...V.map((c) => c * sv), 0, ...N, 0, a[0] * s, -a[1] * s, a[2] * s, 1];
  return { width: `${fmt(pu)}px`, height: `${fmt(pv)}px`, transform: `matrix3d(${cols.map(fmt).join(',')})` };
}

/** What the scene draws now: the picture it culls for, the frame and its margin, and the px per mm (caseCull). */
interface Draw {
  readonly view: CullView;
  readonly rect: Rect;
  readonly s: number;
}

const DrawContext = createContext<Draw | null>(null);

const along = (a: V3, u: V3, v: V3, s: number, t: number): V3 => [a[0] + s * u[0] + t * v[0], a[1] + s * u[1] + t * v[1], a[2] + s * u[2] + t * v[2]];
const times = (u: V3, k: number): V3 => [u[0] * k, u[1] * k, u[2] * k];

/**
 * A face, cut to the part that draws in the frame and its margin (nothing when none does); a cut face's
 * background is laid on the whole face, its element a window onto it, so a gradient stays where it was.
 */
function Quad({ a, u, v, cls, style, grid }: { a: V3; u: V3; v: V3; cls: string; style?: JSX.CSSProperties; grid?: TexelGrid }) {
  // every face is drawn inside the scene, which provides what it draws
  const draw = useContext(DrawContext)!;
  const { s } = draw;
  let face: [V3, V3, V3] = [a, u, v];
  let window: JSX.CSSProperties | undefined;
  const cut = trimFace(draw.view, a, u, v, draw.rect);
  if (!cut) return null;
  const ds = cut.s1 - cut.s0;
  const dt = cut.t1 - cut.t0;
  if (ds < 1 || dt < 1) face = [along(a, u, v, cut.s0, cut.t0), times(u, ds), times(v, dt)];
  const q = quadStyle(...face, grid, s);
  if (!q) return null;
  if (ds < 1 || dt < 1) {
    const [pu, pv] = [parseFloat(q.width) / ds, parseFloat(q.height) / dt];
    window = { backgroundSize: `${fmt(pu)}px ${fmt(pv)}px`, backgroundPosition: `${fmt(-cut.s0 * pu)}px ${fmt(-cut.t0 * pv)}px` };
  }
  return <div class={`q ${cls}`} style={{ ...q, ...window, ...style }} />;
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

/** An axis-aligned box of one flat colour (steel, wood, a rod) as up to six faces, each carrying `cls` plus its own face class for shading. */
function Box({ x0, x1, y0, y1, z0, z1, cls, faces = ['front', 'back', 'left', 'right', 'top', 'bottom'] }: BoxProps) {
  const w = x1 - x0;
  const h = y1 - y0;
  const d = z1 - z0;
  const out: ComponentChildren[] = [];
  for (const f of faces) {
    if (f === 'front') out.push(<Quad key={f} grid={FLAT_GRID} cls={`${cls} f-front`} a={[x0, y1, z1]} u={[w, 0, 0]} v={[0, -h, 0]} />);
    if (f === 'back') out.push(<Quad key={f} grid={FLAT_GRID} cls={`${cls} f-back`} a={[x0, y1, z0]} u={[w, 0, 0]} v={[0, -h, 0]} />);
    if (f === 'left') out.push(<Quad key={f} grid={FLAT_GRID} cls={`${cls} f-side`} a={[x0, y1, z0]} u={[0, 0, d]} v={[0, -h, 0]} />);
    if (f === 'right') out.push(<Quad key={f} grid={FLAT_GRID} cls={`${cls} f-side`} a={[x1, y1, z0]} u={[0, 0, d]} v={[0, -h, 0]} />);
    if (f === 'top') out.push(<Quad key={f} grid={FLAT_GRID} cls={`${cls} f-top`} a={[x0, y1, z0]} u={[w, 0, 0]} v={[0, 0, d]} />);
    if (f === 'bottom') out.push(<Quad key={f} grid={FLAT_GRID} cls={`${cls} f-bottom`} a={[x0, y0, z0]} u={[w, 0, 0]} v={[0, 0, d]} />);
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

/** A pane's lit edge, mm across: CC13 (Ross 09-27) glass is clear, edges only. */
const PANE_EDGE_MM = 1;

/**
 * The four edges, `mm` wide, of a flat face a + s u + t v, inside it and meeting at its corners: two along u, two
 * along v between them. One flat colour each, so each on the flat texel grid.
 */
function Edges({ a, u, v, cls, mm }: { a: V3; u: V3; v: V3; cls: string; mm: number }) {
  const lu = Math.hypot(u[0], u[1], u[2]);
  const lv = Math.hypot(v[0], v[1], v[2]);
  const eu = times(u, mm / lu);
  const ev = times(v, mm / lv);
  const inner = times(v, 1 - (2 * mm) / lv);
  return (
    <>
      <Quad grid={FLAT_GRID} cls={cls} a={a} u={u} v={ev} />
      <Quad grid={FLAT_GRID} cls={cls} a={along(a, u, v, 0, 1 - mm / lv)} u={u} v={ev} />
      <Quad grid={FLAT_GRID} cls={cls} a={along(a, u, v, 0, mm / lv)} u={eu} v={inner} />
      <Quad grid={FLAT_GRID} cls={cls} a={along(a, u, v, 1 - mm / lu, mm / lv)} u={eu} v={inner} />
    </>
  );
}

/**
 * One glass pane as its four lit edges, clear between them (CC13: edges only, no tint to speak of): a full pane
 * was a layer as large as the cabinet that showed nothing but its edges, and five cabinets of them were half the
 * case's pixels (MOB-NAV-2).
 */
function Pane({ a, u, v, cls }: { a: V3; u: V3; v: V3; cls: string }) {
  return <Edges a={a} u={u} v={v} cls={cls} mm={PANE_EDGE_MM} />;
}

/** How far a rim lies above the face it rims: off its plane, so the two never fight over which draws on top. */
const RIM_LIFT_MM = 0.3;

/**
 * A flat horizontal face a + s u + t v (u along x, v along z) of one clear colour with a rim `mm` wide of another,
 * as its CSS inset edge drew it: the fill and the rim's four edges, each on the flat texel grid.
 */
function RimmedFace({ a, u, v, cls, rimCls, mm }: { a: V3; u: V3; v: V3; cls: string; rimCls: string; mm: number }) {
  return (
    <>
      <Quad grid={FLAT_GRID} cls={cls} a={a} u={u} v={v} />
      <Edges a={[a[0], a[1] + RIM_LIFT_MM, a[2]]} u={u} v={v} cls={rimCls} mm={mm} />
    </>
  );
}

/** Glass sides, back and door: clear panes, their edges lit (CC13: see-through, one glass box per cabinet). */
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
    out.push(<Pane key="l" cls="cab-pane cab-pane--side" a={[x0 + inset, hi, -D]} u={[0, 0, D]} v={[0, -h, 0]} />);
    out.push(<Pane key="r" cls="cab-pane cab-pane--side" a={[x1 - inset, hi, -D]} u={[0, 0, D]} v={[0, -h, 0]} />);
  }
  if (p.materials.back === 'glass') {
    out.push(<Pane key="b" cls="cab-pane cab-pane--back" a={[x0, hi, -D + p.panels.backMm / 2]} u={[x1 - x0, 0, 0]} v={[0, -h, 0]} />);
  }
  if (p.materials.front === 'glassDoor') {
    out.push(<Pane key="d" cls="cab-pane cab-pane--door" a={[x0, hi, -1]} u={[x1 - x0, 0, 0]} v={[0, -h, 0]} />);
  }
  return <>{out}</>;
}

/** A glass shelf's lit rim and a glass top's steel one, mm across (their CSS inset edges before MOB-NAV-2). */
const GLASS_RIM_MM = 2;
const GLASS_TOP_RIM_MM = 3;

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
              {wood ? (
                <Quad grid={FLAT_GRID} cls="m-wood f-top" a={[x0, s.topMm, -D]} u={[x1 - x0, 0, 0]} v={[0, 0, D]} />
              ) : (
                <RimmedFace cls="m-glass-top" rimCls="m-steel f-rim" mm={GLASS_TOP_RIM_MM} a={[x0, s.topMm, -D]} u={[x1 - x0, 0, 0]} v={[0, 0, D]} />
              )}
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
              <RimmedFace cls="m-glass-plate" rimCls="m-glass-rim" mm={GLASS_RIM_MM} a={[cx - w / 2, s.topMm, zb]} u={[w, 0, 0]} v={[0, 0, zf - zb]} />
              <Quad grid={FLAT_GRID} cls={framed ? 'm-steel f-front' : 'm-glass-edge'} a={[cx - w / 2, s.topMm, zf]} u={[w, 0, 0]} v={[0, -s.thicknessMm, 0]} />
            </Part>
          );
        }
        const ix0 = x0 + post;
        const ix1 = x1 - post;
        if (s.outsideDoor) {
          return (
            <Part key={i} cls="cab-shelf cab-shelf--open">
              <Quad cls="m-mesh" a={[ix0, s.topMm, -D + post]} u={[ix1 - ix0, 0, 0]} v={[0, 0, D - 2 * post]} />
              <Quad grid={FLAT_GRID} cls="m-steel f-front" a={[x0, s.topMm, 0]} u={[x1 - x0, 0, 0]} v={[0, -s.thicknessMm, 0]} />
            </Part>
          );
        }
        return (
          <Part key={i} cls="cab-shelf cab-shelf--floor">
            {s.material === 'glass' ? (
              <RimmedFace cls="m-glass-plate" rimCls="m-glass-rim" mm={GLASS_RIM_MM} a={[ix0, s.topMm, -D + post]} u={[ix1 - ix0, 0, 0]} v={[0, 0, D - 2 * post]} />
            ) : (
              <Quad cls="m-mesh" a={[ix0, s.topMm, -D + post]} u={[ix1 - ix0, 0, 0]} v={[0, 0, D - 2 * post]} />
            )}
            <Quad grid={FLAT_GRID} cls="m-steel f-front" a={[x0, s.topMm, 0]} u={[x1 - x0, 0, 0]} v={[0, -s.thicknessMm, 0]} />
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
          <Quad grid={FLAT_GRID} cls="m-steel f-front" a={[c.x, legTop, c.z + sec]} u={[sec, 0, 0]} v={[c.dx, -legTop, c.dz]} />
          <Quad grid={FLAT_GRID} cls="m-steel f-side" a={[c.dx < 0 ? c.x : c.x + sec, legTop, c.z]} u={[0, 0, sec]} v={[c.dx, -legTop, c.dz]} />
          <Quad grid={FLAT_GRID} cls="m-steel f-top cab-foot" a={[c.x + c.dx - 6, 0.5, c.z + c.dz - 4]} u={[sec + 12, 0, 0]} v={[0, 0, sec + 8]} />
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
          <Quad grid={GRADIENT_GRID} cls="m-board" a={[x0 + post / 2, s.topMm, -D + post / 2]} u={[x1 - x0 - post, 0, 0]} v={[0, 0, D - post]} />
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

/**
 * `hidden`: loaded but not drawn (a picture whose alpha is still being read).
 * Pictures load as CORS images (ADDR-1: the service worker keeps only a CORS
 * answer); `onBroken` hears of one that fails to load.
 */
function ArtBody({ art, name, hidden = false, onBroken }: { art: FigureArt; name: string; hidden?: boolean; onBroken: (url: string) => void }) {
  const visibility = hidden ? 'hidden' : undefined;
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
          visibility,
        }}
      />
    );
  }
  if (art.kind === 'cutout') {
    // a cut-out's alpha is its own picture: once loaded, a read of it is a cache hit
    return (
      <img
        class="cab-figure__art cab-figure__art--cutout"
        src={art.url}
        alt=""
        draggable={false}
        crossOrigin="anonymous"
        style={{ visibility }}
        onLoad={() => alphaPictureLoaded(art.alphaUrl!)}
        onError={() => onBroken(art.url!)}
      />
    );
  }
  if (art.kind === 'framed') {
    return (
      <div class="cab-figure__frame">
        <img class="cab-figure__art" src={art.url} alt="" draggable={false} crossOrigin="anonymous" onError={() => onBroken(art.url!)} />
      </div>
    );
  }
  return <div class="cab-figure__plate">{name}</div>;
}

/** A plate's aspect: a figure without a picture, or one whose picture is still being read. */
const PLATE_ASPECT = 0.75;

/** Aspect of what the figure draws: the image's own when the list gives it, else the display meta's. */
function artAspect(art: FigureArt, image: FigureImageRef | undefined, metaAspect: number): number {
  if (art.kind === 'plate') return PLATE_ASPECT;
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
function pictureMargins(art: FigureArt, alpha: ReadonlyMap<string, AlphaMargins>): PictureMargins | null {
  if (!art.alphaUrl) return OPAQUE;
  const read = alpha.get(art.alphaUrl);
  if (!read) return null;
  return { top: read.top, bottom: art.bottomMarginFrac ?? read.bottom, left: read.left, right: read.right };
}

/** Where a figure draws (world mm): its picture's box and the tap box it hangs from (SceneFigure). */
function figureGeometry(draw: FigureDraw, art: FigureArt, aspect: number, margins: PictureMargins | null) {
  const { placed, slot, cx } = draw;
  const { item } = placed;
  const grounded = margins !== null;
  // until its picture is read, a figure draws its plate, within the footprint it is packed by, never the picture at a width
  // its packing may not hold; the picture loads meanwhile, hidden, and shows the moment it is read
  const drawnKind = grounded ? art.kind : 'plate';
  const known = margins ?? OPAQUE;
  const picture = pictureBox(drawnKind, placed.heightMm, grounded ? aspect : PLATE_ASPECT, known, item.widthMm);
  const boxH = picture.heightMm;
  const boxW = picture.widthMm;
  // the picture's centre: moved so the figure in it, not the picture, stands centred on its slot
  const artCx = cx + pictureOffsetMm(boxW, known);
  const yBottom = slot.topMm - picture.belowMm;
  // the tap box: the figure standing on its surface, never wider than its footprint and half the gap each side,
  // so neighbours' boxes meet at most; the picture hangs from it by its transparent margins and takes no taps
  const tapW = Math.min(boxW, item.widthMm + FIGURE_GAP_MM);
  const tapX0 = cx - tapW / 2;
  return { grounded, drawnKind, boxW, boxH, artCx, yBottom, tapW, tapX0 };
}

/** What a figure's layer covers (world mm): its tap box and the picture hanging from it, at its depth. */
function figureLayerBox(draw: FigureDraw, g: ReturnType<typeof figureGeometry>, cab: number): FigureBox {
  const top = draw.slot.topMm + draw.placed.heightMm;
  return {
    cab,
    x0: Math.min(g.tapX0, g.artCx - g.boxW / 2),
    x1: Math.max(g.tapX0 + g.tapW, g.artCx + g.boxW / 2),
    y0: Math.min(draw.slot.topMm, g.yBottom),
    y1: Math.max(top, g.yBottom + g.boxH),
    z: draw.placed.zMm,
  };
}

function SceneFigure({
  draw,
  art,
  aspect,
  margins,
  scale,
  labels,
  onSelect,
  onBroken,
}: {
  draw: FigureDraw;
  art: FigureArt;
  aspect: number;
  /** null while its picture's alpha is still being read: drawn meanwhile as its plate, not grounded. */
  margins: PictureMargins | null;
  /** The px per mm its layer is drawn at (figureScales): the scene's, or whole octaves under it; its matrix stretches it to the scene's. */
  scale: number;
  labels: boolean;
  onSelect: () => void;
  onBroken: (url: string) => void;
}) {
  const { placed, slot, cx } = draw;
  const { item } = placed;
  const { s } = useContext(DrawContext)!;
  const band = useContactBand(art.contactBand ? undefined : art.alphaUrl);
  const { grounded, drawnKind, boxW, boxH, artCx, yBottom, tapW, tapX0 } = figureGeometry(draw, art, aspect, margins);
  const z = placed.zMm;
  const k = scale;
  const q = quadStyle([tapX0, slot.topMm + placed.heightMm, z], [tapW, 0, 0], [0, -placed.heightMm, 0], { u: tapW * k, v: placed.heightMm * k }, s);
  // no contact band known: the shadow lies under the figure, the middle of its picture's opaque columns
  const contact = (grounded ? (art.contactBand ?? band) : null) ?? {
    centerXFrac: 0.5 + (cx - artCx) / boxW,
    widthFrac: drawnKind === 'cutout' || drawnKind === 'masked' ? 0.6 : 0.9,
  };
  const shadowW = Math.max(20, contact.widthFrac * boxW * 1.15);
  const shadowD = Math.min(slot.depthMm, Math.max(40, item.depthMm));
  const shadowX = artCx - boxW / 2 + contact.centerXFrac * boxW;
  const plateW = Math.min(PLATE_MAX_MM, item.widthMm);
  const box = (x0: number, x1: number, y0: number, y1: number) =>
    JSON.stringify({ x0: num(x0), x1: num(x1), y0: num(y0), y1: num(y1), z: num(z), surface: slot.topMm });
  return (
    <>
      <Quad grid={GRADIENT_GRID} cls="cab-shadow" a={[shadowX - shadowW / 2, slot.topMm + 0.6, z - shadowD / 2]} u={[shadowW, 0, 0]} v={[0, 0, shadowD]} />
      <button
        type="button"
        class={`q cab-figure ${placed.tooDeep ? 'cab-figure--overhang' : ''}`}
        style={q ? { ...q, '--s': String(k) } : undefined}
        aria-label={item.figure.name}
        data-art={art.kind}
        data-figure-id={item.figure._id}
        data-grounded={grounded ? '1' : '0'}
        data-world={box(tapX0, tapX0 + tapW, slot.topMm, slot.topMm + placed.heightMm)}
        data-art-box={box(artCx - boxW / 2, artCx + boxW / 2, yBottom, yBottom + boxH)}
        onClick={onSelect}
      >
        <span
          class="cab-figure__box"
          style={{
            left: `${fmt((artCx - boxW / 2 - tapX0) * k)}px`,
            // the button's top is the figure's head; the picture rises above it by its clear top margin
            top: `${fmt((slot.topMm + placed.heightMm - (yBottom + boxH)) * k)}px`,
            width: `${fmt(boxW * k)}px`,
            height: `${fmt(boxH * k)}px`,
            pointerEvents: 'none',
          }}
        >
          <ArtBody art={art} name={item.figure.name} hidden={!grounded} onBroken={onBroken} />
          {!grounded && <div class="cab-figure__plate cab-figure__plate--reading">{item.figure.name}</div>}
        </span>
      </button>
      {labels && (
        <div
          class="q cab-plate"
          style={{ ...quadStyle([cx - plateW / 2, slot.topMm + 1, slot.frontZMm + 1], [plateW, 0, 0], [0, -30, 0], { u: plateW * k, v: 30 * k }, s), '--s': String(k) }}
        >
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

  // a picture that fails to load stands as its plate (ADDR-1), never a blank space
  const images = useBrokenImages();
  // what the case draws for each figure, in the shape it draws it (the image list's own size when it gives one)
  const arts = useMemo(
    () =>
      figures.map((f) => {
        const meta = getDisplayMeta(f);
        const image = imageFor?.(f);
        const drawn = figureArt(f, meta, image);
        const art: FigureArt = images.broken(drawn.url) ? { kind: 'plate' } : drawn;
        return { meta, art, aspect: artAspect(art, image, meta.aspect) };
      }),
    [figures, imageFor, images.broken],
  );
  const alphaUrls = useMemo(() => [...new Set(arts.flatMap(({ art }) => (art.alphaUrl ? [art.alphaUrl] : [])))], [arts]);
  // each picture's clear margins as soon as it is read: from then on its figure is grounded and packed by what it draws;
  // one still being read stands as its plate on its label meanwhile, holding back no other
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
  // the framing and the wall's pages hold for a whole swipe: worked out once per view, not at every finger move
  const framingInput = useMemo(
    () => ({ frame, wall, headroomMm, view: prefs.view, focus: focusIdx, shelf, ceilingMm }),
    [frame, wall, headroomMm, prefs.view, focusIdx, shelf, ceilingMm],
  );
  const base = useMemo(() => frameCase(framingInput), [framingInput]);
  const pages = useMemo(() => (framingInput.view === 'wall' ? wallPages(framingInput) : wall.cabinets.map((_, i) => [i])), [framingInput, wall]);
  const pageIdx = pages.findIndex((p) => p.includes(focusIdx));
  const walked = walkX === null ? base : { ...base, camera: { ...base.camera, x: walkX }, look: [walkX, base.look[1], base.look[2]] as const };
  const swiping = prefs.swipe === 'camera' && liveDx !== 0;
  const framing = swiping ? swipeCamera(walked, wall, liveDx) : walked;
  const [panMin, panMax] = panLimitsPx(framing, wall);
  const clampPan = (v: number) => Math.min(panMax, Math.max(panMin, v));
  // pan mode: the photo slides, and past its sane extent is retaken farther along (panFraming)
  const shown = prefs.swipe === 'pan' ? panFraming(framing, clampPan(pan + liveDx)) : { framing, panPx: 0 };
  const { panPx } = shown;
  const { camera } = shown.framing;

  // MOB-NAV-2: while a finger swipes, cull for the picture last culled for until it has moved a quarter frame (the
  // half-viewport margin still covers the frame), a cabinet already drawn keeping its place against a small move;
  // once the swipe settles, cull for the settled picture itself: the five cabinets nearest its centre. Draw the
  // faces at the px per mm the screen shows the cabinets' room (floor to headroom, back to the front of the feet)
  // at its nearest
  const moving = liveDx !== 0;
  const culled = useRef<CullView | null>(null);
  const cull = moving ? stickyView(culled.current, { camera, panPx }) : { camera, panPx };
  culled.current = cull;
  const chosen = useRef<number[]>([]);
  const drawnCabs = nearestCabinets(cull, wall, moving ? chosen.current : []);
  chosen.current = drawnCabs;
  const visible = drawnCabs.map((i) => ({ slot: wall.cabinets[i], i }));
  const span = useMemo(
    () => ({
      y0: 0,
      y1: Math.max(...wall.cabinets.map((c, i) => c.profile.outer.heightMm + headroomMm[i])),
      z0: -Math.max(...wall.cabinets.map((c) => c.profile.outer.depthMm)),
      z1: Math.max(...wall.cabinets.map((c) => c.profile.footprint?.frontOverhangMm ?? 0)),
    }),
    [wall, headroomMm],
  );
  // each cabinet's box on the wall (feet and body), published for the e2e to check the frame against
  const wallBoxes = useMemo(
    () =>
      JSON.stringify(
        wall.cabinets.map((slot) => {
          const b = cabinetBox(slot, 0);
          return [b.x0, b.x1, b.y1, b.z0, b.z1];
        }),
      ),
    [wall],
  );
  const s = texelScale(camera, span);
  const draw: Draw = { view: cull, rect: cullRect(camera.frame), s };

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
    // a walk of the wall view settles where at least three cabinets stand whole (Ross 12:1xC, desk MN2 a)
    const swiped = swipeCamera(walked, wall, dx);
    const moved = prefs.view === 'wall' ? settleWalk(swiped, wall, walked.camera.x) : swiped;
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
  // a figure is drawn when its layer (its tap box and the picture hanging from it) draws into the frame and its margin
  // and no board of its cabinet hides it from the camera
  const inDrawn = draws.filter((d) => drawnCabs.includes(d.cab));
  const inDrawnBoxes = inDrawn.map(({ cab, draw: fig }) => {
    const { art, aspect } = arts[fig.placed.item.index];
    return figureLayerBox(fig, figureGeometry(fig, art, aspect, pictureMargins(art, alpha)), cab);
  });
  const { shown: showIdx, hidden } = figuresToDraw(cull, draw.rect, inDrawnBoxes, new Set(drawnCabs), (cab) => opaqueBoards(wall.cabinets[cab]));
  const onShow = showIdx.map((i) => inDrawn[i]);
  // the figures' layers cost at most their budget wherever the camera stands: the farthest from the frame centre drawn coarser
  const scales = figureScales(
    cull,
    showIdx.map((i) => inDrawnBoxes[i]),
    s,
    FIGURE_BUDGET_VIEWPORTS * camera.frame.width * camera.frame.height,
  );
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
      data-px-per-mm={String(s)}
      data-cull-x={String(cull.camera.x)}
      data-cull-pan={String(cull.panPx)}
      data-wall={wallBoxes}
      data-drawn-cabinets={String(drawnCabs.length)}
      data-drawn-figures={String(onShow.length)}
      data-hidden-figures={String(hidden)}
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
        <div class="cabinet-scene__root" style={{ transform: cssSceneTransform(camera, s), '--s': String(s) }}>
          <DrawContext.Provider value={draw}>
            <Quad cls="room-wall" a={[roomX0, 3200, zBack]} u={[roomW, 0, 0]} v={[0, -3200, 0]} grid={ROOM_GRID} />
            <Quad cls="room-floor" a={[roomX0, 0, zBack]} u={[roomW, 0, 0]} v={[0, 0, 6500]} grid={ROOM_GRID} />
            {visible.map(({ slot, i }) => (
              <Cabinet key={`${i}:${slot.profile.id}`} slot={slot} index={i} />
            ))}
            {onShow.map(({ draw: fig }, n) => {
              const { figure, index } = fig.placed.item;
              const { art, aspect } = arts[index];
              return (
                <SceneFigure
                  key={figure._id}
                  draw={fig}
                  art={art}
                  aspect={aspect}
                  margins={pictureMargins(art, alpha)}
                  scale={scales[n]}
                  labels={labels}
                  onSelect={() => onSelect(figure, index)}
                  onBroken={images.failed}
                />
              );
            })}
          </DrawContext.Provider>
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

// The page sizes the scene (Collection: down to the pull-up tabs); 60vh only where nothing does. Inside the scene
// root a length is a length in the world at its --s px per mm (texelScale), so every px there is scaled by it.
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
      repeating-linear-gradient(45deg, rgba(0, 0, 0, 0.55) 0 calc(3px * var(--s, 1)), transparent calc(3px * var(--s, 1)) calc(11px * var(--s, 1))),
      repeating-linear-gradient(-45deg, rgba(0, 0, 0, 0.55) 0 calc(3px * var(--s, 1)), transparent calc(3px * var(--s, 1)) calc(11px * var(--s, 1))),
      #2c2e33;
  }
  /* CC13: glass is clear, edges only, no reflections or tint to speak of (Ross 09-27) */
  .cabinet-scene .m-glass-plate { background: rgba(190, 226, 230, 0.07); }
  .cabinet-scene .m-glass-rim { background: rgba(196, 236, 236, 0.45); }
  .cabinet-scene .m-glass-top { background: rgba(190, 226, 230, 0.10); }
  .cabinet-scene .m-glass-edge { background: rgba(176, 232, 232, 0.8); }
  .cabinet-scene .cab-pane { background: rgba(190, 236, 236, 0.25); }
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
    box-shadow: inset 0 0 0 calc(3px * var(--s, 1)) #b9b2a4;
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
    border-radius: calc(6px * var(--s, 1));
    color: #e6e8ee;
    font: 600 calc(22px * var(--s, 1))/1.2 var(--font-sans, system-ui);
    text-align: center;
    overflow: hidden;
  }
  .cabinet-scene .cab-figure__plate--reading { position: absolute; inset: 0; }
  .cabinet-scene .cab-plate {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #d9cfb8;
    color: #2b2620;
    font: 600 calc(11px * var(--s, 1))/1 var(--font-sans, system-ui);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0 calc(4px * var(--s, 1));
  }
  /* no box of its own: a layer the size of the scene over the 3D faces, for two buttons (MOB-NAV-2) */
  .cabinet-scene__nav { display: contents; }
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

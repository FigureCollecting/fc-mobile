/**
 * The faithful display case (CASE-CABINET, CASE-ADAPT, FIT-CHECK): real
 * cabinets from the profile library standing side by side along a wall,
 * drawn in true scale through one pinhole camera (caseCamera, caseFraming),
 * the collection packed onto their surfaces (packCabinets). Ross 2026-09-26:
 * never stretched or padded to the screen; the sides, the usable top and the
 * legs show; wide screens show several cabinets. Ross 2026-10-09: clear,
 * see-through glass (CC13), neighbours drawn true (CC4a), the camera steps
 * back at a cabinet's top (CC4b; TOP1 10-18: the top step shows up to the
 * ceiling instead), and a sideways swipe either walks the
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
import { framingHeadroomMm, sideOverhangMm, withClearance, type CabinetProfile, type CabinetSurface } from './cabinetProfile';
import {
  FIGURE_GAP_MM,
  describeViolator,
  measureCaseFigure,
  packCabinets,
  wallLayout,
  type CaseFigure,
  type PackedCabinet,
  type PlacedFigure,
  type SurfaceSlot,
  type WallSlot,
} from './packCabinets';
import { cssSceneTransform, type Vec3 } from './caseCamera';
import {
  atX,
  cabinetBox,
  centreCabinet,
  centreHit,
  clampLift,
  frameCap,
  frameCase,
  frontsOf,
  liftForDragMm,
  lifted,
  focusEdgesPx,
  nearestCabinet,
  pageInView,
  pageOpensAt,
  pagerReach,
  panFraming,
  panLimitsPx,
  panStops,
  panYLimitsPx,
  roomBox,
  settlePan,
  settleWalk,
  shelfSteps,
  swipeCamera,
  walkStops,
  wallPages,
} from './caseFraming';
import {
  FIGURE_BUDGET_VIEWPORTS,
  FLAT_GRID,
  GRADIENT_GRID,
  cullRect,
  figureCap,
  figureScales,
  figuresToDraw,
  freeTexelScale,
  nearestCabinets,
  opaqueBoards,
  stickyPose,
  stickyView,
  texelScale,
  trimFace,
  type CullView,
  type FigureBox,
  type Rect,
  type TexelGrid,
} from './caseCull';
import { clearInset, drawnWidthMm, figureArt, pictureBox, pictureOffsetMm, type FigureArt, type FigureImageRef, type PictureMargins } from './figureArt';
import { wallPatternProfiles, type CasePrefs } from './casePrefs';
import { wallStyle } from './wallColour';
import { REPACK_ON_FILTER } from './caseInterim';
import { alphaPictureLoaded, useAlphaMarginsOf, useContactBand, type AlphaMargins } from './alphaMargin';
import { useLayoutBasis } from './layoutBasis';
import { goToFigure, type GoToScene } from './caseGoTo';
import { setPhotoFits } from './photoFit';
import { UNZOOMED, ZOOM_DOUBLE_TAP, glideZoom, isZoomed, panZoom, pinchZoom, settleZoom, toPicture, zoomAt, zoomTransform, type Point, type Zoom } from './caseZoom';
import { LOOK_HOLD_MS, eyeSpace, poseOf, resetApplies, withPose } from './casePose';
import { cameraData, coneOf, useFreeCamera, type FreeScene } from './useFreeCamera';
import { useBrokenImages } from '../../hooks/useBrokenImages';

/** A sideways move this long (CSS px) turns a press into a swipe; shorter stays a tap. */
export const SWIPE_START_PX = 8;
/** PINCH-1: a double-tap and the way back to 1x (the chip, a pinch let go under it) glide this long, unless motion is reduced. */
export const ZOOM_SETTLE_MS = 200;
/** Two taps on the room this close in time (ms) and place (CSS px) are a double-tap. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 40;
/**
 * NAV-PTR-1: Reset view shows once a drag has moved the picture this far (CSS px: a raise of the camera by what moves
 * the picture this far, or a slide of the photo), or while zoomed; never for a walk or a wobble of the thumb.
 */
const RESET_PX = 24;
/** MISFIT-CHIP-1: a finger resting this long (ms) on the do-not-fit chip, and not moving past the slop (px), hides it. */
export const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 8;
/**
 * CAB-FOCUS-1 (Ross 10-18): how dark the cabinets either side of the focus one are drawn in the one-cabinet view (0 to 1,
 * black over them): light to moderate, to focus the current cabinet where the screen shows neighbours, and to mark the
 * mode. The one value to tune. The room is dark whatever the app's theme (the scene's colours are its own), so the same
 * black veil serves the dark and the light theme.
 * Ross 2026-10-18: 60 %, chosen by eye.
 */
export const NEIGHBOUR_DIM = 0.6;
/** A dimming veil reaches this far past the window the frame shows, so a pinch or a sub-pixel slide never shows its edge. */
const DIM_PAD_PX = 4;
const DEFAULT_FRAME = { width: 360, height: 480 };
/**
 * CASE-FB2a (Ross 10-16: "one line height and fairly minimal space around the text"): a name plate is one line of
 * the name, LABEL_FONT_MM high on a LABEL_LINE_MM line, with LABEL_PAD_MM above and below it (about 2 px on the
 * Fold8's wall and cabinet views). It was 30 mm on an 11 mm line, twice a shelf's lip or more.
 */
export const LABEL_FONT_MM = 11;
export const LABEL_LINE_MM = 13.2;
export const LABEL_PAD_MM = 2;
/** Room at each end of the name, so an ellipsis never meets the plate's edge. */
const LABEL_SIDE_MM = 3;
export const LABEL_HEIGHT_MM = LABEL_LINE_MM + 2 * LABEL_PAD_MM;
/** How far a name plate stands in front of its surface's lip: off its plane, so the two never fight over which draws on top. */
export const LABEL_LIFT_MM = 1;

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
          // CASE-FB3a: a glass shelf's edge is glass, lit, at its profile's thickness whatever that is: its top is edge-on at
          // the camera's height, and a dark steel edge left nothing of it to see there
          return (
            <Part key={i} cls="cab-shelf cab-shelf--glass">
              <RimmedFace cls="m-glass-plate" rimCls="m-glass-rim" mm={GLASS_RIM_MM} a={[cx - w / 2, s.topMm, zb]} u={[w, 0, 0]} v={[0, 0, zf - zb]} />
              <Quad grid={FLAT_GRID} cls="m-glass-edge" a={[cx - w / 2, s.topMm, zf]} u={[w, 0, 0]} v={[0, -s.thicknessMm, 0]} />
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

/**
 * CAB-FOCUS-1: a flat veil over everything on one side of the focus cabinet's silhouette (its neighbours there), in the
 * viewport so a pan or a pinch carries it with the picture. It spans only the window the frame shows of that picture
 * (`window`: the picture's x and y at the frame's edges, which a slide moves), never more: a layer the size of the wall
 * would blow the case's budget of scene layers. It never takes a touch: a neighbour's figures stay tappable.
 */
function NeighbourDim({ side, edge, window }: { side: 'left' | 'right'; edge: number; window: Rect }) {
  const x0 = window.x0 - DIM_PAD_PX;
  const x1 = window.x1 + DIM_PAD_PX;
  const [left, right] = side === 'left' ? [x0, edge] : [edge, x1];
  if (right <= left) return null;
  const style = {
    left: `${fmt(left)}px`,
    width: `${fmt(right - left)}px`,
    top: `${fmt(window.y0 - DIM_PAD_PX)}px`,
    height: `${fmt(window.y1 - window.y0 + 2 * DIM_PAD_PX)}px`,
    backgroundColor: `rgba(0, 0, 0, ${NEIGHBOUR_DIM})`,
    pointerEvents: 'none' as const,
  };
  return <div class="cabinet-scene__dim" data-side={side} data-edge={fmt(edge)} style={style} />;
}

function Cabinet({ slot, index }: { slot: WallSlot; index: number }) {
  const p = slot.profile;
  return (
    <div class="cab" data-profile={p.id} data-index={index} data-removed={p.layout ? p.layout.removed.join(',') : undefined}>
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

/** SIZE-BASIS-1: which of a packed figure's height and width is an estimate (sizeBasis.ts says the same of a figure): '' when neither. */
function sizeEstimated(item: CaseFigure): '' | 'height' | 'width' | 'both' {
  const width = (item.widthBasis ?? 'labeled') !== 'labeled';
  return item.heightEstimated ? (width ? 'both' : 'height') : width ? 'width' : '';
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
  // the figure's opaque rows and columns: the picture is clipped to them, its clear margins cost no px
  const clear = clearInset(drawnKind, known);
  return { grounded, drawnKind, boxW, boxH, artCx, yBottom, tapW, tapX0, clear };
}

/**
 * What a figure's layer covers (world mm), at its depth: its tap box and the picture hanging from it, clipped to the
 * figure in it, whose opaque rows run from the surface to the figure's height (pictureBox).
 */
function figureLayerBox(draw: FigureDraw, g: ReturnType<typeof figureGeometry>, cab: number): FigureBox {
  return {
    cab,
    x0: Math.min(g.tapX0, g.artCx - g.boxW / 2 + g.clear.left * g.boxW),
    x1: Math.max(g.tapX0 + g.tapW, g.artCx + g.boxW / 2 - g.clear.right * g.boxW),
    y0: draw.slot.topMm,
    y1: draw.slot.topMm + draw.placed.heightMm,
    z: draw.placed.zMm,
  };
}

/**
 * Where a figure's name plate may draw (world mm): its corner and sides, its figure's width centred under it (so
 * neighbours' plates keep the packing's gap apart), hanging from the top of its surface's lip, LABEL_LIFT_MM in front
 * of it. CASE-FB2a: it hung from the usable area's front edge (slot.frontZMm), which lies behind the door's glass,
 * or (a rack) behind its posts; where the case draws a surface's lip at the cabinet front (the KLINGSBO's framed
 * floor, the Detolf's base board, every beam of the rack) the lip stood in front of the plate and hid it.
 */
function plateOf(draw: FigureDraw): { a: Vec3; u: Vec3; v: Vec3 } {
  const { placed, slot, cx } = draw;
  const w = placed.item.widthMm;
  return { a: [cx - w / 2, slot.topMm, slot.lipZMm + LABEL_LIFT_MM], u: [w, 0, 0], v: [0, -LABEL_HEIGHT_MM, 0] };
}

function SceneFigure({
  draw,
  art,
  aspect,
  margins,
  scale,
  plate,
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
  /** Its name plate, when labels are on and the plate draws into the frame and its margin (SHOULD 29); else none. */
  plate: { a: Vec3; u: Vec3; v: Vec3 } | null;
  onSelect: () => void;
  onBroken: (url: string) => void;
}) {
  const { placed, slot, cx } = draw;
  const { item } = placed;
  const { s } = useContext(DrawContext)!;
  const band = useContactBand(art.contactBand ? undefined : art.alphaUrl);
  const { grounded, drawnKind, boxW, boxH, artCx, yBottom, tapW, tapX0, clear } = figureGeometry(draw, art, aspect, margins);
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
  // the shadow lies under the base (CASE-FB2a: centred in the surface's depth), never past the surface's front or back
  const slotBack = slot.frontZMm - slot.depthMm;
  const shadowZ = Math.min(slot.frontZMm - shadowD, Math.max(slotBack, (placed.base.frontMm + placed.base.backMm) / 2 - shadowD / 2));
  const box = (x0: number, x1: number, y0: number, y1: number) =>
    JSON.stringify({ x0: num(x0), x1: num(x1), y0: num(y0), y1: num(y1), z: num(z), surface: slot.topMm });
  return (
    <>
      <Quad grid={GRADIENT_GRID} cls="cab-shadow" a={[shadowX - shadowW / 2, slot.topMm + 0.6, shadowZ]} u={[shadowW, 0, 0]} v={[0, 0, shadowD]} />
      <button
        type="button"
        class={`q cab-figure ${placed.tooDeep ? 'cab-figure--overhang' : ''}`}
        style={q ? { ...q, '--s': String(k) } : undefined}
        aria-label={item.figure.name}
        data-art={art.kind}
        data-figure-id={item.figure._id}
        data-index={String(item.index)}
        // SIZE-BASIS-1: what of this figure's size is an estimate: '' (the listing's), 'height', 'width' or 'both'
        data-size-estimated={sizeEstimated(item)}
        // FIT1: the photo is over 15 % off the listed width: 'wider:23', 'narrower:18'
        data-photo-fit={item.photoFit ? `${item.photoFit.dir}:${item.photoFit.pct}` : undefined}
        data-grounded={grounded ? '1' : '0'}
        data-world={box(tapX0, tapX0 + tapW, slot.topMm, slot.topMm + placed.heightMm)}
        data-art-box={box(artCx - boxW / 2, artCx + boxW / 2, yBottom, yBottom + boxH)}
        data-depth={JSON.stringify({ front: num(placed.base.frontMm), back: num(placed.base.backMm), slotFront: num(slot.frontZMm), slotBack: num(slotBack) })}
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
            clipPath: clear.top + clear.bottom + clear.left + clear.right > 0 ? `inset(${[clear.top, clear.right, clear.bottom, clear.left].map((f) => `${fmt(f * 100)}%`).join(' ')})` : undefined,
            pointerEvents: 'none',
          }}
        >
          <ArtBody art={art} name={item.figure.name} hidden={!grounded} onBroken={onBroken} />
          {!grounded && <div class="cab-figure__plate cab-figure__plate--reading">{item.figure.name}</div>}
        </span>
      </button>
      {plate && (
        <div
          class="q cab-plate"
          style={{ ...quadStyle(plate.a, plate.u, plate.v, { u: plate.u[0] * k, v: LABEL_HEIGHT_MM * k }, s), '--s': String(k) }}
          data-figure-id={item.figure._id}
          data-world={box(plate.a[0], plate.a[0] + plate.u[0], plate.a[1] + plate.v[1], plate.a[1])}
        >
          <span class="cab-plate__face">{item.figure.name}</span>
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
  /** What the figures are filtered and sorted by (Collection): a new filter starts the picture at 1x (PINCH-1). */
  filterKey?: string;
  /** MISFIT-CHIP-1: whether the list of the figures that do not fit is open. Its owner (Collection) lets the View card open it; absent, the scene keeps its own. */
  misfitsOpen?: boolean;
  onMisfitsOpen?: (open: boolean) => void;
  /** MISFIT-CHIP-1: how many figures do not fit (for the View card's entry); 0 when the scene goes. */
  onMisfitCount?: (count: number) => void;
  /** MISFIT-CHIP-1: where the ids of the dismissed misfits are kept (the case prefs); the scene also keeps them for its own life. */
  onPrefs?: (patch: Partial<CasePrefs>) => void;
  /**
   * LAYOUT-STABLE-1: lay the wall out from a held basis (layoutBasis.ts): nothing drawn until the first layout, a picture
   * that arrives after it drawn in the place its figure already has (when it fits), the wall laid out again only for an
   * explicit change or once everything has arrived. Off: laid out by whatever has arrived, as it was (the dev fixtures).
   */
  steadyLayout?: boolean;
  /** The pictures of the collection have all been kept (useCollectionImages): nothing more will stream in. Default true. */
  imagesComplete?: boolean;
  /**
   * CARD-VIEW-1: a card's Go to: frame this figure (goToFigure, caseGoTo.ts) once the wall is laid out; a new seq is a new
   * request. Its owner (Collection) puts the case in the one-shelf view with it.
   */
  goTo?: { figureId: string; seq: number } | null;
  /** The request was taken up: found on a shelf and framed, or on none. */
  onWentTo?: (figureId: string, found: boolean) => void;
  /** CARD-VIEW-1: the figures the wall stands on no shelf (they do not fit), once laid out, so a card can say Go to has nowhere to go. */
  onUnplaced?: (ids: ReadonlySet<string>) => void;
}

/** A picture whose figure fits the place it was packed in by this much (mm) still draws there: rounding, not a collision. */
const FIT_SLACK_MM = 0.5;

/** What the case draws for each figure: the shape of the art, its aspect, and the display meta it was measured by. */
type ArtEntry = { meta: ReturnType<typeof getDisplayMeta>; art: FigureArt; aspect: number };
/** The inputs the wall is laid out by that arrive as pictures do (layoutBasis.ts). */
interface PackBasis {
  arts: readonly ArtEntry[];
  alpha: ReadonlyMap<string, AlphaMargins>;
}


/** The host's frame (the fallback until it is measured), and whether it has been measured yet. */
function useFrame(ref: { current: HTMLElement | null }, fallback: { width: number; height: number }) {
  const [frame, setFrame] = useState(fallback);
  const [measured, setMeasured] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (width > 0 && height > 0) {
        setFrame((f) => (f.width === width && f.height === height ? f : { width, height }));
        setMeasured(true);
      }
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
  return { frame, measured };
}

/**
 * PINCH-1: the Reset view chip, while the picture is zoomed. It holds whether it shows and hands the scene its
 * setter (`shown`), so it comes and goes as its own render, never the scene's.
 */
function ResetChip({ shown, moved, onReset, fade = false }: { shown: { current: ((zoomed: boolean) => void) | null }; moved: boolean; onReset: () => void; fade?: boolean }) {
  const [zoomed, setZoomed] = useState(false);
  shown.current = setZoomed;
  // PAN-KEEP-1: also while the camera or the pan is off the default angle: the one deliberate way back
  if (!zoomed && !moved) return null;
  // NAV-PTR-1: a small button (a ⟲ over a short label), a scene control (a press on it is no gesture of the scene's)
  return (
    <button type="button" class={fade ? 'cabinet-scene__reset cabinet-scene__reset--fade' : 'cabinet-scene__reset'} aria-label="Reset view" title="Reset view" data-scene-ui onClick={onReset}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
      </svg>
      <span>Reset</span>
    </button>
  );
}

/** NAV-PTR-1: a click this soon (ms) after an arrow stepped on its pointerup, or let a drag go to the scene, is that press's own click: ignored. */
const STEP_CLICK_MS = 600;

/** Where a press of the scene begins (client px), and its pointer. */
type PressStart = { pointerId: number; clientX: number; clientY: number };

const inBox = (el: Element, at: { clientX: number; clientY: number }): boolean => {
  const r = el.getBoundingClientRect();
  return at.clientX >= r.left && at.clientX <= r.right && at.clientY >= r.top && at.clientY <= r.bottom;
};

/**
 * NAV-PTR-1 (Ross 10-25, "arrow movements weren't working"): an arrow (‹ › ˄ ˅) steps on the pointerup of a primary
 * press that began on it, the pointer still inside its box and the arrow enabled: a thumb that travels a few px still
 * steps, where Chrome makes no click past its tap slop. The click that tap then makes is ignored; any other click (the
 * keyboard's, a script's) steps. A press that leaves the arrow as a drag (out of its box, SWIPE_START_PX or more from
 * where it began) is the scene's from there (`onDrag`, from where it began): a walk started at the edge walks.
 */
function StepButton({ cls, label, disabled, onStep, onDrag, children }: { cls?: string; label: string; disabled: boolean; onStep: () => void; onDrag: (start: PressStart) => void; children: ComponentChildren }) {
  const pressed = useRef<PressStart | null>(null);
  const quietUntil = useRef(0);
  const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    const p = pressed.current;
    if (p === null || p.pointerId !== e.pointerId) return;
    if (Math.max(Math.abs(e.clientX - p.clientX), Math.abs(e.clientY - p.clientY)) < SWIPE_START_PX || inBox(e.currentTarget, e)) return;
    pressed.current = null;
    quietUntil.current = Date.now() + STEP_CLICK_MS;
    // the scene takes the press before this move reaches it (bubbling on to the scene's host)
    onDrag(p);
  };
  const onPointerUp = (e: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    const own = pressed.current?.pointerId === e.pointerId;
    pressed.current = null;
    const b = e.currentTarget;
    if (!own || b.disabled || !inBox(b, e)) return;
    quietUntil.current = Date.now() + STEP_CLICK_MS;
    onStep();
  };
  const onClick = () => {
    if (Date.now() < quietUntil.current) {
      quietUntil.current = 0;
      return;
    }
    onStep();
  };
  return (
    <button
      type="button"
      class={cls}
      aria-label={label}
      disabled={disabled}
      onPointerDown={(e) => {
        pressed.current = e.button === 0 ? { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY } : null;
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        pressed.current = null;
      }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** PAN-KEEP-1: what starts the picture from its frame again besides the view and the wall: the swipe mode, in the shelf view only (TOP1). */
const shelfSwipeKey = (prefs: CasePrefs): string => (prefs.view === 'shelf' ? prefs.swipe : '');

/** MISFIT-CHIP-1: whether a touch landed on one of the scene's own controls (the do-not-fit chip, its list). */
const onSceneUi = (target: EventTarget | null): boolean => target instanceof Element && target.closest('[data-scene-ui]') !== null;

/**
 * MISFIT-CHIP-1: the small do-not-fit chip, bottom left: a warning glyph and the count. A tap opens (or closes) the list;
 * a long press, still, hides the chip until a figure that was not there misfits.
 */
function MisfitChip({ count, open, onToggle, onHide }: { count: number; open: boolean; onToggle: () => void; onHide: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const stop = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  };
  useEffect(() => stop, []);
  return (
    <button
      type="button"
      class="cabinet-scene__misfit"
      data-scene-ui
      aria-label={count === 1 ? '1 figure does not fit' : `${count} figures do not fit`}
      aria-expanded={open}
      onPointerDown={(e) => {
        stop();
        origin.current = { x: e.clientX, y: e.clientY };
        timer.current = setTimeout(() => {
          timer.current = null;
          onHide();
        }, LONG_PRESS_MS);
      }}
      onPointerMove={(e) => {
        const o = origin.current;
        if (o !== null && Math.hypot(e.clientX - o.x, e.clientY - o.y) > LONG_PRESS_SLOP_PX) stop();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onClick={onToggle}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
        <path d="M12 3 1.5 21h21L12 3Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
        <path d="M12 10v5M12 18.2v.1" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
      <span>{count}</span>
    </button>
  );
}

const prefersReducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const zoomData = (z: Zoom): string => JSON.stringify({ k: num(z.k), x: num(z.x), y: num(z.y) });

export function CabinetScene({
  figures,
  onSelect,
  prefs,
  labels = false,
  imageFor,
  frameFallback = DEFAULT_FRAME,
  filterKey,
  steadyLayout = false,
  imagesComplete = true,
  misfitsOpen,
  onMisfitsOpen,
  onMisfitCount,
  onPrefs,
  goTo = null,
  onWentTo,
  onUnplaced,
}: CabinetSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { frame, measured: frameMeasured } = useFrame(hostRef, frameFallback);
  const ceilingMm = prefs.ceilingMm;
  // NAV-1A (rulings R0.2): the Free camera trial; off, every line below runs as it did
  const free = prefs.freeCamera === true;
  const freeRef = useRef(free);
  freeRef.current = free;
  // CLEAR-1: every cabinet keeps the clearance above a figure that the case prefs set
  const pattern = useMemo(() => wallPatternProfiles(prefs.pattern).map((p) => withClearance(p, prefs.clearanceMm)), [prefs.pattern, prefs.clearanceMm]);

  // a picture that fails to load stands as its plate (ADDR-1), never a blank space
  const images = useBrokenImages();
  // what the case draws for each figure, in the shape it draws it (the image list's own size when it gives one)
  const liveArts = useMemo<readonly ArtEntry[]>(
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
  const alphaUrls = useMemo(() => [...new Set(liveArts.flatMap(({ art }) => (art.alphaUrl ? [art.alphaUrl] : [])))], [liveArts]);
  // each picture's clear margins as soon as it is read: from then on its figure is grounded and packed by what it draws;
  // one still being read stands as its plate on its label meanwhile, holding back no other
  const liveAlpha = useAlphaMarginsOf(alphaUrls);

  // LAYOUT-STABLE-1: the wall is laid out from a basis of the picture inputs, held between the moments layoutBasis.ts names,
  // not from whatever the last picture changed. Pictures stream in for minutes on a first launch, and the packer is global:
  // every arrival packed the whole wall again and tens of figures moved at once, again and again.
  const live = useMemo<PackBasis>(() => ({ arts: liveArts, alpha: liveAlpha }), [liveArts, liveAlpha]);
  const unmeasured = useMemo(() => alphaUrls.filter((u) => !liveAlpha.has(u)).length, [alphaUrls, liveAlpha]);
  // an explicit change: the filter or the sort, or a figure added, removed or moved in the list, or cards come in (a figure's
  // size is its card's: the launch draws what the device has, and the cards that arrive redraw it, once the batch is in)
  const epoch = useMemo(() => {
    const cards = figures.filter((f) => (f as { local?: { hasCard?: boolean } }).local?.hasCard === true).length;
    return `${filterKey ?? ''}#${cards}#${figures.map((f) => f._id).join(',')}`;
  }, [filterKey, figures]);
  const settle = useLayoutBasis<PackBasis>({
    live,
    pending: unmeasured,
    settled: imagesComplete && unmeasured === 0,
    ready: figures.length > 0,
    epoch,
    enabled: steadyLayout,
  });
  const basis = settle.basis;

  // each figure is measured by what the case draws for it: its listed size when it has one (a cut-out wider than its listed
  // width is drawn smaller to fit it, FIT1), else what its cut-out draws at true scale (by the basis: before the first layout
  // nothing is measured, so nothing is drawn twice)
  const measured = useMemo(
    () =>
      basis === null
        ? []
        : figures.map((f, i) => {
            const { meta, art, aspect } = basis.arts[i];
            const drawn = art.alphaUrl ? pictureMargins(art, basis.alpha) : null;
            return measureCaseFigure(f, i, { ...meta, aspect }, drawn ?? undefined);
          }),
    [figures, basis],
  );
  const packed = useMemo(() => packCabinets(measured, pattern, ceilingMm), [measured, pattern, ceilingMm]);
  // FIT1: the figures whose photo is over 15 % off their listed width, for the Info card's Size row; gone with the case
  useEffect(() => {
    const flagged = new Map(measured.flatMap((m) => (m.photoFit ? [[m.figure._id, m.photoFit] as const] : [])));
    setPhotoFits(flagged);
    return () => setPhotoFits(new Map());
  }, [measured]);

  /**
   * What a figure draws: its picture as it stands now when that draws within the place the figure was packed in (a picture
   * that arrived after the layout takes its figure's place, never another's), else what it was packed by. Plates and framed
   * pictures draw within their footprint always; one still being read draws its plate (figureGeometry).
   */
  const drawing = (item: CaseFigure) => {
    // a figure is placed only once there is a basis (before it nothing is packed), so `item` comes with one
    const packedBy = basis as PackBasis;
    const now = liveArts[item.index];
    const then = packedBy.arts[item.index];
    const margins = pictureMargins(now.art, liveAlpha);
    if (now === then) return { art: now.art, aspect: now.aspect, margins };
    if ((now.art.kind === 'cutout' || now.art.kind === 'masked') && margins !== null && drawnWidthMm(item.heightMm, now.aspect, margins) > item.widthMm + FIT_SLACK_MM) {
      return { art: then.art, aspect: then.aspect, margins: pictureMargins(then.art, packedBy.alpha) };
    }
    return { art: now.art, aspect: now.aspect, margins };
  };

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
  // CAB-FOCUS-1: the cabinet the one-cabinet view's picture was fitted to. null: the focus. A camera-mode walk carries the focus
  // on to a neighbour (the arrows go on from there) without re-fitting the picture under the finger: only an arrow does.
  const [framedFocus, setFramedFocus] = useState<number | null>(null);
  const [shelf, setShelf] = useState(0);
  const [walkX, setWalkX] = useState<number | null>(null);
  const [pan, setPan] = useState(0);
  const [liveDx, setLiveDx] = useState(0);
  // CASE-FB1 item 5: an up/down drag raises the camera with its aim (camera mode, mm) or slides the photo (pan mode, px)
  const [lift, setLift] = useState(0);
  const [panY, setPanY] = useState(0);
  const [liveDy, setLiveDy] = useState(0);

  // a new view or wall starts from its own framing. PAN-KEEP-1: a swipe mode does not, in the wall and cabinet views: the camera
  // (its walk, its height) and the pan stay across Pan <-> Move the camera, so a perspective set in one is the one the other
  // works from; Reset view is the way back. The shelf view still starts a mode from its frame (TOP1).
  const framingKey = shelfSwipeKey(prefs);
  // (a layout effect: the frame is back before the mode's picture is painted, as the filter's reset below is)
  useLayoutEffect(() => {
    setWalkX(null);
    setPan(0);
    setLift(0);
    setPanY(0);
    setFramedFocus(null);
  }, [prefs.view, prefs.pattern, framingKey]);
  // CASE-FB2a (interim, REPACK_ON_FILTER): a new filter or sort packs its figures from the wall's start, and the view
  // starts there too, before it is drawn: left where a walk had it, the camera stood past a wall a filter had shortened
  useLayoutEffect(() => {
    if (!REPACK_ON_FILTER) return;
    setFocus(0);
    setFramedFocus(null);
    setShelf(0);
    setWalkX(null);
    setPan(0);
    setLift(0);
    setPanY(0);
  }, [filterKey]);

  const lastIndex = wall.cabinets.length - 1;
  const focusIdx = Math.min(focus, lastIndex);
  const framedIdx = framedFocus === null ? focusIdx : Math.min(framedFocus, lastIndex);
  // the framing and the wall's pages hold for a whole swipe: worked out once per view, not at every finger move
  const framingInput = useMemo(
    // NAV-1A (rulings R0.3): Free camera's openings are level
    () => ({ frame, wall, headroomMm, view: prefs.view, focus: prefs.view === 'cabinet' ? framedIdx : focusIdx, shelf, ceilingMm, ...(free ? { level: true } : {}) }),
    [frame, wall, headroomMm, prefs.view, focusIdx, framedIdx, shelf, ceilingMm, free],
  );
  const base = useMemo(() => frameCase(framingInput), [framingInput]);
  const pages = useMemo(() => (framingInput.view === 'wall' ? wallPages(framingInput) : wall.cabinets.map((_, i) => [i])), [framingInput, wall]);
  const culled = useRef<CullView | null>(null);
  // NAV-1A: the Free camera's pose (a ref, written each frame by its gestures); the scene renders when the cull must change
  const rootRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((t) => t + 1), []);
  const freeScene = useRef<FreeScene | null>(null);
  const fc = useFreeCamera(freeScene as { current: FreeScene }, { host: hostRef, root: rootRef, ring: ringRef }, culled, rerender);
  const laidOut = figures.length > 0 && basis !== null && (steadyLayout ? settle.revealed : unmeasured === 0);
  // a new view, wall pattern or filter starts from its framing (instant in this slice); a fold or unfold keeps the pose (spec 6.6)
  const rebaseKey = `${prefs.view}|${prefs.pattern}|${REPACK_ON_FILTER ? (filterKey ?? '') : ''}`;
  const rebasedFor = useRef(rebaseKey);
  const pinnedAt = useRef<{ width: number; height: number; camera: typeof base.camera } | null>(null);
  if (free && rebasedFor.current !== rebaseKey) {
    fc.hold(null);
    pinnedAt.current = null;
  }
  rebasedFor.current = rebaseKey;
  if (free && fc.held() === null && laidOut && pinnedAt.current !== null && (pinnedAt.current.width !== frame.width || pinnedAt.current.height !== frame.height)) {
    fc.hold(poseOf(pinnedAt.current.camera));
  }
  // CASE-FB1: a walk moves the camera along the wall only; an up/down drag (camera mode) raises it and its aim together,
  // between the floor and the ceiling, and the walk keeps that height
  const along = walkX === null ? base : atX(base, walkX);
  const liftBy = (dy: number) => clampLift(along, ceilingMm, lift + (dy === 0 ? 0 : liftForDragMm(along, dy)));
  // PAN-KEEP-1: the camera's height holds in pan mode too (a drag there slides the photo; it does not lift)
  const walked = lifted(along, liftBy(prefs.swipe === 'camera' ? liveDy : 0));
  const swiping = prefs.swipe === 'camera' && liveDx !== 0;
  const framing = swiping ? swipeCamera(walked, wall, liveDx) : walked;
  const [panMin, panMax] = panLimitsPx(framing, wall);
  const clampPan = (v: number) => Math.min(panMax, Math.max(panMin, v));
  // the photo slides (a pan mode drag moves it; a camera mode drag does not, but what was panned stays panned: PAN-KEEP-1), and
  // past its sane extent is retaken farther along (panFraming)
  const shown = panFraming(framing, clampPan(pan + (prefs.swipe === 'pan' ? liveDx : 0)));
  // NAV-1A: in Free camera the camera is the pose (on the framing's lens and frame); the pager pages from what its frame
  // centre looks at (rulings S7)
  const camera = free ? fc.camera(base.camera) : shown.framing.camera;
  // pinned from the host's first measured size on: the fallback frame a wall laid out on before it is not a fold's
  if (free && laidOut && frameMeasured && fc.held() === null) pinnedAt.current = { width: frame.width, height: frame.height, camera: base.camera };
  const centre = free ? centreHit(camera, wall) : undefined;
  // the wall view pages from what the settled picture centres on, after a press, a walk or a pan (close-out 4, ruling 32)
  const still = panFraming(walked, clampPan(pan));
  const pageIdx = prefs.view === 'wall' ? pageInView(pages, wall, still.framing, still.panPx, centre) : focusIdx;
  // PAGER-END: the first and the last page's openings, so Next stays on short of the last page's centre and Prev past the first's
  const ends = useMemo(
    () => (framingInput.view === 'wall' && pages.length > 0 ? { first: pageOpensAt(framingInput, pages[0]), last: pageOpensAt(framingInput, pages[pages.length - 1]) } : null),
    [framingInput, pages],
  );
  const reach = ends !== null ? pagerReach(pages, wall, still.framing, still.panPx, ends, centre) : null;
  const { panPx } = shown;
  // CAB-FOCUS-1: in the one-cabinet view, the cabinets either side of the focus one are dimmed, from the edges of its silhouette
  const dimFrom = prefs.view === 'cabinet' ? focusEdgesPx(camera, wall.cabinets[focusIdx]) : null;
  // pan mode: the photo slides up and down too, between the ceiling over the fronts and the floor line (CASE-FB1 item 5)
  const [panYMin, panYMax] = panYLimitsPx(shown.framing, wall, ceilingMm);
  const clampPanY = (v: number) => Math.min(panYMax, Math.max(panYMin, v));
  const panYPx = clampPanY(panY + (prefs.swipe === 'pan' ? liveDy : 0));
  // CAB-FOCUS-1: the picture's x and y the frame shows at its edges (the picture is drawn slid by the pan)
  const shownWindow: Rect = { x0: -panPx, x1: -panPx + camera.frame.width, y0: -panYPx, y1: -panYPx + camera.frame.height };

  // MOB-NAV-2: while a finger swipes, cull for the picture last culled for until it has moved a quarter frame (the
  // half-viewport margin still covers the frame), a cabinet already drawn keeping its place against a small move;
  // once the swipe settles, cull for the settled picture itself: the drawCap cabinets nearest its centre. Draw the
  // faces at the px per mm the screen shows the cabinets' room (floor to headroom, back to the front of the feet)
  // at its nearest
  const moving = free ? fc.live() : liveDx !== 0 || liveDy !== 0;
  const cull = moving ? (free ? stickyPose(culled.current, { camera, panPx }) : stickyView(culled.current, { camera, panPx })) : { camera, panPx };
  culled.current = cull;
  const chosen = useRef<number[]>([]);
  // NAV-1A (rulings S2): in Free camera the cap follows the turned frame, from the framing's up to the limit
  const fronts = useMemo(() => frontsOf(wall, headroomMm), [wall, headroomMm]);
  const drawCap = free ? frameCap(cull.camera, wall, fronts, base.drawCap) : base.drawCap;
  // CF1 (a): as many as the panel's full-height frame shows fronts (wallCamera), the same in every view
  const drawnCabs = nearestCabinets(cull, wall, moving ? chosen.current : [], drawCap);
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
  // NAV-1A (a), Ross 10-28: turned, the Free camera's scene keeps the px per mm in force where the turn left yaw 0 (a
  // cabinet beside the eye, a move or a pitch while turned never sharpens it); what the turned view itself would ask (its
  // nearest point in view, over the wall and a cabinet's reach past its ends) is published beside it
  const s = free ? freeTexelScale(camera, span, fc.unturned(base.camera)) : texelScale(camera, span);
  const asked = free && camera.yaw ? texelScale(camera, span, [wall.leftMm - 1000, wall.rightMm + 1000]) : null;
  // a photo slid up or down draws, in the unslid picture, the rows the slide brings into the frame
  const rect = cullRect(camera.frame);
  const draw: Draw = { view: cull, rect: { ...rect, y0: rect.y0 - panYPx, y1: rect.y1 - panYPx }, s };

  // --- pinch zoom (PINCH-1): a magnification over the camera's picture toward the point pinched, drawn as one
  // transform on the zoom layer; set on the layer as the fingers move (no render of the scene), never the camera
  const frameRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<HTMLDivElement>(null);
  const zoom = useRef<Zoom>(UNZOOMED);
  // the Reset view chip's setter: the chip coming and going renders nothing else
  const showChip = useRef<((zoomed: boolean) => void) | null>(null);
  // the zoom the figures are drawn sharp for: set once a gesture lets go (after any animation), never while fingers
  // move it: the scene renders once per gesture
  const [sharp, setSharp] = useState<Zoom>(UNZOOMED);
  const settling = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // the glide's next frame (CASE-FB3a): a CSS transition on the layer had the compositor raster every layer under it at the
  // zoom's scale, 3 to 5x the tiles for seconds on the open Fold8 (e2e/case-zoom-return), so a settle is frames of the
  // layer's transform, as the fingers' moves are
  const glide = useRef<number | undefined>(undefined);
  const stopGlide = () => {
    if (glide.current !== undefined) cancelAnimationFrame(glide.current);
    glide.current = undefined;
  };
  // a settle ends (or a touch cuts it short): the layer on the zoom it settles at, the scene redrawn for it
  const settled = useCallback(() => {
    if (settling.current === undefined) return;
    clearTimeout(settling.current);
    settling.current = undefined;
    stopGlide();
    const layer = zoomRef.current;
    if (layer) {
      layer.classList.remove('cabinet-scene__zoom--settling');
      layer.style.transform = zoomTransform(zoom.current);
    }
    setSharp(zoom.current);
  }, []);
  useEffect(
    () => () => {
      clearTimeout(settling.current);
      stopGlide();
    },
    [],
  );
  // the picture the zoom magnifies: the camera's frame
  const picture = useRef(camera.frame);
  picture.current = camera.frame;
  // 'live' while fingers move it (promoted for the gesture), 'still' once let go (rastered at its zoom), or
  // 'settle': animated there, unless motion is reduced
  const showZoom = useCallback((z: Zoom, how: 'live' | 'still' | 'settle') => {
    const from = zoom.current;
    zoom.current = z;
    clearTimeout(settling.current);
    settling.current = undefined;
    stopGlide();
    const layer = zoomRef.current!;
    const animate = how === 'settle' && !prefersReducedMotion();
    layer.classList.toggle('cabinet-scene__zoom--live', how === 'live');
    layer.classList.toggle('cabinet-scene__zoom--settling', animate);
    layer.style.transform = zoomTransform(animate ? from : z);
    hostRef.current!.dataset.zoom = zoomData(z);
    showChip.current?.(isZoomed(z));
    if (animate) {
      let began: number | undefined;
      const frame = (now: number) => {
        began ??= now;
        layer.style.transform = zoomTransform(glideZoom(from, z, (now - began) / ZOOM_SETTLE_MS));
        glide.current = requestAnimationFrame(frame);
      };
      glide.current = requestAnimationFrame(frame);
      settling.current = setTimeout(settled, ZOOM_SETTLE_MS);
    } else if (how !== 'live') setSharp(z);
  }, [settled]);
  // a new view, wall, filter or frame starts the picture at 1x, at once; so does a swipe mode in the shelf view, where it starts
  // from the frame. PAN-KEEP-1: elsewhere the mode is not a new picture, and the zoom (which both modes treat alike: zoomed, one
  // finger pans the magnified picture) stays with the camera
  useLayoutEffect(() => {
    if (zoom.current !== UNZOOMED) showZoom(UNZOOMED, 'still');
  }, [prefs.view, prefs.pattern, framingKey, filterKey, frame.width, frame.height, showZoom]);

  // CARD-VIEW-1: Go to. The wall is laid out (every figure in the place it keeps); a request is taken up once, after the resets
  // above (a layout effect declared after them: a new view's reset never undoes it), to the framing goToFigure gives
  const goToScene = useMemo<GoToScene>(() => ({ frame, wall, cabinets, headroomMm, ceilingMm }), [frame, wall, cabinets, headroomMm, ceilingMm]);
  const wentTo = useRef<number | null>(null);
  const wentOut = useRef(onWentTo);
  wentOut.current = onWentTo;
  useLayoutEffect(() => {
    if (goTo === null || goTo.seq === wentTo.current || !laidOut) return;
    wentTo.current = goTo.seq;
    const target = goToFigure(goTo.figureId, goToScene);
    if (target !== null) {
      setFocus(target.focus);
      setFramedFocus(null);
      setShelf(target.shelf);
      setWalkX(target.walkX);
      setPan(0);
      setLift(0);
      setPanY(0);
      if (zoom.current !== UNZOOMED) showZoom(UNZOOMED, 'still');
      // NAV-1A: Free camera stands at the framing Go to gives, at once (the animated go-to is slice 1c)
      if (free) fc.hold(target.walkX === null ? null : poseOf(target.framing.camera));
    }
    wentOut.current?.(goTo.figureId, target !== null);
  }, [goTo, laidOut, goToScene, showZoom]);
  const unplacedOut = useRef(onUnplaced);
  unplacedOut.current = onUnplaced;
  const unplacedKey = laidOut ? packed.violators.map((v) => v.item.figure._id).join('\n') : null;
  // as the layout commits: a switch to the tiles right after it still leaves its owner what it found
  useLayoutEffect(() => {
    if (unplacedKey === null) return;
    unplacedOut.current?.(new Set(unplacedKey === '' ? [] : unplacedKey.split('\n')));
  }, [unplacedKey]);
  const toFrame = (x: number, y: number): Point => {
    const r = frameRef.current!.getBoundingClientRect();
    return { x: x - r.left, y: y - r.top };
  };

  // --- swipe (CC4), pinch and tap
  // a press turns into a swipe along the axis it first moves farther on (CASE-FB1: sideways walks or pans, up and down
  // lifts); zoomed, or the finger a pinch leaves down, it pans the magnified picture from `zoom` instead, never walking
  const press = useRef<{ id: number; x0: number; y0: number; axis: 'x' | 'y' | null; zoom: Zoom | null; pinched: boolean } | null>(null);
  // the fingers down on the scene (client px), and the pinch of the first two (where they started, in frame px)
  const fingers = useRef(new Map<number, Point>());
  const pinching = useRef<{ a: number; b: number; a0: Point; b0: Point; from: Zoom } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const swallowClick = useRef(false);
  const capture = (id: number) => {
    try {
      hostRef.current?.setPointerCapture(id);
    } catch {
      /* a synthetic pointer cannot be captured */
    }
  };
  const onPointerDown = useCallback((e: PointerEvent) => {
    // MISFIT-CHIP-1: the chip and its list are the scene's controls, not its picture: a touch on them is no gesture of the scene's
    if (onSceneUi(e.target)) return;
    startPress(e);
  }, []);
  // a finger down on the scene; or, NAV-PTR-1, one that began on an arrow and left it as a drag, from where it began
  const startPress = (e: PressStart) => {
    // a new touch cuts a settling zoom short
    settled();
    if (pinching.current) {
      fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      return;
    }
    const p = press.current;
    const a = p && p.id !== e.pointerId ? fingers.current.get(p.id) : undefined;
    // no other finger down: whatever a lost press left is gone
    if (!a) fingers.current.clear();
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (p && a) {
      // a second finger: a pinch; the first one's swipe goes back where it started (a two-finger gesture never walks)
      if (freeRef.current) fc.release(p.id, false);
      press.current = null;
      setLiveDx(0);
      setLiveDy(0);
      swallowClick.current = true;
      lastTap.current = null;
      pinching.current = { a: p.id, b: e.pointerId, a0: toFrame(a.x, a.y), b0: toFrame(e.clientX, e.clientY), from: zoom.current };
      capture(p.id);
      capture(e.pointerId);
      return;
    }
    press.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, axis: null, zoom: isZoomed(zoom.current) ? zoom.current : null, pinched: false };
    // a touch swipe makes no click: whatever it left to swallow ends with the next press
    swallowClick.current = false;
    // NAV-1A: one finger on the unzoomed picture: the Free camera's MOVE, or its LOOK after a still hold
    if (freeRef.current && !isZoomed(zoom.current)) fc.press(e, toFrame(e.clientX, e.clientY));
  };
  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!fingers.current.has(e.pointerId)) return;
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pin = pinching.current;
    if (pin) {
      if (e.pointerId !== pin.a && e.pointerId !== pin.b) return;
      const a = fingers.current.get(pin.a)!;
      const b = fingers.current.get(pin.b)!;
      showZoom(pinchZoom(pin.from, pin.a0, pin.b0, toFrame(a.x, a.y), toFrame(b.x, b.y), picture.current), 'live');
      return;
    }
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x0;
    const dy = e.clientY - p.y0;
    if (p.axis === null && Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_START_PX) {
      p.axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
      capture(e.pointerId);
    }
    if (p.axis === null) return;
    if (p.zoom) showZoom(panZoom(p.zoom, dx, dy, picture.current), 'live');
    else if (freeRef.current) fc.drag(e.pointerId, toFrame(e.clientX, e.clientY), p.axis);
    else if (p.axis === 'x') setLiveDx(dx);
    else setLiveDy(dy);
  }, []);
  // a tap on the room (no figure, no control): the second of two quick ones is a double-tap, back to 1x when
  // zoomed, else 2x at that point (the case handled no double-tap before)
  const tapped = (e: PointerEvent) => {
    const last = lastTap.current;
    const t = Date.now();
    lastTap.current = null;
    if ((e.target as Element).closest('button, a, details')) return;
    if (last && t - last.t <= DOUBLE_TAP_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) <= DOUBLE_TAP_PX) {
      // the click this tap makes comes after the picture has moved (at once with reduced motion): it opens nothing
      swallowClick.current = true;
      const at = toFrame(e.clientX, e.clientY);
      showZoom(isZoomed(zoom.current) ? UNZOOMED : zoomAt(UNZOOMED, at, ZOOM_DOUBLE_TAP, picture.current), 'settle');
      return;
    }
    lastTap.current = { t, x: e.clientX, y: e.clientY };
  };
  const endPress = (e: PointerEvent, commit: boolean) => {
    fingers.current.delete(e.pointerId);
    const pin = pinching.current;
    if (pin) {
      if (e.pointerId !== pin.a && e.pointerId !== pin.b) return;
      // let go: under 1x, or nearly, it settles back at 1x; the finger left down pans the picture, never walks
      pinching.current = null;
      const now = zoom.current;
      const settled = settleZoom(now, picture.current);
      showZoom(settled, settled.k === now.k && settled.x === now.x && settled.y === now.y ? 'still' : 'settle');
      const other = e.pointerId === pin.a ? pin.b : pin.a;
      const at = fingers.current.get(other)!;
      press.current = { id: other, x0: at.x, y0: at.y, axis: null, zoom: settled, pinched: true };
      return;
    }
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    if (p.axis === null) {
      // NAV-1A (rulings S6): a still release is a tap, armed Look or not: the hold swallows nothing
      if (free) fc.release(e.pointerId, false);
      if (commit && !p.pinched) tapped(e);
      return;
    }
    lastTap.current = null;
    const dx = e.clientX - p.x0;
    const dy = e.clientY - p.y0;
    swallowClick.current = true;
    if (p.zoom) {
      showZoom(zoom.current, 'still');
      return;
    }
    if (free) {
      // NAV-1A: the pose is the last live one (no settle, no retake); the arrows and Reset go on from what the frame centre looks at
      const left = fc.release(e.pointerId, commit);
      if (left !== null) {
        setFocus(centreCabinet(withPose(base.camera, left), wall));
        setFramedFocus(null);
      }
      return;
    }
    setLiveDx(0);
    setLiveDy(0);
    if (!commit) return;
    if (p.axis === 'y') {
      // an up/down drag: the camera keeps the height it was raised to, the photo where it slid (CASE-FB1 item 5)
      if (prefs.swipe === 'pan') setPanY(clampPanY(panY + dy));
      else setLift(liftBy(dy));
      return;
    }
    if (prefs.swipe === 'pan') {
      // a pan of the wall view settles on the same kind of stop as a walk, where the photo can slide to one (NOTE 31)
      if (prefs.view !== 'wall') setPan(clampPan(pan + dx));
      else {
        const stop = settlePan(walked, wall, panStops(walked, wall), pan, dx);
        if (stop !== null) setPan(stop.panPx);
      }
      return;
    }
    // a walk of the wall view settles on a stop: three cabinets or more whole, the wall's ends, or the one that stands
    // a cabinet whole that no other does (Ross 12:1xC, desk MN2 a; close-out 3, ruling 27); a short drag stays put
    const moved = prefs.view === 'wall' ? settleWalk(walked, wall, walkStops(framingInput), dx) : { x: swipeCamera(walked, wall, dx).camera.x };
    if (moved === null) return;
    setWalkX(moved.x);
    // CAB-FOCUS-1: the one-cabinet picture stays as fitted to the cabinet it was; the focus is the one the walk reached
    if (prefs.view === 'cabinet') setFramedFocus((f) => f ?? focusIdx);
    setFocus(nearestCabinet(wall, moved.x));
  };
  const onClickCapture = (e: MouseEvent) => {
    if (onSceneUi(e.target)) {
      // a tap on a control is its own, whatever a drag left to swallow
      swallowClick.current = false;
      return;
    }
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.stopPropagation();
    e.preventDefault();
  };

  // TOP1 (Ross 10-18): an arrow press in the one-shelf view snaps to the straight-on view that shows that whole shelf of the
  // focus cabinet: the walk, the pan, the lift and the zoom a drag or a pinch left are gone. Only the arrows do it; a drag
  // or a pinch still moves the picture as the swipe mode says, from there. CAB-FOCUS-1: the one-cabinet view's arrows do
  // the same, to the straight-on fit of the whole focus cabinet.
  const snapFrame = () => {
    setWalkX(null);
    setPan(0);
    setLift(0);
    setPanY(0);
    if (zoom.current !== UNZOOMED) showZoom(UNZOOMED, 'still');
  };
  const goCabinet = (to: number) => {
    // NAV-1A: TOP1 as built: an arrow stands the Free camera at the target's framing, at once (the tween is slice 1c)
    if (free) {
      fc.hold(null);
      rerender();
    }
    setFocus(Math.max(0, Math.min(lastIndex, to)));
    setFramedFocus(null);
    setWalkX(null);
    setPan(0);
    if (prefs.view === 'shelf' || prefs.view === 'cabinet') snapFrame();
  };
  const goPage = (step: number) => {
    const target = pages[Math.max(0, Math.min(pages.length - 1, pageIdx + step))];
    goCabinet(target[0]);
  };
  // SHELF-STEPS-1: the steps are the wall's levels, as the shelf camera is (shelfSteps), not the focus cabinet's own surfaces
  const shelfCount = useMemo(() => shelfSteps(framingInput), [framingInput]);
  const shelfIdx = Math.min(shelf, shelfCount - 1);
  const goShelf = (to: number) => {
    if (free) {
      fc.hold(null);
      rerender();
    }
    setShelf(to);
    snapFrame();
  };

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
  // what each cabinet holds, and its kind
  const heldCounts = useMemo(() => cabinets.map((c) => (c ? c.surfaces.reduce((n, x) => n + x.items.length, 0) : 0)), [cabinets]);
  const heldKinds = useMemo(() => wall.cabinets.map((c) => c.profile.id), [wall]);
  // CASE-FB2b: what every cabinet holds, drawn or not (inside, on its top) and the shelves it stands without, for the e2e
  const held = useMemo(
    () =>
      JSON.stringify(
        cabinets.map((c) => {
          const inside = c ? c.surfaces.reduce((n, x) => n + (x.slot.isTop ? 0 : x.items.length), 0) : 0;
          const onTop = c ? c.surfaces.reduce((n, x) => n + (x.slot.isTop ? x.items.length : 0), 0) : 0;
          return [inside, onTop, c?.profile.layout?.removed ?? []];
        }),
      ),
    [cabinets],
  );
  // a figure is drawn when its layer (its tap box and the picture hanging from it) draws into the frame and its margin
  // and no board of its cabinet hides it from the camera
  const inDrawn = draws.filter((d) => drawnCabs.includes(d.cab));
  const inDrawnBoxes = inDrawn.map(({ cab, draw: fig }) => {
    const { art, aspect, margins } = drawing(fig.placed.item);
    return figureLayerBox(fig, figureGeometry(fig, art, aspect, margins), cab);
  });
  // G1: as many figures as the drawn cabinets hold (each its kind's most), so no cabinet the frame shows stands empty
  const figCap = figureCap(heldCounts, heldKinds, drawnCabs);
  const { shown: showIdx, hidden } = figuresToDraw(cull, draw.rect, inDrawnBoxes, new Set(drawnCabs), (cab) => opaqueBoards(wall.cabinets[cab]), figCap);
  const onShow = showIdx.map((i) => inDrawn[i]);
  // the figures' layers cost at most their budget wherever the camera stands: the farthest from the frame centre drawn coarser
  // SHOULD 29: a name plate is drawn with its figure where its own box draws into the frame and its margin, and is
  // drawn at its figure's px per mm, out of the same budget
  const plates = onShow.map(({ draw: fig }) => {
    const p = labels ? plateOf(fig) : null;
    return p && trimFace(cull, p.a, p.u, p.v, draw.rect) ? p : null;
  });
  // PINCH-1: Chrome rasters a layer under the perspective at the device pixel ratio per layer px, whatever the zoom
  // magnifies it by; so once a zoom settles the figures nearest the middle of the zoomed view are drawn at the zoom
  // times the scene's px per mm, out of the same budget (the rest coarser outward from it)
  const middle = toPicture(sharp, { x: camera.frame.width / 2, y: camera.frame.height / 2 });
  const scales = figureScales(
    cull,
    showIdx.map((i, n) => ({ ...inDrawnBoxes[i], plateMm2: plates[n] ? plates[n].u[0] * LABEL_HEIGHT_MM : 0 })),
    s * sharp.k,
    FIGURE_BUDGET_VIEWPORTS * camera.frame.width * camera.frame.height,
    isZoomed(sharp) ? { x: middle.x, y: middle.y - panYPx } : undefined,
  );
  const overhangs = draws.filter((d) => d.draw.placed.tooDeep);
  const flagged = packed.violators.length + overhangs.length;
  // CASE-FB3b: what the list says of each, with what was measured and from what (describeViolator)
  const wallName = pattern.length === 1 ? `the ${pattern[0].name}` : 'this wall';

  // MISFIT-CHIP-1: the do-not-fit chip, and its list. The chip hides when every figure that does not fit is one that was
  // dismissed (a long press on it, or the list's ×); a figure that was not there brings it back. The list opens from the chip
  // or from outside (the View card), chip hidden or not.
  const misfitIds = [...packed.violators.map((v) => v.item.figure._id), ...overhangs.map((d) => d.draw.placed.item.figure._id)];
  const [ownOpen, setOwnOpen] = useState(false);
  const [ownDismissed, setOwnDismissed] = useState<readonly string[]>([]);
  const listOpen = (misfitsOpen ?? ownOpen) && flagged > 0;
  const setListOpen = (open: boolean) => {
    setOwnOpen(open);
    onMisfitsOpen?.(open);
  };
  const dismissed = new Set([...prefs.misfitsDismissed, ...ownDismissed]);
  const chipShown = misfitIds.some((id) => !dismissed.has(id));
  const dismissMisfits = () => {
    setOwnDismissed(misfitIds);
    onPrefs?.({ misfitsDismissed: misfitIds });
    setListOpen(false);
  };
  const countOut = useRef(onMisfitCount);
  countOut.current = onMisfitCount;
  useEffect(() => {
    countOut.current?.(flagged);
  }, [flagged]);
  useEffect(() => () => countOut.current?.(0), []);

  // the room: its back wall from the floor to the ceiling the View card sets (CASE-FB1 item 3), its floor and ceiling
  const room = roomBox(wall, ceilingMm);
  const roomW = room.x1 - room.x0;
  const roomD = room.zFront - room.zBack;
  // the camera's frame is centred in the scene: on a wide panel, these px of the scene on each side are outside it
  const side = (frame.width - camera.frame.width) / 2;
  // NAV-1A: what the Free camera's gestures move through, for this render
  const boxes = useMemo(() => wall.cabinets.map((slot, i) => cabinetBox(slot, headroomMm[i])), [wall, headroomMm]);
  freeScene.current = {
    base: base.camera,
    s,
    wall,
    fronts,
    boxes,
    space: eyeSpace(room, ceilingMm),
    zBack: room.zBack,
    dimmed: prefs.view === 'cabinet' ? wall.cabinets[focusIdx] : null,
    lookMode: prefs.swipe === 'pan',
    lookHoldMs: lookHoldMs(),
    reducedMotion: prefersReducedMotion(),
    // NAV-1A (b): what a look projects the scene's cost from: the figures as this render draws them, listed only when asked
    budget: {
      span,
      wall,
      fronts,
      cap: base.drawCap,
      counts: heldCounts,
      kinds: heldKinds,
      boards: (cab) => opaqueBoards(wall.cabinets[cab]),
      figures: () =>
        draws.map(({ cab, draw: fig }) => {
          const { art, aspect, margins } = drawing(fig.placed.item);
          const g = figureGeometry(fig, art, aspect, margins);
          return { ...figureLayerBox(fig, g, cab), tapMm: g.tapW, plate: labels ? plateOf(fig) : null };
        }),
      room: [
        [[room.x0, room.y1, room.zBack], [roomW, 0, 0], [0, -room.y1, 0]],
        [[room.x0, 0, room.zBack], [roomW, 0, 0], [0, 0, roomD]],
        [[room.x0, room.y1, room.zBack], [roomW, 0, 0], [0, 0, roomD]],
        [[room.x0, room.y1, room.zBack], [0, 0, roomD], [0, -room.y1, 0]],
        [[room.x1, room.y1, room.zBack], [0, 0, roomD], [0, -room.y1, 0]],
      ],
      roomFacePx: ROOM_GRID.u * ROOM_GRID.v,
      viewportPx: window.innerWidth * window.innerHeight,
    },
  };
  const cone = free ? coneOf(camera, wall, fronts) : null;
  useLayoutEffect(() => {
    if (freeRef.current) fc.sync();
  });

  return (
    <div
      ref={hostRef}
      class="cabinet-scene"
      role="region"
      aria-label="Display cabinets"
      // NAV-PTR-1: every drag on the scene is its own (a finger moving down raises the camera): never a pull to refresh
      data-own-gestures
      data-view={prefs.view}
      data-swipe={prefs.swipe}
      // WALL-COLOUR-1: the wall's colour (both themes', as custom properties)
      data-wall-colour={prefs.wall}
      style={wallStyle(prefs.wall, prefs.wallCustom)}
      data-pattern={prefs.pattern}
      data-focus={String(focusIdx)}
      data-shelf={String(shelfIdx)}
      data-camera-x={fmt(camera.x)}
      data-camera={
        free
          ? cameraData(camera)
          : JSON.stringify({
              x: num(camera.x),
              y: num(camera.y),
              z: num(camera.z),
              pitch: num(camera.pitch),
              focalPx: num(camera.focalPx),
              width: camera.frame.width,
              height: camera.frame.height,
            })
      }
      data-pan={free ? undefined : String(Math.round(panPx))}
      data-pan-y={free ? undefined : String(Math.round(panYPx))}
      data-free-camera={free ? '1' : undefined}
      data-cone={cone ? JSON.stringify({ soft: num((cone.soft * 180) / Math.PI), hard: num((cone.hard * 180) / Math.PI) }) : undefined}
      data-room={JSON.stringify({ ceilingMm: num(room.y1), zBack: num(room.zBack) })}
      data-px-per-mm={String(s)}
      data-turned-px-per-mm={asked === null ? undefined : String(asked)}
      data-cull-x={String(cull.camera.x)}
      data-cull-pan={String(cull.panPx)}
      data-wall={wallBoxes}
      data-held={held}
      data-drawn-cabinets={String(drawnCabs.length)}
      data-drawn-cap={String(drawCap)}
      data-drawn-figures={String(onShow.length)}
      data-figure-cap={String(figCap)}
      data-hidden-figures={String(hidden)}
      data-laid-out={settle.revealed ? '1' : '0'}
      data-layout-final={settle.final ? '1' : '0'}
      data-show-estimated={prefs.showEstimated ? '1' : '0'}
      data-zoom={zoomData(zoom.current)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endPress(e, true)}
      onPointerCancel={(e) => endPress(e, false)}
      onClickCapture={onClickCapture}
      // NAV-1A: a long press (Look's hold, or longer) never opens the browser's own menu over the scene
      onContextMenu={free ? (e) => e.preventDefault() : undefined}
      onScroll={(e) => {
        // ruling 33: where a browser cannot clip without a scroll box, a scroll (a button taking focus) is put back
        e.currentTarget.scrollLeft = 0;
        e.currentTarget.scrollTop = 0;
      }}
    >
      <div
        ref={frameRef}
        class="cabinet-scene__frame"
        // CASE-FB1: the picture is drawn in the camera's frame, centred in the scene: on a wide panel cropped narrower
        // (fewer cabinets across, never a cropped height)
        style={{ left: `${side}px`, width: `${camera.frame.width}px` }}
      >
        {/* PINCH-1: the magnification, one 2D transform over the flattened 3D picture (set as the fingers move) */}
        <div ref={zoomRef} class="cabinet-scene__zoom" style={{ transform: zoomTransform(zoom.current) }}>
          <div
            class="cabinet-scene__viewport"
            style={{ perspective: `${fmt(camera.focalPx)}px`, transform: panPx || panYPx ? `translate(${panPx}px, ${panYPx}px)` : undefined }}
          >
            <div ref={rootRef} class="cabinet-scene__root" style={{ transform: cssSceneTransform(camera, s), '--s': String(s) }}>
              <DrawContext.Provider value={draw}>
                <Quad cls="room-wall" a={[room.x0, room.y1, room.zBack]} u={[roomW, 0, 0]} v={[0, -room.y1, 0]} grid={ROOM_GRID} />
                <Quad cls="room-floor" a={[room.x0, 0, room.zBack]} u={[roomW, 0, 0]} v={[0, 0, roomD]} grid={ROOM_GRID} />
                <Quad cls="room-ceiling" a={[room.x0, room.y1, room.zBack]} u={[roomW, 0, 0]} v={[0, 0, roomD]} grid={ROOM_GRID} />
                {/* NAV-1A (rulings S9): the room's side walls, which a look near a wall's end or a walk past it sees */}
                {free && <Quad cls="room-wall room-side" a={[room.x0, room.y1, room.zBack]} u={[0, 0, roomD]} v={[0, -room.y1, 0]} grid={ROOM_GRID} />}
                {free && <Quad cls="room-wall room-side" a={[room.x1, room.y1, room.zBack]} u={[0, 0, roomD]} v={[0, -room.y1, 0]} grid={ROOM_GRID} />}
                {visible.map(({ slot, i }) => (
                  <Cabinet key={`${i}:${slot.profile.id}`} slot={slot} index={i} />
                ))}
                {onShow.map(({ draw: fig }, n) => {
                  const { figure, index } = fig.placed.item;
                  const { art, aspect, margins } = drawing(fig.placed.item);
                  return (
                    <SceneFigure
                      key={figure._id}
                      draw={fig}
                      art={art}
                      aspect={aspect}
                      margins={margins}
                      scale={scales[n]}
                      plate={plates[n]}
                      onSelect={() => onSelect(figure, index)}
                      onBroken={images.failed}
                    />
                  );
                })}
              </DrawContext.Provider>
            </div>
            {dimFrom !== null && focusIdx > 0 && <NeighbourDim side="left" edge={dimFrom.left} window={shownWindow} />}
            {dimFrom !== null && focusIdx < lastIndex && <NeighbourDim side="right" edge={dimFrom.right} window={shownWindow} />}
          </div>
        </div>
        {free && <div ref={ringRef} class="cabinet-scene__look-ring" aria-hidden="true" />}
      </div>

      <ResetChip
        shown={showChip}
        // NAV-PTR-1: zoomed, or raised or slid at least RESET_PX of picture travel (the raise in screen terms, in every view);
        // a walk is navigation, not a view off its angle
        moved={
          free
            ? // NAV-1A (spec 4): off the frame-centre cabinet's framing by more than a glance; never during a gesture
              !fc.live() && fc.held() !== null && resetApplies(poseOf(camera), poseOf(base.camera))
            : Math.abs(lift) >= Math.abs(liftForDragMm(along, RESET_PX)) || Math.abs(pan) >= RESET_PX || Math.abs(panY) >= RESET_PX
        }
        fade={free}
        onReset={() => {
          if (free) {
            // NAV-1A: the frame-centre cabinet's framing, turned straight, at once; the zoom cleared
            fc.hold(null);
            showZoom(UNZOOMED, 'still');
            setFramedFocus(null);
            rerender();
            return;
          }
          showZoom(UNZOOMED, 'settle');
          setWalkX(null);
          setPan(0);
          setLift(0);
          setPanY(0);
          setFramedFocus(null);
        }}
      />

      {/* NAV-PTR-1: the arrows are the scene's controls, not its picture: a press on one is no gesture of the scene's */}
      <div class="cabinet-scene__nav" data-scene-ui>
        <StepButton
          cls="cabinet-scene__step cabinet-scene__step--prev"
          label="Previous cabinet"
          disabled={reach !== null ? !reach.prev : focusIdx <= 0}
          onStep={() => (prefs.view === 'wall' ? goPage(-1) : goCabinet(focusIdx - 1))}
          onDrag={startPress}
        >
          ‹
        </StepButton>
        <StepButton
          cls="cabinet-scene__step cabinet-scene__step--next"
          label="Next cabinet"
          disabled={reach !== null ? !reach.next : focusIdx >= lastIndex}
          onStep={() => (prefs.view === 'wall' ? goPage(1) : goCabinet(focusIdx + 1))}
          onDrag={startPress}
        >
          ›
        </StepButton>
        {prefs.view === 'shelf' && (
          <div class="cabinet-scene__shelves">
            <StepButton label="Shelf above" disabled={shelfIdx <= 0} onStep={() => goShelf(Math.max(0, shelfIdx - 1))} onDrag={startPress}>
              ˄
            </StepButton>
            <StepButton label="Shelf below" disabled={shelfIdx >= shelfCount - 1} onStep={() => goShelf(Math.min(shelfCount - 1, shelfIdx + 1))} onDrag={startPress}>
              ˅
            </StepButton>
          </div>
        )}
      </div>

      {flagged > 0 && chipShown && (
        <MisfitChip
          count={flagged}
          open={listOpen}
          onToggle={() => setListOpen(!listOpen)}
          onHide={() => {
            // the chip is gone under the finger: the click its lift-off makes lands on whatever is beneath, never a tap of that
            swallowClick.current = true;
            dismissMisfits();
          }}
        />
      )}
      {listOpen && (
        <div class="cabinet-scene__fit" data-scene-ui role="region" aria-label="Figures that do not fit" data-count={String(flagged)}>
          <div class="cabinet-scene__fit-head">
            <span class="cabinet-scene__fit-title">{flagged === 1 ? '1 figure does not fit' : `${flagged} figures do not fit`}</span>
            <button type="button" class="cabinet-scene__fit-dismiss" aria-label="Dismiss: hide the chip until another figure does not fit" onClick={dismissMisfits}>
              ×
            </button>
          </div>
          <ul>
            {packed.violators.map((v) => (
              <li key={v.item.figure._id}>
                {v.item.figure.name}: {describeViolator(v, pattern, ceilingMm)}, for {wallName}
              </li>
            ))}
            {overhangs.map(({ draw }) => (
              <li key={draw.placed.item.figure._id}>
                {draw.placed.item.figure.name}: too deep for its shelf, it overhangs
              </li>
            ))}
          </ul>
        </div>
      )}
      <Style css={styles} />
      {free && <Style css={freeStyles} />}
    </div>
  );
}

/** NAV-1A: Look's hold, tunable on the device with ?lookhold=200 (100 to 1,000 ms; Ross may try 200 and 300). */
function lookHoldMs(): number {
  const v = Number(new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('lookhold'));
  return Number.isFinite(v) && v >= 100 && v <= 1000 ? v : LOOK_HOLD_MS;
}

/** NAV-1A: the Free camera's own rules, drawn only while it is on (the old path's sheet is untouched). */
const freeStyles = `
  .cabinet-scene[data-free-camera] { -webkit-touch-callout: none; }
  /* rulings S6: the 28 px ring under a finger that has armed Look, gone when it lifts */
  .cabinet-scene__look-ring {
    position: absolute;
    width: 28px;
    height: 28px;
    margin: -14px 0 0 -14px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.9);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
    box-sizing: border-box;
    pointer-events: none;
    display: none;
  }
  .cabinet-scene__look-ring[data-on] { display: block; }
  /* spec 4: Reset view never during a gesture; it fades in over 400 ms once one ends */
  .cabinet-scene[data-gesture] .cabinet-scene__reset { visibility: hidden; }
  .cabinet-scene__reset--fade { animation: cabinet-scene-reset-in 400ms ease-out both; }
  @keyframes cabinet-scene-reset-in { from { opacity: 0; } to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .cabinet-scene__reset--fade { animation: none; } }
`;

// The page sizes the scene (Collection: down to the pull-up tabs); 60vh only where nothing does. Inside the scene
// root a length is a length in the world at its --s px per mm (texelScale), so every px there is scaled by it.
const styles = `
  .cabinet-scene {
    position: relative;
    /* ruling 33: clipped with no scroll box, so a button taking focus never scrolls the picture off the frame */
    overflow: hidden;
    overflow: clip;
    height: 60vh;
    background: #0b0c0f;
    /* CASE-FB1: every drag is the case's: sideways walks or pans, up and down raises the camera or slides the photo */
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }
  /* the camera's frame, centred; clipped with no scroll box (ruling 33) */
  .cabinet-scene__frame { position: absolute; top: 0; bottom: 0; overflow: hidden; overflow: clip; }
  /* PINCH-1: the zoom layer covers the frame and scales from its top-left (caseZoom); promoted only while fingers
     move it, so once let go its picture rasters again at the zoom it settled at. Never a CSS transition: it would have
     the compositor raster every layer under it at the zoom's scale (CASE-FB3a); a settle glides by frames instead */
  .cabinet-scene__zoom { position: absolute; inset: 0; transform-origin: 0 0; }
  .cabinet-scene__zoom--live { will-change: transform; }
  .cabinet-scene__viewport { position: absolute; inset: 0; perspective-origin: 50% 50%; }
  /* CAB-FOCUS-1: the dimming over the focus cabinet's neighbours: flat, over the window the frame shows, its box set per render */
  .cabinet-scene__dim { position: absolute; }
  .cabinet-scene__root { position: absolute; left: 0; top: 0; width: 0; height: 0; transform-origin: 0 0 0; transform-style: preserve-3d; }
  .cabinet-scene .cab, .cabinet-scene .part { position: absolute; left: 0; top: 0; width: 0; height: 0; transform-style: preserve-3d; pointer-events: none; }
  .cabinet-scene .q { position: absolute; left: 0; top: 0; transform-origin: 0 0 0; pointer-events: none; box-sizing: border-box; }
  /* WALL-COLOUR-1: the wall is the colour the View card sets, the one of the app's theme (both are on the scene as custom
     properties); the floor and the ceiling are mixed from it, so a light wall does not stand over a black floor */
  .cabinet-scene { --wall: var(--wall-dark, #3b342a); }
  [data-theme='light'] .cabinet-scene { --wall: var(--wall-light, #efe6d6); }
  .cabinet-scene .room-wall {
    background: linear-gradient(180deg, color-mix(in srgb, var(--wall) 92%, white) 0%, var(--wall) 55%, color-mix(in srgb, var(--wall) 86%, black) 100%);
  }
  .cabinet-scene .room-floor {
    background: linear-gradient(180deg, color-mix(in srgb, var(--wall) 30%, #2a211b) 0%, color-mix(in srgb, var(--wall) 42%, #3a2d24) 100%);
  }
  .cabinet-scene .room-ceiling {
    background: linear-gradient(0deg, color-mix(in srgb, var(--wall) 94%, white) 0%, color-mix(in srgb, var(--wall) 98%, white) 100%);
  }
  .cabinet-scene .m-steel { background: #1d1e22; }
  .cabinet-scene .m-steel.f-side { background: #131417; }
  .cabinet-scene .m-steel.f-top { background: #2b2d32; }
  /* WALL-COLOUR-1: an underside is its material's top shaded about 20 % darker, never black (against a wall it could not be told from a gap) */
  .cabinet-scene .m-steel.f-bottom { background: #222428; }
  .cabinet-scene .m-wood { background: #2f2825; }
  .cabinet-scene .m-wood.f-side { background: #221c1a; }
  .cabinet-scene .m-wood.f-top { background: #3b332f; }
  .cabinet-scene .m-wood.f-bottom { background: #2f2926; }
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
  /* WALL-COLOUR-1: glass reads on a light wall: in the light theme its edges are a darker teal (the pale ones above vanish on cream) */
  [data-theme='light'] .cabinet-scene .m-glass-plate { background: rgba(40, 120, 130, 0.12); }
  [data-theme='light'] .cabinet-scene .m-glass-rim { background: rgba(40, 120, 130, 0.6); }
  [data-theme='light'] .cabinet-scene .m-glass-top { background: rgba(40, 120, 130, 0.1); }
  [data-theme='light'] .cabinet-scene .m-glass-edge { background: rgba(30, 110, 120, 0.8); }
  [data-theme='light'] .cabinet-scene .cab-pane { background: rgba(40, 120, 130, 0.14); }
  .cabinet-scene .cab-shadow {
    background: radial-gradient(ellipse at 50% 50%, rgba(0, 0, 0, 0.62) 0%, rgba(0, 0, 0, 0.3) 45%, rgba(0, 0, 0, 0) 72%);
  }
  /* SIZE-BASIS-1: a figure whose height or width is an estimate, outlined when the View card asks: quiet, dashed, no tap of its own */
  .cabinet-scene[data-show-estimated='1'] .cab-figure[data-size-estimated]:not([data-size-estimated='']) {
    outline: 1.5px dashed rgba(255, 193, 7, 0.85);
    outline-offset: 1px;
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
  /* a name plate (CASE-FB2a): the room its figure's width gives it, its brass face as wide as the name, cut short with
     an ellipsis where the room ends, one line high */
  .cabinet-scene .cab-plate {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    font: 600 calc(${LABEL_FONT_MM}px * var(--s, 1)) / calc(${LABEL_LINE_MM}px * var(--s, 1)) var(--font-sans, system-ui);
  }
  .cabinet-scene .cab-plate__face {
    display: block;
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
    padding: calc(${LABEL_PAD_MM}px * var(--s, 1)) calc(${LABEL_SIDE_MM}px * var(--s, 1));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    /* antique brass: a brushed, aged warm gold-brown, lit from above, a darker bevelled edge, the name engraved dark */
    background:
      repeating-linear-gradient(90deg, rgba(255, 236, 190, 0.07) 0 calc(1px * var(--s, 1)), rgba(70, 45, 12, 0.06) calc(1px * var(--s, 1)) calc(2.5px * var(--s, 1))),
      linear-gradient(180deg, #dcb978 0%, #b8904a 45%, #8f6a2e 100%);
    box-shadow:
      inset 0 0 0 calc(0.7px * var(--s, 1)) rgba(68, 44, 14, 0.85),
      inset 0 calc(1px * var(--s, 1)) 0 calc(0.4px * var(--s, 1)) rgba(255, 232, 170, 0.35);
    border-radius: calc(1.5px * var(--s, 1));
    color: #2e1f0a;
    text-shadow: 0 calc(0.6px * var(--s, 1)) 0 rgba(255, 228, 160, 0.4);
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
  /* MISFIT-CHIP-1: the do-not-fit chip, bottom left, inset 24 px from the edge (the back swipe's), clear of the raised + at the
     middle of the tab bar; a warning glyph and the count. A 48 px target round the small chip, as the Reset view chip's */
  .cabinet-scene__misfit {
    position: absolute;
    left: 24px;
    bottom: 16px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 10px 0 8px;
    border-radius: var(--radius-full, 9999px);
    background: rgba(150, 40, 28, 0.92);
    color: #fff;
    font: 600 12px/1 var(--font-sans, system-ui);
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    pointer-events: auto;
  }
  .cabinet-scene__misfit::before { content: ''; position: absolute; inset: -10px -8px; }
  /* the list: over the lower part of the scene, scrolling inside its own box so any length reads */
  .cabinet-scene__fit {
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: 56px;
    max-height: min(60%, 360px);
    overflow-y: auto;
    overscroll-behavior: contain;
    touch-action: pan-y;
    padding: 6px 10px 8px;
    border-radius: 10px;
    background: rgba(70, 22, 16, 0.96);
    color: #fff;
    font: 600 12px/1.3 var(--font-sans, system-ui);
  }
  .cabinet-scene__fit-head { position: sticky; top: -6px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0 4px; background: rgba(70, 22, 16, 0.96); }
  .cabinet-scene__fit-dismiss { flex: none; width: 32px; height: 32px; border-radius: 9999px; font-size: 20px; line-height: 1; color: #fff; background: rgba(255, 255, 255, 0.14); }
  .cabinet-scene__fit ul { margin: 4px 0 0; padding-left: 16px; font-weight: 500; }
  .cabinet-scene__fit li + li { margin-top: 4px; }
  /* NAV-PTR-1: Reset view, bottom right, inset 24 px from the edge (the misfit chip's mirror), never at the top: a small
     button, a glyph over a short label at the app's smallest size */
  .cabinet-scene__reset {
    position: absolute;
    right: 24px;
    bottom: 16px;
    width: 40px;
    height: 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 0;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    font: 600 var(--font-2xs)/1 var(--font-sans, system-ui);
    white-space: nowrap;
    pointer-events: auto;
  }
  /* a 48 px target (--touch-min) round the 40 px button */
  .cabinet-scene__reset::before { content: ''; position: absolute; inset: -4px; }
`;

import { useMemo, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Figure } from '@figurecollecting/fc-shared';
import type { VirtualItem } from '@tanstack/virtual-core';
import { packShelves } from './packShelves';
import type { ShelfItem, ShelfRow } from './packShelves';
import { getDisplayMeta } from './displayMeta';
import { resolveRelHeights, resolveMaxHeightMm, resolveHeightMm, resolveDepthMm } from './sizeResolution';
import { computeFigureZPlacement } from './figureDepthPlacement';
import type { PlacementStrategy, FigureZPlacement } from './figureDepthPlacement';
import { useBottomMarginFrac } from './alphaMargin';
import { SHELF_BAND } from './density';
import type { Density } from './density';
import { useElementWidth } from '../../hooks/useElementWidth';
import { useVirtualizer } from '../../hooks/useVirtualizer';
import { useScrollParent } from '../../hooks/useScrollParent';

export type { PlacementStrategy };

export type CaseMotif = 'detolf-dark' | 'glass-clear' | 'bookcase-wood';

/**
 * Extra vertical room reserved below each figure's feet for its nameplate
 * (Ross: plates mount to the shelf edge — lip/below-shelf zone — and must
 * never climb back up over the figure's base). Sized for the plate's worst
 * case: a 2-line wrapped name + 1-line maker at --font-plate/-sub, plus its
 * own padding/border. Only reserved when labels are actually on, so the
 * shelf stays at its normal (denser) height with labels off.
 */
export const PLATE_ZONE_PX = 34;

/** Margin above the tallest figure on a row, plus the shelf plane/lip/wash
 *  chrome below it — the same "+30" a fixed band already implied, kept as a
 *  constant now that row height is per-row instead of one shared constant. */
const BAY_MARGIN_PX = 30;

/** Small uniform offset (px) every figure/footprint sits forward of the
 *  true z=0 front-glass plane — see figureDepthPlacement's module doc. */
const FRONT_MARGIN_PX = 6;

/** .case__row's own left/right padding (px) — the floor's local 3D
 *  coordinate space has no such padding (it's a sibling subtree, not
 *  nested inside .case__row), so floor-space shadow X positions need this
 *  offset to land under the actual (padded) flex-rendered figure. Kept as
 *  a named constant cross-referenced with the CSS `padding: 0 6px 13px`
 *  below rather than a silently-duplicated magic number. */
const ROW_PADDING_X_PX = 6;

/**
 * ONE shared camera for the whole visible case (Ross, correcting a
 * regression): the case-depth-study's proven look comes from a SINGLE
 * perspective + perspective-origin applied to ALL shelves at once, so
 * each shelf's tilt varies with its own distance from the eye-line —
 * near-eye shelves read nearly edge-on, shelves far above or below show
 * progressively more of their top/underside. Applying perspective PER
 * BAY (the regression) resets that to an identical head-on camera for
 * every shelf — flat, no tilt variation, the exact bug this restores.
 *
 * The camera is a GEOMETRY COMPUTATION, not a runtime layout artifact
 * (Ross, second pass — the first pass derived perspective distance from
 * the mounted virtualization window's height, which drifted 943-1543px
 * across scroll as overscan/bay-count changed; a real camera's distance
 * from the shelf doesn't change because the browser happened to mount a
 * different number of DOM nodes). The two camera parameters are handled
 * separately, matching how they actually behave physically:
 *
 * - STANDOFF (viewer-to-front-plane distance): FIXED. Real display cases
 *   don't get closer/farther as you scroll a page. Anchored to the
 *   commissioned geometry model's Scenario D (cabinet_perspective_reference
 *   .md, an IKEA Detolf at eye height 60in / standoff 30in, width-ratio
 *   fingerprint w_back/w_front = 0.7032 — squarely in the "realistic
 *   close viewing" 0.6-0.8 band, §10). FIXED_STANDOFF_MM converts to px
 *   via pxPerMm, the SAME mm->px scale already anchoring figure heights
 *   and footprint depths (case coherence — one scale for camera, cabinet,
 *   and figures, not three independent ones).
 *
 * - EYE HEIGHT (perspective-origin Y): the ONE parameter that legitimately
 *   varies — not with mounted-DOM state, but with which part of the case
 *   the viewport is currently showing (computed live in the component body
 *   as eyeYWorldPx, from the scroll container's real scrollTop/clientHeight
 *   — see there for the formula). WORLD_EYE_FOCUS_FRACTION is the eye's
 *   position as a fraction of what's currently visible, kept at the
 *   case-depth-study's own calibration (16.5% down) so an unscrolled case
 *   that fits entirely on screen reproduces the study's exact feel — the
 *   fraction just gets applied to "the currently visible span" instead of
 *   always "the whole case," so a scrolled case re-anchors smoothly and a
 *   shelf's tilt genuinely updates (including flipping top/underside as it
 *   crosses the eye-line) as it scrolls through view, per the geometry
 *   model's surface-visibility rule (§3): eye above a shelf's top -> top
 *   visible; eye below its bottom -> underside; in between -> edge-on.
 *
 * CSS's own `perspective`/`perspective-origin` ARE a pinhole-camera
 * projection (perspective(d) is literally 1/(1 - z/d), the standard
 * perspective-divide) — feeding them real, physically-grounded values
 * accomplishes the commissioned model's projection math without a parallel
 * hand-rolled JS projector; validated against the model by comparing this
 * component's live width-ratio fingerprint and per-shelf tilt PATTERN
 * (monotonic growth away from the eye-line, near-zero at it) to Scenario
 * D's table, not by trying to reproduce Detolf's exact shelf pitch (this
 * component's shelf spacing is data-driven from packShelves, not fixed).
 *
 * IMPLEMENTATION NOTE (third pass — see .case__bay/.case__world doc
 * comments for the full reasoning): these two parameters are computed
 * ONCE here (worldPerspectivePx, eyeYWorldPx), but the actual `perspective`
 * / `perspective-origin` CSS lives on EACH `.case__bay`, not on one shared
 * ancestor — a self-contained PER-BAY camera using the SAME standoff and a
 * per-bay-recomputed origin (eyeYWorldPx re-expressed in that bay's own
 * local frame) is mathematically identical to a single shared camera for
 * every point in that bay, while letting each bay clip its own content
 * again (overflow:hidden safely reintroduced — a deeply-seated figure can
 * no longer visually bleed into an adjacent bay). "Shared camera" here
 * describes the PROJECTION MATH, not the literal DOM element it's
 * declared on.
 */
const FIXED_STANDOFF_MM = 762; // 30in — commissioned Scenario D (Detolf)
const WORLD_EYE_FOCUS_FRACTION = 0.165;

export const CASE_MOTIFS: { value: CaseMotif; label: string }[] = [
  { value: 'detolf-dark', label: 'Dark glass' },
  { value: 'glass-clear', label: 'Clear glass' },
  { value: 'bookcase-wood', label: 'Bookcase' },
];

export type CaseMode = 'dynamic' | 'fixed';

/**
 * Real cabinet inner dimensions for FIXED mode — locks the case to a real
 * profile (e.g. an IKEA Detolf's true inner shelf W x D x H) so figures
 * render at true physical scale and violators (too tall for the
 * compartment) can be flagged. NOT wired up yet — this is the structural
 * seam for the "will this figure fit my Detolf?" feature
 * (figure_sizing_and_case_dimension_model); caseMode/caseProfile are
 * accepted and threaded through so that feature can land without another
 * prop-plumbing pass, but fixed mode currently renders identically to
 * dynamic mode.
 */
export interface CaseProfile {
  name: string;
  innerWidthMm: number;
  innerDepthMm: number;
  /** Per-shelf-compartment clear height. */
  innerHeightMm: number;
}

/**
 * A real IKEA Detolf, computed from the commissioned geometry model
 * (cabinet_perspective_reference.md) rather than a rough estimate — the
 * first concrete CaseProfile, still voided/unconsumed like caseMode above,
 * but now grounded in real numbers instead of being purely structural.
 * Exterior 16.93 x 14.57 x 64.17in per IKEA's own listing; interior usable
 * width/depth and per-shelf clear opening height are collector-measured
 * (IKEA doesn't publish them) — see the doc's §12 sources and its
 * "Geometry ground truth — IKEA Detolf" table for the full derivation.
 */
export const DETOLF_PROFILE: CaseProfile = {
  name: 'IKEA Detolf',
  innerWidthMm: 385, // usable width 15.16in
  innerDepthMm: 330, // usable depth ~13in (330mm, collector-measured)
  innerHeightMm: 370, // clear opening ~14.57-14.76in per shelf level
};

interface CaseShelfProps {
  figures: Figure[];
  motif: CaseMotif;
  density: Density;
  onSelect?: (figure: Figure, index: number) => void;
  /** Watermark rendered into the case background (SVG logo lands later). */
  watermark?: ComponentChildren;
  /** Museum-plaque nameplate overlay under each figure. Defaults off. */
  labels?: boolean;
  /** Dynamic (default): each row's compartment height adapts to whatever's
   *  actually packed onto it. Fixed: locks to caseProfile's real
   *  dimensions and highlights figures that don't fit — see CaseProfile. */
  caseMode?: CaseMode;
  /** Required once caseMode is 'fixed'; ignored in dynamic mode. */
  caseProfile?: CaseProfile;
  /** True-depth (default, Ross): billboards physically recede their full
   *  footprint depth — honest perspective shrink included by design (a
   *  taller figure seated deep CAN project smaller than a shorter one up
   *  front; that's real-vision-consistent, not a bug — see
   *  figureDepthPlacement's module doc). Height-truth: a gentler,
   *  front-anchored alternate that suppresses most of the shrink. Kept as
   *  a knob for later, not because either is expected to change per-render
   *  in the app today. */
  placementStrategy?: PlacementStrategy;
}

/** Subtle wordmark placeholder until the bunny logo SVG is ready. */
function WatermarkPlaceholder() {
  return (
    <svg viewBox="0 0 160 20" width="120" height="15" aria-hidden="true">
      <text
        x="160"
        y="15"
        text-anchor="end"
        font-family="Inter, system-ui, sans-serif"
        font-size="14"
        font-weight="700"
        letter-spacing="0.5"
        fill="currentColor"
      >
        figurecollecting
      </text>
    </svg>
  );
}

/**
 * One figure standing on a shelf, seated at its own real 3D depth (see
 * figureDepthPlacement). Grounded by its real VISIBLE feet, not the
 * image's own (often padded) bottom edge — see useBottomMarginFrac.
 * Unmatted figures keep the metaphor by standing on the shelf as small
 * framed pictures. The contact shadow/footprint is NOT rendered here — it
 * lives in the floor's own local 3D coordinate space so it recedes
 * correctly with the floor's rotateX fold; see FloorShadow.
 *
 * Positioned ANALYTICALLY (translate3d), not by flexbox (Ross: figures and
 * their own shadows had drifted apart — the shadow already lived in the
 * floor's real 3D coordinate space and climbed the tilted floor correctly
 * with depth, but the figure was flexbox-positioned with only a translateZ
 * push, so its X came from justify-content:space-evenly instead of the
 * shadow's analytic item.left, and its grounding Y was pinned to a flat
 * flex baseline instead of the floor's actual point at that depth). Fixed
 * by using the SAME X the shadow uses (ROW_PADDING_X_PX + item.left — see
 * FloorShadow) and grounding the button's bottom edge at shelfLineY, the
 * exact world-Y the floor's own front edge sits at (.case__floor3d's
 * `top: shelfLineY`, before its rotateX fold pivots around that point) —
 * so feet and shadow are genuinely coincident points in the SAME shared 3D
 * world, not just visually close. The "climbing the floor with depth"
 * effect then falls out of the shared perspective for free: feet and
 * shadow project through the identical camera because they're the same
 * (x, shelfLineY, z) point. shelfLineY is NOT the bay's own full height
 * (bayHeightPx) — see the component body's shelfLineY comment for why
 * those differ when labels are on.
 */
function ShelfFigure({
  item,
  zPlacement,
  shelfLineY,
  onSelect,
}: {
  item: ShelfItem;
  zPlacement: FigureZPlacement;
  shelfLineY: number;
  onSelect?: (figure: Figure, index: number) => void;
}) {
  const { figure, meta, w, h } = item;

  // Real per-image alpha measurement: every matted PNG has a different
  // amount of transparent padding below the figure's actual feet. Ungrounded
  // figures with a large margin visibly hover above the shelf line; this
  // shifts the IMAGE ONLY (not the button, shadow, or nameplate — all three
  // are already correctly anchored to the shelf line) down by that margin
  // so the real feet meet it instead.
  const bottomMarginFrac = useBottomMarginFrac(meta.matted ? figure.imageUrl : undefined);
  const groundingShiftPx = Math.round(bottomMarginFrac * h);

  const figX = ROW_PADDING_X_PX + item.left;
  const figY = shelfLineY - h; // bottom edge (feet) lands at shelfLineY

  return (
    <button
      class={`shelf-figure ${meta.matted ? '' : 'shelf-figure--framed'}`}
      style={{
        width: `${w}px`,
        height: `${h}px`,
        '--fig-x': `${figX}px`,
        '--fig-y': `${figY}px`,
        '--fig-z': `${zPlacement.billboardZPx}px`,
      } as Record<string, string>}
      type="button"
      onClick={onSelect ? () => onSelect(figure, item.index) : undefined}
      data-synthetic-base={meta.matted && !meta.baseRecovered ? 'true' : undefined}
    >
      {figure.imageUrl ? (
        meta.matted ? (
          <img
            class="shelf-figure__img"
            src={figure.imageUrl}
            alt=""
            loading="lazy"
            style={groundingShiftPx ? { transform: `translateY(${groundingShiftPx}px)` } : undefined}
          />
        ) : (
          <span class="shelf-figure__frame">
            <img class="shelf-figure__img shelf-figure__img--photo" src={figure.imageUrl} alt="" loading="lazy" />
          </span>
        )
      ) : (
        <span class="shelf-figure__silhouette" aria-hidden="true" />
      )}
      <span class="sr-only">{figure.name}</span>
    </button>
  );
}

/**
 * A figure's nameplate — pinned to the shelf FRONT EDGE at z=0 (Ross: the
 * plate must NOT ride the figure's own translateZ back into the case).
 * Rendered as its OWN standalone element with an independent translate3d,
 * not a DOM child of the button — the button's --fig-z recession is the
 * whole reason the old plate (a child, inheriting that transform) receded
 * and foreshortened right along with a deeply-seated figure, the same
 * mechanism that made per-figure plate-to-foot screen distance vary. This
 * one sits at the SAME X column as its figure (figX + half its width, the
 * figure's own horizontal center) and the SAME Y the shelf's front lip and
 * every figure's own feet already share (shelfLineY — see ShelfFigure's
 * doc comment), but Z=0: the true front-glass plane, not receded at all.
 * Every plate therefore renders at one consistent size on one clean front
 * rail, regardless of how deep its own figure is seated — exactly Ross's
 * "shelf edge — lip/below-shelf zone" description, now literally true in
 * 3D rather than simulated via a flat CSS position on a receded parent.
 * Grows DOWN from shelfLineY into the room .case__bay reserves below it
 * (bayHeightPx - shelfLineY == PLATE_ZONE_PX) — NOT bayHeightPx itself,
 * which is the bay's own full (clipped) box; anchoring here instead of
 * there is what keeps the plate inside that box instead of being clipped
 * away by .case__bay's overflow:hidden (see the component body's
 * shelfLineY comment for the full reasoning).
 */
function ShelfPlate({ item, shelfLineY }: { item: ShelfItem; shelfLineY: number }) {
  const { figure, w, slotWidth } = item;
  // Widened to the item's slot (its own width plus its share of the
  // surrounding gaps) — Ross: let plates nearly meet, not stay capped to
  // the figure's own (often much narrower) width.
  const plateWidth = Math.max(w, slotWidth - 4);
  const figX = ROW_PADDING_X_PX + item.left;
  const plateLeft = Math.round(figX + w / 2 - plateWidth / 2);

  return (
    <div
      class="shelf-figure__plate"
      aria-hidden="true"
      style={{
        width: `${plateWidth}px`,
        transform: `translate3d(${plateLeft}px, ${shelfLineY}px, 0px)`,
      }}
    >
      <span class="shelf-figure__plate-name">{figure.name}</span>
      {figure.manufacturer && (
        <span class="shelf-figure__plate-mfr">{figure.manufacturer}</span>
      )}
    </div>
  );
}

/**
 * A figure's contact shadow/footprint, rendered in the FLOOR's own local
 * pre-rotation coordinate space (a child of .case__floor3d) rather than
 * relative to the figure's own button — so it inherits the floor's
 * rotateX(-90) fold and correctly recedes toward the back wall, "for
 * free," the same technique the case-depth-study proved. Local top/height
 * are CENTERED on the figure's own contact Z (zPlacement.billboardZPx —
 * the SAME Z the billboard sits at, not independently anchored to the
 * front margin; see the shadowTop/contactLocalY comment below for why
 * that was a real bug), spanning the figure's resolved footprint depth
 * around that point; local left is item.left (packShelves' analytic X
 * position) plus the row's own padding offset, since this subtree isn't
 * nested inside the padded flex row.
 */
function FloorShadow({ item, zPlacement }: { item: ShelfItem; zPlacement: FigureZPlacement }) {
  const { meta, w } = item;
  if (!meta.matted) return null;

  // Two-lobe contact shadow geometry from the two footprint scalars
  // (translated from shelf2.py contact_shadow): soft lobe spans 1.3x the
  // footprint; unrecovered bases get a stronger, wider synthetic grounding.
  const spread = meta.baseRecovered ? 1.3 : 1.55;
  const shadowW = Math.round(meta.footprintWidth * spread * w);
  const centerX = ROW_PADDING_X_PX + item.left + meta.footprintCenterX * w;
  const shadowLeft = Math.round(centerX - shadowW / 2);
  const shadowDepth = Math.max(8, Math.round(zPlacement.footprintDepthPx));

  // Contact Z: the billboard's own translateZ (zPlacement.billboardZPx),
  // NOT independently anchored to FRONT_MARGIN_PX (Ross's bug — the
  // shadow used to always start at the front glass regardless of how deep
  // the figure was actually seated, so the billboard sat at the shadow's
  // BACK edge instead of its contact point; under the shared camera that
  // Z mismatch reads as a vertical offset that's zero only at the
  // eye-line shelf and grows with distance from it — "all but one shelf
  // too high or too low"). The floor's rotateX fold maps local-Y (this
  // element's own pre-fold top/height) to world -Z, so a world-Z of `z`
  // is local-Y `-z`; CENTERING the shadow's span on that point (not
  // anchoring either edge to it) matches the shadow's own symmetric
  // radial-gradient shape (see .case__floor-shadow — centered at 50% 50%,
  // no directional near/far bias) and keeps figure feet + shadow
  // coincident at every depth, not just one.
  const contactLocalY = -zPlacement.billboardZPx;
  const shadowTop = Math.round(contactLocalY - shadowDepth / 2);

  return (
    <div
      class="case__floor-shadow"
      aria-hidden="true"
      style={{
        left: `${shadowLeft}px`,
        width: `${shadowW}px`,
        top: `${shadowTop}px`,
        height: `${shadowDepth}px`,
        opacity: meta.baseRecovered ? undefined : 1,
      }}
    />
  );
}

/** Compartment height for one packed row: tallest figure on it, plus fixed
 *  chrome margin (shelf plane/lip/wash) and the nameplate zone if labels
 *  are on. This is what makes DYNAMIC mode dynamic — every row can be a
 *  different height depending on what actually landed on it. */
function computeBayHeight(row: ShelfRow, plateZone: number): number {
  const tallest = row.reduce((max, item) => Math.max(max, item.h), 0);
  return tallest + BAY_MARGIN_PX + plateZone;
}

/**
 * Display A — the virtual display case. Figures stand as transparent PNGs on
 * shelf rows inside a case built from GENUINE CSS 3D (perspective +
 * preserve-3d): a receding back wall with top-back-corner ambient
 * occlusion, hinge-folded side walls converging toward it, a receding
 * frosted-glass shelf floor, and a flat plinth cap that closes the
 * floor-to-frame seam — the same rig proven in the standalone
 * case-depth-study, graduated here to render per virtualized row instead of
 * one fixed-shelf-count box. No per-figure reflections (frosted glass
 * diffuses, it doesn't mirror) and no glass-glare/streak sheets (rejected
 * twice during the study). Rows are packed as self-contained units and
 * virtualized by shelf so collections of 1000+ figures stay smooth, with
 * PROPORTIONAL sizing (relative to each figure's real physical height, one
 * shared scale across the whole displayed set) driving both the figure's
 * own render size and — since row height now depends on it — the
 * compartment height too.
 */
export function CaseShelf({
  figures,
  motif,
  density,
  onSelect,
  watermark,
  labels,
  caseMode = 'dynamic',
  caseProfile,
  placementStrategy = 'true-depth',
}: CaseShelfProps) {
  void caseMode;
  void caseProfile; // future-stub seam — see CaseProfile doc comment

  const hostRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(hostRef, 360);
  const band = SHELF_BAND[density];
  const caseD = Math.round(band * 0.85);
  const plateZone = labels ? PLATE_ZONE_PX : 0;

  // ONE shared physical-height scale across the whole displayed set (not
  // renormalized per row) — a given figure always renders at the same
  // relative size regardless of which shelf it lands on. Recomputed only
  // when the figure set itself changes. maxHeightMm doubles as the
  // anchor for the depth (mm -> px) scale below — "one shared mm->px scale
  // across figures AND case" (case coherence principle).
  const relHeights = useMemo(() => resolveRelHeights(figures, getDisplayMeta), [figures]);
  const getRelHeight = useMemo(
    () => (figure: Figure, meta: ReturnType<typeof getDisplayMeta>) => relHeights.get(figure._id) ?? meta.relHeight,
    [relHeights],
  );
  const maxHeightMm = useMemo(() => resolveMaxHeightMm(figures), [figures]);
  const pxPerMm = maxHeightMm > 0 ? band / maxHeightMm : 0;

  // Frame pillars eat ~12px a side; row padding eats a bit more.
  const rows = useMemo(
    () => packShelves(figures, Math.max(160, width - 48), band, 8, getRelHeight),
    [figures, width, band, getRelHeight],
  );

  // Each figure's real 3D depth placement (billboard Z + footprint depth
  // for its floor-space shadow) — DEFAULT strategy seats billboards at
  // their full resolved footprint depth, honest perspective shrink
  // included by design (see figureDepthPlacement's module doc for why
  // that's intentional, not a bug to guard against). depthMm is exposed
  // per figure alongside the placement itself, UNCLAMPED, as the seam a
  // fixed-mode fit-check ("too deep for the shelf", next to "too tall")
  // would read from later — not wired to anything yet, same as
  // caseMode/caseProfile. The clamped px value actually used for
  // placement (footprintDepthPx, inside `placement`) is FOV hygiene only,
  // not a height guard — it keeps a garbage depthMm from flinging a
  // figure past the back wall.
  const zPlacements = useMemo(() => {
    const map = new Map<string, FigureZPlacement & { depthMm: number }>();
    for (const figure of figures) {
      const meta = getDisplayMeta(figure);
      const resolvedHeight = resolveHeightMm(figure);
      const resolvedDepth = resolveDepthMm(figure, meta, resolvedHeight?.heightMm ?? null);
      const placement = computeFigureZPlacement(resolvedDepth.depthMm, pxPerMm, {
        strategy: placementStrategy,
        caseDepthPx: caseD,
        frontMarginPx: FRONT_MARGIN_PX,
      });
      map.set(figure._id, { ...placement, depthMm: resolvedDepth.depthMm });
    }
    return map;
  }, [figures, pxPerMm, placementStrategy, caseD]);
  const ZERO_PLACEMENT: FigureZPlacement = { billboardZPx: 0, footprintDepthPx: 0 };

  // Virtualize by SHELF against the app's own page scroll container — not a
  // nested scrollbox — so collections of 1000+ figures stay smooth. Falls
  // back to rendering every bay when no `.app-content` ancestor is found
  // (e.g. the component mounted in isolation in tests). estimateSize is
  // per-row (tanstack/virtual-core supports variable sizes natively) since
  // DYNAMIC mode means row height isn't a single shared constant anymore.
  const scrollParent = useScrollParent(hostRef);
  const rowVirtualizer = useVirtualizer<HTMLElement, HTMLElement>({
    count: rows.length,
    getScrollElement: () => scrollParent,
    estimateSize: (index) => computeBayHeight(rows[index] ?? [], plateZone),
    overscan: 3,
  });
  const virtualBays: VirtualItem[] = scrollParent
    ? rowVirtualizer.getVirtualItems()
    : rows.reduce<VirtualItem[]>((acc, row, index) => {
        const size = computeBayHeight(row, plateZone);
        const start = acc.length ? acc[acc.length - 1].end : 0;
        acc.push({ key: index, index, start, end: start + size, size, lane: 0 });
        return acc;
      }, []);
  const totalBaysHeight = scrollParent
    ? rowVirtualizer.getTotalSize()
    : rows.reduce((sum, row) => sum + computeBayHeight(row, plateZone), 0);

  // Case padding (10px top + 14px bottom) plus the packed bay content —
  // the watermark slot sizes itself off this, not the viewport.
  const caseHeightPx = 24 + totalBaysHeight;
  const watermarkHeightPx = Math.min(Math.round(caseHeightPx * 0.21), 120);

  // Bays are positioned RELATIVE to windowStart (the first mounted bay's
  // absolute offset), not to the list's absolute top, so translateY values
  // stay small/bounded no matter how far the user has scrolled or how huge
  // the collection is. windowHeightPx also becomes .case__world's explicit
  // height below — a position:absolute box with only absolutely-positioned
  // children never gains an auto height on its own, and this component
  // used to rely on a (since-removed) percentage perspective-origin that
  // silently broke against that zero-height box; keeping an explicit
  // height is just good practice now that origin is px-based (see below).
  const windowStart = virtualBays.length ? virtualBays[0].start : 0;
  const windowEnd = virtualBays.length ? virtualBays[virtualBays.length - 1].end : 0;
  const windowHeightPx = Math.max(1, windowEnd - windowStart);

  // Camera standoff: FIXED, computed from real geometry — see the
  // FIXED_STANDOFF_MM doc comment. NOT derived from windowHeightPx/any
  // mounted-DOM measurement, so it can't drift with scroll/overscan.
  const worldPerspectivePx = pxPerMm > 0 ? Math.round(FIXED_STANDOFF_MM * pxPerMm) : 900;

  // Eye height: the one parameter that DOES vary, tracking which part of
  // the case the viewport is currently showing — not the mounted DOM
  // window (which includes invisible overscan and would reintroduce the
  // same drift as the standoff bug), but the scroll container's own real,
  // stable scrollTop/clientHeight. visibleSpanPx is how much of the case
  // is visible from the top of the viewport downward (clamped to what's
  // actually left below the current scroll position, and to the whole
  // case when it's shorter than the viewport — the "fits on screen, eye
  // is effectively fixed like the study" case). eyeYAbsolutePx is in the
  // list's absolute coordinate space (same space as vBay.start); subtract
  // windowStart to land in .case__world's own local space, where the
  // element actually lives — and express it in PX, not %, so it doesn't
  // depend on .case__world's box height resolving correctly at all.
  const scrollTopPx = rowVirtualizer.scrollOffset ?? 0;
  const viewportHeightPx = scrollParent ? scrollParent.clientHeight : totalBaysHeight;
  const visibleSpanPx = Math.max(1, Math.min(viewportHeightPx, totalBaysHeight - scrollTopPx));
  const eyeYAbsolutePx = scrollTopPx + WORLD_EYE_FOCUS_FRACTION * visibleSpanPx;
  const eyeYWorldPx = eyeYAbsolutePx - windowStart;

  return (
    <div class="case-host" ref={hostRef}>
      <div
        class={`case ${motif === 'glass-clear' ? 'case--light' : ''}`}
        data-motif={motif}
        style={{ height: `${caseHeightPx}px`, '--case-d': `${caseD}px` } as Record<string, string>}
      >
        <div
          class="case__world"
          style={{
            height: `${windowHeightPx}px`,
            transform: `translateY(${windowStart}px)`,
          } as Record<string, string>}
        >
        {virtualBays.map((vBay) => {
          const row = rows[vBay.index];
          if (!row) return null;
          const bayHeightPx = computeBayHeight(row, plateZone);
          // The shelf's own surface Y — where the floor, every figure's
          // feet, and (when labels are on) the plate's own anchor all
          // land — is NOT bayHeightPx itself when labels are on.
          // bayHeightPx grows by plateZone to reserve room for the plate
          // (computeBayHeight), but that reserved room has to live BELOW
          // the actual shelf surface, inside .case__bay's own box (it has
          // overflow:hidden — see the bay-bleed fix — so anything
          // positioned past the bay's own bottom edge gets silently
          // clipped, which is exactly what happened to the plate before
          // this). Subtracting plateZone back off gives the shelf's real
          // surface Y, identical whether labels are on or off — only the
          // bay's own total height (and the reserved room below the
          // shelf) changes.
          const shelfLineY = bayHeightPx - plateZone;
          const bayWorldOffset = vBay.start - windowStart;
          // Per-bay perspective-origin, mathematically equivalent to the
          // single shared camera (see the module doc comment above
          // FIXED_STANDOFF_MM / the bay-bleed fix note) — bayOriginY is
          // the global eye-line re-expressed in THIS bay's own local
          // frame. Same worldPerspectivePx (standoff) for every bay.
          const bayOriginY = eyeYWorldPx - bayWorldOffset;
          return (
            <section
              key={vBay.key}
              class="case__bay"
              style={{
                height: `${bayHeightPx}px`,
                transform: `translateY(${bayWorldOffset}px)`,
                '--bay-perspective': `${worldPerspectivePx}px`,
                '--bay-origin-y': `${bayOriginY}px`,
              } as Record<string, string>}
            >
              {/* ── Genuine CSS 3D interior — see the module doc comment.
                  perspective lives on THIS bay itself (--bay-perspective/
                  --bay-origin-y above), self-contained rather than
                  inherited from an ancestor — mathematically equivalent to
                  one shared camera across the whole mounted window (see
                  the FIXED_STANDOFF_MM IMPLEMENTATION NOTE), so figures'
                  translateZ and the floor/walls' fold — and each bay's own
                  tilt relative to the others — still compose as one
                  consistent scene, not N disconnected head-on cameras,
                  while letting overflow:hidden clip each bay safely. ── */}
              <div class="case__bay3d" aria-hidden="true">
                <div class="case__interior3d">
                  <div class="case__back3d" />
                  <div class="case__wall-left3d" />
                  <div class="case__wall-right3d" />
                  {/* Short hinge-folded lip, same fold+origin as the floor
                      below it, so it tapers in perspective agreement
                      instead of reading as a flat bar bolted to the front
                      (the case-depth-study's plinth-top technique). */}
                  <div class="case__plinth-lip3d" style={{ top: `${shelfLineY}px` }} />
                  <div class="case__floor3d" style={{ top: `${shelfLineY}px` }}>
                    {row.map((item) => (
                      <FloorShadow key={item.figure._id} item={item} zPlacement={zPlacements.get(item.figure._id) ?? ZERO_PLACEMENT} />
                    ))}
                  </div>
                  <div class="case__plinth3d" />
                </div>
              </div>
              {/* Analytically positioned (translate3d), not flexbox — each
                  figure's X/Y/Z is set per item on .shelf-figure so its
                  feet land exactly where its own shadow sits (see
                  ShelfFigure's doc comment). preserve-3d so the shared
                  perspective above reaches each figure's transform.
                  Nameplates (labels on) render as SEPARATE sibling elements
                  (ShelfPlate), not children of the figure button — they
                  pin to the shelf's own front edge at z=0, independent of
                  how far back their figure recedes (see ShelfPlate's doc
                  comment). */}
              <div class="case__row">
                {row.map((item) => [
                  <ShelfFigure
                    key={item.figure._id}
                    item={item}
                    zPlacement={zPlacements.get(item.figure._id) ?? ZERO_PLACEMENT}
                    shelfLineY={shelfLineY}
                    onSelect={onSelect}
                  />,
                  labels && <ShelfPlate key={`plate-${item.figure._id}`} item={item} shelfLineY={shelfLineY} />,
                ])}
              </div>
              <div class="case__wash" />
            </section>
          );
        })}
        </div>
        <div class="case__watermark" style={{ height: `${watermarkHeightPx}px` }}>
          {watermark ?? <WatermarkPlaceholder />}
        </div>
      </div>

      <style>{caseStyles}</style>
    </div>
  );
}

const caseStyles = `
  .case-host {
    width: 100%;
  }

  /* ── Case frame ─────────────────────────────────────────────────────── */
  /* Height is set explicitly (inline style) to the packed/virtualized
     content size — bays below are virtualized-list items, positioned by
     transform, not stacked in normal flow. */
  .case {
    position: relative;
    padding: 10px 12px 14px;
    background: var(--case-frame);
    box-shadow: inset 0 1px 0 var(--case-frame-hi), inset 1px 0 0 var(--case-frame-hi),
      inset -1px 0 0 var(--case-frame-hi);
    overflow: hidden;
  }

  /* ── Window anchor — NOT a 3D camera anymore ────────────────────────
     Used to be the single shared perspective for every mounted bay; moved
     back to a PER-BAY perspective below (see .case__bay) to fix a real
     visual bug the shared version caused: with overflow:hidden removed
     from .case__bay (needed at the time to stop the CSS Transforms spec's
     overflow-forces-flat rule from silently killing the shared preserve-3d
     chain), a deeply-seated figure's own projected screen position could
     shift far enough to visually paint INTO an adjacent bay's territory —
     nothing clipped it anymore. Per-bay perspective (self-contained,
     one-level, no ancestor preserve-3d chain to protect) lets overflow:
     hidden come back safely, closing that hole. This element is now just
     the translateY(windowStart) positioning anchor bays sit relative to,
     unrelated to the camera. */
  .case__world {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
  }

  /* ── Shelf bay: 3D interior + figures ──────────────────────────────── */
  /* Virtualized list item, positioned by translateY relative to
     .case__world (not the list's absolute top). Height varies per row in
     DYNAMIC mode (tallest occupant + margin), so this is NOT a fixed-size
     item — tanstack/virtual-core's variable-size estimateSize/measure
     path handles that.
     PER-BAY perspective + perspective-origin (--bay-perspective /
     --bay-origin-y, set inline per bay from the SAME worldPerspectivePx
     standoff and a per-bay-computed origin — see the component body's
     bayOriginY comment) — mathematically equivalent to a single shared
     camera for every point in this bay (derived, not approximated: same
     perspective distance in both, and re-expressing the global eye-line
     in this bay's own local frame exactly cancels the difference between
     "one shared projection" and "N independent ones" — verify empirically
     if this is ever touched, the same way the overflow bug was caught).
     Self-contained (no preserve-3d needed from an ancestor), so
     overflow:hidden is safe again — no adjacent-bay bleed, and no risk of
     the overflow-forces-flat trap this rebuild hit earlier, because
     nothing here depends on a preserve-3d chain reaching through this
     element from outside it. */
  .case__bay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    overflow: hidden;
    perspective: var(--bay-perspective, 900px);
    perspective-origin: 50% var(--bay-origin-y, 100px);
  }

  .case__bay3d {
    position: absolute;
    inset: 0;
    transform-style: preserve-3d;
  }

  .case__interior3d {
    position: absolute;
    inset: 0;
    transform-style: preserve-3d;
  }

  /* Back wall: flat, pushed back -caseD. Top-corner ambient occlusion baked
     in as layered radial gradients — the strongest, most front-on-visible
     depth cue per the reference photos this rig was built against. */
  .case__back3d {
    position: absolute;
    inset: 0;
    transform: translateZ(calc(-1 * var(--case-d, 100px)));
    background:
      radial-gradient(ellipse 55% 65% at 4% 4%, var(--corner-ao, rgba(0,0,0,0.55)) 0%, transparent 62%),
      radial-gradient(ellipse 55% 65% at 96% 4%, var(--corner-ao, rgba(0,0,0,0.55)) 0%, transparent 62%),
      radial-gradient(ellipse 80% 90% at 50% 30%, var(--back3d-ambient, rgba(150,165,180,0.16)) 0%, transparent 68%),
      var(--case-back-bg);
    background-repeat: no-repeat;
  }

  /* Interior side walls: hinge-folded from the bay's left/right edges,
     receding to meet the back wall. This is what stays flat/absent without
     genuine 3D — off-axis it's the dominant depth cue, front-on it still
     reads via its taper. */
  .case__wall-left3d,
  .case__wall-right3d {
    position: absolute;
    top: 0;
    bottom: 0;
    width: var(--case-d, 100px);
    background: var(--wall3d-gradient);
  }

  .case__wall-left3d {
    left: 0;
    transform-origin: 0% 0%;
    transform: rotateY(90deg);
  }

  .case__wall-right3d {
    right: 0;
    transform-origin: 100% 0%;
    transform: rotateY(-90deg);
    background: var(--wall3d-gradient-r);
  }

  /* Shelf floor: hinge-folded from the bay's own bottom edge, receding
     back. Bright front-edge highlight (glass catching light) fading to
     shadow toward the back. Frosted/translucent, not mirror-clear — no
     per-figure reflection layer (removed; frosted glass diffuses). */
  .case__floor3d {
    position: absolute;
    left: 0;
    right: 0;
    height: var(--case-d, 100px);
    transform-origin: 0% 0%;
    transform: rotateX(-90deg);
    background: var(--floor3d-gradient);
  }

  /* Plinth lip: SAME hinge-fold as .case__floor3d (identical
     transform-origin and rotateX) so it tapers in perspective agreement
     with the floor instead of reading as a flat bar bolted onto the front
     — the case-depth-study's plinth-top technique, ported. Opaque
     frame-colored gradient (not the floor's translucent glass tint) so it
     reads as the base's own solid top edge. This is what actually closes
     the shelf-to-frame transition; .case__plinth3d below is just the flat
     cap face. */
  .case__plinth-lip3d {
    position: absolute;
    left: 0;
    right: 0;
    height: 10px;
    transform-origin: 0% 0%;
    transform: rotateX(-90deg);
    background: var(--plinth-lip-gradient);
  }

  /* Plinth cap: flat, unrotated, closes the seam where the plinth lip
     above meets the case's own bottom trim — a receding (Z-varying) plane
     and a flat trim strip project to very slightly different screen-Y
     under perspective at this distance from the vanishing point, which
     leaves a hairline gap if they only just touch. Overlaps that seam on
     purpose; not a design choice you'd notice on its own. */
  .case__plinth3d {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 10px;
    background: var(--plinth3d-gradient);
  }

  /* Figures are positioned ANALYTICALLY per item (--fig-x/--fig-y/--fig-z
     on .shelf-figure below), not by flexbox — see ShelfFigure's doc
     comment for why (feet must land on the same point as the figure's own
     shadow, which flexbox + a lone translateZ push couldn't guarantee).
     preserve-3d so each figure's translate3d is projected through this
     bay's own perspective (see .case__bay) alongside the floor/shadow it
     shares coordinates with. */
  .case__row {
    position: absolute;
    inset: 0;
    z-index: 2;
    transform-style: preserve-3d;
  }

  /* post-figure light wash (LED heads-catch-the-light pass / warm key) */
  .case__wash {
    position: absolute;
    inset: 0;
    z-index: 4;
    pointer-events: none;
    background: var(--bay-wash);
  }

  /* ── Watermark slot (logo SVG lands later) ─────────────────────────── */
  .case__watermark {
    position: absolute;
    right: 20px;
    bottom: 18px;
    z-index: 1;
    color: var(--watermark-color);
    opacity: var(--watermark-opacity);
    pointer-events: none;
  }

  /* ── Figures ────────────────────────────────────────────────────────── */
  /* --fig-x/--fig-y/--fig-z (set per item, see ShelfFigure) are the
     billboard's full analytic 3D placement — X/Y match the shadow's own
     point on the floor exactly, Z is the real depth placement (a gentle
     recession under the height-truth strategy, the full footprint depth
     under true-depth). No longer a flexbox child (position:absolute, not
     relative) — translate3d is now the ONLY thing positioning this
     element, not flex layout plus a lone Z push. :active repeats the full
     translate3d so the tap-scale doesn't reset the figure to (0,0,0) while
     pressed (a plain transform on :active would otherwise REPLACE, not add
     to, the base transform). */
  .shelf-figure {
    position: absolute;
    top: 0;
    left: 0;
    padding: 0;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
    transform: translate3d(var(--fig-x, 0px), var(--fig-y, 0px), var(--fig-z, 0px));
  }

  .shelf-figure:active {
    transform: translate3d(var(--fig-x, 0px), var(--fig-y, 0px), var(--fig-z, 0px)) scale(0.985);
  }

  .shelf-figure__img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    object-position: bottom;
    position: relative;
    z-index: 2;
  }

  /* Contact shadow/footprint: two-lobe wide soft ellipse + tight dark AO
     core, same visual recipe as before — but this is now .case__floor-
     shadow, a child of .case__floor3d (the floor's own local 3D space),
     not a child of .shelf-figure. See FloorShadow's doc comment for why. */
  .case__floor-shadow {
    position: absolute;
    border-radius: 50%;
    background:
      radial-gradient(ellipse 38% 30% at 50% 50%, rgba(0, 0, 0, var(--shadow-core)) 0%, transparent 95%),
      radial-gradient(ellipse 50% 50% at 50% 50%, rgba(0, 0, 0, var(--shadow-soft)) 0%, transparent 76%);
    opacity: 0.9;
  }

  /* unmatted photo: framed picture standing on the shelf */
  .shelf-figure--framed .shelf-figure__frame {
    position: absolute;
    inset: 0;
    z-index: 2;
    border: 3px solid var(--photo-frame);
    border-bottom-width: 5px;
    background: #fff;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
    display: block;
    overflow: hidden;
  }

  .shelf-figure__img--photo {
    /* never-crop applies to the framed-photo fallback too: letterbox inside
       the frame rather than cropping the picture. */
    object-fit: contain;
    object-position: center;
  }

  /* no image at all: soft silhouette so layout + shadows stay honest */
  .shelf-figure__silhouette {
    position: absolute;
    inset: 0;
    z-index: 2;
    border-radius: 40% 40% 8% 8% / 24% 24% 4% 4%;
    background: linear-gradient(180deg, rgba(127, 138, 152, 0.28), rgba(127, 138, 152, 0.16));
  }

  /* ── Nameplate: tiny museum plaque mounted at the shelf FRONT EDGE ──────
     A standalone element (see ShelfPlate), not a child of the figure
     button — position is driven ENTIRELY by its own inline
     transform:translate3d(x, bayHeightPx, 0), computed once in JS to land
     at the figure's own X column and the shelf's own front-lip Y, at Z=0
     (not receded). top/left:0 here are just the reference the translate3d
     offset is relative to, matching .shelf-figure's own pattern — no
     left:50%/-50% centering trick anymore, since ShelfPlate already
     computes the plate's own centered left edge directly. Width is set
     inline per-item (its packed slot, not its own — often much narrower —
     figure width), so neighboring plates can grow to nearly meet without
     ever colliding. The plate's own top edge (this element's local origin)
     lands flush with bayHeightPx — the same Y every figure's feet and the
     shadow's own contact point already share — and grows DOWN into the
     shelf-lip zone via its own content/padding, never back up over a
     figure's base. */
  .shelf-figure__plate {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 6;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    padding: 2px 6px;
    border-radius: 3px;
    background: rgba(12, 10, 8, 0.85);
    border: 1px solid rgba(201, 164, 100, 0.35);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
    pointer-events: none;
    line-height: 1.2;
  }

  .shelf-figure__plate-name,
  .shelf-figure__plate-mfr {
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: center;
  }

  /* Ross: explicit floor exemption for this decorative miniature label only
     (--font-plate / --font-plate-sub, see tokens.css) — 7px / 6px. Long
     names wrap to 2 lines (approved) rather than lose the whole tail to an
     ellipsis; the maker line stays single-line. */
  .shelf-figure__plate-name {
    font-size: var(--font-plate);
    font-weight: 600;
    color: #e3c489;
    white-space: normal;
    word-break: break-word;
    /* Plain 2-line wrap + height cap, deliberately NOT -webkit-line-clamp:
       that legacy mechanism (needs display:-webkit-box) rendered blank or
       dropped the first line entirely as a flex-column child in testing —
       verified in a real browser, not assumed. This is simpler and correct:
       at 7px across a 90px+ slot, 2 lines comfortably fits every fixture
       name; anything longer just clips flush at the height cap. */
    max-height: calc(var(--font-plate) * 2.4);
    flex-shrink: 0;
  }

  .shelf-figure__plate-mfr {
    font-size: var(--font-plate-sub);
    color: rgba(227, 196, 137, 0.62);
    white-space: nowrap;
  }

  /* ── Motifs — pure-CSS themes via custom properties ─────────────────── */

  /* Detolf: dark glass case, LED strip, cool-tinted 3D interior */
  .case[data-motif='detolf-dark'] {
    --case-frame: linear-gradient(180deg, #383c42 0%, #24262b 100%);
    --case-frame-hi: rgba(148, 156, 168, 0.5);
    --case-back-bg: linear-gradient(180deg, #262b33 0%, #12141a 100%);
    --corner-ao: rgba(0, 0, 0, 0.55);
    --back3d-ambient: rgba(150, 165, 180, 0.16);
    --bay-wash: linear-gradient(180deg, rgba(205, 225, 255, 0.11) 0%, transparent 42%);
    --wall3d-gradient: linear-gradient(90deg, rgba(110, 135, 160, 0.32) 0%, rgba(20, 24, 30, 0.6) 100%);
    --wall3d-gradient-r: linear-gradient(270deg, rgba(110, 135, 160, 0.32) 0%, rgba(20, 24, 30, 0.6) 100%);
    --floor3d-gradient: linear-gradient(180deg,
      rgba(215, 230, 240, 0.85) 0%, rgba(150, 180, 185, 0.4) 10%,
      rgba(80, 100, 105, 0.3) 35%, rgba(45, 55, 60, 0.26) 100%);
    --plinth-lip-gradient: linear-gradient(180deg, #6a6f77 0%, #363940 55%, #1a1c20 100%);
    --plinth3d-gradient: linear-gradient(180deg, #454951 0%, #24262a 55%, #121316 100%);
    --shadow-soft: 0.34;
    --shadow-core: 0.5;
    --watermark-color: #cfe0ff;
    --watermark-opacity: 0.07;
    --photo-frame: #3a3e45;
  }

  /* Clear glass: FROSTED mid-tone, not a white lightbox (Ross regression —
     the old --back3d-ambient white hotspot on a near-white --case-back-bg
     with weak corner AO blew the interior out flat). Retuned to match the
     study's frosted-glass character: milky translucent walls/floor, no
     central hotspot, strong corner AO for real depth even at this lighter
     value range. */
  .case[data-motif='glass-clear'] {
    --case-frame: linear-gradient(180deg, #ccd2d9 0%, #aab1b9 100%);
    --case-frame-hi: rgba(255, 255, 255, 0.75);
    --case-back-bg: linear-gradient(180deg, #b6c0c9 0%, #8d99a3 100%);
    --corner-ao: rgba(35, 45, 55, 0.48);
    --back3d-ambient: rgba(215, 225, 232, 0.14);
    --bay-wash: linear-gradient(180deg, rgba(255, 255, 255, 0.14) 0%, transparent 40%);
    --wall3d-gradient: linear-gradient(90deg, rgba(170, 190, 205, 0.5) 0%, rgba(90, 102, 112, 0.55) 100%);
    --wall3d-gradient-r: linear-gradient(270deg, rgba(170, 190, 205, 0.5) 0%, rgba(90, 102, 112, 0.55) 100%);
    --floor3d-gradient: linear-gradient(180deg,
      rgba(240, 246, 248, 0.9) 0%, rgba(200, 214, 218, 0.5) 10%,
      rgba(150, 168, 174, 0.4) 35%, rgba(110, 126, 132, 0.34) 100%);
    --plinth-lip-gradient: linear-gradient(180deg, #dbe1e6 0%, #aab3ba 55%, #7c868d 100%);
    --plinth3d-gradient: linear-gradient(180deg, #c4ccd3 0%, #9aa3ab 55%, #757e86 100%);
    --shadow-soft: 0.22;
    --shadow-core: 0.38;
    --watermark-color: #3c4652;
    --watermark-opacity: 0.08;
    --photo-frame: #8a9099;
  }

  /* Bookcase: warm wood back + shelf, no glass effects */
  .case[data-motif='bookcase-wood'] {
    --case-frame: linear-gradient(180deg, #4a3020 0%, #38241a 100%);
    --case-frame-hi: rgba(150, 106, 66, 0.6);
    --case-back-bg:
      repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.05) 0 2px, transparent 2px 7px, rgba(255, 220, 170, 0.04) 7px 9px, transparent 9px 23px),
      linear-gradient(180deg, rgb(97, 65, 40) 0%, rgb(76, 49, 29) 100%);
    --corner-ao: rgba(0, 0, 0, 0.45);
    --back3d-ambient: rgba(255, 228, 188, 0.1);
    --bay-wash: linear-gradient(180deg, rgba(255, 228, 188, 0.1) 0%, transparent 45%);
    --wall3d-gradient: linear-gradient(90deg, rgba(120, 82, 48, 0.55) 0%, rgba(45, 30, 18, 0.6) 100%);
    --wall3d-gradient-r: linear-gradient(270deg, rgba(120, 82, 48, 0.55) 0%, rgba(45, 30, 18, 0.6) 100%);
    --floor3d-gradient:
      repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.04) 0 3px, transparent 3px 11px),
      linear-gradient(180deg, rgb(158, 118, 76) 0%, rgb(120, 84, 50) 35%, rgb(90, 60, 34) 100%);
    --plinth-lip-gradient: linear-gradient(180deg, #8a6038 0%, #5a3c24 55%, #2e1c10 100%);
    --plinth3d-gradient: linear-gradient(180deg, #5a3c24 0%, #3a2616 55%, #241408 100%);
    --shadow-soft: 0.32;
    --shadow-core: 0.46;
    --watermark-color: #ffe2b8;
    --watermark-opacity: 0.06;
    --photo-frame: #2e2018;
  }
`;

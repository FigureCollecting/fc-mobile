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

/** Shared perspective (px) for a bay's 3D interior AND its figures — one
 *  camera for the whole scene, so a figure's translateZ and the floor's
 *  own rotateX(-90) fold are viewed through the identical projection. */
const BAY_PERSPECTIVE_PX = 480;

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
  /** Height-truth (default): billboards stay close to the shelf front
   *  regardless of footprint depth, so proportional-height sizing is never
   *  distorted by perspective shrink — depth instead reads through the
   *  floor-space footprint/shadow. True-depth: billboards physically
   *  recede their full footprint depth (stronger parallax, but a tall
   *  figure placed deep CAN render smaller than a short one up front —
   *  see figureDepthPlacement's module doc). Kept as a knob for later, not
   *  because either is expected to change per-render in the app today. */
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
 */
function ShelfFigure({
  item,
  zPlacement,
  onSelect,
  labels,
  plateZone,
}: {
  item: ShelfItem;
  zPlacement: FigureZPlacement;
  onSelect?: (figure: Figure, index: number) => void;
  labels?: boolean;
  plateZone: number;
}) {
  const { figure, meta, w, h, slotWidth } = item;

  // Real per-image alpha measurement: every matted PNG has a different
  // amount of transparent padding below the figure's actual feet. Ungrounded
  // figures with a large margin visibly hover above the shelf line; this
  // shifts the IMAGE ONLY (not the button, shadow, or nameplate — all three
  // are already correctly anchored to the row baseline / shelf line) down
  // by that margin so the real feet meet it instead.
  const bottomMarginFrac = useBottomMarginFrac(meta.matted ? figure.imageUrl : undefined);
  const groundingShiftPx = Math.round(bottomMarginFrac * h);

  return (
    <button
      class={`shelf-figure ${meta.matted ? '' : 'shelf-figure--framed'}`}
      style={{ width: `${w}px`, height: `${h}px`, '--fig-z': `${zPlacement.billboardZPx}px` } as Record<string, string>}
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
      {labels && (
        // Widened to the item's slot (its own width plus its share of the
        // surrounding gaps) — Ross: let plates nearly meet, not stay capped
        // to the figure's own (often much narrower) width. Mounted at the
        // shelf edge: top of the plate sits flush with the figure's own
        // bottom (never climbing over the base), growing down through the
        // enlarged shelf-lip zone (plateZone).
        <span
          class="shelf-figure__plate"
          aria-hidden="true"
          style={{ width: `${Math.max(w, slotWidth - 4)}px`, bottom: `${-plateZone}px` }}
        >
          <span class="shelf-figure__plate-name">{figure.name}</span>
          {figure.manufacturer && (
            <span class="shelf-figure__plate-mfr">{figure.manufacturer}</span>
          )}
        </span>
      )}
      <span class="sr-only">{figure.name}</span>
    </button>
  );
}

/**
 * A figure's contact shadow/footprint, rendered in the FLOOR's own local
 * pre-rotation coordinate space (a child of .case__floor3d) rather than
 * relative to the figure's own button — so it inherits the floor's
 * rotateX(-90) fold and correctly recedes toward the back wall, "for
 * free," the same technique the case-depth-study proved. Local top/height
 * span from the front margin back to the figure's own resolved footprint
 * depth (Ross: "stretches from z≈0 back to z=-d_fig"); local left is
 * item.left (packShelves' analytic X position) plus the row's own padding
 * offset, since this subtree isn't nested inside the padded flex row.
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

  return (
    <div
      class="case__floor-shadow"
      aria-hidden="true"
      style={{
        left: `${shadowLeft}px`,
        width: `${shadowW}px`,
        top: `${FRONT_MARGIN_PX}px`,
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
  placementStrategy = 'height-truth',
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
  // for its floor-space shadow) — see figureDepthPlacement's module doc
  // for why billboards stay close to the front regardless of footprint
  // depth (protects the proportional-height truth above from perspective
  // shrink). depthMm/heightSource are exposed per figure alongside the
  // placement itself as the seam a fixed-mode fit-check ("too deep for the
  // shelf", next to "too tall") would read from later — not wired to
  // anything yet, same as caseMode/caseProfile.
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

  return (
    <div class="case-host" ref={hostRef}>
      <div
        class={`case ${motif === 'glass-clear' ? 'case--light' : ''}`}
        data-motif={motif}
        style={{ height: `${caseHeightPx}px`, '--case-d': `${caseD}px` } as Record<string, string>}
      >
        {virtualBays.map((vBay) => {
          const row = rows[vBay.index];
          if (!row) return null;
          const bayHeightPx = computeBayHeight(row, plateZone);
          return (
            <section
              key={vBay.key}
              class="case__bay"
              style={{
                height: `${bayHeightPx}px`,
                transform: `translateY(${vBay.start}px)`,
                '--bay-perspective': `${BAY_PERSPECTIVE_PX}px`,
              } as Record<string, string>}
            >
              {/* ── Genuine CSS 3D interior — see the module doc comment.
                  perspective lives on .case__bay (this element's parent),
                  shared with .case__row below, so figures' own translateZ
                  and the floor/walls' fold are one consistent 3D scene. ── */}
              <div class="case__bay3d" aria-hidden="true">
                <div class="case__interior3d">
                  <div class="case__back3d" />
                  <div class="case__wall-left3d" />
                  <div class="case__wall-right3d" />
                  <div class="case__floor3d" style={{ top: `${bayHeightPx}px` }}>
                    {row.map((item) => (
                      <FloorShadow key={item.figure._id} item={item} zPlacement={zPlacements.get(item.figure._id) ?? ZERO_PLACEMENT} />
                    ))}
                  </div>
                  <div class="case__plinth3d" />
                </div>
              </div>
              {/* Row padding-bottom grows by plateZone so the figure's feet
                  lift clear of the enlarged shelf-edge zone the nameplate
                  now occupies — see PLATE_ZONE_PX. preserve-3d so the
                  shared perspective above reaches each figure's own
                  translateZ (--fig-z, set per item on .shelf-figure). */}
              <div class="case__row" style={{ paddingBottom: `${13 + plateZone}px` }}>
                {row.map((item) => (
                  <ShelfFigure
                    key={item.figure._id}
                    item={item}
                    zPlacement={zPlacements.get(item.figure._id) ?? ZERO_PLACEMENT}
                    onSelect={onSelect}
                    labels={labels}
                    plateZone={plateZone}
                  />
                ))}
              </div>
              <div class="case__wash" />
            </section>
          );
        })}
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

  /* ── Shelf bay: 3D interior + figures ──────────────────────────────── */
  /* Virtualized list item: absolutely positioned, placed via translateY.
     Height varies per row in DYNAMIC mode (tallest occupant + margin), so
     this is NOT a fixed-size item — tanstack/virtual-core's variable-size
     estimateSize/measure path handles that.
     perspective lives HERE (not on .case__bay3d below) so it's shared by
     BOTH the 3D interior AND .case__row's figures — one camera for the
     whole scene, not two disconnected 3D contexts that happen to overlap.
     Still scoped to this ONE bay (not the whole virtualized case), so every
     compartment looks like a consistent shelf regardless of where it sits
     in a (potentially huge) scroll list — a shared perspective across all
     bays would make far-scrolled ones look increasingly skewed. */
  .case__bay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    overflow: hidden;
    perspective: var(--bay-perspective, 480px);
    perspective-origin: 50% 20%;
  }

  .case__bay3d {
    position: absolute;
    inset: 0;
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

  /* Plinth: flat, unrotated cap that closes the seam where the floor's
     front edge meets the case's own bottom trim — a receding (Z-varying)
     plane and a flat trim strip project to very slightly different
     screen-Y under perspective at this distance from the vanishing point,
     which leaves a hairline gap if they only just touch. Overlaps that
     seam on purpose; not a design choice you'd notice on its own. */
  .case__plinth3d {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 10px;
    background: var(--plinth3d-gradient);
  }

  /* figures sit on the floor: baseline = lip + lift above the bay bottom.
     A flexbox layer for X layout (unchanged), but NOW also preserve-3d so
     each figure's own --fig-z translateZ (below) is projected through the
     shared perspective on .case__bay above — real depth placement, not
     just a flat overlay pretending to be in front of the 3D interior. */
  .case__row {
    position: absolute;
    inset: 0;
    padding: 0 6px 13px;
    display: flex;
    align-items: flex-end;
    justify-content: space-evenly;
    gap: 8px;
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
  /* --fig-z (set per item, see ShelfFigure) is the billboard's own real 3D
     depth placement — a gentle recession under the height-truth strategy,
     the full footprint depth under true-depth. :active repeats it so the
     tap-scale doesn't reset the figure back to z=0 while pressed (a plain
     transform on :active would otherwise REPLACE, not add to, the base
     transform). */
  .shelf-figure {
    position: relative;
    flex-shrink: 0;
    padding: 0;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
    transform: translateZ(var(--fig-z, 0px));
  }

  .shelf-figure:active {
    transform: translateZ(var(--fig-z, 0px)) scale(0.985);
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

  /* ── Nameplate: tiny museum plaque mounted at the shelf edge ───────────
     Width is set inline per-item (its packed slot, not its own — often much
     narrower — figure width), so neighboring plates can grow to nearly meet
     without ever colliding. bottom is also set inline (-plateZone): the
     plate's TOP edge lands flush with the figure's own bottom edge and
     grows DOWN into the enlarged shelf-lip zone — never back up over the
     figure's base. */
  .shelf-figure__plate {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
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
    --plinth3d-gradient: linear-gradient(180deg, #454951 0%, #24262a 55%, #121316 100%);
    --shadow-soft: 0.34;
    --shadow-core: 0.5;
    --watermark-color: #cfe0ff;
    --watermark-opacity: 0.07;
    --photo-frame: #3a3e45;
  }

  /* Clear glass: pale ground, brighter shelf plane, lighter walls */
  .case[data-motif='glass-clear'] {
    --case-frame: linear-gradient(180deg, #ccd2d9 0%, #aab1b9 100%);
    --case-frame-hi: rgba(255, 255, 255, 0.75);
    --case-back-bg: linear-gradient(180deg, #dde3e9 0%, #c3cad2 100%);
    --corner-ao: rgba(60, 70, 80, 0.28);
    --back3d-ambient: rgba(255, 255, 255, 0.35);
    --bay-wash: linear-gradient(180deg, rgba(255, 255, 255, 0.16) 0%, transparent 40%);
    --wall3d-gradient: linear-gradient(90deg, rgba(180, 200, 215, 0.55) 0%, rgba(140, 155, 165, 0.4) 100%);
    --wall3d-gradient-r: linear-gradient(270deg, rgba(180, 200, 215, 0.55) 0%, rgba(140, 155, 165, 0.4) 100%);
    --floor3d-gradient: linear-gradient(180deg,
      rgba(255, 255, 255, 0.95) 0%, rgba(225, 235, 238, 0.55) 10%,
      rgba(196, 210, 214, 0.42) 35%, rgba(170, 182, 186, 0.36) 100%);
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
    --plinth3d-gradient: linear-gradient(180deg, #5a3c24 0%, #3a2616 55%, #241408 100%);
    --shadow-soft: 0.32;
    --shadow-core: 0.46;
    --watermark-color: #ffe2b8;
    --watermark-opacity: 0.06;
    --photo-frame: #2e2018;
  }
`;

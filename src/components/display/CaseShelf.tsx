import { useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { packShelves } from './packShelves';
import type { ShelfItem } from './packShelves';
import { SHELF_BAND } from './density';
import type { Density } from './density';
import { useElementWidth } from '../../hooks/useElementWidth';

export type CaseMotif = 'detolf-dark' | 'glass-clear' | 'bookcase-wood';

export const CASE_MOTIFS: { value: CaseMotif; label: string }[] = [
  { value: 'detolf-dark', label: 'Dark glass' },
  { value: 'glass-clear', label: 'Clear glass' },
  { value: 'bookcase-wood', label: 'Bookcase' },
];

interface CaseShelfProps {
  figures: Figure[];
  motif: CaseMotif;
  density: Density;
  onSelect?: (figure: Figure, index: number) => void;
  /** Watermark rendered into the case background (SVG logo lands later). */
  watermark?: ComponentChildren;
  /** Museum-plaque nameplate overlay under each figure. Defaults off. */
  labels?: boolean;
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
 * One figure standing on a shelf. Matted figures get a two-lobe contact
 * shadow (positioned by the manifest's footprint scalars) and, on glass
 * motifs, a floor reflection. Unmatted figures keep the metaphor by standing
 * on the shelf as small framed pictures.
 */
function ShelfFigure({
  item,
  onSelect,
  labels,
}: {
  item: ShelfItem;
  onSelect?: (figure: Figure, index: number) => void;
  labels?: boolean;
}) {
  const { figure, meta, w, h } = item;

  // Two-lobe contact shadow geometry from the two footprint scalars
  // (translated from shelf2.py contact_shadow): soft lobe spans 1.3x the
  // footprint; unrecovered bases get a stronger, wider synthetic grounding.
  const spread = meta.baseRecovered ? 1.3 : 1.55;
  const shadowW = meta.footprintWidth * spread;
  const shadowLeft = meta.footprintCenterX - shadowW / 2;
  const shadowH = Math.max(8, Math.round(meta.footprintWidth * w * 0.17));

  return (
    <button
      class={`shelf-figure ${meta.matted ? '' : 'shelf-figure--framed'}`}
      style={{ width: `${w}px`, height: `${h}px` }}
      type="button"
      onClick={onSelect ? () => onSelect(figure, item.index) : undefined}
      data-synthetic-base={meta.matted && !meta.baseRecovered ? 'true' : undefined}
    >
      <span
        class="shelf-figure__shadow"
        style={{
          left: `${(shadowLeft * 100).toFixed(1)}%`,
          width: `${(shadowW * 100).toFixed(1)}%`,
          height: `${shadowH}px`,
          bottom: `${-Math.round(shadowH / 2)}px`,
          opacity: meta.baseRecovered ? undefined : 1,
        }}
      />
      {figure.imageUrl ? (
        meta.matted ? (
          <>
            <img class="shelf-figure__img" src={figure.imageUrl} alt="" loading="lazy" />
            <img class="shelf-figure__reflection" src={figure.imageUrl} alt="" aria-hidden="true" loading="lazy" />
          </>
        ) : (
          <span class="shelf-figure__frame">
            <img class="shelf-figure__img shelf-figure__img--photo" src={figure.imageUrl} alt="" loading="lazy" />
          </span>
        )
      ) : (
        <span class="shelf-figure__silhouette" aria-hidden="true" />
      )}
      {labels && (
        <span class="shelf-figure__plate" aria-hidden="true">
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
 * Display A — the virtual display case. Figures stand as transparent PNGs on
 * shelf rows inside a pure-CSS case: back panel, receding shelf plane, front
 * lip, per-figure contact shadows, and motif-specific lighting (LED wash,
 * glass glints, floor reflections / wood grain) — a CSS translation of the
 * proven shelf2.py compositor recipe. Rows are packed as self-contained
 * units, ready for row-level virtualization when collections grow.
 */
export function CaseShelf({ figures, motif, density, onSelect, watermark, labels }: CaseShelfProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(hostRef, 360);
  const band = SHELF_BAND[density];
  // Frame pillars eat ~12px a side; row padding eats a bit more.
  const rows = packShelves(figures, Math.max(160, width - 48), band);
  // Case padding (10px top + 14px bottom) plus each bay's own height —
  // the watermark slot sizes itself off this, not the viewport.
  const caseHeightPx = 24 + rows.length * (band + 30);
  const watermarkHeightPx = Math.min(Math.round(caseHeightPx * 0.21), 120);

  return (
    <div class="case-host" ref={hostRef}>
      <div class={`case ${motif === 'glass-clear' ? 'case--light' : ''}`} data-motif={motif}>
        {rows.map((row, i) => (
          <section key={i} class="case__bay" style={{ height: `${band + 30}px` }}>
            <div class="case__back" />
            <div class="case__row">
              {row.map((item) => (
                <ShelfFigure key={item.figure._id} item={item} onSelect={onSelect} labels={labels} />
              ))}
            </div>
            <div class="case__plane" />
            <div class="case__lip" />
            <div class="case__wash" />
          </section>
        ))}
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
  .case {
    position: relative;
    padding: 10px 12px 14px;
    background: var(--case-frame);
    box-shadow: inset 0 1px 0 var(--case-frame-hi), inset 1px 0 0 var(--case-frame-hi),
      inset -1px 0 0 var(--case-frame-hi);
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow: hidden;
  }

  /* ── Shelf bay: back panel, figures, shelf plane, front lip ────────── */
  .case__bay {
    position: relative;
    overflow: hidden;
  }

  .case__back {
    position: absolute;
    inset: 0 0 8px 0;
    background:
      linear-gradient(90deg, rgba(0,0,0,var(--corner-fade)) 0%, transparent 9%, transparent 91%, rgba(0,0,0,var(--corner-fade)) 100%),
      linear-gradient(180deg, rgba(0,0,0,var(--undershelf-a)) 0%, transparent 14%),
      var(--led-strip),
      var(--case-back-bg);
    background-repeat: no-repeat;
  }

  /* figures sit on the plane: baseline = lip + lift above the bay bottom */
  .case__row {
    position: absolute;
    inset: 0;
    padding: 0 6px 13px;
    display: flex;
    align-items: flex-end;
    justify-content: space-evenly;
    gap: 8px;
    z-index: 2;
  }

  /* receding shelf top plane: trapezoid, darker back edge, bright front rim */
  .case__plane {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 8px;
    height: 22px;
    z-index: 1;
    background: var(--plane-bg);
    clip-path: polygon(1.4% 0, 98.6% 0, 100% 100%, 0 100%);
    border-top: 1px solid rgba(0, 0, 0, 0.35);
    box-shadow: inset 0 -2px 0 var(--plane-rim);
  }

  /* front lip: highlight line + glass/wood face */
  .case__lip {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 8px;
    z-index: 3;
    background: var(--lip-face);
    border-top: 2px solid var(--lip-line);
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
  .shelf-figure {
    position: relative;
    flex-shrink: 0;
    padding: 0;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }

  .shelf-figure:active {
    transform: scale(0.985);
  }

  .shelf-figure__img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    object-position: bottom;
    position: relative;
    z-index: 2;
  }

  /* two-lobe contact shadow: wide soft ellipse + tight dark AO core */
  .shelf-figure__shadow {
    position: absolute;
    z-index: 1;
    background:
      radial-gradient(ellipse 38% 30% at 50% 50%, rgba(0, 0, 0, var(--shadow-core)) 0%, transparent 95%),
      radial-gradient(ellipse 50% 50% at 50% 50%, rgba(0, 0, 0, var(--shadow-soft)) 0%, transparent 76%);
    opacity: 0.9;
  }

  /* floor reflection (glass motifs): flipped, squashed, masked out fast */
  .shelf-figure__reflection {
    position: absolute;
    top: 100%;
    left: 0;
    width: 100%;
    height: 42%;
    object-fit: fill;
    transform: scaleY(-1);
    mask-image: linear-gradient(to bottom, transparent 12%, rgba(0, 0, 0, var(--reflect-a)) 100%);
    -webkit-mask-image: linear-gradient(to bottom, transparent 12%, rgba(0, 0, 0, var(--reflect-a)) 100%);
    z-index: 0;
    display: var(--reflect-display);
    pointer-events: none;
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

  /* ── Nameplate: tiny museum plaque mounted at the shelf edge ─────────── */
  .shelf-figure__plate {
    position: absolute;
    left: 50%;
    bottom: -9px;
    transform: translateX(-50%);
    z-index: 6;
    max-width: 96%;
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
    line-height: 1.15;
  }

  .shelf-figure__plate-name,
  .shelf-figure__plate-mfr {
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .shelf-figure__plate-name {
    font-size: 9px;
    font-weight: 600;
    color: #e3c489;
  }

  .shelf-figure__plate-mfr {
    font-size: 7px;
    color: rgba(227, 196, 137, 0.62);
  }

  /* ── Motifs — pure-CSS themes via custom properties ─────────────────── */

  /* Detolf: dark glass case, LED strip, green-edged glass shelves */
  .case[data-motif='detolf-dark'] {
    --case-frame: linear-gradient(180deg, #383c42 0%, #24262b 100%);
    --case-frame-hi: rgba(148, 156, 168, 0.5);
    --case-back-bg: linear-gradient(180deg, #171a21 0%, #0e1015 100%);
    --corner-fade: 0.18;
    --undershelf-a: 0.24;
    --led-strip: linear-gradient(180deg, rgba(226, 240, 255, 0.92) 0, rgba(226, 240, 255, 0.9) 2px, rgba(195, 218, 255, 0.24) 3px, rgba(195, 218, 255, 0) 58%);
    --bay-wash: linear-gradient(180deg, rgba(205, 225, 255, 0.11) 0%, transparent 42%);
    --plane-bg: linear-gradient(180deg, rgb(52, 62, 66) 0%, rgb(92, 106, 110) 100%);
    --plane-rim: rgba(214, 232, 226, 0.5);
    --lip-line: rgba(196, 232, 218, 0.88);
    --lip-face: linear-gradient(180deg, rgb(96, 140, 126) 0%, rgb(50, 73, 66) 100%);
    --shadow-soft: 0.34;
    --shadow-core: 0.5;
    --reflect-a: 0.16;
    --reflect-display: block;
    --watermark-color: #cfe0ff;
    --watermark-opacity: 0.07;
    --photo-frame: #3a3e45;
  }

  /* Clear glass: pale ground, brighter shelf plane, stronger refraction cues */
  .case[data-motif='glass-clear'] {
    --case-frame: linear-gradient(180deg, #ccd2d9 0%, #aab1b9 100%);
    --case-frame-hi: rgba(255, 255, 255, 0.75);
    --case-back-bg: linear-gradient(180deg, #eef1f5 0%, #d7dce2 100%);
    --corner-fade: 0.07;
    --undershelf-a: 0.1;
    --led-strip: linear-gradient(180deg, rgba(255, 255, 255, 0.95) 0, rgba(255, 255, 255, 0.9) 2px, rgba(240, 248, 255, 0.4) 3px, rgba(240, 248, 255, 0) 55%);
    --bay-wash: linear-gradient(180deg, rgba(255, 255, 255, 0.16) 0%, transparent 40%);
    --plane-bg: linear-gradient(180deg, rgb(196, 210, 214) 0%, rgb(233, 243, 245) 100%);
    --plane-rim: rgba(255, 255, 255, 0.9);
    --lip-line: rgba(255, 255, 255, 0.92);
    --lip-face: linear-gradient(180deg, rgb(172, 213, 199) 0%, rgb(126, 172, 157) 100%);
    --shadow-soft: 0.22;
    --shadow-core: 0.38;
    --reflect-a: 0.22;
    --reflect-display: block;
    --watermark-color: #3c4652;
    --watermark-opacity: 0.08;
    --photo-frame: #8a9099;
  }

  /* Bookcase: warm wood back + shelf lips, no glass effects */
  .case[data-motif='bookcase-wood'] {
    --case-frame: linear-gradient(180deg, #4a3020 0%, #38241a 100%);
    --case-frame-hi: rgba(150, 106, 66, 0.6);
    --case-back-bg:
      repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.05) 0 2px, transparent 2px 7px, rgba(255, 220, 170, 0.04) 7px 9px, transparent 9px 23px),
      linear-gradient(180deg, rgb(97, 65, 40) 0%, rgb(76, 49, 29) 100%);
    --corner-fade: 0.15;
    --undershelf-a: 0.37;
    --led-strip: none;
    --bay-wash: linear-gradient(180deg, rgba(255, 228, 188, 0.1) 0%, transparent 45%);
    --plane-bg:
      repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.04) 0 3px, transparent 3px 11px),
      linear-gradient(180deg, rgb(100, 68, 42) 0%, rgb(152, 110, 68) 100%);
    --plane-rim: rgba(226, 190, 140, 0.55);
    --lip-line: rgb(216, 178, 128);
    --lip-face: linear-gradient(180deg, rgb(124, 86, 52) 0%, rgb(82, 53, 31) 100%);
    --shadow-soft: 0.32;
    --shadow-core: 0.46;
    --reflect-a: 0;
    --reflect-display: none;
    --watermark-color: #ffe2b8;
    --watermark-opacity: 0.06;
    --photo-frame: #2e2018;
  }
`;

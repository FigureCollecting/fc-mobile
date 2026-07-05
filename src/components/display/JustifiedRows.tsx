import { useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Figure } from '@figurecollecting/fc-shared';
import { packJustified } from './packJustified';
import { ROW_HEIGHT } from './density';
import type { Density } from './density';
import { useElementWidth } from '../../hooks/useElementWidth';

const ROW_GAP_PX = 2;

interface JustifiedRowsProps {
  figures: Figure[];
  density: Density;
  onSelect?: (figure: Figure, index: number) => void;
  /** Bottom-gradient nameplate caption over each item. Defaults off. */
  labels?: boolean;
  /** Watermark pinned to the bottom-right of the whole rows container. */
  watermark?: ComponentChildren;
}

/**
 * Display B — justified rows: fixed row height, native-aspect widths,
 * edge-to-edge, always uncropped.
 */
export function JustifiedRows({ figures, density, onSelect, labels, watermark }: JustifiedRowsProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(hostRef, 360);
  const rows = packJustified(figures, width, ROW_HEIGHT[density]);
  const totalHeightPx =
    rows.reduce((sum, r) => sum + r.height, 0) + Math.max(0, rows.length - 1) * ROW_GAP_PX;
  const watermarkHeightPx = Math.min(Math.round(totalHeightPx * 0.21), 120);

  return (
    <div class="jrows" ref={hostRef}>
      {rows.map((row, i) => (
        <div key={i} class="jrows__row" style={{ height: `${row.height}px` }}>
          {row.items.map((item) => (
            <button
              key={item.figure._id}
              class="jrows__item"
              style={{ width: `${item.w}px` }}
              type="button"
              onClick={onSelect ? () => onSelect(item.figure, item.index) : undefined}
            >
              {item.figure.imageUrl ? (
                <img class="jrows__img" src={item.figure.imageUrl} alt="" loading="lazy" />
              ) : (
                <span class="jrows__placeholder" aria-hidden="true" />
              )}
              {labels && (
                <span class="jrows__caption" aria-hidden="true">
                  <span class="jrows__caption-name">{item.figure.name}</span>
                  {item.figure.manufacturer && (
                    <span class="jrows__caption-mfr">{item.figure.manufacturer}</span>
                  )}
                </span>
              )}
              <span class="sr-only">{item.figure.name}</span>
            </button>
          ))}
        </div>
      ))}

      {watermark && (
        <div class="jrows__watermark" style={{ height: `${watermarkHeightPx}px` }}>
          {watermark}
        </div>
      )}

      <style>{`
        .jrows {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 2px;
          width: 100%;
        }

        .jrows__watermark {
          position: absolute;
          right: 10px;
          bottom: 10px;
          z-index: 1;
        }

        .jrows__row {
          display: flex;
          gap: 2px;
          overflow: hidden;
        }

        .jrows__item {
          position: relative;
          flex-shrink: 0;
          height: 100%;
          padding: 0;
          background: var(--surface-secondary);
          -webkit-user-select: none;
          user-select: none;
          -webkit-touch-callout: none;
        }

        .jrows__item:active {
          opacity: 0.85;
        }

        .jrows__img {
          width: 100%;
          height: 100%;
          /* NEVER crop: the whole figure, native aspect */
          object-fit: contain;
        }

        .jrows__placeholder {
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, var(--surface-tertiary), var(--surface-secondary));
        }

        /* ── Nameplate: bottom-gradient caption over the image ────────────── */
        .jrows__caption {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 1;
          display: flex;
          flex-direction: column;
          padding: 10px 6px 4px;
          background: linear-gradient(180deg, transparent, rgba(0, 0, 0, 0.78) 70%);
          pointer-events: none;
        }

        .jrows__caption-name,
        .jrows__caption-mfr {
          max-width: 100%;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .jrows__caption-name {
          font-size: 10px;
          font-weight: 600;
          color: #fff;
        }

        .jrows__caption-mfr {
          font-size: 8px;
          color: rgba(255, 255, 255, 0.7);
        }
      `}</style>
    </div>
  );
}

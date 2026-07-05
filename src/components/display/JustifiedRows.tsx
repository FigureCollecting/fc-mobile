import { useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Figure } from '@figurecollecting/fc-shared';
import type { VirtualItem } from '@tanstack/virtual-core';
import { packJustified } from './packJustified';
import { ROW_HEIGHT } from './density';
import type { Density } from './density';
import { useElementWidth } from '../../hooks/useElementWidth';
import { useVirtualizer } from '../../hooks/useVirtualizer';
import { useScrollParent } from '../../hooks/useScrollParent';

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

  // Virtualize by ROW against the app's own page scroll container — not a
  // nested scrollbox — so collections of 1000+ figures stay smooth. Falls
  // back to rendering every row when no `.app-content` ancestor is found
  // (e.g. the component mounted in isolation in tests). Row heights are
  // already known exactly from packJustified, so estimateSize is exact,
  // not an estimate.
  const scrollParent = useScrollParent(hostRef);
  const fallbackRowHeight = ROW_HEIGHT[density];
  const rowVirtualizer = useVirtualizer<HTMLElement, HTMLElement>({
    count: rows.length,
    getScrollElement: () => scrollParent,
    estimateSize: (index) => rows[index]?.height ?? fallbackRowHeight,
    gap: ROW_GAP_PX,
    overscan: 3,
  });
  const virtualRows: VirtualItem[] = scrollParent
    ? rowVirtualizer.getVirtualItems()
    : (() => {
        let offset = 0;
        return rows.map((row, index) => {
          const item = { key: index, index, start: offset, end: offset + row.height, size: row.height, lane: 0 };
          offset += row.height + ROW_GAP_PX;
          return item;
        });
      })();
  const totalHeightPx = scrollParent
    ? rowVirtualizer.getTotalSize()
    : rows.reduce((sum, r) => sum + r.height, 0) + Math.max(0, rows.length - 1) * ROW_GAP_PX;
  const watermarkHeightPx = Math.min(Math.round(totalHeightPx * 0.21), 120);

  return (
    <div class="jrows" ref={hostRef} style={{ height: `${totalHeightPx}px` }}>
      {virtualRows.map((vRow) => {
        const row = rows[vRow.index];
        if (!row) return null;
        return (
          <div
            key={vRow.key}
            class="jrows__row"
            style={{ height: `${row.height}px`, transform: `translateY(${vRow.start}px)` }}
          >
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
        );
      })}

      {watermark && (
        <div class="jrows__watermark" style={{ height: `${watermarkHeightPx}px` }}>
          {watermark}
        </div>
      )}

      <style>{`
        /* Height is set explicitly (inline style) to the packed/virtualized
           content size — rows below are virtualized-list items, positioned
           by transform, not stacked in normal flow. */
        .jrows {
          position: relative;
          width: 100%;
        }

        .jrows__watermark {
          position: absolute;
          right: 10px;
          bottom: 10px;
          z-index: 1;
        }

        /* Virtualized list item: absolutely positioned, placed via translateY. */
        .jrows__row {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
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

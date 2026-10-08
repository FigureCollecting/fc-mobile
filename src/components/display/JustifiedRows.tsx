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
import { Style } from '../../styles/Style';
import { SyncBadge } from '../sync/SyncBadge';
import type { LocalMeta } from '../../local/figures';

const ROW_GAP_PX = 2;

interface JustifiedRowsProps {
  figures: Figure[];
  density: Density;
  onSelect?: (figure: Figure, index: number) => void;
  /** Bottom-gradient nameplate caption over each item. Defaults off. */
  labels?: boolean;
  /** Watermark pinned to the bottom-right of the whole rows container. */
  watermark?: ComponentChildren;
  /** Select mode: whether a figure is selected (each tile then reports aria-pressed). */
  isSelected?: (figure: Figure) => boolean;
}

/** The local-store state of an item (src/local/figures.ts); fixture figures have none. */
const localOf = (figure: Figure): Pick<LocalMeta, 'kind' | 'sync' | 'asOf'> | undefined =>
  (figure as Figure & { local?: LocalMeta }).local;

/**
 * Display B — justified rows: fixed row height, native-aspect widths,
 * edge-to-edge, always uncropped.
 */
export function JustifiedRows({ figures, density, onSelect, labels, watermark, isSelected }: JustifiedRowsProps) {
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
            {row.items.map((item) => {
              const local = localOf(item.figure);
              const quantity = item.figure.quantity ?? 1;
              const badgeId = local === undefined ? undefined : `sync-${item.figure._id}-${local.kind}`;
              return (
                <button
                  key={item.figure._id}
                  class={`jrows__item ${isSelected?.(item.figure) ? 'jrows__item--selected' : ''}`}
                  style={{ width: `${item.w}px` }}
                  type="button"
                  data-index={item.index}
                  data-sync={local?.sync}
                  data-quantity={local === undefined ? undefined : quantity}
                  aria-describedby={badgeId}
                  aria-pressed={isSelected === undefined ? undefined : isSelected(item.figure)}
                  onClick={onSelect ? () => onSelect(item.figure, item.index) : undefined}
                >
                  {item.figure.imageUrl ? (
                    <img class="jrows__img" src={item.figure.imageUrl} alt="" loading="lazy" />
                  ) : (
                    // A placeholder plate (MG-2): no image anywhere, so the figure's name.
                    <span class="jrows__plate" aria-hidden="true">
                      <span class="jrows__plate-name">{item.figure.name}</span>
                      {item.figure.manufacturer && <span class="jrows__plate-mfr">{item.figure.manufacturer}</span>}
                    </span>
                  )}
                  {labels && item.figure.imageUrl && (
                    <span class="jrows__caption" aria-hidden="true">
                      <span class="jrows__caption-name">{item.figure.name}</span>
                      {item.figure.manufacturer && (
                        <span class="jrows__caption-mfr">{item.figure.manufacturer}</span>
                      )}
                    </span>
                  )}
                  {quantity > 1 && (
                    <span class="jrows__count" aria-hidden="true">
                      ×{quantity}
                    </span>
                  )}
                  {local !== undefined && (
                    <span class="jrows__sync" aria-hidden="true">
                      <SyncBadge sync={local.sync} asOf={local.asOf} id={badgeId!} />
                    </span>
                  )}
                  <span class="sr-only">{item.figure.name}</span>
                </button>
              );
            })}
          </div>
        );
      })}

      {watermark && (
        <div class="jrows__watermark" style={{ height: `${watermarkHeightPx}px` }}>
          {watermark}
        </div>
      )}

      <Style css={`
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

        .jrows__plate {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          gap: 2px;
          padding: 6px;
          text-align: left;
          background: linear-gradient(180deg, var(--surface-tertiary), var(--surface-secondary));
          overflow: hidden;
        }

        .jrows__plate-name {
          font-size: var(--font-xs, 11px);
          font-weight: 600;
          color: var(--text-primary);
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .jrows__plate-mfr {
          font-size: 10px;
          color: var(--text-tertiary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .jrows__count {
          position: absolute;
          top: 4px;
          right: 4px;
          z-index: 2;
          padding: 0 5px;
          border-radius: 999px;
          background: var(--brand-500);
          color: #fff;
          font-size: 11px;
          font-weight: 700;
          line-height: 16px;
        }

        .jrows__sync {
          position: absolute;
          top: 4px;
          left: 4px;
          z-index: 2;
        }

        .jrows__item--selected {
          outline: 3px solid var(--brand-500);
          outline-offset: -3px;
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

        /* Ross: explicit floor exemption for this decorative miniature
           caption only (--font-plate / --font-plate-sub, see tokens.css) —
           7px / 6px, same as CaseShelf's plate, so most real names render
           fully instead of ellipsizing. */
        .jrows__caption-name {
          font-size: var(--font-plate);
          font-weight: 600;
          color: #fff;
        }

        .jrows__caption-mfr {
          font-size: var(--font-plate-sub);
          color: rgba(255, 255, 255, 0.7);
        }
      `} />
    </div>
  );
}

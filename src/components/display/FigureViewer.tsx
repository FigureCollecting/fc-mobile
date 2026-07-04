import { useEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import type { Figure } from '@figurecollecting/fc-shared';
import type PhotoSwipe from 'photoswipe';
import { StatusBadge } from '../ui/StatusBadge';
import { getDisplayMeta } from './displayMeta';

interface FigureViewerProps {
  /** The CURRENT RESULT SET — swiping left/right moves through it. */
  figures: Figure[];
  /** Index of the tapped figure within the result set. */
  index: number;
  onClose: () => void;
}

/**
 * Display D — tap a figure in any layout and it opens full-screen: uncropped
 * image with pinch-zoom and swipe across the current result set (PhotoSwipe,
 * loaded as a lazy chunk), plus the figure's data in a pull-up sheet.
 */
export function FigureViewer({ figures, index, onClose }: FigureViewerProps) {
  const [current, setCurrent] = useState(index);
  const [expanded, setExpanded] = useState(false);
  const pswpRef = useRef<PhotoSwipe | null>(null);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [{ default: PhotoSwipeCtor }] = await Promise.all([
        import('photoswipe'),
        // CSS rides the same lazy chunk
        import('photoswipe/style.css'),
      ]);
      if (cancelled) return;

      const dataSource = figures.map((f) => {
        const meta = getDisplayMeta(f);
        if (!f.imageUrl) {
          return {
            html: '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#889;font-size:13px">No image</div>',
          };
        }
        return {
          src: f.imageUrl,
          width: meta.width,
          height: meta.height,
          alt: f.name,
        };
      });

      const pswp = new PhotoSwipeCtor({
        dataSource,
        index,
        bgOpacity: 0.96,
        pinchToClose: true,
        closeOnVerticalDrag: true,
        // uncropped always — fit the whole image
        initialZoomLevel: 'fit',
        secondaryZoomLevel: 2,
        maxZoomLevel: 4,
      });

      pswp.on('change', () => setCurrent(pswp.currIndex));
      pswp.on('destroy', () => {
        pswpRef.current = null;
        if (!closingRef.current) {
          closingRef.current = true;
          onCloseRef.current();
        }
      });
      pswp.init();
      pswpRef.current = pswp;
    })();

    return () => {
      cancelled = true;
      if (pswpRef.current) {
        closingRef.current = true;
        pswpRef.current.destroy();
        pswpRef.current = null;
      }
    };
    // The viewer is mounted per open; result set and start index are fixed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const figure = figures[current];
  if (!figure) return null;

  // Portaled to document.body so it shares a stacking context with PhotoSwipe
  // (which appends its own root to body). Left inside the page, the sheet's
  // z-index is scoped to the page's stacking context and paints under the
  // viewer no matter how high it is.
  return createPortal(
    <div class={`figure-viewer-sheet ${expanded ? 'figure-viewer-sheet--expanded' : ''}`}>
      <button
        class="figure-viewer-sheet__handle"
        type="button"
        aria-label={expanded ? 'Collapse details' : 'Expand details'}
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
      >
        <span class="figure-viewer-sheet__grip" />
      </button>

      <div class="figure-viewer-sheet__head">
        <span class="figure-viewer-sheet__name">{figure.name}</span>
        <span class="figure-viewer-sheet__counter">
          {current + 1} of {figures.length}
        </span>
      </div>

      <div class="figure-viewer-sheet__badges">
        {figure.scale && <span class="figure-viewer-sheet__scale">{figure.scale}</span>}
        {figure.manufacturer && <span class="figure-viewer-sheet__maker">{figure.manufacturer}</span>}
        {figure.collectionStatus && <StatusBadge status={figure.collectionStatus} size="sm" />}
      </div>

      {expanded && (
        <div class="figure-viewer-sheet__more">
          {figure.origin && (
            <div class="figure-viewer-sheet__row">
              <span class="figure-viewer-sheet__key">Origin</span>
              <span class="figure-viewer-sheet__val">{figure.origin}</span>
            </div>
          )}
          {figure.companyRoles?.map((role) =>
            role.companyName ? (
              <div key={role.companyId} class="figure-viewer-sheet__row">
                <span class="figure-viewer-sheet__key">{role.roleName ?? 'Company'}</span>
                <span class="figure-viewer-sheet__val">{role.companyName}</span>
              </div>
            ) : null,
          )}
          {figure.category && (
            <div class="figure-viewer-sheet__row">
              <span class="figure-viewer-sheet__key">Category</span>
              <span class="figure-viewer-sheet__val">{figure.category}</span>
            </div>
          )}
        </div>
      )}

      <style>{`
        .figure-viewer-sheet {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 100001; /* above the pswp root */
          background: color-mix(in srgb, var(--surface-secondary) 92%, transparent);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border-radius: var(--radius-lg) var(--radius-lg) 0 0;
          padding: 0 var(--space-page) calc(var(--space-3) + var(--safe-area-bottom));
          box-shadow: var(--shadow-lg);
        }

        .figure-viewer-sheet__handle {
          display: flex;
          justify-content: center;
          width: 100%;
          padding: var(--space-2) 0;
        }

        .figure-viewer-sheet__grip {
          width: 32px;
          height: 4px;
          border-radius: var(--radius-full);
          background: var(--text-tertiary);
        }

        .figure-viewer-sheet__head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: var(--space-2);
        }

        .figure-viewer-sheet__name {
          font-size: var(--font-base);
          font-weight: var(--font-weight-semibold);
          color: var(--text-primary);
          line-height: var(--line-height-ui);
          min-width: 0;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .figure-viewer-sheet__counter {
          font-size: var(--font-2xs);
          color: var(--text-tertiary);
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
        }

        .figure-viewer-sheet__badges {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          margin-top: var(--space-stack);
          flex-wrap: wrap;
        }

        .figure-viewer-sheet__scale {
          font-size: var(--font-2xs);
          font-weight: var(--font-weight-semibold);
          color: var(--brand-400);
          background: rgba(9, 103, 210, 0.16);
          padding: 2px 8px;
          border-radius: var(--radius-full);
        }

        .figure-viewer-sheet__maker {
          font-size: var(--font-xs);
          color: var(--text-secondary);
        }

        .figure-viewer-sheet__more {
          margin-top: var(--space-2);
          padding-top: var(--space-2);
          border-top: 1px solid var(--border-subtle);
          display: flex;
          flex-direction: column;
          gap: var(--space-stack);
        }

        .figure-viewer-sheet__row {
          display: flex;
          justify-content: space-between;
          gap: var(--space-3);
        }

        .figure-viewer-sheet__key {
          font-size: var(--font-xs);
          color: var(--text-tertiary);
          flex-shrink: 0;
        }

        .figure-viewer-sheet__val {
          font-size: var(--font-xs);
          color: var(--text-primary);
          text-align: right;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      `}</style>
    </div>,
    document.body,
  );
}

import { useEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import type { Figure } from '@figurecollecting/fc-shared';
import type PhotoSwipe from 'photoswipe';
import { getDisplayMeta } from './displayMeta';
import { FigureDetailContent } from './FigureDetailContent';
import { Style } from '../../styles/Style';

/**
 * PhotoSwipe's destroy() only closes a gallery whose opening animation has finished; one still
 * opening keeps its element and listeners. Take them down here either way.
 */
function dispose(pswp: PhotoSwipe): void {
  pswp.destroy();
  if (pswp.element?.isConnected === true) {
    pswp.events.removeAll();
    pswp.element.remove();
  }
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);

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
            // A placeholder plate naming the figure (MG-2). A class, not a style attribute: the CSP
            // blocks inline styles in injected HTML; the text is escaped, it is catalog data.
            html: `<div class="figure-viewer__no-image"><span class="figure-viewer__plate-name">${escapeHtml(f.name)}</span>${
              f.manufacturer ? `<span class="figure-viewer__plate-mfr">${escapeHtml(f.manufacturer)}</span>` : ''
            }</div>`,
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
        const pswp = pswpRef.current;
        pswpRef.current = null;
        dispose(pswp);
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
    <div class="figure-viewer-sheet">
      <FigureDetailContent
        figure={figure}
        index={current}
        total={figures.length}
        onBeforeOpen={() => {
          const pswp = pswpRef.current;
          closingRef.current = true;
          pswpRef.current = null;
          if (pswp) dispose(pswp);
          onCloseRef.current();
        }}
      />

      <Style css={`
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

        .figure-viewer__no-image {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: 100%;
          height: 100%;
          padding: 24px;
          text-align: center;
          color: #ccd;
        }

        .figure-viewer__plate-name {
          font-size: 20px;
          font-weight: 700;
        }

        .figure-viewer__plate-mfr {
          font-size: 13px;
          color: #889;
        }
      `} />
    </div>,
    document.body,
  );
}

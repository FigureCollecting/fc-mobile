import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { motion } from 'framer-motion';
import type { Figure } from '@figurecollecting/fc-shared';
import type PhotoSwipe from 'photoswipe';
import { getDisplayMeta } from './displayMeta';
import { FigureDetailContent } from './FigureDetailContent';
import { Style } from '../../styles/Style';
import { useSheetDrag } from '../ui/useSheetDrag';
import { useBackToClose } from '../../hooks/useBackToClose';

/** What a tap may land on and still be on the figure: its picture, or its placeholder plate's words. */
const ON_THE_FIGURE = '.pswp__img, .figure-viewer__plate-name, .figure-viewer__plate-mfr';

/** The sheet's two detents: all of it up, or down to its summary (name, badges, the way to its copies). */
const ALL = 0;
const SUMMARY = 1;

/** translateY px of each detent: up, and down by all but its handle and summary. */
function infoDetents(sheet: HTMLElement): number[] {
  const summary = sheet.querySelector('.figure-viewer-sheet__summary');
  const body = sheet.querySelector('.figure-viewer-sheet__body');
  if (!summary || !body) return [0];
  const top = sheet.getBoundingClientRect().top;
  const shown = summary.getBoundingClientRect().bottom - top + body.scrollTop + parseFloat(getComputedStyle(sheet).paddingBottom || '0');
  const down = Math.max(0, sheet.offsetHeight - shown);
  return down > 1 ? [0, down] : [0];
}

/**
 * How much of the screen's bottom the sheet covers at its summary detent: the photo is laid out above it, whole (STRETCH-FIX).
 * Measured from the sheet's own size and detents, not where it stands now, which it is still rising to as the gallery opens.
 */
function sheetPeekPx(sheet: HTMLElement | null): number {
  if (!sheet) return 0;
  return Math.max(0, sheet.offsetHeight - (infoDetents(sheet)[1] ?? 0));
}

/** The parts of PhotoSwipe's slide content and slide the fit reads and sets (its types are not exported by path). */
export interface PictureContent {
  element: HTMLElement | undefined;
  width: number;
  height: number;
  data: { width?: number; height?: number };
}
export interface PictureSlide {
  width: number;
  height: number;
  calculateSize(): void;
  zoomAndPanToInitial(): void;
  applyCurrentZoomPan(): void;
  updateContentSize(force?: boolean): void;
}

/**
 * STRETCH-FIX (Ross 10-18, Fold8 cover: "She's stretched"): a figure's display meta carries no real picture size (every
 * real figure's says 600 x 800), and PhotoSwipe sizes the <img> to the shape it is told, so the real picture was stretched
 * into that box. Once the picture has loaded, the slide is laid out in the picture's own shape: uniform scale, bars where
 * its shape differs from the room's. Fixture figures declare their own pictures' sizes and are left alone.
 */
export function fitSlideToPicture(content: PictureContent, slide: PictureSlide): void {
  const img = content.element;
  if (!(img instanceof HTMLImageElement) || img.naturalWidth === 0 || img.naturalHeight === 0) return;
  const { naturalWidth: width, naturalHeight: height } = img;
  if (Math.abs(width / height / (content.width / content.height) - 1) <= 0.001) return;
  content.width = width;
  content.height = height;
  content.data.width = width;
  content.data.height = height;
  slide.width = width;
  slide.height = height;
  slide.calculateSize();
  slide.zoomAndPanToInitial();
  slide.applyCurrentZoomPan();
  slide.updateContentSize(true);
}

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
  const [detent, setDetent] = useState(SUMMARY);
  const sheetRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // dragged by its handle and handed off from its body (sheetDrag.ts); it peeks at the summary, never closes
  const { y, settleTo, refit } = useSheetDrag({ open: true, sheetRef, contentRef: bodyRef, detents: infoDetents, initial: SUMMARY, onSettle: setDetent });
  // CARD-FLICKER-1: another figure's card measures differently; the sheet is back on its detent before that is painted,
  // so the card swaps in place (the ResizeObserver comes after layout and framer-motion writes a frame later: the
  // sheet dropped or rose for a frame between)
  useLayoutEffect(refit, [current]);
  const pswpRef = useRef<PhotoSwipe | null>(null);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  /** Take the gallery down and report the close, once, whichever way it came (its X, Back, the full detail). */
  const closeViewer = () => {
    const pswp = pswpRef.current;
    pswpRef.current = null;
    if (pswp) {
      closingRef.current = true;
      dispose(pswp);
    }
    if (closingRef.current && !pswp) return;
    closingRef.current = true;
    onCloseRef.current();
  };
  // Back, and Esc from the first moment (PhotoSwipe's own reads keys only once its gallery has opened)
  useBackToClose(closeViewer);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [{ default: PhotoSwipeCtor }] = await Promise.all([
        import('photoswipe'),
        // CSS rides the same lazy chunk
        import('photoswipe/style.css'),
      ]);
      // unmounted, or closed (its X, Esc, Back) before the gallery's code arrived
      if (cancelled || closingRef.current) return;

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
        // the photo stands whole above the Info sheet (STRETCH-FIX), never under it
        paddingFn: () => ({ top: 0, left: 0, right: 0, bottom: sheetPeekPx(sheetRef.current) }),
        // our own X, always shown (SHEETS-FB1 6c), not PhotoSwipe's, which a tap hides
        close: false,
        // a tap off the figure closes; on it, it shows or hides the zoom and arrows as before
        tapAction(this: PhotoSwipe, _point, event) {
          if ((event.target as Element).closest(ON_THE_FIGURE)) this.element?.classList.toggle('pswp--ui-visible');
          else this.close();
        },
      });

      pswp.on('change', () => setCurrent(pswp.currIndex));
      pswp.on('loadComplete', ({ content, slide }) => fitSlideToPicture(content, slide));
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

  // another figure's card is another height: the photo fits above its sheet's summary
  useLayoutEffect(() => {
    pswpRef.current?.updateSize(true);
  }, [current]);

  const figure = figures[current];
  if (!figure) return null;

  // Portaled to document.body so it shares a stacking context with PhotoSwipe
  // (which appends its own root to body). Left inside the page, the sheet's
  // z-index is scoped to the page's stacking context and paints under the
  // viewer no matter how high it is.
  const expanded = detent === ALL;
  return createPortal(
    <>
    <button type="button" class="figure-viewer__close" aria-label="Close" onClick={closeViewer}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M18 6L6 18" />
        <path d="M6 6l12 12" />
      </svg>
    </button>
    <motion.div class="figure-viewer-sheet" ref={sheetRef} style={{ y }} data-detent={expanded ? 'all' : 'summary'}>
      <button
        class="figure-viewer-sheet__handle"
        type="button"
        aria-label={expanded ? 'Show the summary' : 'Show all details'}
        aria-expanded={expanded}
        onClick={() => {
          setDetent(expanded ? SUMMARY : ALL);
          settleTo(expanded ? SUMMARY : ALL);
        }}
      >
        <span class="figure-viewer-sheet__grip" />
      </button>
      <div class="figure-viewer-sheet__body" ref={bodyRef}>
        <FigureDetailContent
          figure={figure}
          index={current}
          total={figures.length}
          onBeforeOpen={closeViewer}
        />
      </div>

      <Style css={`
        .figure-viewer-sheet {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 100001; /* above the pswp root */
          display: flex;
          flex-direction: column;
          max-height: 80vh;
          max-height: 80dvh;
          background: color-mix(in srgb, var(--surface-secondary) 92%, transparent);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border-radius: var(--radius-lg) var(--radius-lg) 0 0;
          padding: 0 var(--space-page) calc(var(--space-3) + var(--safe-area-bottom));
          box-shadow: var(--shadow-lg);
          /* the handle and the rest of the card are the sheet's to drag; its body scrolls */
          touch-action: none;
        }

        .figure-viewer-sheet__handle {
          flex-shrink: 0;
          display: flex;
          justify-content: center;
          width: 100%;
          padding: var(--space-2) 0;
          cursor: grab;
        }

        .figure-viewer-sheet__grip {
          width: 32px;
          height: 4px;
          border-radius: var(--radius-full);
          background: var(--text-tertiary);
        }

        .figure-viewer-sheet__body {
          min-height: 0;
          overflow-y: auto;
          touch-action: pan-y;
          overscroll-behavior-y: none;
        }

        .figure-viewer__close {
          position: fixed;
          top: calc(var(--space-2) + var(--safe-area-top, 0px));
          right: var(--space-2);
          z-index: 100002; /* above the pswp root and the sheet */
          display: flex;
          align-items: center;
          justify-content: center;
          width: 44px;
          height: 44px;
          border-radius: var(--radius-full);
          background: color-mix(in srgb, var(--surface-primary) 70%, transparent);
          color: var(--text-primary);
        }

        /* PhotoSwipe's own buttons (its zoom) keep clear of our X */
        .pswp__top-bar {
          padding-right: 56px;
          box-sizing: border-box;
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
    </motion.div>
    </>,
    document.body,
  );
}

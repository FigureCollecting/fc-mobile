import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { motion } from 'framer-motion';
import type { Figure } from '@figurecollecting/fc-shared';
import type PhotoSwipe from 'photoswipe';
import { getDisplayMeta } from './displayMeta';
import { FigureDetailContent, useCopiesAction } from './FigureDetailContent';
import { FigureRail, readySections } from './figureSections';
import { PhotosSheet } from './PhotosSheet';
import { PhotosChip } from './PhotosChip';
import type { LocalFigure } from '../../local/figures';
import { RAIL_INSET_PX, RAIL_WIDTH_PX, railHeightPx } from '../ui/SideRail';
import { Style } from '../../styles/Style';
import { useSheetDrag } from '../ui/useSheetDrag';
import { useBackToClose } from '../../hooks/useBackToClose';
import { anchorOffset, zoomToPoint } from './imageZoom';

/** What a tap may land on and still be on the figure: its picture, or its placeholder plate's words. */
const ON_THE_FIGURE = '.pswp__img, .figure-viewer__plate-name, .figure-viewer__plate-mfr';

/** The sheet's two detents: all of it up, or down to its summary (name, badges, the way to its copies). */
const ALL = 0;
const SUMMARY = 1;
/** SIDE-RAIL-1: the room kept above the rail on top of its own height: the gap above the sheet and the screen's top bar. */
const RAIL_ROOM_PX = 12 + 64;

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

/** The parts of PhotoSwipe's slide the face zoom reads and drives. */
export interface ZoomSlide {
  currZoomLevel: number;
  zoomLevels: { initial: number; secondary: number; min: number; max: number };
  /** The picture's size at zoom level 1. */
  width: number;
  height: number;
  /** Where its top-left stands in the viewport. */
  pan: { x: number; y: number };
  /** The room it is laid out in: the viewport less PhotoSwipe's padding. */
  panAreaSize: { x: number; y: number };
  bounds: { center: { x: number; y: number } };
  zoomTo(destZoomLevel: number, centerPoint?: { x: number; y: number }, transitionDuration?: number | false): void;
  toggleZoom(centerPoint?: { x: number; y: number }): void;
}

/**
 * CARD-VIEW-1 part 2 (Ross 10-25: "more often than not, you want to start zoomed in around the face/upper"): PhotoSwipe's
 * zoom control and its `z` key call toggleZoom with no point, which zoomed in at the middle of the screen. Whole, the slide
 * zooms in to its secondary level centred on the face instead: half across and a third down the picture (FACE_ANCHOR), held
 * so it still fills its room (anchorOffset; PhotoSwipe's own bounds hold it the same way). Zoomed, or with no step to take,
 * it toggles as PhotoSwipe does. A double-tap or a click zooms at its own point (the slide's toggleZoom, never this).
 */
export function zoomToFace(slide: ZoomSlide, duration?: number | false): void {
  const { currZoomLevel: from, zoomLevels } = slide;
  const to = Math.min(zoomLevels.max, Math.max(zoomLevels.min, zoomLevels.secondary));
  if (from !== zoomLevels.initial) return slide.toggleZoom();
  // PhotoSwipe stands the whole picture at the middle of its room, rounded: the room's offset in the viewport (its padding)
  const room = { width: slide.panAreaSize.x, height: slide.panAreaSize.y };
  const pad = {
    x: slide.bounds.center.x - Math.round((room.width - slide.width * from) / 2),
    y: slide.bounds.center.y - Math.round((room.height - slide.height * from) / 2),
  };
  const at = anchorOffset(room, { width: slide.width * to, height: slide.height * to });
  const point = zoomToPoint(slide.pan, { x: pad.x + at.x, y: pad.y + at.y }, from, to);
  if (point === null) return slide.toggleZoom();
  slide.zoomTo(to, point, duration);
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
  /** CARD-VIEW-1: Go to for the figure shown now (Collection closes this viewer first: it covers the shelving). */
  goTo?: (figure: Figure) => void;
  /** Why Go to has nowhere to go for a figure, or null. */
  goToBlocked?: (figure: Figure) => string | null;
}

/**
 * Display D — tap a figure in any layout and it opens full-screen: uncropped
 * image with pinch-zoom and swipe across the current result set (PhotoSwipe,
 * loaded as a lazy chunk), plus the figure's data in a pull-up sheet.
 */
/** One figure's slide: its photo, or a placeholder plate naming it when it has none (MG-2). */
function slideOf(f: Figure): { src: string; width: number; height: number; alt: string } | { html: string } {
  const meta = getDisplayMeta(f);
  if (!f.imageUrl) {
    return {
      // A class, not a style attribute: the CSP blocks inline styles in injected HTML; the text is escaped, it is catalog data.
      html: `<div class="figure-viewer__no-image"><span class="figure-viewer__plate-name">${escapeHtml(f.name)}</span>${
        f.manufacturer ? `<span class="figure-viewer__plate-mfr">${escapeHtml(f.manufacturer)}</span>` : ''
      }</div>`,
    };
  }
  return { src: f.imageUrl, width: meta.width, height: meta.height, alt: f.name };
}

export function FigureViewer({ figures, index, onClose, goTo, goToBlocked }: FigureViewerProps) {
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

      const dataSource = figures.map(slideOf);

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
        // and left of the section rail: its width, its inset from the edge and a little air (SIDE-RAIL-1)
        paddingFn: () => ({ top: 0, left: 0, right: RAIL_INSET_PX + RAIL_WIDTH_PX + 8, bottom: sheetPeekPx(sheetRef.current) }),
        // our own X, always shown (SHEETS-FB1 6c), not PhotoSwipe's, which a tap hides
        close: false,
        // a tap off the figure closes; on it, it shows or hides the zoom and arrows as before
        tapAction(this: PhotoSwipe, _point, event) {
          if ((event.target as Element).closest(ON_THE_FIGURE)) this.element?.classList.toggle('pswp--ui-visible');
          else this.close();
        },
      });

      // CARD-VIEW-1 part 2: its zoom control and its z key (toggleZoom, no point) start at the face; a double-tap keeps its point
      pswp.toggleZoom = () => {
        const slide = pswp.currSlide;
        if (slide) zoomToFace(slide as unknown as ZoomSlide, pswp.options.zoomAnimationDuration);
      };
      pswp.on('change', () => setCurrent(pswp.currIndex));
      pswp.on('loadComplete', ({ content, slide }) => fitSlideToPicture(content, slide));
      // STRETCH-2: a picture beside the open one (two ahead) loads before PhotoSwipe has a slide for it and says no loadComplete;
      // the slide made on the swipe took the guessed shape for good. Lay it out as it is set, picture loaded or not (a load still
      // to come is laid out by loadComplete).
      pswp.on('afterSetContent', ({ slide }) => fitSlideToPicture(slide.content, slide));
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
  // PHOTOS-FIND-1 item 6: the photo picked in the Photos sheet, the large picture behind it until the sheet closes
  const [aimed, setAimed] = useState<string | undefined>(undefined);
  const picture = aimed ?? figure?.imageUrl;
  // GALLERY-1: the photo behind the sheet follows a photo the figure takes up while the viewer is open ("Use for me" in the
  // Photos tab), and the photo picked in that tab while it is open: the slide that stands is rewritten and refreshed, no
  // other. The slides are written once at open otherwise.
  const shownUrl = useRef<string | undefined>(undefined);
  const shownFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!figure) return;
    // the first look at a figure (the viewer's own, or a swipe to it) is what its slide is written from, the gallery loaded yet or not
    const first = shownFor.current !== figure._id;
    const changed = shownUrl.current !== picture;
    shownFor.current = figure._id;
    shownUrl.current = picture;
    const pswp = pswpRef.current;
    if (first || !changed || !pswp) return;
    const slides = pswp.options.dataSource as unknown[];
    slides[current] = slideOf({ ...figure, imageUrl: picture });
    pswp.refreshSlideContent(current);
  }, [figure, current, picture]);
  const openCopies = useCopiesAction(figure ?? ({} as Figure), closeViewer);
  // GALLERY-1: the figure's photos, over the viewer; another figure (a swipe) is another figure's photos
  const [photosOpen, setPhotosOpen] = useState(false);
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
    <motion.div
      class="figure-viewer-sheet"
      ref={sheetRef}
      style={{ y, '--rail-room': `${railHeightPx(readySections().length) + RAIL_ROOM_PX}px` }}
      data-detent={expanded ? 'all' : 'summary'}
    >
      {/* SIDE-RAIL-1: the figure card's sections on a right rail, riding the sheet's top edge so it is always above it */}
      <FigureRail
        class="figure-viewer-sheet__rail"
        detailsOpen={expanded}
        onDetails={() => {
          setDetent(expanded ? SUMMARY : ALL);
          settleTo(expanded ? SUMMARY : ALL);
        }}
        onPhotos={(figure as Partial<LocalFigure>).local === undefined ? null : () => setPhotosOpen(true)}
        onCopies={openCopies}
      />
      {/* PHOTOS-FIND-1: how many photos the figure has, when more than this one; low on the photo at the left, the rail's opposite */}
      <PhotosChip headId={(figure as Partial<LocalFigure>).local?.headId} onOpen={() => setPhotosOpen(true)} class="figure-viewer-sheet__photos" />
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
          goTo={goTo && { go: () => goTo(figure), blocked: goToBlocked?.(figure) ?? null }}
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
          /* leaves the rail its room above, so it is never pushed off the top of the screen */
          max-height: min(80dvh, calc(100dvh - var(--rail-room, 0px)));
          background: color-mix(in srgb, var(--surface-secondary) 92%, transparent);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border-radius: var(--radius-lg) var(--radius-lg) 0 0;
          padding: 0 var(--space-page) calc(var(--space-3) + var(--safe-area-bottom));
          box-shadow: var(--shadow-lg);
          /* the handle and the rest of the card are the sheet's to drag; its body scrolls */
          touch-action: none;
        }

        /* the rail: 24 px in from the edge, just above the sheet's top edge (its own height away from it) */
        .figure-viewer-sheet__rail {
          position: absolute;
          right: calc(24px + var(--safe-area-right, 0px));
          bottom: calc(100% + 12px);
        }

        /* the photos chip: as far in from the left edge as the rail is from the right (the back-swipe), its pill as high above the
           sheet as the rail's foot */
        .figure-viewer-sheet__photos {
          position: absolute;
          left: calc(${RAIL_INSET_PX}px + var(--safe-area-left, 0px));
          bottom: 100%;
        }

        /* PhotoSwipe's prev/next arrows stand higher than its default middle, and the next arrow stands left of the rail's column
           (the photo keeps to its left too), so they never meet the rail whatever its height: three sections on a short panel
           reach the height the two once stayed under (GALLERY-1) */
        .pswp .pswp__button--arrow {
          top: 28%;
        }

        .pswp .pswp__button--arrow--next {
          right: ${RAIL_INSET_PX + RAIL_WIDTH_PX + 8}px;
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
    <PhotosSheet key={figure._id} figure={figure} open={photosOpen} onClose={() => setPhotosOpen(false)} onAim={setAimed} />
    </>,
    document.body,
  );
}

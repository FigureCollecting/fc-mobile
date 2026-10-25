import { useRef, useState } from 'preact/hooks';
import type { Figure } from '@figurecollecting/fc-shared';
import { FigureDetailContent, useCopiesAction } from './FigureDetailContent';
import { FigureRail } from './figureSections';
import { PhotosSheet } from './PhotosSheet';
import type { LocalFigure } from '../../local/figures';
import { Style } from '../../styles/Style';
import { useBrokenImages } from '../../hooks/useBrokenImages';
import { useBackToClose } from '../../hooks/useBackToClose';
import { ZoomableImage } from './ZoomableImage';

interface DetailPaneProps {
  figure: Figure;
  index: number;
  total: number;
  onClose: () => void;
  /** CARD-VIEW-1: Go to for its figure (beside the case: the pane stays open). */
  goTo?: (figure: Figure) => void;
  /** Why Go to has nowhere to go for a figure, or null. */
  goToBlocked?: (figure: Figure) => string | null;
}

/**
 * Fold-open dual-pane detail (>= 640px container width): the SAME
 * FigureDetailContent used by the full-screen viewer's pull-up sheet,
 * hosted as a static right-hand pane instead of a PhotoSwipe takeover — no
 * fullscreen overlay. The grid condenses left and stays visible and
 * interactive alongside it. Its picture zooms in place (CARD-VIEW-1,
 * ZoomableImage), as the full-screen viewer's does.
 */
export function DetailPane({ figure, index, total, onClose, goTo, goToBlocked }: DetailPaneProps) {
  // An image that fails to load is drawn as the placeholder (ADDR-1), never a blank box.
  const images = useBrokenImages();
  // Back and Esc close it too (SHEETS-FB1 6c), unless a card is open over it: they close the one on top
  useBackToClose(onClose);
  const imageUrl = images.broken(figure.imageUrl) ? undefined : figure.imageUrl;
  const pane = useRef<HTMLElement>(null);
  const openCopies = useCopiesAction(figure);
  // GALLERY-1: the figure's photos, over the pane
  const [photosOpen, setPhotosOpen] = useState(false);
  return (
    <aside class="detail-pane" ref={pane}>
      <button class="detail-pane__close" type="button" onClick={onClose} aria-label="Close detail">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 6L6 18" />
          <path d="M6 6l12 12" />
        </svg>
      </button>

      {/* SIDE-RAIL-1: the figure card's sections on a right rail, held at the pane's top as it scrolls */}
      <div class="detail-pane__rail-anchor">
        <FigureRail
          class="detail-pane__rail"
          detailsOpen
          onDetails={() => pane.current?.querySelector('.figure-viewer-sheet__more')?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
          onPhotos={(figure as Partial<LocalFigure>).local === undefined ? null : () => setPhotosOpen(true)}
          onCopies={openCopies}
        />
      </div>

      {imageUrl ? (
        <ZoomableImage frameClass="detail-pane__frame" imgClass="detail-pane__image" src={imageUrl} alt={figure.name} onError={() => images.failed(imageUrl)} />
      ) : (
        <div class="detail-pane__placeholder" aria-hidden="true" />
      )}

      <div class="detail-pane__content">
        <FigureDetailContent figure={figure} index={index} total={total} goTo={goTo && { go: () => goTo(figure), blocked: goToBlocked?.(figure) ?? null }} />
      </div>

      <PhotosSheet figure={figure} open={photosOpen} onClose={() => setPhotosOpen(false)} />

      <Style css={`
        .detail-pane {
          position: relative;
          flex: 0 0 40%;
          max-width: 40%;
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow-y: auto;
          background: var(--surface-secondary);
          /* leaves the section rail its room at the right: its width, its 24 px inset and a little air */
          padding-right: calc(24px + 60px + 8px);
          box-sizing: border-box;
        }

        /* held at the pane's top as it scrolls, and reaching out over the room the pane leaves, to the pane's own edge */
        .detail-pane__rail-anchor {
          position: sticky;
          top: 0;
          height: 0;
          z-index: 2;
          margin-right: calc(-1 * (24px + 60px + 8px));
        }

        .detail-pane__rail {
          position: absolute;
          right: calc(24px + var(--safe-area-right, 0px));
          top: calc(var(--space-2) + 44px);
        }

        .detail-pane__close {
          position: absolute;
          top: var(--space-2);
          right: var(--space-2);
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: var(--radius-full);
          background: color-mix(in srgb, var(--surface-primary) 70%, transparent);
          color: var(--text-secondary);
        }

        /* the picture's box: as wide as the pane, as tall as the picture at that width, at most 55 % of the pane (one
           flex line, so the picture is stretched to the line the max-height clamps, and laid out whole in it) */
        .detail-pane__frame {
          width: 100%;
          max-height: 55%;
          background: var(--surface-tertiary);
          flex-shrink: 0;
        }

        .detail-pane__image {
          width: 100%;
          object-fit: contain;
        }

        .detail-pane__placeholder {
          width: 100%;
          height: 40%;
          flex-shrink: 0;
          background: linear-gradient(180deg, var(--surface-tertiary), var(--surface-secondary));
        }

        .detail-pane__content {
          padding: var(--space-2) var(--space-page) calc(var(--space-3) + var(--safe-area-bottom));
        }
      `} />
    </aside>
  );
}

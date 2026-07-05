import type { Figure } from '@figurecollecting/fc-shared';
import { FigureDetailContent } from './FigureDetailContent';

interface DetailPaneProps {
  figure: Figure;
  index: number;
  total: number;
  onClose: () => void;
}

/**
 * Fold-open dual-pane detail (>= 640px container width): the SAME
 * FigureDetailContent used by the full-screen viewer's pull-up sheet,
 * hosted as a static right-hand pane instead of a PhotoSwipe takeover — no
 * pinch-zoom, no fullscreen overlay. The grid condenses left and stays
 * visible and interactive alongside it.
 */
export function DetailPane({ figure, index, total, onClose }: DetailPaneProps) {
  return (
    <aside class="detail-pane">
      <button class="detail-pane__close" type="button" onClick={onClose} aria-label="Close detail">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 6L6 18" />
          <path d="M6 6l12 12" />
        </svg>
      </button>

      {figure.imageUrl ? (
        <img class="detail-pane__image" src={figure.imageUrl} alt={figure.name} />
      ) : (
        <div class="detail-pane__placeholder" aria-hidden="true" />
      )}

      <div class="detail-pane__content">
        <FigureDetailContent figure={figure} index={index} total={total} />
      </div>

      <style>{`
        .detail-pane {
          position: relative;
          flex: 0 0 40%;
          max-width: 40%;
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow-y: auto;
          background: var(--surface-secondary);
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

        .detail-pane__image {
          width: 100%;
          max-height: 55%;
          object-fit: contain;
          background: var(--surface-tertiary);
          flex-shrink: 0;
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
      `}</style>
    </aside>
  );
}

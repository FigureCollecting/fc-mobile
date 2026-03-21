import { useCallback, useRef } from 'preact/hooks';
import { useLocation } from 'wouter';
import type { Figure } from '@figurecollecting/fc-shared';
import { StatusBadge } from '../ui/StatusBadge';

interface FigureCardProps {
  figure: Figure;
  onClick?: () => void;
  selectable?: boolean;
  isSelected?: boolean;
  onLongPress?: () => void;
}

const LONG_PRESS_MS = 500;

export function FigureCard({ figure, onClick, selectable, isSelected, onLongPress }: FigureCardProps) {
  const { name, origin, imageUrl, collectionStatus } = figure;
  const [, setLocation] = useLocation();
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);

  const handleClick = useCallback(() => {
    if (didLongPress.current) {
      didLongPress.current = false;
      return;
    }
    if (onClick) {
      onClick();
    } else if (!selectable) {
      setLocation(`/figure/${figure._id}`);
    }
  }, [onClick, selectable, setLocation, figure._id]);

  const handlePointerDown = useCallback(() => {
    didLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      onLongPress?.();
    }, LONG_PRESS_MS);
  }, [onLongPress]);

  const handlePointerUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handlePointerCancel = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    didLongPress.current = false;
  }, []);

  return (
    <button
      class={`figure-card ${selectable ? 'figure-card--selectable' : ''} ${isSelected ? 'figure-card--selected' : ''}`}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerCancel}
      type="button"
    >
      <div class="figure-card__image-wrapper">
        {imageUrl ? (
          <img
            class="figure-card__image"
            src={imageUrl}
            alt={name}
            loading="lazy"
          />
        ) : (
          <div class="figure-card__placeholder">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
        )}
        {collectionStatus && !selectable && (
          <div class="figure-card__badge">
            <StatusBadge status={collectionStatus} />
          </div>
        )}
        {selectable && (
          <div class="figure-card__checkbox">
            {isSelected ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="var(--brand-500)" stroke="none">
                <rect x="2" y="2" width="20" height="20" rx="4" />
                <path d="M9 12l2 2 4-4" stroke="white" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2">
                <rect x="2" y="2" width="20" height="20" rx="4" />
              </svg>
            )}
          </div>
        )}
      </div>
      <div class="figure-card__info">
        <span class="figure-card__name">{name}</span>
        {origin && <span class="figure-card__series">{origin}</span>}
      </div>

      <style>{`
        .figure-card {
          display: flex;
          flex-direction: column;
          background: var(--surface-secondary);
          border-radius: var(--radius-lg);
          overflow: hidden;
          text-align: left;
          transition: transform var(--transition-fast);
          min-height: var(--touch-min);
          -webkit-user-select: none;
          user-select: none;
          -webkit-touch-callout: none;
        }

        .figure-card:active {
          transform: scale(0.97);
        }

        .figure-card--selected {
          outline: 2px solid var(--brand-500);
          outline-offset: -2px;
        }

        .figure-card__image-wrapper {
          position: relative;
          aspect-ratio: 1;
          overflow: hidden;
          background: var(--surface-tertiary);
        }

        .figure-card__image {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .figure-card--selected .figure-card__image {
          opacity: 0.75;
        }

        .figure-card__placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .figure-card__badge {
          position: absolute;
          top: var(--space-2);
          left: var(--space-2);
        }

        .figure-card__checkbox {
          position: absolute;
          top: var(--space-2);
          right: var(--space-2);
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));
        }

        .figure-card__info {
          padding: var(--space-3);
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .figure-card__name {
          font-size: var(--font-sm);
          font-weight: var(--font-weight-medium);
          color: var(--text-primary);
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          line-height: var(--line-height-tight);
        }

        .figure-card__series {
          font-size: var(--font-xs);
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `}</style>
    </button>
  );
}

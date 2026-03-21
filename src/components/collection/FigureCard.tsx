import { useCallback, useRef } from 'preact/hooks';
import { useLocation } from 'wouter';
import type { Figure } from '@figurecollecting/fc-shared';
import { StatusBadge } from '../ui/StatusBadge';
import { LazyImage } from '../ui/LazyImage';

interface FigureCardProps {
  figure: Figure;
  onClick?: () => void;
  selectable?: boolean;
  isSelected?: boolean;
  onLongPress?: () => void;
  /** 'grid' (2-col), 'list' (full-width rows), 'compact' (3-col small) */
  viewMode?: 'grid' | 'list' | 'compact';
  /** Whether this item was recently synced (triggers badge pulse) */
  recentlySync?: boolean;
}

const LONG_PRESS_MS = 500;

export function FigureCard({
  figure,
  onClick,
  selectable,
  isSelected,
  onLongPress,
  viewMode = 'grid',
  recentlySync,
}: FigureCardProps) {
  const { name, origin, imageUrl, collectionStatus, manufacturer, scale } = figure;
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

  const modeClass = `figure-card--${viewMode}`;

  // List mode: horizontal layout with more detail
  if (viewMode === 'list') {
    return (
      <button
        class={`figure-card figure-card--list ${selectable ? 'figure-card--selectable' : ''} ${isSelected ? 'figure-card--selected' : ''}`}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerCancel}
        type="button"
      >
        <div class="figure-card-list__image">
          {imageUrl ? (
            <LazyImage class="figure-card-list__img" src={imageUrl} alt={name} />
          ) : (
            <div class="figure-card__placeholder figure-card__placeholder--list">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
            </div>
          )}
        </div>
        <div class="figure-card-list__content">
          <span class="figure-card-list__name">{name}</span>
          {manufacturer && <span class="figure-card-list__meta">{manufacturer}</span>}
          <div class="figure-card-list__tags">
            {scale && <span class="figure-card-list__tag">{scale}</span>}
            {collectionStatus && (
              <span class={`figure-card-list__badge ${recentlySync ? 'figure-card-list__badge--pulse' : ''}`}>
                <StatusBadge status={collectionStatus} />
              </span>
            )}
          </div>
        </div>
        {selectable && (
          <div class="figure-card-list__checkbox">
            {isSelected ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="var(--brand-500)" stroke="none">
                <rect x="2" y="2" width="20" height="20" rx="4" />
                <path d="M9 12l2 2 4-4" stroke="white" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2">
                <rect x="2" y="2" width="20" height="20" rx="4" />
              </svg>
            )}
          </div>
        )}
        <style>{listStyles}</style>
      </button>
    );
  }

  // Grid (default) and Compact modes
  return (
    <button
      class={`figure-card ${modeClass} ${selectable ? 'figure-card--selectable' : ''} ${isSelected ? 'figure-card--selected' : ''}`}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerCancel}
      type="button"
    >
      <div class="figure-card__image-wrapper">
        {imageUrl ? (
          <LazyImage
            class="figure-card__image"
            src={imageUrl}
            alt={name}
          />
        ) : (
          <div class="figure-card__placeholder">
            <svg width={viewMode === 'compact' ? '20' : '32'} height={viewMode === 'compact' ? '20' : '32'} viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
        )}
        {collectionStatus && !selectable && (
          <div class={`figure-card__badge ${recentlySync ? 'figure-card__badge--pulse' : ''}`}>
            <StatusBadge status={collectionStatus} size={viewMode === 'compact' ? 'sm' : 'sm'} />
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
      {viewMode !== 'compact' && (
        <div class="figure-card__info">
          <span class="figure-card__name">{name}</span>
          {origin && <span class="figure-card__series">{origin}</span>}
        </div>
      )}

      <style>{`
        .figure-card {
          display: flex;
          flex-direction: column;
          background: var(--surface-secondary);
          border-radius: var(--radius-lg);
          overflow: hidden;
          text-align: left;
          min-height: var(--touch-min);
          -webkit-user-select: none;
          user-select: none;
          -webkit-touch-callout: none;
          /* Spring press feedback via CSS */
          transition: transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
          will-change: transform;
        }

        .figure-card:active {
          transform: scale(0.97);
          transition-duration: 100ms;
        }

        .figure-card--selected {
          outline: 2px solid var(--brand-500);
          outline-offset: -2px;
        }

        /* Compact mode adjustments */
        .figure-card--compact {
          border-radius: var(--radius-md);
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

        /* Pulse animation for newly synced badges */
        .figure-card__badge--pulse {
          animation: badge-pulse 2s ease-in-out 3;
        }

        .figure-card-list__badge--pulse {
          animation: badge-pulse 2s ease-in-out 3;
        }

        @keyframes badge-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(1.1); }
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

const listStyles = `
  .figure-card--list {
    flex-direction: row;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--surface-secondary);
    width: 100%;
    text-align: left;
    -webkit-user-select: none;
    user-select: none;
    transition: transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1), background var(--transition-fast);
    will-change: transform;
  }

  .figure-card--list:active {
    transform: scale(0.98);
    transition-duration: 100ms;
    background: var(--surface-tertiary);
  }

  .figure-card--list.figure-card--selected {
    outline: 2px solid var(--brand-500);
    outline-offset: -2px;
  }

  .figure-card-list__image {
    width: 64px;
    height: 64px;
    border-radius: var(--radius-md);
    overflow: hidden;
    flex-shrink: 0;
    background: var(--surface-tertiary);
  }

  .figure-card-list__img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .figure-card__placeholder--list {
    width: 64px;
    height: 64px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .figure-card-list__content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .figure-card-list__name {
    font-size: var(--font-sm);
    font-weight: var(--font-weight-medium);
    color: var(--text-primary);
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .figure-card-list__meta {
    font-size: var(--font-xs);
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .figure-card-list__tags {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: 2px;
  }

  .figure-card-list__tag {
    font-size: 0.625rem;
    color: var(--text-tertiary);
    background: var(--surface-tertiary);
    padding: 2px 6px;
    border-radius: var(--radius-full);
  }

  .figure-card-list__badge {
    display: inline-flex;
  }

  .figure-card-list__checkbox {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
  }
`;

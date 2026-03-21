import { useCallback } from 'preact/hooks';
import { useLocation } from 'wouter';
import type { Figure, IRelease } from '@figurecollecting/fc-shared';
import { LazyImage } from '../ui/LazyImage';
import { releaseCountdown, formatReleaseDate } from '../../utils/countdown';

interface ReleaseCardProps {
  figure: Figure;
  release: IRelease;
}

export function ReleaseCard({ figure, release }: ReleaseCardProps) {
  const [, setLocation] = useLocation();
  const { name, manufacturer, imageUrl, collectionStatus } = figure;

  const countdown = release.date ? releaseCountdown(release.date) : null;
  const dateStr = release.date ? formatReleaseDate(release.date) : 'TBD';

  const isOrdered = collectionStatus === 'ordered';
  const statusLabel = isOrdered ? 'Ordered' : 'Wished';
  const statusClass = isOrdered ? 'release-card__status--ordered' : 'release-card__status--wished';

  const isUrgent = countdown?.urgency === 'imminent';
  const isPast = countdown?.urgency === 'past';

  const handleTap = useCallback(() => {
    setLocation(`/figure/${figure._id}`);
  }, [figure._id, setLocation]);

  const priceStr = release.price
    ? `${release.currency ?? 'JPY'} ${release.price.toLocaleString()}`
    : null;

  return (
    <button
      type="button"
      class={
        'release-card' +
        (isUrgent ? ' release-card--urgent' : '') +
        (isPast ? ' release-card--past' : '')
      }
      onClick={handleTap}
    >
      {/* Thumbnail */}
      <div class="release-card__thumb">
        {imageUrl ? (
          <LazyImage class="release-card__img" src={imageUrl} alt={name} />
        ) : (
          <div class="release-card__placeholder">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
        )}
      </div>

      {/* Content */}
      <div class="release-card__content">
        <span class="release-card__name">{name}</span>
        {manufacturer && <span class="release-card__mfr">{manufacturer}</span>}
        <div class="release-card__meta">
          <span class="release-card__date">{dateStr}</span>
          {priceStr && <span class="release-card__price">{priceStr}</span>}
        </div>
      </div>

      {/* Right side: status + countdown */}
      <div class="release-card__right">
        <span class={`release-card__status ${statusClass}`}>{statusLabel}</span>
        {countdown && (
          <span class={`release-card__countdown release-card__countdown--${countdown.urgency}`}>
            {countdown.text}
          </span>
        )}
      </div>

      <style>{releaseCardStyles}</style>
    </button>
  );
}

const releaseCardStyles = `
  .release-card {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-secondary);
    border-radius: var(--radius-lg);
    width: 100%;
    text-align: left;
    min-height: var(--touch-recommended);
    transition: transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1), background var(--transition-fast);
    will-change: transform;
    -webkit-user-select: none;
    user-select: none;
    border: 1px solid transparent;
  }

  .release-card:active {
    transform: scale(0.98);
    transition-duration: 100ms;
    background: var(--surface-tertiary);
  }

  .release-card--urgent {
    border-color: var(--accent-warning);
  }

  .release-card--past {
    opacity: 0.65;
  }

  .release-card__thumb {
    width: 48px;
    height: 48px;
    border-radius: var(--radius-md);
    overflow: hidden;
    flex-shrink: 0;
    background: var(--surface-tertiary);
  }

  .release-card__img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .release-card__placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .release-card__content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .release-card__name {
    font-size: var(--font-sm);
    font-weight: var(--font-weight-medium);
    color: var(--text-primary);
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-height: var(--line-height-tight);
  }

  .release-card__mfr {
    font-size: var(--font-xs);
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .release-card__meta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: 2px;
  }

  .release-card__date {
    font-size: 0.625rem;
    color: var(--text-tertiary);
  }

  .release-card__price {
    font-size: 0.625rem;
    color: var(--text-secondary);
    font-weight: var(--font-weight-medium);
  }

  .release-card__right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    flex-shrink: 0;
  }

  .release-card__status {
    font-size: 0.625rem;
    font-weight: var(--font-weight-semibold);
    padding: 2px 8px;
    border-radius: var(--radius-full);
    white-space: nowrap;
    line-height: 1;
  }

  .release-card__status--ordered {
    background: rgba(245, 158, 11, 0.15);
    color: var(--accent-warning);
  }

  .release-card__status--wished {
    background: rgba(59, 130, 246, 0.15);
    color: var(--accent-info);
  }

  .release-card__countdown {
    font-size: 0.625rem;
    font-weight: var(--font-weight-semibold);
    white-space: nowrap;
    line-height: 1;
  }

  .release-card__countdown--imminent {
    color: var(--accent-warning);
  }

  .release-card__countdown--soon {
    color: var(--brand-400);
  }

  .release-card__countdown--future {
    color: var(--text-tertiary);
  }

  .release-card__countdown--past {
    color: var(--accent-success);
  }
`;

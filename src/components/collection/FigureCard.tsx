interface FigureCardProps {
  name: string;
  series?: string;
  imageUrl?: string;
  onClick?: () => void;
}

export function FigureCard({ name, series, imageUrl, onClick }: FigureCardProps) {
  return (
    <button class="figure-card" onClick={onClick} type="button">
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
      </div>
      <div class="figure-card__info">
        <span class="figure-card__name">{name}</span>
        {series && <span class="figure-card__series">{series}</span>}
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
        }

        .figure-card:active {
          transform: scale(0.97);
        }

        .figure-card__image-wrapper {
          aspect-ratio: 1;
          overflow: hidden;
          background: var(--surface-tertiary);
        }

        .figure-card__image {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .figure-card__placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
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

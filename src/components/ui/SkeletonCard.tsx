export function SkeletonCard() {
  return (
    <div class="skeleton-card" aria-hidden="true">
      <div class="skeleton-card__image" />
      <div class="skeleton-card__body">
        <div class="skeleton-card__line skeleton-card__line--wide" />
        <div class="skeleton-card__line skeleton-card__line--narrow" />
      </div>

      <style>{`
        .skeleton-card {
          background: var(--surface-secondary);
          border-radius: var(--radius-lg);
          overflow: hidden;
        }

        .skeleton-card__image {
          aspect-ratio: 1;
          background: var(--surface-tertiary);
          animation: skeleton-pulse 1.5s ease-in-out infinite;
        }

        .skeleton-card__body {
          padding: var(--space-3);
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .skeleton-card__line {
          height: 12px;
          border-radius: var(--radius-sm);
          background: var(--surface-tertiary);
          animation: skeleton-pulse 1.5s ease-in-out infinite;
          animation-delay: 0.15s;
        }

        .skeleton-card__line--wide {
          width: 80%;
        }

        .skeleton-card__line--narrow {
          width: 50%;
          animation-delay: 0.3s;
        }

        @keyframes skeleton-pulse {
          0%, 100% {
            opacity: 0.3;
          }
          50% {
            opacity: 0.7;
          }
        }
      `}</style>
    </div>
  );
}

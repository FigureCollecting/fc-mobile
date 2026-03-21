import type { ComponentChildren } from 'preact';

interface CollectionGridProps {
  children: ComponentChildren;
  /** 'grid' (2-col), 'list' (full-width), 'compact' (3-col small) */
  viewMode?: 'grid' | 'list' | 'compact';
}

export function CollectionGrid({ children, viewMode = 'grid' }: CollectionGridProps) {
  const modeClass = `collection-grid--${viewMode}`;

  return (
    <div class={`collection-grid ${modeClass}`}>
      {children}

      <style>{`
        .collection-grid {
          padding: var(--space-4);
        }

        /* Grid mode: 2 columns (default) */
        .collection-grid--grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: var(--space-3);
        }

        @media (min-width: 480px) {
          .collection-grid--grid {
            grid-template-columns: repeat(3, 1fr);
          }
        }

        @media (min-width: 768px) {
          .collection-grid--grid {
            grid-template-columns: repeat(4, 1fr);
            gap: var(--space-4);
          }
        }

        /* List mode: single column full-width rows */
        .collection-grid--list {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        /* Compact mode: 3 columns dense thumbnails */
        .collection-grid--compact {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: var(--space-2);
        }

        @media (min-width: 480px) {
          .collection-grid--compact {
            grid-template-columns: repeat(4, 1fr);
          }
        }

        @media (min-width: 768px) {
          .collection-grid--compact {
            grid-template-columns: repeat(6, 1fr);
          }
        }
      `}</style>
    </div>
  );
}

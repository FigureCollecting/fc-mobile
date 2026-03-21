import type { ComponentChildren } from 'preact';

interface CollectionGridProps {
  children: ComponentChildren;
}

export function CollectionGrid({ children }: CollectionGridProps) {
  return (
    <div class="collection-grid">
      {children}

      <style>{`
        .collection-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: var(--space-3);
          padding: var(--space-4);
        }

        @media (min-width: 480px) {
          .collection-grid {
            grid-template-columns: repeat(3, 1fr);
          }
        }

        @media (min-width: 768px) {
          .collection-grid {
            grid-template-columns: repeat(4, 1fr);
            gap: var(--space-4);
          }
        }
      `}</style>
    </div>
  );
}

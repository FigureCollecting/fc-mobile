import { Header } from '../components/layout/Header';
import { CollectionGrid } from '../components/collection/CollectionGrid';
import { SkeletonCard } from '../components/ui/SkeletonCard';

export function Collection() {
  return (
    <div class="page-collection">
      <Header title="Collection" />
      <CollectionGrid>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </CollectionGrid>
      <p class="page-collection__empty">
        Sign in to see your collection
      </p>

      <style>{`
        .page-collection__empty {
          text-align: center;
          color: var(--text-secondary);
          padding: var(--space-8) var(--space-4);
          font-size: var(--font-sm);
        }
      `}</style>
    </div>
  );
}

import { Header } from '../components/layout/Header';
import { CollectionGrid } from '../components/collection/CollectionGrid';
import { FigureCard } from '../components/collection/FigureCard';
import { SkeletonCard } from '../components/ui/SkeletonCard';
import { useCollection } from '../hooks/useCollection';
import { useAuthStore } from '../stores/auth';

export function Collection() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data, isLoading, isError } = useCollection();

  // Not logged in
  if (!isAuthenticated) {
    return (
      <div class="page-collection">
        <Header title="Collection" />
        <p class="page-collection__empty">
          Sign in to see your collection
        </p>
        <style>{styles}</style>
      </div>
    );
  }

  // Loading
  if (isLoading) {
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
        <style>{styles}</style>
      </div>
    );
  }

  // Error
  if (isError) {
    return (
      <div class="page-collection">
        <Header title="Collection" />
        <p class="page-collection__empty">
          Failed to load collection. Pull down to retry.
        </p>
        <style>{styles}</style>
      </div>
    );
  }

  const figures = data?.data ?? [];

  // Empty collection
  if (figures.length === 0) {
    return (
      <div class="page-collection">
        <Header title="Collection" />
        <p class="page-collection__empty">
          Your collection is empty. Add figures to get started!
        </p>
        <style>{styles}</style>
      </div>
    );
  }

  // Collection with data
  return (
    <div class="page-collection">
      <Header title={`Collection (${data?.total ?? 0})`} />
      <CollectionGrid>
        {figures.map((figure) => (
          <FigureCard key={figure._id} figure={figure} />
        ))}
      </CollectionGrid>
      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .page-collection__empty {
    text-align: center;
    color: var(--text-secondary);
    padding: var(--space-8) var(--space-4);
    font-size: var(--font-sm);
  }
`;

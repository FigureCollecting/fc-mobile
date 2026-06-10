import { useState, useCallback } from 'preact/hooks';
import { useRoute, useLocation } from 'wouter';
import { useFigure } from '../hooks/useFigure';
import { useUpdateFigure, useDeleteFigure } from '../hooks/useFigureMutations';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ImageGallery } from '../components/ui/ImageGallery';
import { EditFigureSheet } from '../components/collection/EditFigureSheet';
import { StatusSheet } from '../components/collection/StatusSheet';
import { DeleteSheet } from '../components/collection/DeleteSheet';
import type { EditFormData } from '../components/collection/EditFigureSheet';
import type { CollectionStatus } from '@figurecollecting/fc-shared';

function SkeletonDetail() {
  return (
    <div class="figure-detail" aria-hidden="true">
      <div class="figure-detail__hero">
        <div class="figure-detail__hero-skeleton" />
      </div>
      <div class="figure-detail__card">
        <div class="figure-detail__skeleton-line figure-detail__skeleton-line--wide" />
        <div class="figure-detail__skeleton-line figure-detail__skeleton-line--medium" />
        <div class="figure-detail__skeleton-line figure-detail__skeleton-line--narrow" />
        <div class="figure-detail__skeleton-block" />
      </div>
    </div>
  );
}

function formatPrice(price: number | undefined, currency: string | undefined): string {
  if (price == null) return '';
  const cur = currency ?? 'JPY';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(price);
  } catch {
    return `${cur} ${price}`;
  }
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatDimension(mm: number | undefined): string {
  if (mm == null) return '';
  return `${mm}mm`;
}

export function FigureDetail() {
  const [, params] = useRoute('/figure/:id');
  const [, setLocation] = useLocation();
  const { data: figure, isLoading, isError } = useFigure(params?.id);
  const updateMutation = useUpdateFigure();
  const deleteMutation = useDeleteFigure();
  const [editOpen, setEditOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleBack = useCallback(() => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      setLocation('/');
    }
  }, [setLocation]);

  const handleEditSave = useCallback(
    (data: EditFormData) => {
      if (!figure) return;
      updateMutation.mutate(
        { id: figure._id, data },
        { onSuccess: () => setEditOpen(false) },
      );
    },
    [figure, updateMutation],
  );

  const handleStatusChange = useCallback(
    (status: CollectionStatus) => {
      if (!figure) return;
      updateMutation.mutate(
        { id: figure._id, data: { collectionStatus: status } },
        { onSuccess: () => setStatusOpen(false) },
      );
    },
    [figure, updateMutation],
  );

  const handleDelete = useCallback(() => {
    if (!figure) return;
    deleteMutation.mutate(figure._id, {
      onSuccess: () => {
        setDeleteOpen(false);
        if (window.history.length > 1) {
          window.history.back();
        } else {
          setLocation('/');
        }
      },
    });
  }, [figure, deleteMutation, setLocation]);

  if (isLoading) return <SkeletonDetail />;

  if (isError || !figure) {
    return (
      <div class="figure-detail">
        <div class="figure-detail__header-bar">
          <button
            class="figure-detail__back-btn"
            onClick={handleBack}
            aria-label="Go back"
            type="button"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
        <div class="figure-detail__error">
          <p>Failed to load figure details.</p>
          <button class="figure-detail__retry-btn" onClick={() => window.location.reload()} type="button">
            Retry
          </button>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  // Build images array — for now just the single imageUrl
  const images = figure.imageUrl ? [figure.imageUrl] : [];

  // Primary release info
  const primaryRelease = figure.releases?.[0];
  const releaseDate = primaryRelease?.date;
  const releasePrice = primaryRelease?.price;
  const releaseCurrency = primaryRelease?.currency;

  // Dimensions string
  const dims = figure.dimensions;
  const dimensionParts: string[] = [];
  if (dims?.heightMm) dimensionParts.push(`H: ${formatDimension(dims.heightMm)}`);
  if (dims?.widthMm) dimensionParts.push(`W: ${formatDimension(dims.widthMm)}`);
  if (dims?.depthMm) dimensionParts.push(`D: ${formatDimension(dims.depthMm)}`);
  const dimensionsStr = dimensionParts.join(' / ');

  return (
    <div class="figure-detail">
      {/* Hero image */}
      <div class="figure-detail__hero">
        <button
          class="figure-detail__back-btn figure-detail__back-btn--floating"
          onClick={handleBack}
          aria-label="Go back"
          type="button"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
        </button>

        {images.length > 0 ? (
          <ImageGallery images={images} alt={figure.name} />
        ) : (
          <div class="figure-detail__hero-placeholder">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
        )}
      </div>

      {/* Content card overlapping hero */}
      <div class="figure-detail__card">
        {/* Name + manufacturer */}
        <div class="figure-detail__header">
          <h1 class="figure-detail__name">{figure.name}</h1>
          <p class="figure-detail__manufacturer">{figure.manufacturer}</p>
          {figure.collectionStatus && (
            <div class="figure-detail__status">
              <StatusBadge status={figure.collectionStatus} size="md" />
            </div>
          )}
        </div>

        {/* Release info */}
        {(releaseDate || releasePrice || figure.scale) && (
          <section class="figure-detail__section">
            <h2 class="figure-detail__section-title">Release Info</h2>
            <div class="figure-detail__info-grid">
              {releaseDate && (
                <div class="figure-detail__info-item">
                  <span class="figure-detail__info-label">Release Date</span>
                  <span class="figure-detail__info-value">{formatDate(releaseDate)}</span>
                </div>
              )}
              {releasePrice != null && (
                <div class="figure-detail__info-item">
                  <span class="figure-detail__info-label">Price</span>
                  <span class="figure-detail__info-value">{formatPrice(releasePrice, releaseCurrency)}</span>
                </div>
              )}
              {figure.scale && (
                <div class="figure-detail__info-item">
                  <span class="figure-detail__info-label">Scale</span>
                  <span class="figure-detail__info-value">{figure.scale}</span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Details */}
        {(figure.materials || dimensionsStr || figure.origin || figure.category) && (
          <section class="figure-detail__section">
            <h2 class="figure-detail__section-title">Details</h2>
            <div class="figure-detail__info-grid">
              {figure.origin && (
                <div class="figure-detail__info-item">
                  <span class="figure-detail__info-label">Series</span>
                  <span class="figure-detail__info-value">{figure.origin}</span>
                </div>
              )}
              {figure.category && (
                <div class="figure-detail__info-item">
                  <span class="figure-detail__info-label">Category</span>
                  <span class="figure-detail__info-value">{figure.category}</span>
                </div>
              )}
              {figure.materials && (
                <div class="figure-detail__info-item">
                  <span class="figure-detail__info-label">Materials</span>
                  <span class="figure-detail__info-value">{figure.materials}</span>
                </div>
              )}
              {dimensionsStr && (
                <div class="figure-detail__info-item">
                  <span class="figure-detail__info-label">Dimensions</span>
                  <span class="figure-detail__info-value">{dimensionsStr}</span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Purchase info */}
        {figure.purchaseInfo && (figure.purchaseInfo.date || figure.purchaseInfo.price != null) && (
          <section class="figure-detail__section">
            <h2 class="figure-detail__section-title">Purchase Info</h2>
            <div class="figure-detail__info-grid">
              {figure.purchaseInfo.date && (
                <div class="figure-detail__info-item">
                  <span class="figure-detail__info-label">Purchased</span>
                  <span class="figure-detail__info-value">{formatDate(figure.purchaseInfo.date)}</span>
                </div>
              )}
              {figure.purchaseInfo.price != null && (
                <div class="figure-detail__info-item">
                  <span class="figure-detail__info-label">Paid</span>
                  <span class="figure-detail__info-value">
                    {formatPrice(figure.purchaseInfo.price, figure.purchaseInfo.currency)}
                  </span>
                </div>
              )}
              {figure.merchant?.name && (
                <div class="figure-detail__info-item">
                  <span class="figure-detail__info-label">Merchant</span>
                  <span class="figure-detail__info-value">{figure.merchant.name}</span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Notes */}
        {figure.note && (
          <section class="figure-detail__section">
            <h2 class="figure-detail__section-title">Notes</h2>
            <p class="figure-detail__notes">{figure.note}</p>
          </section>
        )}

        {/* Tags */}
        {figure.tags && figure.tags.length > 0 && (
          <section class="figure-detail__section">
            <h2 class="figure-detail__section-title">Tags</h2>
            <div class="figure-detail__tags">
              {figure.tags.map((tag) => (
                <span key={tag} class="figure-detail__tag">{tag}</span>
              ))}
            </div>
          </section>
        )}

        {/* Spacer for bottom action bar */}
        <div class="figure-detail__bottom-spacer" />
      </div>

      {/* Bottom action bar */}
      <div class="figure-detail__action-bar">
        <button class="figure-detail__action-btn" type="button" onClick={() => setEditOpen(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          <span>Edit</span>
        </button>
        <button class="figure-detail__action-btn figure-detail__action-btn--status" type="button" onClick={() => setStatusOpen(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
            <path d="M12 6v6l4 2" />
          </svg>
          <span>Status</span>
        </button>
        <button class="figure-detail__action-btn figure-detail__action-btn--danger" type="button" onClick={() => setDeleteOpen(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          <span>Delete</span>
        </button>
      </div>

      {/* Edit sheet */}
      <EditFigureSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        figure={figure}
        onSave={handleEditSave}
        isSaving={updateMutation.isPending}
      />

      {/* Status sheet */}
      <StatusSheet
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        currentStatus={figure.collectionStatus}
        onSelect={handleStatusChange}
        isUpdating={updateMutation.isPending}
      />

      {/* Delete sheet */}
      <DeleteSheet
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        isDeleting={deleteMutation.isPending}
        figureName={figure.name}
        imageUrl={figure.imageUrl}
      />

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .figure-detail {
    min-height: 100%;
    background: var(--surface-primary);
    padding-bottom: 0;
  }

  /* Hero section */
  .figure-detail__hero {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    max-height: 420px;
    background: var(--surface-tertiary);
    overflow: hidden;
  }

  .figure-detail__hero-skeleton {
    width: 100%;
    height: 100%;
    background: var(--surface-tertiary);
    animation: fd-pulse 1.5s ease-in-out infinite;
  }

  .figure-detail__hero-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-tertiary);
  }

  /* Back button */
  .figure-detail__back-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--touch-min);
    height: var(--touch-min);
    color: var(--text-primary);
  }

  .figure-detail__back-btn--floating {
    position: absolute;
    top: var(--safe-area-top);
    left: var(--space-2);
    z-index: 10;
    background: rgba(0, 0, 0, 0.5);
    border-radius: var(--radius-full);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }

  .figure-detail__header-bar {
    display: flex;
    align-items: center;
    padding: var(--space-2);
    padding-top: calc(var(--safe-area-top) + var(--space-2));
  }

  /* Content card */
  .figure-detail__card {
    position: relative;
    margin-top: -24px;
    background: var(--surface-primary);
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
    padding: var(--space-6) var(--space-4);
    z-index: 2;
  }

  /* Skeleton lines */
  .figure-detail__skeleton-line {
    height: 16px;
    border-radius: var(--radius-sm);
    background: var(--surface-tertiary);
    animation: fd-pulse 1.5s ease-in-out infinite;
    margin-bottom: var(--space-3);
  }

  .figure-detail__skeleton-line--wide { width: 80%; }
  .figure-detail__skeleton-line--medium { width: 50%; animation-delay: 0.15s; }
  .figure-detail__skeleton-line--narrow { width: 30%; animation-delay: 0.3s; }

  .figure-detail__skeleton-block {
    height: 100px;
    border-radius: var(--radius-md);
    background: var(--surface-tertiary);
    animation: fd-pulse 1.5s ease-in-out infinite;
    animation-delay: 0.45s;
    margin-top: var(--space-4);
  }

  @keyframes fd-pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 0.7; }
  }

  /* Header */
  .figure-detail__header {
    margin-bottom: var(--space-6);
  }

  .figure-detail__name {
    font-size: var(--font-xl);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    line-height: var(--line-height-tight);
    margin-bottom: var(--space-1);
  }

  .figure-detail__manufacturer {
    font-size: var(--font-sm);
    color: var(--text-secondary);
    margin-bottom: var(--space-3);
  }

  .figure-detail__status {
    margin-top: var(--space-2);
  }

  /* Sections */
  .figure-detail__section {
    margin-bottom: var(--space-6);
  }

  .figure-detail__section-title {
    font-size: var(--font-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: var(--space-3);
  }

  .figure-detail__info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4) var(--space-3);
  }

  .figure-detail__info-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .figure-detail__info-label {
    font-size: var(--font-xs);
    color: var(--text-tertiary);
  }

  .figure-detail__info-value {
    font-size: var(--font-sm);
    color: var(--text-primary);
    font-weight: var(--font-weight-medium);
  }

  /* Notes */
  .figure-detail__notes {
    font-size: var(--font-sm);
    color: var(--text-secondary);
    line-height: var(--line-height-normal);
    background: var(--surface-secondary);
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-4);
  }

  /* Tags */
  .figure-detail__tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .figure-detail__tag {
    display: inline-flex;
    align-items: center;
    font-size: var(--font-xs);
    color: var(--text-secondary);
    background: var(--surface-secondary);
    border-radius: var(--radius-full);
    padding: 4px 10px;
  }

  /* Error state */
  .figure-detail__error {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-12) var(--space-4);
    color: var(--text-secondary);
    font-size: var(--font-sm);
  }

  .figure-detail__retry-btn {
    font-size: var(--font-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--brand-400);
    padding: var(--space-3) var(--space-6);
    border: 1px solid var(--brand-500);
    border-radius: var(--radius-md);
    min-height: var(--touch-min);
  }

  /* Bottom spacer */
  .figure-detail__bottom-spacer {
    height: 80px;
  }

  /* Bottom action bar */
  .figure-detail__action-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: space-around;
    background: var(--surface-secondary);
    border-top: 1px solid var(--border-subtle);
    padding: var(--space-2) var(--space-4);
    padding-bottom: calc(var(--space-2) + var(--safe-area-bottom));
    z-index: 50;
  }

  .figure-detail__action-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    min-width: var(--touch-min);
    min-height: var(--touch-min);
    padding: var(--space-2);
    color: var(--text-secondary);
    font-size: var(--font-xs);
    font-weight: var(--font-weight-medium);
    transition: color var(--transition-fast);
  }

  .figure-detail__action-btn:active {
    color: var(--text-primary);
  }

  .figure-detail__action-btn--status {
    color: var(--brand-400);
  }

  .figure-detail__action-btn--danger:active {
    color: var(--accent-danger);
  }
`;

import { useState, useCallback } from 'preact/hooks';
import { useRoute, useLocation } from 'wouter';
import type { OccurrenceStatus } from '@figurecollecting/fc-api-contract';
import { useFigure } from '../hooks/useFigure';
import { useCollections } from '../hooks/useCollection';
import { useCopyActions, useDeleteFigure, useUpdateFigure, type FigureEdit } from '../hooks/useFigureMutations';
import { useProductImage } from '../hooks/useProductImage';
import { useAuthPhase } from '../local/useLocal';
import { jan13 } from '../local/figures';
import { StatusBadge } from '../components/ui/StatusBadge';
import { EditFigureSheet } from '../components/collection/EditFigureSheet';
import { DeleteSheet } from '../components/collection/DeleteSheet';
import { DisposalSheet } from '../components/collection/DisposalSheet';
import { MoveSheet, type MoveTarget } from '../components/collection/MoveSheet';
import { CopyList } from '../components/collection/CopyList';
import { TAB_LABEL } from '../components/collection/CollectionTabs';
import { SyncBadge, formatAsOf } from '../components/sync/SyncBadge';
import { showToast } from '../stores/toast';
import type { Disposal } from '../storage/userStore';
import { Style } from '../styles/Style';

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

function formatRelease(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (y === undefined || m === undefined || Number.isNaN(y) || Number.isNaN(m)) return ym;
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, 1));
}

const copiesLabel = (n: number): string => (n === 1 ? '1 copy' : `${n} copies`);
const failed = (what: string) => (err: unknown) => showToast(`Could not ${what}: ${(err as Error).message}`, 'error');

function BackIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
  );
}

/** One figure from the local store (WK-15): its card facts, its copies and every edit, offline too. */
export function FigureDetail() {
  const [, params] = useRoute('/figure/:id');
  const [, setLocation] = useLocation();
  const phase = useAuthPhase();
  const { data: figure, isLoading, isError } = useFigure(params?.id);
  const image = useProductImage(figure?.local.headId);
  const collections = useCollections();
  const updateMutation = useUpdateFigure();
  const deleteMutation = useDeleteFigure();
  const actions = useCopyActions();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [moving, setMoving] = useState<string[] | null>(null);
  const [disposing, setDisposing] = useState<string[] | null>(null);

  const handleBack = useCallback(() => {
    if (window.history.length > 1) window.history.back();
    else setLocation('/');
  }, [setLocation]);

  const handleEditSave = useCallback(
    (data: FigureEdit) => {
      if (!figure) return;
      updateMutation.mutate({ id: figure._id, data }, { onSuccess: () => setEditOpen(false), onError: failed('save') });
    },
    [figure, updateMutation],
  );

  const handleDelete = useCallback(() => {
    if (!figure) return;
    deleteMutation.mutate(figure._id, {
      onSuccess: () => {
        setDeleteOpen(false);
        handleBack();
      },
      onError: failed('remove'),
    });
  }, [figure, deleteMutation, handleBack]);

  if (phase === 'loading' || isLoading) return <SkeletonDetail />;

  if (isError || !figure) {
    return (
      <div class="figure-detail">
        <div class="figure-detail__header-bar">
          <button class="figure-detail__back-btn" onClick={handleBack} aria-label="Go back" type="button">
            <BackIcon />
          </button>
        </div>
        <div class="figure-detail__error">
          <p>{phase === 'signed-out' ? 'Sign in to see this figure.' : 'This figure is not in your collection.'}</p>
        </div>
        <Style css={styles} />
      </div>
    );
  }

  const local = figure.local;
  const movingKind = moving === null ? undefined : local.copies.find((c) => c.occ_id === moving[0])?.status;
  const moveTargets: MoveTarget[] = collections
    .filter((c) => c.kind !== 'former' && !(c.coll_id === 'default' && c.kind === movingKind))
    .map((c) => ({ ref: c.ref, label: c.coll_id === 'default' ? (c.name ?? TAB_LABEL[c.kind]) : `${TAB_LABEL[c.kind]}: ${c.name}` }));
  const dims = figure.dimensions;
  const dimensionParts = [
    dims?.heightMm ? `H: ${dims.heightMm}mm` : undefined,
    dims?.widthMm ? `W: ${dims.widthMm}mm` : undefined,
    dims?.depthMm ? `D: ${dims.depthMm}mm` : undefined,
  ].filter(Boolean);
  const facts: Array<[string, string]> = [
    ['Character', local.character ?? ''],
    ['Series', local.series ?? ''],
    ['Scale', figure.scale],
    ['Release', figure.releases?.[0]?.date ? formatRelease(figure.releases[0].date) : ''],
    ['JAN', local.gtin14s.map(jan13).join(', ')],
    ['Dimensions', dimensionParts.join(' / ')],
  ];

  return (
    <div class="figure-detail">
      <div class="figure-detail__hero">
        <button class="figure-detail__back-btn figure-detail__back-btn--floating" onClick={handleBack} aria-label="Go back" type="button">
          <BackIcon />
        </button>
        {image.data ? (
          <img class="figure-detail__image" src={image.data.url} alt={figure.name} />
        ) : (
          // The placeholder plate (MG-2): no derivative, so no image of any kind.
          <div class="figure-detail__plate" aria-hidden="true">
            <span class="figure-detail__plate-name">{figure.name}</span>
            {figure.manufacturer && <span class="figure-detail__plate-mfr">{figure.manufacturer}</span>}
          </div>
        )}
      </div>

      <div class="figure-detail__card">
        <div class="figure-detail__header">
          <h1 class="figure-detail__name">{figure.name}</h1>
          {figure.manufacturer && <p class="figure-detail__manufacturer">{figure.manufacturer}</p>}
          <div class="figure-detail__status">
            {figure.collectionStatus && <StatusBadge status={figure.collectionStatus} size="md" />}
            <SyncBadge sync={local.sync} asOf={local.asOf} id={`sync-${figure._id}`} />
          </div>
          <p class="figure-detail__as-of">{local.hasCard ? `Facts ${local.factsAsOf === null ? 'of unknown date' : formatAsOf(local.factsAsOf)}` : 'Details arrive with the next sync.'}</p>
        </div>

        {facts.some(([, v]) => v !== '') && (
          <section class="figure-detail__section">
            <h2 class="figure-detail__section-title">Details</h2>
            <div class="figure-detail__info-grid">
              {facts
                .filter(([, v]) => v !== '')
                .map(([label, value]) => (
                  <div key={label} class="figure-detail__info-item">
                    <span class="figure-detail__info-label">{label}</span>
                    <span class="figure-detail__info-value">{value}</span>
                  </div>
                ))}
            </div>
          </section>
        )}

        <CopyList
          figure={figure}
          collections={collections}
          onArrived={(occ) => void actions.markArrived(occ).catch(failed('mark it arrived'))}
          onMove={setMoving}
          onDispose={setDisposing}
          onRemove={(occ) => void actions.removeCopy(occ).catch(failed('remove the copy'))}
          onDedupe={(kind: OccurrenceStatus) => void actions.dedupe(local.headId, kind).catch(failed('dedupe'))}
        />

        {figure.rating !== undefined && (
          <section class="figure-detail__section">
            <h2 class="figure-detail__section-title">Score</h2>
            <p class="figure-detail__notes">{`${figure.rating} / 10`}</p>
          </section>
        )}

        {figure.note && (
          <section class="figure-detail__section">
            <h2 class="figure-detail__section-title">Notes</h2>
            <p class="figure-detail__notes">{figure.note}</p>
          </section>
        )}

        {figure.tags && figure.tags.length > 0 && (
          <section class="figure-detail__section">
            <h2 class="figure-detail__section-title">Tags</h2>
            <div class="figure-detail__tags">
              {figure.tags.map((tag) => (
                <span key={tag} class="figure-detail__tag">
                  {tag}
                </span>
              ))}
            </div>
          </section>
        )}

        <div class="figure-detail__bottom-spacer" />
      </div>

      <div class="figure-detail__action-bar">
        <button class="figure-detail__action-btn" type="button" onClick={() => setEditOpen(true)}>
          <span>Edit</span>
        </button>
        <button class="figure-detail__action-btn figure-detail__action-btn--danger" type="button" onClick={() => setDeleteOpen(true)}>
          <span>Delete</span>
        </button>
      </div>

      <EditFigureSheet open={editOpen} onClose={() => setEditOpen(false)} figure={figure} onSave={handleEditSave} isSaving={updateMutation.isPending} />

      <DeleteSheet open={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} isDeleting={deleteMutation.isPending} figureName={figure.name} />

      <MoveSheet
        open={moving !== null}
        title={`Move ${copiesLabel(moving?.length ?? 0)} to`}
        targets={moveTargets}
        onPick={(t) => {
          const occs = moving ?? [];
          setMoving(null);
          void actions.moveCopies(occs, t.ref).catch(failed('move'));
        }}
        onClose={() => setMoving(null)}
      />

      <DisposalSheet
        open={disposing !== null}
        what={copiesLabel(disposing?.length ?? 0)}
        onClose={() => setDisposing(null)}
        onSave={(disposal: Disposal) => {
          const occs = disposing ?? [];
          setDisposing(null);
          void actions.markFormer(occs, disposal).catch(failed('save'));
        }}
      />

      <Style css={styles} />
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

  .figure-detail__plate {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-6);
    text-align: center;
    background: linear-gradient(180deg, var(--surface-tertiary), var(--surface-secondary));
  }

  .figure-detail__plate-name {
    font-size: var(--font-xl);
    font-weight: 700;
    color: var(--text-primary);
  }

  .figure-detail__plate-mfr {
    font-size: var(--font-sm);
    color: var(--text-tertiary);
  }

  .figure-detail__image {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .figure-detail__as-of {
    margin-top: var(--space-1);
    font-size: var(--font-xs);
    color: var(--text-tertiary);
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

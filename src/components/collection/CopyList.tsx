import type { OccurrenceStatus } from '@figurecollecting/fc-api-contract';
import type { LocalFigure } from '../../local/figures';
import type { CollectionView } from '../../sync/occurrences';
import { DisposalLine } from './FormerList';
import { TAB_LABEL } from './CollectionTabs';
import { Style } from '../../styles/Style';

const KINDS: readonly OccurrenceStatus[] = ['owned', 'ordered', 'wished', 'former'];

export interface CopyListProps {
  figure: LocalFigure;
  collections: CollectionView[];
  onArrived: (occId: string) => void;
  onMove: (occIds: string[]) => void;
  onDispose: (occIds: string[]) => void;
  onRemove: (occId: string) => void;
  onDedupe: (kind: OccurrenceStatus) => void;
}

/** The figure's copies, by kind, each with its actions (GR 2026-09-26): one copy at a time. */
export function CopyList({ figure, collections, onArrived, onMove, onDispose, onRemove, onDedupe }: CopyListProps) {
  const nameOf = (ref: string | null) => collections.find((c) => c.ref === ref && c.coll_id !== 'default')?.name ?? null;
  const byKind = KINDS.map((kind) => ({ kind, copies: figure.local.copies.filter((c) => c.status === kind) })).filter((g) => g.copies.length > 0);
  return (
    <section class="copy-list">
      <h2 class="figure-detail__section-title">Your copies</h2>
      {byKind
        .filter((g) => g.kind !== 'former' && g.copies.length > 1)
        .map((g) => (
          <button key={g.kind} type="button" class="copy-list__dedupe" onClick={() => onDedupe(g.kind)}>
            {`Keep 1 of ${g.copies.length} ${TAB_LABEL[g.kind].toLowerCase()}`}
          </button>
        ))}
      <ul class="copy-list__items" aria-label="Your copies">
        {byKind.flatMap((g) =>
          g.copies.map((c) => (
            <li key={c.occ_id} class="copy-list__item" data-occ={c.occ_id}>
              <div class="copy-list__what">
                <span class="copy-list__kind">{TAB_LABEL[g.kind]}</span>
                {nameOf(c.shown_in) !== null && <span class="copy-list__filed">{nameOf(c.shown_in)}</span>}
                {g.kind === 'former' && <DisposalLine disposal={c.disposal as never} />}
              </div>
              <div class="copy-list__actions">
                {g.kind === 'ordered' && (
                  <button type="button" onClick={() => onArrived(c.occ_id)}>
                    Mark arrived
                  </button>
                )}
                <button type="button" onClick={() => onMove([c.occ_id])}>
                  Move…
                </button>
                {g.kind !== 'former' && (
                  <button type="button" onClick={() => onDispose([c.occ_id])}>
                    Mark sold, traded, gifted…
                  </button>
                )}
                <button type="button" class="copy-list__remove" onClick={() => onRemove(c.occ_id)}>
                  Remove copy
                </button>
              </div>
            </li>
          )),
        )}
      </ul>
      <Style css={`
        .copy-list {
          margin-bottom: var(--space-5);
        }
        .copy-list__items {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .copy-list__item {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          padding: var(--space-2) 0;
          border-top: 1px solid var(--border-subtle);
        }
        .copy-list__what {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-2);
          align-items: baseline;
        }
        .copy-list__kind {
          font-weight: 600;
        }
        .copy-list__filed {
          font-size: var(--font-sm);
          color: var(--text-secondary);
        }
        .copy-list__actions {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-2);
        }
        .copy-list__actions button,
        .copy-list__dedupe {
          min-height: 36px;
          padding: 0 var(--space-3);
          border-radius: var(--radius-full);
          background: var(--surface-secondary);
          font-size: var(--font-sm);
        }
        .copy-list__dedupe {
          margin-bottom: var(--space-2);
          color: var(--brand-400);
        }
        .copy-list__actions .copy-list__remove {
          color: var(--accent-danger, #dc2626);
        }
      `} />
    </section>
  );
}

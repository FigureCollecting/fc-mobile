import { useState } from 'preact/hooks';
import type { Figure } from '@figurecollecting/fc-shared';
import { StatusBadge } from '../ui/StatusBadge';

interface FigureDetailContentProps {
  figure: Figure;
  index: number;
  total: number;
}

/**
 * The figure's data block — name, position counter, badges, and an
 * expandable detail list. Shared between the full-screen viewer's pull-up
 * sheet (Display D, < 640px) and the Fold-open dual-pane (>= 640px, Display
 * D'): same content component either way, just hosted differently.
 */
export function FigureDetailContent({ figure, index, total }: FigureDetailContentProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <button
        class="figure-viewer-sheet__handle"
        type="button"
        aria-label={expanded ? 'Collapse details' : 'Expand details'}
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
      >
        <span class="figure-viewer-sheet__grip" />
      </button>

      <div class="figure-viewer-sheet__head">
        <span class="figure-viewer-sheet__name">{figure.name}</span>
        <span class="figure-viewer-sheet__counter">
          {index + 1} of {total}
        </span>
      </div>

      <div class="figure-viewer-sheet__badges">
        {figure.scale && <span class="figure-viewer-sheet__scale">{figure.scale}</span>}
        {figure.manufacturer && <span class="figure-viewer-sheet__maker">{figure.manufacturer}</span>}
        {figure.collectionStatus && <StatusBadge status={figure.collectionStatus} size="sm" />}
      </div>

      {expanded && (
        <div class="figure-viewer-sheet__more">
          {figure.origin && (
            <div class="figure-viewer-sheet__row">
              <span class="figure-viewer-sheet__key">Origin</span>
              <span class="figure-viewer-sheet__val">{figure.origin}</span>
            </div>
          )}
          {figure.companyRoles?.map((role) =>
            role.companyName ? (
              <div key={role.companyId} class="figure-viewer-sheet__row">
                <span class="figure-viewer-sheet__key">{role.roleName ?? 'Company'}</span>
                <span class="figure-viewer-sheet__val">{role.companyName}</span>
              </div>
            ) : null,
          )}
          {figure.category && (
            <div class="figure-viewer-sheet__row">
              <span class="figure-viewer-sheet__key">Category</span>
              <span class="figure-viewer-sheet__val">{figure.category}</span>
            </div>
          )}
        </div>
      )}

      <style>{`
        .figure-viewer-sheet__handle {
          display: flex;
          justify-content: center;
          width: 100%;
          padding: var(--space-2) 0;
        }

        .figure-viewer-sheet__grip {
          width: 32px;
          height: 4px;
          border-radius: var(--radius-full);
          background: var(--text-tertiary);
        }

        .figure-viewer-sheet__head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: var(--space-2);
        }

        .figure-viewer-sheet__name {
          font-size: var(--font-base);
          font-weight: var(--font-weight-semibold);
          color: var(--text-primary);
          line-height: var(--line-height-ui);
          min-width: 0;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .figure-viewer-sheet__counter {
          font-size: var(--font-2xs);
          color: var(--text-tertiary);
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
        }

        .figure-viewer-sheet__badges {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          margin-top: var(--space-stack);
          flex-wrap: wrap;
        }

        .figure-viewer-sheet__scale {
          font-size: var(--font-2xs);
          font-weight: var(--font-weight-semibold);
          color: var(--brand-400);
          background: rgba(9, 103, 210, 0.16);
          padding: 2px 8px;
          border-radius: var(--radius-full);
        }

        .figure-viewer-sheet__maker {
          font-size: var(--font-xs);
          color: var(--text-secondary);
        }

        .figure-viewer-sheet__more {
          margin-top: var(--space-2);
          padding-top: var(--space-2);
          border-top: 1px solid var(--border-subtle);
          display: flex;
          flex-direction: column;
          gap: var(--space-stack);
        }

        .figure-viewer-sheet__row {
          display: flex;
          justify-content: space-between;
          gap: var(--space-3);
        }

        .figure-viewer-sheet__key {
          font-size: var(--font-xs);
          color: var(--text-tertiary);
          flex-shrink: 0;
        }

        .figure-viewer-sheet__val {
          font-size: var(--font-xs);
          color: var(--text-primary);
          text-align: right;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      `}</style>
    </>
  );
}

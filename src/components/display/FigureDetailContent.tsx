import { useLocation } from 'wouter';
import type { LocalMeta } from '../../local/figures';
import { SyncBadge } from '../sync/SyncBadge';
import type { Figure } from '@figurecollecting/fc-shared';
import { StatusBadge } from '../ui/StatusBadge';
import { Style } from '../../styles/Style';
import { usePhotoFit, type PhotoFit } from './photoFit';
import { describeSize } from './sizeBasis';

/** CARD-VIEW-1 part 3: the card's Go to, as its host offers it. */
export interface GoToAction {
  /** Takes the case to the figure (Collection decides whether the card closes first). */
  go: () => void;
  /** Why it has nowhere to go (the figure is on no shelf), or null. */
  blocked: string | null;
}

interface FigureDetailContentProps {
  figure: Figure;
  index: number;
  total: number;
  /** Runs before the full detail opens: a full-screen viewer closes itself first. */
  onBeforeOpen?: () => void;
  /** Go to, beside Copies and actions; absent: none. */
  goTo?: GoToAction;
}

/** Go to's icon: a target, the case's figure at its middle. */
export function GoToIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}

type Shown = Figure & { local?: Pick<LocalMeta, 'headId' | 'kind' | 'sync' | 'asOf'> & Partial<Pick<LocalMeta, 'character'>> };

/** Every field the figure has beyond the summary's badges (maker, scale, status, count), in reading order, as [label, value]; the ones it lacks are left out. */
function fieldsOf(figure: Shown, photoFit?: PhotoFit): [string, string][] {
  const rows: [string, string | null | undefined][] = [
    ['Origin', figure.origin],
    ['Character', figure.local?.character],
    ['Version', figure.version],
    ['Release', figure.releases?.find((r) => r.date)?.date],
    // SIZE-BASIS-1: the size the case draws, and what it rests on (the listing's, the scale's, a default, the photo's shape)
    ['Size', describeSize(figure, photoFit).line],
    ['Category', figure.category],
    ['Type', figure.classification],
    ['Materials', figure.materials],
    ...(figure.companyRoles ?? []).map((r): [string, string | undefined] => [r.roleName ?? 'Company', r.companyName]),
    ...(figure.artistRoles ?? []).map((r): [string, string | undefined] => [r.roleName ?? 'Artist', r.artistName]),
    ['JAN', figure.jan],
    ['Tags', figure.tags?.join(', ')],
    ['Rating', figure.rating === undefined ? undefined : String(figure.rating)],
    ['Note', figure.note],
  ];
  return rows.filter((r): r is [string, string] => typeof r[1] === 'string' && r[1] !== '');
}

/**
 * What "Copies and actions" does for this figure: the full page of its local item, in the place of the viewer's or pane's
 * history entry (Back from it returns to the collection), after `onBeforeOpen` (a full-screen viewer closes itself first);
 * null for a figure with no local item.
 */
export function useCopiesAction(figure: Figure, onBeforeOpen?: () => void): (() => void) | null {
  const [, setLocation] = useLocation();
  const local = (figure as Shown).local;
  if (local === undefined) return null;
  return () => {
    onBeforeOpen?.();
    setLocation(`/figure/${local.headId}`, { replace: true });
  };
}

/**
 * The figure's data block: its summary (name, position counter, badges, the way to its copies) and every
 * field it has, all at once (SHEETS-FB1: nothing hangs on tapping a handle). Shared between the full-screen
 * viewer's pull-up sheet (Display D, < 640px), which peeks at the summary and pulls up to the rest, and the
 * Fold-open dual-pane (>= 640px, Display D'), which shows it all.
 */
export function FigureDetailContent({ figure, index, total, onBeforeOpen, goTo }: FigureDetailContentProps) {
  const openCopies = useCopiesAction(figure, onBeforeOpen);
  // The local store's state of the item; fixture figures have none.
  const local = (figure as Shown).local;
  const quantity = figure.quantity ?? 1;
  const fields = fieldsOf(figure as Shown, usePhotoFit(figure._id));

  return (
    <>
      <div class="figure-viewer-sheet__summary">
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
        {quantity > 1 && <span class="figure-viewer-sheet__count">×{quantity}</span>}
        {local !== undefined && <SyncBadge sync={local.sync} asOf={local.asOf} id={`viewer-sync-${figure._id}`} />}
        {/* the card's actions, on the badges' line where they fit and on their own below where not, together either way: the
            summary stays short enough to peek on the sideways cover (CARD-VIEW-1) */}
        {(goTo !== undefined || openCopies !== null) && (
          <div class="figure-viewer-sheet__actions">
            {goTo !== undefined && (
              <button
                type="button"
                class="figure-viewer-sheet__goto"
                data-figure-id={figure._id}
                disabled={goTo.blocked !== null}
                aria-describedby={goTo.blocked === null ? undefined : `goto-why-${figure._id}`}
                onClick={goTo.go}
              >
                <GoToIcon />
                Go to
              </button>
            )}
            {openCopies !== null && (
              <button type="button" class="figure-viewer-sheet__open" onClick={openCopies}>
                Copies and actions
              </button>
            )}
            {goTo !== undefined && goTo.blocked !== null && (
              <span id={`goto-why-${figure._id}`} class="figure-viewer-sheet__goto-why">
                {goTo.blocked}
              </span>
            )}
          </div>
        )}
      </div>
      </div>

      {fields.length > 0 && (
        <dl class="figure-viewer-sheet__more">
          {fields.map(([key, value], i) => (
            <div key={`${key}-${i}`} class="figure-viewer-sheet__row">
              <dt class="figure-viewer-sheet__key">{key}</dt>
              <dd class="figure-viewer-sheet__val">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <Style css={`
        .figure-viewer-sheet__count {
          font-size: var(--font-xs);
          font-weight: 700;
          color: var(--brand-400);
        }

        /* the card's actions, one row: Go to (CARD-VIEW-1) and the way to its copies */
        .figure-viewer-sheet__actions {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: var(--space-2);
        }

        /* drawn as tall as Copies and actions; its target is a thumb's 48 px (6 px more above and below, where only text is) */
        .figure-viewer-sheet__goto {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-height: 36px;
          padding: 0 var(--space-3);
          border-radius: var(--radius-full);
          background: var(--surface-tertiary);
          color: var(--brand-400);
          font-size: var(--font-sm);
          font-weight: var(--font-weight-semibold);
        }

        .figure-viewer-sheet__goto::after {
          content: '';
          position: absolute;
          left: 0;
          right: 0;
          top: -6px;
          bottom: -6px;
        }

        .figure-viewer-sheet__goto:disabled {
          color: var(--text-tertiary);
          opacity: 0.7;
        }

        .figure-viewer-sheet__goto-why {
          font-size: var(--font-xs);
          color: var(--text-tertiary);
        }

        .figure-viewer-sheet__open {
          min-height: 36px;
          padding: 0 var(--space-3);
          border-radius: var(--radius-full);
          background: var(--surface-tertiary);
          font-size: var(--font-sm);
        }

        .figure-viewer-sheet__summary {
          padding-bottom: var(--space-1);
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
          margin: var(--space-2) 0 0;
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
          margin: 0;
          font-size: var(--font-xs);
          color: var(--text-primary);
          text-align: right;
          min-width: 0;
          overflow-wrap: anywhere;
        }
      `} />
    </>
  );
}

import { useState, useMemo } from 'preact/hooks';
import type { Figure } from '@figurecollecting/fc-shared';
import { DetentSheet } from '../ui/DetentSheet';
import { FacetControl } from './FacetControl';
import { TAB_LABEL } from './holdings';
import { getFacet } from '../../utils/facets';
import { COLLECTION_TABS, type CollectionTab, type ListFilters } from '../../hooks/useFigureListParams';
import { hapticLight } from '../../utils/haptics';
import { Style } from '../../styles/Style';

type FilterTab = 'maker' | 'scale' | 'tags';

const TABS: { id: FilterTab; label: string }[] = [
  { id: 'maker', label: 'Maker' },
  { id: 'scale', label: 'Scale' },
  { id: 'tags', label: 'Tags' },
];

const SORT_OPTIONS = [
  { value: 'activity', label: 'Added' },
  { value: 'name', label: 'Name' },
  { value: 'releaseDate', label: 'Release' },
];

interface TabbedFilterSheetProps {
  open: boolean;
  onClose: () => void;
  /** The chosen holdings' figures, before the facets: the facet values and their counts come from them. */
  figures: Figure[];
  filters: ListFilters;
  /** Every filter at its default: what Clear goes back to. */
  defaults: ListFilters;
  /** Each holding's count, on its choice. */
  holdings: Record<CollectionTab, number>;
  /** What the grid shows, of what the chosen holdings hold: the live count. */
  shown: number;
  total: number;
  sort: string;
  order: 'asc' | 'desc';
  /** Every change applies at once, to the grid behind the card. */
  onApply: (filters: ListFilters) => void;
  onSort: (sort: string, order: 'asc' | 'desc') => void;
}

/**
 * Refine: a draggable detented (half/full) card with the TAB STRIP AT THE
 * BOTTOM, under the thumb. Tab 1 Maker+Distributor, tab 2 Scale+Origin, tab 3
 * Tags (facet grows as tagging expands); above them the holdings (Owned,
 * Ordered, Wished, No longer owned, several at once, each with its count) and
 * the sort. Every change applies LIVE to the grid behind it (SHEETS-FB1), the
 * card shows what it shows of the total ("312 of 559"); Done closes it and
 * Clear puts every filter back to its default. The last chosen holding cannot
 * be taken off (a tap on it does nothing): there is no empty choice.
 */
export function TabbedFilterSheet({
  open,
  onClose,
  figures,
  filters,
  defaults,
  holdings,
  shown,
  total,
  sort,
  order,
  onApply,
  onSort,
}: TabbedFilterSheetProps) {
  const [tab, setTab] = useState<FilterTab>('maker');

  const toggle = (key: keyof ListFilters, value: string) => {
    const list = filters[key];
    // the last chosen holding stays: no holding chosen would show what no choice says (Clear goes back to the defaults)
    if (key === 'status' && list.length === 1 && list[0] === value) return;
    onApply({ ...filters, [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] });
  };

  const facets = useMemo(
    () => ({
      mfr: getFacet(figures, 'mfr'),
      dist: getFacet(figures, 'dist'),
      scale: getFacet(figures, 'scale'),
      origin: getFacet(figures, 'origin'),
      tag: getFacet(figures, 'tag'),
    }),
    [figures],
  );

  const footer = (
    <div class="filter-sheet2__footer">
      <div class="filter-sheet2__tabs" role="tablist" aria-label="Filter groups">
        {TABS.map((t) => (
          <button
            key={t.id}
            class={`filter-sheet2__tab ${tab === t.id ? 'filter-sheet2__tab--active' : ''}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => { hapticLight(); setTab(t.id); }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div class="filter-sheet2__actions">
        <button class="filter-sheet2__btn filter-sheet2__btn--clear" type="button" onClick={() => onApply(defaults)}>
          Clear
        </button>
        <button class="filter-sheet2__btn filter-sheet2__btn--done" type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );

  return (
    <DetentSheet open={open} onClose={onClose} footer={footer}>
      <div class="filter-sheet2">
        {/* Quick facets shared by every tab */}
        <section class="filter-sheet2__quick">
          <p class="filter-sheet2__count" aria-live="polite">{`${shown} of ${total}`}</p>
          <div class="filter-sheet2__status" role="group" aria-label="Holding">
            {COLLECTION_TABS.map((h) => {
              const active = filters.status.includes(h);
              return (
                <button
                  key={h}
                  class={`filter-sheet2__status-chip ${active ? 'filter-sheet2__status-chip--active' : ''}`}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggle('status', h)}
                >
                  {TAB_LABEL[h]}
                  <span class="filter-sheet2__status-count">{holdings[h]}</span>
                </button>
              );
            })}
          </div>
          <div class="filter-sheet2__sort" role="group" aria-label="Sort">
            {SORT_OPTIONS.map((o) => (
              <button
                key={o.value}
                class={`filter-sheet2__sort-chip ${sort === o.value ? 'filter-sheet2__sort-chip--active' : ''}`}
                type="button"
                onClick={() => onSort(o.value, order)}
              >
                {o.label}
              </button>
            ))}
            <button
              class="filter-sheet2__order"
              type="button"
              aria-label={`Sort ${order === 'asc' ? 'ascending' : 'descending'}`}
              onClick={() => onSort(sort, order === 'asc' ? 'desc' : 'asc')}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                style={{ transform: order === 'desc' ? 'rotate(180deg)' : 'none' }}
              >
                <path d="M12 5v14" />
                <path d="M19 12l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </section>

        {tab === 'maker' && (
          <div role="tabpanel">
            <FacetControl
              label="Manufacturer"
              values={facets.mfr}
              selected={filters.mfr}
              onToggle={(v) => toggle('mfr', v)}
            />
            <FacetControl
              label="Distributor"
              values={facets.dist}
              selected={filters.dist}
              onToggle={(v) => toggle('dist', v)}
            />
          </div>
        )}

        {tab === 'scale' && (
          <div role="tabpanel">
            <FacetControl
              label="Scale"
              values={facets.scale}
              selected={filters.scale}
              onToggle={(v) => toggle('scale', v)}
            />
            <FacetControl
              label="Origin"
              values={facets.origin}
              selected={filters.origin}
              onToggle={(v) => toggle('origin', v)}
            />
          </div>
        )}

        {tab === 'tags' && (
          <div role="tabpanel">
            <FacetControl
              label="Tags"
              values={facets.tag}
              selected={filters.tag}
              onToggle={(v) => toggle('tag', v)}
              hint="many more tags coming soon"
            />
          </div>
        )}
      </div>

      <Style css={`
        .filter-sheet2 {
          padding-bottom: var(--space-3);
        }

        .filter-sheet2__quick {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          margin-bottom: var(--space-4);
        }

        .filter-sheet2__status,
        .filter-sheet2__sort {
          display: flex;
          align-items: center;
          gap: var(--space-gap);
          flex-wrap: wrap;
        }

        .filter-sheet2__status-chip,
        .filter-sheet2__sort-chip {
          min-height: 32px;
          padding: var(--space-1) var(--space-3);
          border-radius: var(--radius-full);
          background: var(--surface-tertiary);
          border: 1px solid var(--border-subtle);
          font-size: var(--font-xs);
          color: var(--text-secondary);
        }

        .filter-sheet2__count {
          margin: 0;
          font-size: var(--font-sm);
          font-weight: var(--font-weight-semibold);
          color: var(--text-primary);
          font-variant-numeric: tabular-nums;
        }

        .filter-sheet2__status-count {
          margin-left: 6px;
          color: var(--text-tertiary);
          font-variant-numeric: tabular-nums;
        }

        .filter-sheet2__status-chip--active,
        .filter-sheet2__sort-chip--active {
          background: rgba(9, 103, 210, 0.15);
          border-color: var(--brand-500);
          color: var(--brand-400);
          font-weight: var(--font-weight-medium);
        }

        .filter-sheet2__order {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: var(--radius-full);
          background: var(--surface-tertiary);
          color: var(--text-secondary);
        }

        /* footer: TABS AT THE BOTTOM + apply row */
        .filter-sheet2__footer {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .filter-sheet2__tabs {
          display: flex;
          gap: var(--space-1);
          background: var(--surface-tertiary);
          border-radius: var(--radius-md);
          padding: 2px;
        }

        .filter-sheet2__tab {
          flex: 1;
          min-height: 36px;
          border-radius: calc(var(--radius-md) - 2px);
          font-size: var(--font-sm);
          font-weight: var(--font-weight-medium);
          color: var(--text-tertiary);
        }

        .filter-sheet2__tab--active {
          background: var(--surface-secondary);
          color: var(--brand-400);
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
        }

        .filter-sheet2__actions {
          display: flex;
          gap: var(--space-2);
        }

        .filter-sheet2__btn {
          min-height: 42px;
          border-radius: var(--radius-md);
          font-size: var(--font-sm);
          font-weight: var(--font-weight-semibold);
        }

        .filter-sheet2__btn--clear {
          flex: 1;
          background: var(--surface-tertiary);
          color: var(--text-secondary);
        }

        .filter-sheet2__btn--done {
          flex: 2;
          background: var(--brand-500);
          color: white;
        }

        .filter-sheet2__btn--done:active {
          background: var(--brand-600);
        }
      `} />
    </DetentSheet>
  );
}

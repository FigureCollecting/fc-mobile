import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
import type { Figure } from '@figurecollecting/fc-shared';
import { DetentSheet } from '../ui/DetentSheet';
import { FacetControl } from './FacetControl';
import { getFacet, applyFilters } from '../../utils/facets';
import type { ListFilters } from '../../hooks/useFigureListParams';
import { hapticLight } from '../../utils/haptics';

type FilterTab = 'maker' | 'scale' | 'tags';

const TABS: { id: FilterTab; label: string }[] = [
  { id: 'maker', label: 'Maker' },
  { id: 'scale', label: 'Scale' },
  { id: 'tags', label: 'Tags' },
];

const STATUS_VALUES = ['owned', 'ordered', 'wished'];

const SORT_OPTIONS = [
  { value: 'activity', label: 'Added' },
  { value: 'name', label: 'Name' },
  { value: 'releaseDate', label: 'Release' },
];

interface TabbedFilterSheetProps {
  open: boolean;
  onClose: () => void;
  /** Full (unfiltered) figure set — facet values, counts and the live result count come from it. */
  figures: Figure[];
  filters: ListFilters;
  sort: string;
  order: 'asc' | 'desc';
  onApply: (filters: ListFilters) => void;
  onSort: (sort: string, order: 'asc' | 'desc') => void;
}

/**
 * The tabbed filter sheet: detented (half/full) bottom sheet with the TAB
 * STRIP AT THE BOTTOM, under the thumb. Tab 1 Maker+Distributor, tab 2
 * Scale+Origin, tab 3 Tags (facet grows as tagging expands). Every control
 * is cardinality-aware and the apply button carries a live result count.
 */
export function TabbedFilterSheet({
  open,
  onClose,
  figures,
  filters,
  sort,
  order,
  onApply,
  onSort,
}: TabbedFilterSheetProps) {
  const [tab, setTab] = useState<FilterTab>('maker');
  const [draft, setDraft] = useState<ListFilters>(filters);

  // Re-seed the draft each time the sheet opens.
  useEffect(() => {
    if (open) setDraft(filters);
  }, [open, filters]);

  const toggle = useCallback((key: keyof ListFilters, value: string) => {
    setDraft((prev) => {
      const list = prev[key];
      const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
      return { ...prev, [key]: next };
    });
  }, []);

  const liveCount = useMemo(() => applyFilters(figures, draft).length, [figures, draft]);

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

  const handleApply = useCallback(() => {
    onApply(draft);
    onClose();
  }, [draft, onApply, onClose]);

  const handleClear = useCallback(() => {
    setDraft((prev) => ({
      ...prev,
      status: [],
      mfr: [],
      dist: [],
      scale: [],
      origin: [],
      tag: [],
    }));
  }, []);

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
        <button class="filter-sheet2__btn filter-sheet2__btn--clear" type="button" onClick={handleClear}>
          Clear
        </button>
        <button class="filter-sheet2__btn filter-sheet2__btn--apply" type="button" onClick={handleApply}>
          Show {liveCount}
        </button>
      </div>
    </div>
  );

  return (
    <DetentSheet open={open} onClose={onClose} footer={footer}>
      <div class="filter-sheet2">
        {/* Quick facets shared by every tab */}
        <section class="filter-sheet2__quick">
          <div class="filter-sheet2__status" role="group" aria-label="Collection status">
            {STATUS_VALUES.map((s) => {
              const active = draft.status.includes(s);
              return (
                <button
                  key={s}
                  class={`filter-sheet2__status-chip ${active ? 'filter-sheet2__status-chip--active' : ''}`}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggle('status', s)}
                >
                  {s}
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
              selected={draft.mfr}
              onToggle={(v) => toggle('mfr', v)}
            />
            <FacetControl
              label="Distributor"
              values={facets.dist}
              selected={draft.dist}
              onToggle={(v) => toggle('dist', v)}
            />
          </div>
        )}

        {tab === 'scale' && (
          <div role="tabpanel">
            <FacetControl
              label="Scale"
              values={facets.scale}
              selected={draft.scale}
              onToggle={(v) => toggle('scale', v)}
            />
            <FacetControl
              label="Origin"
              values={facets.origin}
              selected={draft.origin}
              onToggle={(v) => toggle('origin', v)}
            />
          </div>
        )}

        {tab === 'tags' && (
          <div role="tabpanel">
            <FacetControl
              label="Tags"
              values={facets.tag}
              selected={draft.tag}
              onToggle={(v) => toggle('tag', v)}
              hint="many more tags coming soon"
            />
          </div>
        )}
      </div>

      <style>{`
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
          text-transform: capitalize;
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

        .filter-sheet2__btn--apply {
          flex: 2;
          background: var(--brand-500);
          color: white;
        }

        .filter-sheet2__btn--apply:active {
          background: var(--brand-600);
        }
      `}</style>
    </DetentSheet>
  );
}

import type { ListFilters } from '../../hooks/useFigureListParams';
import { countActiveFilters } from '../../utils/facets';
import { hapticLight } from '../../utils/haptics';

interface FilterBarProps {
  filters: ListFilters;
  sort: string;
  order: 'asc' | 'desc';
  resultCount: number;
  onOpen: () => void;
}

const SORT_LABEL: Record<string, string> = {
  activity: 'Added',
  name: 'Name',
  releaseDate: 'Release',
};

/** Slim Filter | Sort bar — one row, opens the tabbed filter sheet. */
export function FilterBar({ filters, sort, order, resultCount, onOpen }: FilterBarProps) {
  const active = countActiveFilters(filters);

  return (
    <div class="filter-bar">
      <button class="filter-bar__btn" type="button" onClick={() => { hapticLight(); onOpen(); }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
        </svg>
        <span>Filter</span>
        {active > 0 && <span class="filter-bar__badge">{active}</span>}
      </button>
      <span class="filter-bar__divider" />
      <button class="filter-bar__btn" type="button" onClick={() => { hapticLight(); onOpen(); }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 5h10M11 9h7M11 13h4" />
          <path d="M3 17l3 3 3-3M6 18V4" />
        </svg>
        <span>
          {SORT_LABEL[sort] ?? sort} {order === 'asc' ? '↑' : '↓'}
        </span>
      </button>
      <span class="filter-bar__count">{resultCount}</span>

      <style>{`
        .filter-bar {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          height: var(--filter-bar-height);
          padding: 0 var(--space-page);
        }

        .filter-bar__btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 28px;
          padding: 0 var(--space-2);
          border-radius: var(--radius-full);
          font-size: var(--font-xs);
          font-weight: var(--font-weight-medium);
          color: var(--text-secondary);
          background: var(--surface-secondary);
          border: 1px solid var(--border-subtle);
        }

        .filter-bar__btn:active {
          background: var(--surface-tertiary);
        }

        .filter-bar__badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 16px;
          height: 16px;
          padding: 0 4px;
          border-radius: var(--radius-full);
          background: var(--brand-500);
          color: white;
          font-size: var(--font-2xs);
          font-weight: var(--font-weight-semibold);
        }

        .filter-bar__divider {
          width: 1px;
          height: 16px;
          background: var(--border-subtle);
        }

        .filter-bar__count {
          margin-left: auto;
          font-size: var(--font-xs);
          color: var(--text-tertiary);
          font-variant-numeric: tabular-nums;
        }
      `}</style>
    </div>
  );
}

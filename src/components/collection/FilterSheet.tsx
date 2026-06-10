import { useState, useCallback } from 'preact/hooks';
import { BottomSheet } from '../ui/BottomSheet';
import type { CollectionStatus } from '@figurecollecting/fc-shared';

export interface FilterState {
  statuses: CollectionStatus[];
  manufacturer: string | null;
  scale: string | null;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

export const DEFAULT_FILTERS: FilterState = {
  statuses: [],
  manufacturer: null,
  scale: null,
  sortBy: 'activity',
  sortOrder: 'asc',
};

interface FilterSheetProps {
  open: boolean;
  onClose: () => void;
  filters: FilterState;
  onApply: (filters: FilterState) => void;
}

const STATUS_OPTIONS: { value: CollectionStatus; label: string }[] = [
  { value: 'owned', label: 'Owned' },
  { value: 'ordered', label: 'Ordered' },
  { value: 'wished', label: 'Wished' },
];

const SCALE_OPTIONS = ['1/4', '1/6', '1/7', '1/8'];

const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'activity', label: 'Date Added' },
  { value: 'releaseDate', label: 'Release Date' },
  { value: 'price', label: 'Price' },
];

export function FilterSheet({ open, onClose, filters, onApply }: FilterSheetProps) {
  const [local, setLocal] = useState<FilterState>(filters);

  const toggleStatus = useCallback((status: CollectionStatus) => {
    setLocal((prev) => {
      const has = prev.statuses.includes(status);
      return {
        ...prev,
        statuses: has
          ? prev.statuses.filter((s) => s !== status)
          : [...prev.statuses, status],
      };
    });
  }, []);

  const setScale = useCallback((scale: string | null) => {
    setLocal((prev) => ({
      ...prev,
      scale: prev.scale === scale ? null : scale,
    }));
  }, []);

  const setSortBy = useCallback((sortBy: string) => {
    setLocal((prev) => ({ ...prev, sortBy }));
  }, []);

  const toggleSortOrder = useCallback(() => {
    setLocal((prev) => ({
      ...prev,
      sortOrder: prev.sortOrder === 'asc' ? 'desc' : 'asc',
    }));
  }, []);

  const handleApply = useCallback(() => {
    onApply(local);
    onClose();
  }, [local, onApply, onClose]);

  const handleClear = useCallback(() => {
    const cleared = { ...DEFAULT_FILTERS };
    setLocal(cleared);
    onApply(cleared);
    onClose();
  }, [onApply, onClose]);

  return (
    <BottomSheet open={open} onClose={onClose} snapPoint="half">
      <div class="filter-sheet">
        <div class="filter-sheet__header">
          <h2 class="filter-sheet__title">Filters</h2>
        </div>

        {/* Collection Status */}
        <section class="filter-sheet__section">
          <h3 class="filter-sheet__section-title">Collection Status</h3>
          <div class="filter-sheet__checkboxes">
            {STATUS_OPTIONS.map((opt) => {
              const checked = local.statuses.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  class={`filter-sheet__checkbox ${checked ? 'filter-sheet__checkbox--checked' : ''}`}
                  onClick={() => toggleStatus(opt.value)}
                  type="button"
                  aria-pressed={checked}
                >
                  <span class="filter-sheet__check-icon">
                    {checked ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--brand-500)" stroke="none">
                        <rect x="2" y="2" width="20" height="20" rx="4" />
                        <path d="M9 12l2 2 4-4" stroke="white" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2">
                        <rect x="2" y="2" width="20" height="20" rx="4" />
                      </svg>
                    )}
                  </span>
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Scale */}
        <section class="filter-sheet__section">
          <h3 class="filter-sheet__section-title">Scale</h3>
          <div class="filter-sheet__chips">
            {SCALE_OPTIONS.map((scale) => (
              <button
                key={scale}
                class={`filter-sheet__chip ${local.scale === scale ? 'filter-sheet__chip--active' : ''}`}
                onClick={() => setScale(scale)}
                type="button"
              >
                {scale}
              </button>
            ))}
          </div>
        </section>

        {/* Sort By */}
        <section class="filter-sheet__section">
          <h3 class="filter-sheet__section-title">Sort By</h3>
          <div class="filter-sheet__chips">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                class={`filter-sheet__chip ${local.sortBy === opt.value ? 'filter-sheet__chip--active' : ''}`}
                onClick={() => setSortBy(opt.value)}
                type="button"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        {/* Sort Order */}
        <section class="filter-sheet__section">
          <h3 class="filter-sheet__section-title">Sort Order</h3>
          <button
            class="filter-sheet__sort-order"
            onClick={toggleSortOrder}
            type="button"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              style={{ transform: local.sortOrder === 'desc' ? 'rotate(180deg)' : 'none' }}
            >
              <path d="M12 5v14" />
              <path d="M19 12l-7 7-7-7" />
            </svg>
            <span>{local.sortOrder === 'asc' ? 'Ascending' : 'Descending'}</span>
          </button>
        </section>

        {/* Actions */}
        <div class="filter-sheet__actions">
          <button
            class="filter-sheet__btn filter-sheet__btn--clear"
            onClick={handleClear}
            type="button"
          >
            Clear All
          </button>
          <button
            class="filter-sheet__btn filter-sheet__btn--apply"
            onClick={handleApply}
            type="button"
          >
            Apply
          </button>
        </div>
      </div>

      <style>{`
        .filter-sheet {
          padding-bottom: var(--space-4);
        }

        .filter-sheet__header {
          margin-bottom: var(--space-4);
        }

        .filter-sheet__title {
          font-size: var(--font-lg);
          font-weight: var(--font-weight-bold);
          color: var(--text-primary);
        }

        .filter-sheet__section {
          margin-bottom: var(--space-5);
        }

        .filter-sheet__section-title {
          font-size: var(--font-xs);
          font-weight: var(--font-weight-semibold);
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: var(--space-3);
        }

        /* Checkboxes */
        .filter-sheet__checkboxes {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
        }

        .filter-sheet__checkbox {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          min-height: var(--touch-min);
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-md);
          font-size: var(--font-sm);
          color: var(--text-primary);
          transition: background var(--transition-fast);
        }

        .filter-sheet__checkbox:active {
          background: var(--surface-tertiary);
        }

        .filter-sheet__check-icon {
          display: flex;
          align-items: center;
          flex-shrink: 0;
        }

        /* Chips */
        .filter-sheet__chips {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-2);
        }

        .filter-sheet__chip {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 40px;
          padding: var(--space-2) var(--space-4);
          background: var(--surface-tertiary);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-full);
          font-size: var(--font-sm);
          color: var(--text-secondary);
          transition: all var(--transition-fast);
        }

        .filter-sheet__chip--active {
          background: rgba(9, 103, 210, 0.15);
          border-color: var(--brand-500);
          color: var(--brand-400);
          font-weight: var(--font-weight-medium);
        }

        /* Sort order toggle */
        .filter-sheet__sort-order {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          min-height: var(--touch-min);
          padding: var(--space-2) var(--space-3);
          color: var(--text-primary);
          font-size: var(--font-sm);
          border-radius: var(--radius-md);
        }

        .filter-sheet__sort-order:active {
          background: var(--surface-tertiary);
        }

        /* Action buttons */
        .filter-sheet__actions {
          display: flex;
          gap: var(--space-3);
          margin-top: var(--space-6);
        }

        .filter-sheet__btn {
          flex: 1;
          min-height: var(--touch-min);
          border-radius: var(--radius-md);
          font-size: var(--font-sm);
          font-weight: var(--font-weight-semibold);
          transition: all var(--transition-fast);
        }

        .filter-sheet__btn--clear {
          background: var(--surface-tertiary);
          color: var(--text-secondary);
        }

        .filter-sheet__btn--clear:active {
          background: var(--surface-elevated);
        }

        .filter-sheet__btn--apply {
          background: var(--brand-500);
          color: white;
        }

        .filter-sheet__btn--apply:active {
          background: var(--brand-600);
        }
      `}</style>
    </BottomSheet>
  );
}

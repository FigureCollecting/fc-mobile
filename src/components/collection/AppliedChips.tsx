import type { CollectionTab, ListFilters } from '../../hooks/useFigureListParams';
import { isDefaultFilters } from '../../utils/facets';
import { TAB_LABEL } from './holdings';
import { Style } from '../../styles/Style';

interface AppliedChipsProps {
  filters: ListFilters;
  /** Every filter at its default: nothing filtered. */
  defaults: ListFilters;
  /** What the grid shows, of what the chosen holdings hold. */
  shown: number;
  total: number;
  onChange: (filters: ListFilters) => void;
}

interface Chip {
  key: keyof ListFilters;
  value: string;
  label: string;
}

/**
 * The page's filter row (SHEETS-FB1): the applied filters as removable chips and what shows of the total
 * ("312 of 559"); gone entirely while nothing is filtered (every filter its default and nothing hidden by
 * them). While it shows, the defaults (the holdings, Category=Prepainted, type=Figures) show as chips too,
 * so what hides a figure stays visible and removable.
 */
export function AppliedChips({ filters, defaults, shown, total, onChange }: AppliedChipsProps) {
  if (shown >= total && isDefaultFilters(filters, defaults)) return null;
  const chips: Chip[] = filters.status.map((value) => ({ key: 'status', value, label: TAB_LABEL[value as CollectionTab] }));
  const push = (key: keyof ListFilters, values: string[], prefix?: string) => {
    for (const value of values) {
      chips.push({ key, value, label: prefix ? `${prefix}: ${value}` : value });
    }
  };

  push('mfr', filters.mfr);
  push('dist', filters.dist, 'Dist');
  push('scale', filters.scale);
  push('origin', filters.origin);
  push('cat', filters.cat);
  push('type', filters.type);
  push('tag', filters.tag, 'Tag');

  const remove = (chip: Chip) => {
    onChange({
      ...filters,
      [chip.key]: filters[chip.key].filter((v) => v !== chip.value),
    });
  };

  return (
    <div class="applied-chips">
      <div class="applied-chips__list" role="list" aria-label="Applied filters">
      {chips.map((chip) => (
        <button
          key={`${chip.key}:${chip.value}`}
          class="applied-chips__chip"
          type="button"
          role="listitem"
          aria-label={`Remove filter ${chip.label}`}
          onClick={() => remove(chip)}
        >
          <span class="applied-chips__label">{chip.label}</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      ))}
      </div>
      <span class="applied-chips__count">{`${shown} of ${total}`}</span>

      <Style css={`
        .applied-chips {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-1) var(--space-page) var(--space-2);
        }

        .applied-chips__list {
          display: flex;
          flex: 1;
          min-width: 0;
          gap: var(--space-1);
          overflow-x: auto;
          scrollbar-width: none;
        }

        .applied-chips__chip {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          flex-shrink: 0;
          height: 26px;
          padding: 0 var(--space-2);
          border-radius: var(--radius-full);
          background: rgba(9, 103, 210, 0.14);
          border: 1px solid rgba(9, 103, 210, 0.45);
          color: var(--brand-400);
          font-size: var(--font-2xs);
          font-weight: var(--font-weight-medium);
          white-space: nowrap;
        }

        .applied-chips__chip:active {
          opacity: 0.7;
        }

        .applied-chips__count {
          flex-shrink: 0;
          font-size: var(--font-xs);
          color: var(--text-tertiary);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
      `} />
    </div>
  );
}

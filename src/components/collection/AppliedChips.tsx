import type { ListFilters } from '../../hooks/useFigureListParams';

interface AppliedChipsProps {
  filters: ListFilters;
  onChange: (filters: ListFilters) => void;
}

interface Chip {
  key: keyof ListFilters;
  value: string;
  label: string;
}

/**
 * Applied filters as removable chips pinned above the grid. Preselected
 * defaults (Category=Prepainted, type=Figures) appear here too, so defaults
 * stay honest and visible — removing one clears it like any other filter.
 */
export function AppliedChips({ filters, onChange }: AppliedChipsProps) {
  const chips: Chip[] = [];
  const push = (key: keyof ListFilters, values: string[], prefix?: string) => {
    for (const value of values) {
      chips.push({ key, value, label: prefix ? `${prefix}: ${value}` : value });
    }
  };

  push('status', filters.status);
  push('mfr', filters.mfr);
  push('dist', filters.dist, 'Dist');
  push('scale', filters.scale);
  push('origin', filters.origin);
  push('cat', filters.cat);
  push('type', filters.type);
  push('tag', filters.tag, 'Tag');

  if (chips.length === 0) return null;

  const remove = (chip: Chip) => {
    onChange({
      ...filters,
      [chip.key]: filters[chip.key].filter((v) => v !== chip.value),
    });
  };

  return (
    <div class="applied-chips" role="list" aria-label="Applied filters">
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

      <style>{`
        .applied-chips {
          display: flex;
          gap: var(--space-1);
          padding: var(--space-1) var(--space-page) var(--space-2);
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
      `}</style>
    </div>
  );
}

import { useState, useMemo } from 'preact/hooks';
import type { FacetValue } from '../../utils/facets';

interface FacetControlProps {
  label: string;
  values: FacetValue[];
  selected: string[];
  onToggle: (value: string) => void;
  /** Optional hint under the label (e.g. tags placeholder note). */
  hint?: string;
}

/** Above this many values the control switches to shortlist + type-ahead. */
const CHIP_LIMIT = 8;

/**
 * Cardinality-aware facet control — the DATA's shape decides the
 * presentation. Small facets (Scale, Status) render as a count-sorted chip
 * row; large ones (Manufacturer, Origin) render a top-N shortlist plus a
 * type-ahead over the full value list.
 */
export function FacetControl({ label, values, selected, onToggle, hint }: FacetControlProps) {
  const [query, setQuery] = useState('');
  const large = values.length > CHIP_LIMIT;

  const shortlist = useMemo(() => {
    if (!large) return values;
    // Selected values always visible, then top-by-count.
    const picked = values.filter((v) => selected.includes(v.value));
    const rest = values.filter((v) => !selected.includes(v.value));
    return [...picked, ...rest].slice(0, CHIP_LIMIT);
  }, [values, selected, large]);

  const matches = useMemo(() => {
    if (!large || !query.trim()) return [];
    const q = query.trim().toLowerCase();
    return values.filter((v) => v.value.toLowerCase().includes(q)).slice(0, 24);
  }, [values, query, large]);

  return (
    <section class="facet-control">
      <h3 class="facet-control__label">
        {label}
        {hint && <span class="facet-control__hint">{hint}</span>}
      </h3>

      <div class="facet-control__chips">
        {shortlist.map((v) => {
          const active = selected.includes(v.value);
          return (
            <button
              key={v.value}
              class={`facet-control__chip ${active ? 'facet-control__chip--active' : ''}`}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(v.value)}
            >
              {v.value}
              <span class="facet-control__count">{v.count}</span>
            </button>
          );
        })}
        {values.length === 0 && <span class="facet-control__empty">No values yet</span>}
      </div>

      {large && (
        <div class="facet-control__search">
          <input
            type="search"
            class="facet-control__input"
            placeholder={`Search ${values.length} ${label.toLowerCase()}…`}
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            aria-label={`Search ${label}`}
          />
          {matches.length > 0 && (
            <div class="facet-control__matches" role="listbox">
              {matches.map((v) => {
                const active = selected.includes(v.value);
                return (
                  <button
                    key={v.value}
                    class={`facet-control__match ${active ? 'facet-control__match--active' : ''}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onToggle(v.value);
                      setQuery('');
                    }}
                  >
                    <span class="facet-control__match-name">{v.value}</span>
                    <span class="facet-control__count">{v.count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <style>{`
        .facet-control {
          margin-bottom: var(--space-4);
        }

        .facet-control__label {
          display: flex;
          align-items: baseline;
          gap: var(--space-2);
          font-size: var(--font-xs);
          font-weight: var(--font-weight-semibold);
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: var(--space-2);
        }

        .facet-control__hint {
          font-size: var(--font-2xs);
          font-weight: var(--font-weight-normal);
          color: var(--text-tertiary);
          text-transform: none;
          letter-spacing: 0;
        }

        .facet-control__chips {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-gap);
        }

        .facet-control__chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-height: 34px;
          padding: var(--space-1) var(--space-3);
          background: var(--surface-tertiary);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-full);
          font-size: var(--font-sm);
          color: var(--text-secondary);
          transition: all var(--transition-fast);
        }

        .facet-control__chip--active {
          background: rgba(9, 103, 210, 0.15);
          border-color: var(--brand-500);
          color: var(--brand-400);
          font-weight: var(--font-weight-medium);
        }

        .facet-control__count {
          font-size: var(--font-2xs);
          color: var(--text-tertiary);
          font-variant-numeric: tabular-nums;
        }

        .facet-control__empty {
          font-size: var(--font-xs);
          color: var(--text-tertiary);
        }

        .facet-control__search {
          margin-top: var(--space-2);
        }

        .facet-control__input {
          width: 100%;
          /* 16px floor — iOS zoom guard */
          font-size: var(--font-input, 1rem);
          padding: var(--space-2) var(--space-3);
          min-height: 40px;
        }

        .facet-control__matches {
          margin-top: var(--space-1);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          overflow: hidden;
          max-height: 180px;
          overflow-y: auto;
        }

        .facet-control__match {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-2);
          width: 100%;
          min-height: 38px;
          padding: var(--space-1) var(--space-3);
          font-size: var(--font-sm);
          color: var(--text-primary);
          text-align: left;
        }

        .facet-control__match--active {
          color: var(--brand-400);
          background: rgba(9, 103, 210, 0.1);
        }

        .facet-control__match:active {
          background: var(--surface-tertiary);
        }
      `}</style>
    </section>
  );
}

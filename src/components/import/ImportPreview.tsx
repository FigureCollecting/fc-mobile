import { useState, useCallback, useMemo } from 'preact/hooks';
import type { CollectionStatus } from '@figurecollecting/fc-shared';

export interface ImportItem {
  /** Index in the original parsed array */
  index: number;
  name: string;
  manufacturer: string;
  scale: string;
  status: CollectionStatus;
  /** Whether this item is selected for import */
  selected: boolean;
  /** Raw parsed data for this row */
  raw: Record<string, unknown>;
}

interface ImportPreviewProps {
  items: ImportItem[];
  onToggle: (index: number) => void;
  onToggleAll: (selected: boolean) => void;
}

function StatusDot({ status }: { status: CollectionStatus }) {
  const color =
    status === 'owned'
      ? 'var(--accent-success)'
      : status === 'ordered'
        ? 'var(--accent-info)'
        : 'var(--accent-warning)';

  return (
    <span
      class="import-preview__status-dot"
      style={{ background: color }}
      title={status}
    />
  );
}

export function ImportPreview({ items, onToggle, onToggleAll }: ImportPreviewProps) {
  const [filterStatus, setFilterStatus] = useState<CollectionStatus | 'all'>('all');

  const selectedCount = useMemo(() => items.filter((i) => i.selected).length, [items]);
  const allSelected = selectedCount === items.length && items.length > 0;

  const filteredItems = useMemo(() => {
    if (filterStatus === 'all') return items;
    return items.filter((i) => i.status === filterStatus);
  }, [items, filterStatus]);

  const handleToggleAll = useCallback(() => {
    onToggleAll(!allSelected);
  }, [allSelected, onToggleAll]);

  const handleFilterChange = useCallback((e: Event) => {
    setFilterStatus((e.target as HTMLSelectElement).value as CollectionStatus | 'all');
  }, []);

  return (
    <div class="import-preview">
      {/* Header row */}
      <div class="import-preview__header">
        <div class="import-preview__count">
          {selectedCount} of {items.length} items selected
        </div>
        <select
          class="import-preview__filter"
          value={filterStatus}
          onChange={handleFilterChange}
        >
          <option value="all">All</option>
          <option value="owned">Owned</option>
          <option value="ordered">Ordered</option>
          <option value="wished">Wished</option>
        </select>
      </div>

      {/* Toggle all */}
      <button
        class="import-preview__toggle-all"
        type="button"
        onClick={handleToggleAll}
      >
        <span class={`import-preview__checkbox ${allSelected ? 'import-preview__checkbox--checked' : ''}`}>
          {allSelected && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </span>
        <span>{allSelected ? 'Deselect All' : 'Select All'}</span>
      </button>

      {/* Item list */}
      <div class="import-preview__list">
        {filteredItems.map((item) => (
          <button
            key={item.index}
            class="import-preview__item"
            type="button"
            onClick={() => onToggle(item.index)}
          >
            <span class={`import-preview__checkbox ${item.selected ? 'import-preview__checkbox--checked' : ''}`}>
              {item.selected && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </span>
            <div class="import-preview__item-info">
              <span class="import-preview__item-name">{item.name || '(unnamed)'}</span>
              <span class="import-preview__item-meta">
                {item.manufacturer}{item.scale ? ` \u00B7 ${item.scale}` : ''}
              </span>
            </div>
            <StatusDot status={item.status} />
          </button>
        ))}

        {filteredItems.length === 0 && (
          <p class="import-preview__empty">No items match the selected filter.</p>
        )}
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .import-preview {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .import-preview__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) 0;
  }

  .import-preview__count {
    font-size: var(--font-sm);
    color: var(--text-secondary);
    font-weight: var(--font-weight-medium);
  }

  .import-preview__filter {
    font-size: var(--font-sm);
    color: var(--text-primary);
    background: var(--surface-tertiary);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    padding: var(--space-1) var(--space-2);
    min-height: 36px;
  }

  .import-preview__toggle-all {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-1);
    font-size: var(--font-sm);
    font-weight: var(--font-weight-semibold);
    color: var(--brand-400);
    min-height: var(--touch-min);
    text-align: left;
    width: 100%;
    border-bottom: 1px solid var(--border-subtle);
  }

  .import-preview__toggle-all:active {
    background: var(--surface-tertiary);
  }

  .import-preview__list {
    display: flex;
    flex-direction: column;
    max-height: 50vh;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  .import-preview__item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-1);
    border-bottom: 1px solid var(--border-subtle);
    min-height: var(--touch-min);
    text-align: left;
    width: 100%;
    transition: background var(--transition-fast);
  }

  .import-preview__item:active {
    background: var(--surface-tertiary);
  }

  .import-preview__checkbox {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border: 2px solid var(--text-tertiary);
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--transition-fast);
  }

  .import-preview__checkbox--checked {
    background: var(--brand-500);
    border-color: var(--brand-500);
  }

  .import-preview__item-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .import-preview__item-name {
    font-size: var(--font-sm);
    color: var(--text-primary);
    font-weight: var(--font-weight-medium);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .import-preview__item-meta {
    font-size: var(--font-xs);
    color: var(--text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .import-preview__status-dot {
    flex-shrink: 0;
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .import-preview__empty {
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--font-sm);
    padding: var(--space-8) 0;
  }
`;

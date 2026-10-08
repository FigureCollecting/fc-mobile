import type { CollectionTab } from '../../hooks/useFigureListParams';
import { COLLECTION_TABS } from '../../hooks/useFigureListParams';
import { Style } from '../../styles/Style';

export const TAB_LABEL: Record<CollectionTab, string> = {
  owned: 'Owned',
  ordered: 'Ordered',
  wished: 'Wished',
  former: 'No longer owned',
};

interface CollectionTabsProps {
  tab: CollectionTab;
  counts: Record<CollectionTab, number> | undefined;
  onChange: (tab: CollectionTab) => void;
}

/** The four tabs over the default collections (GR 2026-09-26), each with its item count. */
export function CollectionTabs({ tab, counts, onChange }: CollectionTabsProps) {
  return (
    <div class="collection-tabs" role="tablist" aria-label="Collections">
      {COLLECTION_TABS.map((t) => (
        <button
          key={t}
          type="button"
          role="tab"
          aria-selected={t === tab}
          class={`collection-tabs__tab ${t === tab ? 'collection-tabs__tab--active' : ''}`}
          onClick={() => onChange(t)}
        >
          {`${TAB_LABEL[t]} (${counts?.[t] ?? 0})`}
        </button>
      ))}
      <Style css={`
        .collection-tabs {
          display: flex;
          gap: var(--space-1);
          padding: var(--space-1) var(--space-page);
          overflow-x: auto;
          scrollbar-width: none;
        }
        .collection-tabs__tab {
          flex-shrink: 0;
          min-height: 36px;
          padding: 0 var(--space-3);
          border-radius: var(--radius-full);
          font-size: var(--font-sm);
          color: var(--text-secondary);
          background: var(--surface-secondary);
          white-space: nowrap;
        }
        .collection-tabs__tab--active {
          background: var(--brand-500);
          color: #fff;
          font-weight: 600;
        }
      `} />
    </div>
  );
}

import type { CollectionTab } from '../../hooks/useFigureListParams';

/** The holdings' names (the default collections, GR 2026-09-26), chosen in Refine (SHEETS-FB1). */
export const TAB_LABEL: Record<CollectionTab, string> = {
  owned: 'Owned',
  ordered: 'Ordered',
  wished: 'Wished',
  former: 'No longer owned',
};

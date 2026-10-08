// Collection counts from the local store (WK-15): copies per kind (a stack of three is three), and
// the makers of the held figures. Offline too; no request.
import { useCallback } from 'preact/hooks';
import type { UseQueryResult } from '@tanstack/react-query';
import { useSnapshot, type Snapshot } from '../local/useLocal';

export interface CollectionCounts {
  owned: number;
  ordered: number;
  wished: number;
  total: number;
  /** Held figures (owned, ordered, wished) per maker, most first. */
  makers: Array<{ name: string; count: number }>;
}

function countCopies(s: Snapshot): CollectionCounts {
  const out = { owned: 0, ordered: 0, wished: 0 };
  const makers = new Map<string, number>();
  for (const f of s.figures) {
    if (f.local.kind === 'former') continue;
    out[f.local.kind] += f.quantity ?? 1;
    if (f.manufacturer) makers.set(f.manufacturer, (makers.get(f.manufacturer) ?? 0) + 1);
  }
  return {
    ...out,
    total: out.owned + out.ordered + out.wished,
    makers: [...makers.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

export function useCollectionStats(): UseQueryResult<CollectionCounts> {
  return useSnapshot(useCallback(countCopies, []));
}

import type { Figure } from '@figurecollecting/fc-shared';

/**
 * Client-side sort over the loaded figure list (mirrors the server sort
 * fields; 'activity' uses createdAt as its proxy). Works identically in
 * fixture mode and against cached/eventual data.
 */
export function sortFigures(figures: Figure[], sort: string, order: 'asc' | 'desc'): Figure[] {
  const dir = order === 'desc' ? -1 : 1;
  const key = (f: Figure): string => {
    switch (sort) {
      case 'name':
        return f.name?.toLowerCase() ?? '';
      case 'releaseDate':
        return f.releases?.[0]?.date ?? f.createdAt ?? '';
      default: // 'activity'
        return f.createdAt ?? '';
    }
  };
  return [...figures].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -dir : ka > kb ? dir : 0;
  });
}

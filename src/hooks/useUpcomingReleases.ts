import { useMemo } from 'preact/hooks';
import { useQuery } from '@tanstack/react-query';
import type { Figure, IRelease } from '@figurecollecting/fc-shared';
import { getFigures } from '@figurecollecting/fc-shared';
import { api } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { getCachedFigures } from '../storage/figureCache';

export interface UpcomingRelease {
  figure: Figure;
  release: IRelease;
  releaseDate: Date;
  daysUntil: number;
}

export function useUpcomingReleases(daysAhead = 60) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Reuse the same queries as the release calendar to avoid duplication
  const orderedQuery = useQuery<Figure[]>({
    queryKey: ['release-calendar', 'ordered'],
    queryFn: async () => {
      try {
        const response = await getFigures(api, 1, 500, 'activity', 'asc', 'ordered');
        return response.data;
      } catch {
        return getCachedFigures('ordered');
      }
    },
    enabled: isAuthenticated,
    staleTime: 5 * 60_000,
  });

  const wishedQuery = useQuery<Figure[]>({
    queryKey: ['release-calendar', 'wished'],
    queryFn: async () => {
      try {
        const response = await getFigures(api, 1, 500, 'activity', 'asc', 'wished');
        return response.data;
      } catch {
        return getCachedFigures('wished');
      }
    },
    enabled: isAuthenticated,
    staleTime: 5 * 60_000,
  });

  const upcoming = useMemo((): UpcomingRelease[] => {
    const figures = [...(orderedQuery.data ?? []), ...(wishedQuery.data ?? [])];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() + daysAhead);

    const results: UpcomingRelease[] = [];

    for (const figure of figures) {
      if (!figure.releases?.length) continue;

      for (const release of figure.releases) {
        if (!release.date) continue;

        const releaseDate = new Date(release.date);
        if (releaseDate >= today && releaseDate <= cutoff) {
          const diff = releaseDate.getTime() - today.getTime();
          const daysUntil = Math.ceil(diff / (1000 * 60 * 60 * 24));
          results.push({ figure, release, releaseDate, daysUntil });
        }
      }
    }

    // Sort by soonest first
    results.sort((a, b) => a.daysUntil - b.daysUntil);
    return results;
  }, [orderedQuery.data, wishedQuery.data, daysAhead]);

  // Count how many release this month
  const thisMonthCount = useMemo(() => {
    const now = new Date();
    return upcoming.filter(
      (r) =>
        r.releaseDate.getFullYear() === now.getFullYear() &&
        r.releaseDate.getMonth() === now.getMonth(),
    ).length;
  }, [upcoming]);

  return {
    releases: upcoming,
    thisMonthCount,
    isLoading: orderedQuery.isLoading || wishedQuery.isLoading,
  };
}

import { useMemo } from 'preact/hooks';
import { useQuery } from '@tanstack/react-query';
import type { Figure, IRelease } from '@figurecollecting/fc-shared';
import { getFigures } from '@figurecollecting/fc-shared';
import { api } from '../api/client';
import { useAuthStore } from '../stores/auth';
import { getCachedFigures } from '../storage/figureCache';

export interface CalendarRelease {
  figure: Figure;
  release: IRelease;
  day: number;
}

export interface ReleaseCalendarData {
  /** Releases in the selected month, sorted by date */
  releases: CalendarRelease[];
  /** Set of days (1-31) that have at least one release */
  releaseDays: Set<number>;
  /** Total count of releases for quick display */
  totalReleases: number;
  /** Upcoming releases across the next 6 months (for preview) */
  upcomingCount: number;
}

/**
 * Fetch all ordered/wished figures and filter by release dates in the given month.
 * Uses existing collection data — no new backend endpoint needed.
 */
export function useReleaseCalendar(year: number, month: number) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Fetch all ordered and wished figures (up to 500 to get all relevant items)
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

  const allFigures = useMemo(() => {
    const ordered = orderedQuery.data ?? [];
    const wished = wishedQuery.data ?? [];
    return [...ordered, ...wished];
  }, [orderedQuery.data, wishedQuery.data]);

  const calendarData = useMemo((): ReleaseCalendarData => {
    const releases: CalendarRelease[] = [];
    const releaseDays = new Set<number>();
    let upcomingCount = 0;

    const now = new Date();
    const sixMonthsLater = new Date(now.getFullYear(), now.getMonth() + 6, now.getDate());

    for (const figure of allFigures) {
      if (!figure.releases?.length) continue;

      for (const release of figure.releases) {
        if (!release.date) continue;

        const releaseDate = new Date(release.date);
        // Check if release is in the selected month
        if (releaseDate.getFullYear() === year && releaseDate.getMonth() === month) {
          const day = releaseDate.getDate();
          releases.push({ figure, release, day });
          releaseDays.add(day);
        }

        // Count upcoming releases (next 6 months from today)
        if (releaseDate >= now && releaseDate <= sixMonthsLater) {
          upcomingCount++;
        }
      }
    }

    // Sort by day of month
    releases.sort((a, b) => a.day - b.day);

    return {
      releases,
      releaseDays,
      totalReleases: releases.length,
      upcomingCount,
    };
  }, [allFigures, year, month]);

  return {
    ...calendarData,
    isLoading: orderedQuery.isLoading || wishedQuery.isLoading,
    isError: orderedQuery.isError && wishedQuery.isError,
    refetch: () => {
      orderedQuery.refetch();
      wishedQuery.refetch();
    },
  };
}

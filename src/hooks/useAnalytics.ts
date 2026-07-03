import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuthStore } from '../stores/auth';

// --- Types ---

export interface CollectionAnalytics {
  totalFigures: number;
  statusCounts: {
    owned: number;
    ordered: number;
    wished: number;
  };
  totalValue: number | null;
  uniqueManufacturers: number;
}

export interface BreakdownItem {
  _id: string;
  count: number;
  label?: string;
}

export interface TimelineMonth {
  month: string;
  count: number;
}

export interface PriceSummary {
  trackedItems: number;
  trends: {
    up: number;
    down: number;
    stable: number;
  };
  activeAlerts: number;
}

// --- Hooks ---
// NOTE: These used to silently fall back to fabricated data on API errors,
// which masked real backend failures. They now propagate errors so callers
// can render honest empty / error states.

export function useCollectionAnalytics() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery<CollectionAnalytics>({
    queryKey: ['analytics', 'collection'],
    queryFn: async () => {
      const response = await api.get('/analytics/collection');
      return (response as { data: { analytics: CollectionAnalytics } }).data.analytics;
    },
    enabled: isAuthenticated,
    staleTime: 5 * 60_000, // 5 min cache
  });
}

export function useCollectionBreakdown(groupBy: string) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery<BreakdownItem[]>({
    queryKey: ['analytics', 'breakdown', groupBy],
    queryFn: async () => {
      const response = await api.get(`/analytics/collection/breakdown?groupBy=${groupBy}`);
      return (response as { data: { breakdown: BreakdownItem[] } }).data.breakdown;
    },
    enabled: isAuthenticated,
    staleTime: 5 * 60_000,
  });
}

export function useCollectionTimeline(months: number = 12) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery<TimelineMonth[]>({
    queryKey: ['analytics', 'timeline', months],
    queryFn: async () => {
      const response = await api.get(`/analytics/collection/timeline?months=${months}`);
      return (response as { data: { timeline: TimelineMonth[] } }).data.timeline;
    },
    enabled: isAuthenticated,
    staleTime: 5 * 60_000,
  });
}

export function usePriceSummary() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery<PriceSummary>({
    queryKey: ['analytics', 'prices'],
    queryFn: async () => {
      const response = await api.get('/analytics/prices/summary');
      return (response as { data: { summary: PriceSummary } }).data.summary;
    },
    enabled: isAuthenticated,
    staleTime: 5 * 60_000,
  });
}

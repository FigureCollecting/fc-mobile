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

// --- Mock data (fallback when API unavailable) ---

const MOCK_COLLECTION: CollectionAnalytics = {
  totalFigures: 47,
  statusCounts: { owned: 32, ordered: 8, wished: 7 },
  totalValue: 245_000,
  uniqueManufacturers: 12,
};

const MOCK_BREAKDOWN_MANUFACTURER: BreakdownItem[] = [
  { _id: 'Good Smile Company', count: 14 },
  { _id: 'Alter', count: 8 },
  { _id: 'Kotobukiya', count: 6 },
  { _id: 'Max Factory', count: 5 },
  { _id: 'Bandai Spirits', count: 4 },
  { _id: 'FREEing', count: 3 },
  { _id: 'Aniplex', count: 3 },
  { _id: 'Phat Company', count: 2 },
  { _id: 'Union Creative', count: 1 },
  { _id: 'Myethos', count: 1 },
];

const MOCK_BREAKDOWN_ORIGIN: BreakdownItem[] = [
  { _id: 'Fate Series', count: 11 },
  { _id: 'Hatsune Miku', count: 7 },
  { _id: 'Re:Zero', count: 5 },
  { _id: 'Sword Art Online', count: 4 },
  { _id: 'Demon Slayer', count: 3 },
  { _id: 'My Hero Academia', count: 3 },
  { _id: 'Genshin Impact', count: 3 },
  { _id: 'Spy x Family', count: 2 },
];

function buildMockTimeline(): TimelineMonth[] {
  const months: TimelineMonth[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    months.push({ month: label, count: Math.floor(Math.random() * 6) + 1 });
  }
  return months;
}

const MOCK_TIMELINE = buildMockTimeline();

const MOCK_PRICE_SUMMARY: PriceSummary = {
  trackedItems: 5,
  trends: { up: 2, down: 1, stable: 2 },
  activeAlerts: 3,
};

// --- Hooks ---

export function useCollectionAnalytics() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery<CollectionAnalytics>({
    queryKey: ['analytics', 'collection'],
    queryFn: async () => {
      try {
        const response = await api.get('/analytics/collection');
        return (response as { data: { analytics: CollectionAnalytics } }).data.analytics;
      } catch {
        return MOCK_COLLECTION;
      }
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
      try {
        const response = await api.get(`/analytics/collection/breakdown?groupBy=${groupBy}`);
        return (response as { data: { breakdown: BreakdownItem[] } }).data.breakdown;
      } catch {
        return groupBy === 'manufacturer'
          ? MOCK_BREAKDOWN_MANUFACTURER
          : MOCK_BREAKDOWN_ORIGIN;
      }
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
      try {
        const response = await api.get(`/analytics/collection/timeline?months=${months}`);
        return (response as { data: { timeline: TimelineMonth[] } }).data.timeline;
      } catch {
        return MOCK_TIMELINE;
      }
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
      try {
        const response = await api.get('/analytics/prices/summary');
        return (response as { data: { summary: PriceSummary } }).data.summary;
      } catch {
        return MOCK_PRICE_SUMMARY;
      }
    },
    enabled: isAuthenticated,
    staleTime: 5 * 60_000,
  });
}

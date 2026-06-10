import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuthStore } from '../stores/auth';

// --- Types ---

export type StockStatus = 'in_stock' | 'pre_order' | 'sold_out' | 'unknown';
export type PriceTrend = 'up' | 'down' | 'stable';
export type AlertType = 'price_below' | 'back_in_stock' | 'any_change';

export interface SitePrice {
  site: string;
  price: number;
  currency: string;
  stockStatus: StockStatus;
  url: string;
  lastUpdated: string;
}

export interface WatchlistItem {
  figureId: string;
  figureName: string;
  manufacturer: string;
  imageUrl?: string;
  lowestPrice: number;
  currency: string;
  cheapestSite: string;
  trend: PriceTrend;
  trendPercent?: number;
  /** Last 30 days of price points for sparkline visualization */
  priceHistory?: number[];
  addedAt: string;
}

export interface PricePoint {
  site: string;
  price: number;
  currency: string;
  date: string;
}

export interface PriceAlert {
  _id: string;
  figureId: string;
  figureName: string;
  type: AlertType;
  targetPrice?: number;
  currency?: string;
  sites: string[];
  pushEnabled: boolean;
  status: 'active' | 'paused';
  createdAt: string;
}

export interface WatchlistSummary {
  totalItems: number;
  avgTrend: PriceTrend;
  avgTrendPercent: number;
}

// --- Hooks ---

export function useWatchlist() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery<{ items: WatchlistItem[]; summary: WatchlistSummary }>({
    queryKey: ['prices', 'watchlist'],
    queryFn: async () => {
      const { data } = await api.get('/prices/watchlist');
      return data as { items: WatchlistItem[]; summary: WatchlistSummary };
    },
    enabled: isAuthenticated,
    staleTime: 60_000,
  });
}

export function usePriceHistory(figureId: string | undefined) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery<PricePoint[]>({
    queryKey: ['prices', 'history', figureId],
    queryFn: async () => {
      const { data } = await api.get(`/prices/${figureId}/history`);
      return data as PricePoint[];
    },
    enabled: isAuthenticated && !!figureId,
    staleTime: 5 * 60_000,
  });
}

export function useCurrentPrices(figureId: string | undefined) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery<SitePrice[]>({
    queryKey: ['prices', 'current', figureId],
    queryFn: async () => {
      const { data } = await api.get(`/prices/${figureId}/current`);
      return data as SitePrice[];
    },
    enabled: isAuthenticated && !!figureId,
    staleTime: 60_000,
  });
}

export function useAlerts(figureId?: string) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery<PriceAlert[]>({
    queryKey: ['prices', 'alerts', figureId ?? 'all'],
    queryFn: async () => {
      const url = figureId ? `/prices/alerts?figureId=${figureId}` : '/prices/alerts';
      const { data } = await api.get(url);
      return data as PriceAlert[];
    },
    enabled: isAuthenticated,
    staleTime: 60_000,
  });
}

export function useAddToWatchlist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (figureId: string) => {
      return api.post('/prices/watchlist', { figureId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prices', 'watchlist'] });
    },
  });
}

export function useRemoveFromWatchlist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (figureId: string) => {
      return api.delete(`/prices/watchlist/${figureId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prices', 'watchlist'] });
    },
  });
}

export function useSaveAlert() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (alert: Omit<PriceAlert, '_id' | 'createdAt' | 'status'> & { _id?: string }) => {
      if (alert._id) {
        return api.put(`/prices/alerts/${alert._id}`, alert);
      }
      return api.post('/prices/alerts', alert);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prices', 'alerts'] });
    },
  });
}

export function useDeleteAlert() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (alertId: string) => {
      return api.delete(`/prices/alerts/${alertId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prices', 'alerts'] });
    },
  });
}

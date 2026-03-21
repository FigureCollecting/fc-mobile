// Shared API client configured for mobile
import { createApiClient, createSimpleApiClient } from '@figurecollecting/fc-shared';
import type { AuthAccessor } from '@figurecollecting/fc-shared';
import { useAuthStore } from '../stores/auth';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://figurecollecting.com/api';

// AuthAccessor wired to the shared auth store
const auth: AuthAccessor = {
  getToken: () => useAuthStore.getState().user?.token,
  getRefreshToken: () => useAuthStore.getState().user?.refreshToken,
  updateTokens: (token, refreshToken, tokenExpiresAt) =>
    useAuthStore.getState().updateTokens(token, refreshToken, tokenExpiresAt),
  recordActivity: () => useAuthStore.getState().recordActivity(),
  logout: () => useAuthStore.getState().logout(),
  onAuthFailure: () => {
    // Mobile: navigate to login (handled by auth state reactivity)
    console.log('Auth failure — redirecting to login');
  },
};

// Main API client with token refresh
export const api = createApiClient({ baseUrl: API_BASE_URL, auth });

// Simple client for scraper/sync endpoints (no token refresh)
export const scraperApi = createSimpleApiClient({
  baseUrl: API_BASE_URL,
  auth: { getToken: auth.getToken },
});

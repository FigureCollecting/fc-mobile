// Shared API client configured for mobile.
//
// Base URL resolution precedence (first match wins):
//   1. Runtime override — localStorage.getItem('fc.apiUrl')
//      Useful for beta testers who want to flip a deployed build to staging
//      without rebuilding.
//   2. Build-time env — import.meta.env.VITE_API_URL
//      Set in .env.development / .env.production.
//   3. Fallback — https://figurecollecting.com/api (production default).
//
// On auth failure the client clears the auth store and performs a hard
// navigation to /login. Router-based navigation is unreliable across async
// boundaries; window.location.assign guarantees a fresh state tree.
import { createApiClient, createSimpleApiClient } from '@figurecollecting/fc-shared';
import type { AuthAccessor } from '@figurecollecting/fc-shared';
import { useAuthStore } from '../stores/auth';

const RUNTIME_API_URL_KEY = 'fc.apiUrl';
const PRODUCTION_API_URL = 'https://figurecollecting.com/api';

function resolveApiBaseUrl(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const override = localStorage.getItem(RUNTIME_API_URL_KEY);
      if (override && override.trim().length > 0) {
        return override.trim();
      }
    }
  } catch {
    // localStorage can throw in private mode / sandboxed frames — fall through.
  }

  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && envUrl.trim().length > 0) {
    return envUrl.trim();
  }

  return PRODUCTION_API_URL;
}

const API_BASE_URL = resolveApiBaseUrl();

const AUTH_ROUTES = new Set(['/login', '/register']);

// AuthAccessor wired to the shared auth store
const auth: AuthAccessor = {
  getToken: () => useAuthStore.getState().user?.token,
  getRefreshToken: () => useAuthStore.getState().user?.refreshToken,
  updateTokens: (token, refreshToken, tokenExpiresAt) =>
    useAuthStore.getState().updateTokens(token, refreshToken, tokenExpiresAt),
  recordActivity: () => useAuthStore.getState().recordActivity(),
  logout: () => useAuthStore.getState().logout(),
  onAuthFailure: () => {
    // Synchronously clear auth state so downstream code doesn't keep using a
    // stale token while we navigate away.
    useAuthStore.getState().logout();

    // Skip the hard redirect if we're already on /login or /register — it would
    // just loop and wipe any mid-flight auth attempt.
    if (typeof window === 'undefined') return;
    const pathname = window.location?.pathname ?? '';
    if (AUTH_ROUTES.has(pathname)) return;

    // Hard navigation — guarantees a clean component tree, kills in-flight
    // query subscriptions, and avoids router race conditions.
    window.location.assign('/login');
  },
};

// Main API client with token refresh
export const api = createApiClient({ baseUrl: API_BASE_URL, auth });

// Simple client for scraper/sync endpoints (no token refresh)
export const scraperApi = createSimpleApiClient({
  baseUrl: API_BASE_URL,
  auth: { getToken: auth.getToken },
});

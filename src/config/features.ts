/**
 * Screens wired to endpoints that exist on no backend anywhere (analytics,
 * notifications, prices/watchlist, push, export, calendar, collection DNA,
 * MFC cookie sync). Off by default; VITE_ENABLE_LEGACY_SCREENS=true is a
 * local-dev-only escape hatch for working on their eventual real backends.
 */
export const LEGACY_SCREENS_ENABLED = import.meta.env.VITE_ENABLE_LEGACY_SCREENS === 'true';

/** VITE_AUTH_MODE=oidc: src/auth (OIDC + PKCE, DPoP device key, /callback) replaces the
 * legacy /login redirect. Off by default until the screens move over (WK-15). */
export const OIDC_AUTH_ENABLED = import.meta.env.VITE_AUTH_MODE === 'oidc';

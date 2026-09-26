/**
 * Screens wired to endpoints that exist on no backend anywhere (analytics,
 * notifications, prices/watchlist, push, export, calendar, collection DNA,
 * MFC cookie sync). Off by default; VITE_ENABLE_LEGACY_SCREENS=true is a
 * local-dev-only escape hatch for working on their eventual real backends.
 */
export const LEGACY_SCREENS_ENABLED = import.meta.env.VITE_ENABLE_LEGACY_SCREENS === 'true';

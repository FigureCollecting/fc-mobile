/**
 * Screens wired to endpoints that exist on no backend anywhere (analytics,
 * notifications, prices/watchlist, push, export, calendar, collection DNA,
 * MFC cookie sync). Off by default; VITE_ENABLE_LEGACY_SCREENS=true is a
 * local-dev-only escape hatch for working on their eventual real backends.
 *
 * Sign-in is not a switch: OIDC + PKCE + DPoP (src/auth) is the only one (WK-15).
 */
export const LEGACY_SCREENS_ENABLED = import.meta.env.VITE_ENABLE_LEGACY_SCREENS === 'true';

/**
 * LGMOB diagnostic ids (src/auth/diagIds.ts): the traceparent on calls to our API, the origin_trace on
 * queued edits, and the Settings > Privacy switch with its "How we use your data" link to /privacy.
 * Off unless VITE_DIAG_IDS=true: they reach users only together with the /privacy page (P1), so no
 * env file the image build reads, the Dockerfile or a workflow sets it (deploy/__tests__/diagIdsFlag.test.ts).
 * Read at each call so a test can stub it; a build fixes it.
 */
export function diagIdsEnabled(): boolean {
  return import.meta.env.VITE_DIAG_IDS === 'true';
}

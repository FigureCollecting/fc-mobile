// The Authentik fc-coordinator provider's endpoints. Hardcoded rather than read
// from discovery, because Authentik's discovery document sends no CORS headers.
export const PROVIDER = 'fc-coordinator';
export const DEFAULT_IDP_ORIGIN = 'https://auth.mindsignals1.com';
/** offline_access asks for a refresh token; the client works without one (interactive re-login). */
export const OIDC_SCOPE = 'openid profile email offline_access';

export interface OidcConfig {
  issuer: string;
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  endSessionEndpoint: string;
  scope: string;
}

export function oidcConfig(idpOrigin: string = DEFAULT_IDP_ORIGIN): OidcConfig {
  const base = idpOrigin.replace(/\/+$/, '');
  return {
    issuer: `${base}/application/o/${PROVIDER}/`,
    clientId: PROVIDER,
    authorizationEndpoint: `${base}/application/o/authorize/`,
    tokenEndpoint: `${base}/application/o/token/`,
    endSessionEndpoint: `${base}/application/o/${PROVIDER}/end-session/`,
    scope: OIDC_SCOPE,
  };
}

/** The build's IdP origin: production Authentik unless VITE_OIDC_ORIGIN names another (the local stack's mock). */
function configuredIdpOrigin(env: Readonly<Record<string, unknown>>): string {
  const origin = env['VITE_OIDC_ORIGIN'];
  return typeof origin === 'string' && origin !== '' ? origin : DEFAULT_IDP_ORIGIN;
}

export function configuredOidc(env: Readonly<Record<string, unknown>> = import.meta.env): OidcConfig {
  return oidcConfig(configuredIdpOrigin(env));
}

/** The sign-in server's own pages for changing the signed-in account. */
export interface AccountPages {
  passwordChange: string;
  mfaDevices: string;
}

/**
 * Change Password is fc's own flow (fc-infra authentik/blueprints/fc-flows.yaml slug fc-password-change: current
 * password, a second factor, then the new one), sent bare with no next=. Not the user settings' password card: that
 * runs the first password stage with a configure flow, the stock default-password-change, which asks for neither.
 * The flow needs a live sign-in-server session; without one it is a dead end (known limit). Two-Factor is the
 * Credentials tab of Authentik's user settings, named in the hash as JSON after the route's ";" (Authentik 2026.8.5
 * web: Tabs.ts and RouteMatch.ts getURLParams, UserSettingsPage.ts slot page-credentials).
 */
export function accountPages(idpOrigin: string = DEFAULT_IDP_ORIGIN): AccountPages {
  const base = idpOrigin.replace(/\/+$/, '');
  return {
    passwordChange: `${base}/if/flow/fc-password-change/`,
    mfaDevices: `${base}/if/user/#/settings;${encodeURIComponent(JSON.stringify({ page: 'page-credentials' }))}`,
  };
}

export function configuredAccountPages(env: Readonly<Record<string, unknown>> = import.meta.env): AccountPages {
  return accountPages(configuredIdpOrigin(env));
}

export const redirectUriFor = (appOrigin: string): string => `${appOrigin}/callback`;
export const postLogoutUriFor = (appOrigin: string): string => `${appOrigin}/`;

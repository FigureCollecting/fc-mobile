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

/** The build's IdP: production Authentik unless VITE_OIDC_ORIGIN names another (the local stack's mock). */
export function configuredOidc(env: Readonly<Record<string, unknown>> = import.meta.env): OidcConfig {
  const origin = env['VITE_OIDC_ORIGIN'];
  return oidcConfig(typeof origin === 'string' && origin !== '' ? origin : DEFAULT_IDP_ORIGIN);
}

export const redirectUriFor = (appOrigin: string): string => `${appOrigin}/callback`;
export const postLogoutUriFor = (appOrigin: string): string => `${appOrigin}/`;

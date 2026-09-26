// Authorization code + PKCE against the hardcoded provider endpoints. The token
// endpoint is called with fetch (Authentik allows CORS for registered origins);
// the authorize and end-session legs are full-page navigations.
import { decodeJwt } from 'jose';
import type { OidcConfig } from './config';
import { NetworkError } from './errors';

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
}

/** The token endpoint answered with an OAuth error (or an unusable reply, as server_error). */
export class TokenError extends Error {
  readonly error: string;
  readonly status: number;

  constructor(error: string, status: number) {
    super(`token endpoint: ${error} (${status})`);
    this.name = 'TokenError';
    this.error = error;
    this.status = status;
  }
}

export class IdTokenError extends Error {
  constructor(reason: string) {
    super(`id_token: ${reason}`);
    this.name = 'IdTokenError';
  }
}

export function authorizeUrl(
  cfg: OidcConfig,
  p: { redirectUri: string; state: string; challenge: string; nonce: string; loginHint?: string },
): string {
  const url = new URL(cfg.authorizationEndpoint);
  const params: Record<string, string> = {
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: p.redirectUri,
    scope: cfg.scope,
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
  };
  if (p.loginHint !== undefined) params['login_hint'] = p.loginHint;
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

export function endSessionUrl(cfg: OidcConfig, p: { postLogoutRedirectUri: string; idTokenHint?: string }): string {
  const url = new URL(cfg.endSessionEndpoint);
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('post_logout_redirect_uri', p.postLogoutRedirectUri);
  if (p.idTokenHint !== undefined) url.searchParams.set('id_token_hint', p.idTokenHint);
  return url.toString();
}

/** A token call that never answers (captive portal) must not hold the refresh lock forever. */
export const TOKEN_TIMEOUT_MS = 15_000;

async function tokenRequest(
  cfg: OidcConfig,
  fetchFn: typeof fetch,
  fields: Record<string, string>,
  timeoutMs: number,
): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetchFn(cfg.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...fields, client_id: cfg.clientId }).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new NetworkError(err);
  }
  let body: Record<string, unknown> | undefined;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = undefined;
  }
  if (res.ok && typeof body?.['access_token'] === 'string') return body as unknown as TokenResponse;
  const error = typeof body?.['error'] === 'string' ? body['error'] : 'server_error';
  throw new TokenError(error, res.status);
}

export function exchangeCode(
  cfg: OidcConfig,
  fetchFn: typeof fetch,
  p: { code: string; verifier: string; redirectUri: string },
  timeoutMs = TOKEN_TIMEOUT_MS,
): Promise<TokenResponse> {
  const fields = { grant_type: 'authorization_code', code: p.code, code_verifier: p.verifier, redirect_uri: p.redirectUri };
  return tokenRequest(cfg, fetchFn, fields, timeoutMs);
}

export function refreshGrant(
  cfg: OidcConfig,
  fetchFn: typeof fetch,
  refreshToken: string,
  timeoutMs = TOKEN_TIMEOUT_MS,
): Promise<TokenResponse> {
  return tokenRequest(cfg, fetchFn, { grant_type: 'refresh_token', refresh_token: refreshToken }, timeoutMs);
}

/** Five minutes: the token just came from the token endpoint over TLS, so exp only guards a wild clock. */
const EXP_LEEWAY_SECONDS = 300;

// OIDC Core 3.1.3.7, token received directly from the token endpoint: TLS stands in for
// the signature check; issuer, audience, expiry and nonce are still checked.
export function idTokenClaims(
  cfg: OidcConfig,
  idToken: string,
  p: { nowSeconds: number; nonce?: string },
): { sub: string } {
  let claims: ReturnType<typeof decodeJwt>;
  try {
    claims = decodeJwt(idToken);
  } catch {
    throw new IdTokenError('malformed');
  }
  if (claims.iss !== cfg.issuer) throw new IdTokenError('issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(cfg.clientId)) throw new IdTokenError('audience');
  if (typeof claims.exp !== 'number' || claims.exp + EXP_LEEWAY_SECONDS < p.nowSeconds) throw new IdTokenError('expired');
  if (p.nonce !== undefined && claims['nonce'] !== p.nonce) throw new IdTokenError('nonce');
  if (typeof claims.sub !== 'string' || claims.sub === '') throw new IdTokenError('subject');
  return { sub: claims.sub };
}

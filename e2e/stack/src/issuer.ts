// Mock of the Authentik fc-coordinator provider: its path layout, client id,
// lifetimes and strict redirect URIs, with login auto-completed. PKCE is S256
// only, codes are single-use, refresh tokens rotate and the old one is refused.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, jwtVerify, SignJWT, type CryptoKey, type JWK } from 'jose';
import { readBody, sendJson } from './http.js';

export interface StackUser {
  sub: string;
  email: string;
  name: string;
  preferredUsername: string;
}

export const USER_A: StackUser = {
  sub: '11111111-1111-4111-8111-111111111111',
  email: 'collector-a@stack.test',
  name: 'Collector A',
  preferredUsername: 'collector-a',
};
export const USER_B: StackUser = {
  sub: '22222222-2222-4222-8222-222222222222',
  email: 'collector-b@stack.test',
  name: 'Collector B',
  preferredUsername: 'collector-b',
};

export interface IssuerSettings {
  accessTokenTtlSeconds: number;
  /** Authentik issues a refresh token only when the provider maps offline_access. */
  offlineAccess: boolean;
  /** Reusing a rotated-out refresh token also revokes its live successor. */
  reuseRevokesFamily: boolean;
}

export interface IssuerOptions extends Partial<IssuerSettings> {
  redirectUris: string[];
  allowedOrigins: string[];
  clientId?: string;
  users?: StackUser[];
  host?: string;
  port?: number;
  now?: () => number;
}

export interface IssuerEvent {
  at: string;
  endpoint: 'authorize' | 'token' | 'revoke';
  grantType?: string;
  outcome: string;
  reason?: string;
  sub?: string;
}

export interface MockIssuer {
  origin: string;
  issuer: string;
  jwksUri: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
  userinfoEndpoint: string;
  endSessionEndpoint: string;
  clientId: string;
  log: IssuerEvent[];
  users(): StackUser[];
  loginAs(sub: string): void;
  revokeUser(sub: string): number;
  configure(patch: Partial<IssuerSettings>): void;
  settings(): IssuerSettings;
  close(): Promise<void>;
}

const PROVIDER = 'fc-coordinator';
const CODE_TTL_MS = 60_000;
const REFRESH_TTL_MS = 30 * 86_400_000;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

interface CodeGrant {
  clientId: string;
  redirectUri: string;
  challenge: string;
  scope: string;
  nonce?: string;
  sub: string;
  expiresAt: number;
  used: boolean;
  families: string[];
}

interface RefreshGrant {
  sub: string;
  scope: string;
  family: string;
  state: 'active' | 'rotated' | 'revoked';
  expiresAt: number;
  authTime: number;
}

class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
  }
}

const b64sha256 = (value: string): string => createHash('sha256').update(value, 'ascii').digest('base64url');

export async function startMockIssuer(options: IssuerOptions): Promise<MockIssuer> {
  const host = options.host ?? '127.0.0.1';
  const clientId = options.clientId ?? PROVIDER;
  const now = options.now ?? Date.now;
  const users = options.users ?? [USER_A, USER_B];
  const settings: IssuerSettings = {
    accessTokenTtlSeconds: options.accessTokenTtlSeconds ?? 600,
    offlineAccess: options.offlineAccess ?? true,
    reuseRevokesFamily: options.reuseRevokesFamily ?? false,
  };
  let current = users[0] as StackUser;

  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const kid = `stack-${randomUUID().slice(0, 8)}`;
  const publicJwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };

  const codes = new Map<string, CodeGrant>();
  const refreshes = new Map<string, RefreshGrant>();
  const log: IssuerEvent[] = [];

  const server = http.createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => resolve((server.address() as AddressInfo).port));
  });
  const origin = `http://${host}:${port}`;
  const issuer = `${origin}/application/o/${PROVIDER}/`;
  const paths = {
    discovery: `/application/o/${PROVIDER}/.well-known/openid-configuration`,
    jwks: `/application/o/${PROVIDER}/jwks/`,
    authorize: '/application/o/authorize/',
    token: '/application/o/token/',
    revoke: '/application/o/revoke/',
    userinfo: '/application/o/userinfo/',
    endSession: `/application/o/${PROVIDER}/end-session/`,
  };
  const url = (path: string): string => `${origin}${path}`;

  const record = (event: Omit<IssuerEvent, 'at'>): void => {
    log.push({ at: new Date(now()).toISOString(), ...event });
  };

  const findUser = (hint: string): StackUser | undefined =>
    users.find((u) => u.sub === hint || u.email === hint || u.preferredUsername === hint);

  const sign = (claims: Record<string, unknown>, sub: string, ttlSeconds: number, iat: number): Promise<string> =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
      .setIssuer(issuer)
      .setAudience(clientId)
      .setSubject(sub)
      .setIssuedAt(iat)
      .setExpirationTime(iat + ttlSeconds)
      .sign(privateKey as CryptoKey);

  async function issueTokens(
    sub: string,
    scope: string,
    authTime: number,
    family: string,
    nonce?: string,
  ): Promise<Record<string, unknown>> {
    const user = users.find((u) => u.sub === sub) as StackUser;
    const iat = Math.floor(now() / 1000);
    const profile = { email: user.email, email_verified: true, name: user.name, preferred_username: user.preferredUsername };
    const accessToken = await sign(
      { azp: clientId, scope, auth_time: authTime, jti: randomUUID(), ...profile },
      sub,
      settings.accessTokenTtlSeconds,
      iat,
    );
    const atHash = createHash('sha256').update(accessToken).digest().subarray(0, 16).toString('base64url');
    const idToken = await sign(
      { azp: clientId, auth_time: authTime, at_hash: atHash, ...(nonce === undefined ? {} : { nonce }), ...profile },
      sub,
      settings.accessTokenTtlSeconds,
      iat,
    );
    const body: Record<string, unknown> = {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: settings.accessTokenTtlSeconds,
      id_token: idToken,
      scope,
    };
    if (settings.offlineAccess && scope.split(' ').includes('offline_access')) {
      const refresh = randomBytes(48).toString('base64url');
      refreshes.set(refresh, { sub, scope, family, state: 'active', expiresAt: now() + REFRESH_TTL_MS, authTime });
      body['refresh_token'] = refresh;
    }
    return body;
  }

  const revokeFamily = (family: string): number => {
    let n = 0;
    for (const grant of refreshes.values()) {
      if (grant.family === family && grant.state !== 'revoked') {
        grant.state = 'revoked';
        n += 1;
      }
    }
    return n;
  };

  function authorize(query: URLSearchParams, res: http.ServerResponse): void {
    if (query.get('client_id') !== clientId) throw new OAuthError('invalid_client', 'unknown client_id');
    const redirectUri = query.get('redirect_uri') ?? '';
    if (!options.redirectUris.includes(redirectUri)) {
      throw new OAuthError('invalid_request', 'redirect_uri is not registered for this client');
    }
    const state = query.get('state') ?? '';
    const back = (params: Record<string, string>): void => {
      const target = new URL(redirectUri);
      for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
      if (state !== '') target.searchParams.set('state', state);
      res.writeHead(302, { location: target.toString(), 'cache-control': 'no-store' }).end();
    };
    const fail = (error: string, reason: string): void => {
      record({ endpoint: 'authorize', outcome: error, reason });
      back({ error, error_description: reason });
    };

    if (query.get('response_type') !== 'code') return fail('unsupported_response_type', 'only response_type=code');
    const scope = query.get('scope') ?? '';
    if (!scope.split(' ').includes('openid')) return fail('invalid_scope', 'scope must include openid');
    if (query.get('code_challenge_method') !== 'S256') return fail('invalid_request', 'PKCE with S256 is required');
    const challenge = query.get('code_challenge') ?? '';
    if (!CHALLENGE.test(challenge)) return fail('invalid_request', 'code_challenge must be a base64url SHA-256');
    const hint = query.get('login_hint');
    const user = hint === null || hint === '' ? current : findUser(hint);
    if (user === undefined) return fail('access_denied', 'no such user');

    const code = randomBytes(32).toString('base64url');
    const nonce = query.get('nonce');
    codes.set(code, {
      clientId,
      redirectUri,
      challenge,
      scope,
      ...(nonce === null || nonce === '' ? {} : { nonce }),
      sub: user.sub,
      expiresAt: now() + CODE_TTL_MS,
      used: false,
      families: [],
    });
    record({ endpoint: 'authorize', outcome: 'ok', sub: user.sub });
    back({ code });
  }

  async function token(fields: URLSearchParams): Promise<Record<string, unknown>> {
    const grantType = fields.get('grant_type') ?? '';
    if (fields.get('client_id') !== clientId) throw new OAuthError('invalid_client', 'unknown client_id', 401);

    if (grantType === 'authorization_code') {
      const grant = codes.get(fields.get('code') ?? '');
      if (grant === undefined) throw new OAuthError('invalid_grant', 'unknown code');
      if (grant.used) {
        for (const family of grant.families) revokeFamily(family);
        throw new OAuthError('invalid_grant', 'code already used; its tokens are revoked');
      }
      if (now() > grant.expiresAt) throw new OAuthError('invalid_grant', 'code expired');
      if (fields.get('redirect_uri') !== grant.redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri mismatch');
      const verifier = fields.get('code_verifier') ?? '';
      if (!VERIFIER.test(verifier)) throw new OAuthError('invalid_request', 'code_verifier is required');
      if (b64sha256(verifier) !== grant.challenge) throw new OAuthError('invalid_grant', 'PKCE verification failed');
      grant.used = true;
      const family = randomUUID();
      grant.families.push(family);
      const body = await issueTokens(grant.sub, grant.scope, Math.floor(now() / 1000), family, grant.nonce);
      record({ endpoint: 'token', grantType, outcome: 'ok', sub: grant.sub });
      return body;
    }

    if (grantType === 'refresh_token') {
      const presented = fields.get('refresh_token') ?? '';
      const grant = refreshes.get(presented);
      if (grant === undefined) throw new OAuthError('invalid_grant', 'unknown refresh token');
      if (grant.state === 'rotated') {
        if (settings.reuseRevokesFamily) revokeFamily(grant.family);
        throw new OAuthError('invalid_grant', 'rotated', 400);
      }
      if (grant.state === 'revoked') throw new OAuthError('invalid_grant', 'revoked');
      if (now() > grant.expiresAt) throw new OAuthError('invalid_grant', 'expired');
      grant.state = 'rotated';
      const body = await issueTokens(grant.sub, grant.scope, grant.authTime, grant.family);
      record({ endpoint: 'token', grantType, outcome: 'ok', sub: grant.sub });
      return body;
    }

    throw new OAuthError('unsupported_grant_type', `grant_type '${grantType}' is not supported`);
  }

  const cors = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const from = req.headers.origin;
    if (from !== undefined && options.allowedOrigins.includes(from)) {
      res.setHeader('access-control-allow-origin', from);
      res.setHeader('vary', 'Origin');
    }
  };

  server.on('request', (req, res) => {
    void (async () => {
      const target = new URL(req.url ?? '/', origin);
      const path = target.pathname;
      try {
        if (path === paths.discovery) {
          return sendJson(res, 200, {
            issuer,
            authorization_endpoint: url(paths.authorize),
            token_endpoint: url(paths.token),
            userinfo_endpoint: url(paths.userinfo),
            end_session_endpoint: url(paths.endSession),
            revocation_endpoint: url(paths.revoke),
            jwks_uri: url(paths.jwks),
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            code_challenge_methods_supported: ['S256'],
            scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
            subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'],
            token_endpoint_auth_methods_supported: ['none'],
          });
        }
        if (path === paths.jwks) return sendJson(res, 200, { keys: [publicJwk] });
        if (path === paths.authorize) return authorize(target.searchParams, res);
        if (path === paths.token || path === paths.revoke || path === paths.userinfo) {
          cors(req, res);
          if (req.method === 'OPTIONS') {
            res.writeHead(204, {
              'access-control-allow-methods': 'POST, GET, OPTIONS',
              'access-control-allow-headers': 'content-type, authorization',
              'access-control-max-age': '600',
            });
            return res.end();
          }
        }
        if (path === paths.userinfo) {
          const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
          if (bearer === undefined) return sendJson(res, 401, { error: 'invalid_token' });
          try {
            const { payload } = await jwtVerify(bearer, publicKey, { issuer, audience: clientId });
            const { sub, email, email_verified, name, preferred_username } = payload;
            return sendJson(res, 200, { sub, email, email_verified, name, preferred_username });
          } catch {
            return sendJson(res, 401, { error: 'invalid_token' });
          }
        }
        if (path === paths.token || path === paths.revoke) {
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'invalid_request' });
          const fields = new URLSearchParams(await readBody(req));
          if (path === paths.revoke) {
            const grant = refreshes.get(fields.get('token') ?? '');
            if (grant !== undefined) revokeFamily(grant.family);
            record({ endpoint: 'revoke', outcome: 'ok', ...(grant === undefined ? {} : { sub: grant.sub }) });
            res.writeHead(200).end();
            return;
          }
          const grantType = fields.get('grant_type') ?? '';
          try {
            const body = await token(fields);
            res.setHeader('cache-control', 'no-store');
            return sendJson(res, 200, body);
          } catch (err) {
            const e = err as OAuthError;
            record({ endpoint: 'token', grantType, outcome: e.error, reason: e.description });
            return sendJson(res, e.status, { error: e.error, error_description: e.description });
          }
        }
        if (path === paths.endSession) {
          const back = target.searchParams.get('post_logout_redirect_uri') ?? '';
          const allowed = options.redirectUris.some((r) => back !== '' && new URL(r).origin === new URL(back).origin);
          if (allowed) {
            res.writeHead(302, { location: back }).end();
            return;
          }
          res.writeHead(200, { 'content-type': 'text/plain' }).end('signed out');
          return;
        }
        sendJson(res, 404, { error: 'not_found' });
      } catch (err) {
        const e = err as OAuthError;
        sendJson(res, e.status, { error: e.error, error_description: e.description });
      }
    })();
  });

  return {
    origin,
    issuer,
    jwksUri: url(paths.jwks),
    authorizationEndpoint: url(paths.authorize),
    tokenEndpoint: url(paths.token),
    revocationEndpoint: url(paths.revoke),
    userinfoEndpoint: url(paths.userinfo),
    endSessionEndpoint: url(paths.endSession),
    clientId,
    log,
    users: () => [...users],
    loginAs: (sub) => {
      const user = users.find((u) => u.sub === sub);
      if (user === undefined) throw new Error(`unknown user ${sub}`);
      current = user;
    },
    revokeUser: (sub) => {
      const families = new Set([...refreshes.values()].filter((g) => g.sub === sub).map((g) => g.family));
      let n = 0;
      for (const family of families) n += revokeFamily(family);
      return n;
    },
    configure: (patch) => {
      Object.assign(settings, patch);
    },
    settings: () => ({ ...settings }),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

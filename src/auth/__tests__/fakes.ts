// Protocol fakes behind one routed fetch: an Authentik-shaped token endpoint (PKCE S256,
// rotating refresh tokens) and a coordinator edge that checks DPoP proofs as
// fc-coordinator does (binding, htm/htu, iat window, ath, nonce, jti).
import { EmbeddedJWK, SignJWT, calculateJwkThumbprint, generateKeyPair, jwtVerify, type JWK } from 'jose';
import { oidcConfig, type OidcConfig } from '../config';

export const APP_ORIGIN = 'https://app.test';
export const IDP_ORIGIN = 'https://idp.test';
export const SUB_A = '11111111-1111-4111-8111-111111111111';
export const SUB_B = '22222222-2222-4222-8222-222222222222';
/** 2026-09-26T12:00:00Z */
export const T0 = Date.UTC(2026, 8, 26, 12, 0, 0);

type Handler = (req: Request) => Promise<Response>;

export class FakeNet {
  offline = false;
  /** Origins whose requests never answer; they end only when the caller's signal aborts. */
  readonly hanging = new Set<string>();
  readonly calls: string[] = [];
  private readonly routes = new Map<string, Handler>();

  route(origin: string, handler: Handler): void {
    this.routes.set(origin, handler);
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    this.calls.push(`${req.method} ${req.url}`);
    req.signal.throwIfAborted();
    if (this.offline) throw new TypeError('Failed to fetch');
    if (this.hanging.has(new URL(req.url).origin)) {
      return new Promise<Response>((_resolve, reject) => {
        req.signal.addEventListener('abort', () => reject(req.signal.reason));
      });
    }
    const handler = this.routes.get(new URL(req.url).origin);
    if (handler === undefined) throw new TypeError('Failed to fetch');
    return handler(req);
  };
}

const b64sha256 = async (text: string): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let s = '';
  for (const b of digest) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

interface CodeGrant {
  challenge: string;
  redirectUri: string;
  nonce: string | null;
  sub: string;
  scope: string;
  used: boolean;
}

export interface TokenCall {
  grantType: string;
  outcome: string;
}

export class FakeIdp {
  readonly config: OidcConfig = oidcConfig(IDP_ORIGIN);
  offlineAccess = true;
  accessTtlSeconds = 600;
  /** Next token response is answered with this status and no body change (5xx simulation). */
  failNextWith: number | undefined;
  /** Replaces the id_token of every later answer. */
  idTokenOverride: string | undefined;
  /** Refresh answers carry only the access token: no rotation, no id_token, no expires_in or scope. */
  bareRefresh = false;
  readonly tokenCalls: TokenCall[] = [];
  now: () => number = () => T0;
  private readonly codes = new Map<string, CodeGrant>();
  private readonly refresh = new Map<string, { sub: string; scope: string; state: 'active' | 'rotated' | 'revoked' }>();
  private readonly access = new Map<string, { sub: string; exp: number }>();
  private counter = 0;

  private readonly key: CryptoKey;

  private constructor(key: CryptoKey) {
    this.key = key;
  }

  static async create(): Promise<FakeIdp> {
    const { privateKey } = await generateKeyPair('RS256');
    return new FakeIdp(privateKey);
  }

  /** The IdP side of /authorize: checks what the client sent and returns the callback URL. */
  authorize(authorizeUrl: string, sub = SUB_A): string {
    const url = new URL(authorizeUrl);
    const q = url.searchParams;
    if (`${url.origin}${url.pathname}` !== this.config.authorizationEndpoint) throw new Error(`wrong endpoint ${url}`);
    if (q.get('client_id') !== this.config.clientId) throw new Error('client_id');
    if (q.get('response_type') !== 'code') throw new Error('response_type');
    if (q.get('code_challenge_method') !== 'S256') throw new Error('S256 required');
    const code = `code-${++this.counter}`;
    this.codes.set(code, {
      challenge: q.get('code_challenge') ?? '',
      redirectUri: q.get('redirect_uri') ?? '',
      nonce: q.get('nonce'),
      sub,
      scope: q.get('scope') ?? '',
      used: false,
    });
    const back = new URL(q.get('redirect_uri') ?? '');
    back.searchParams.set('code', code);
    back.searchParams.set('state', q.get('state') ?? '');
    return back.toString();
  }

  revokeAll(sub: string): void {
    for (const grant of this.refresh.values()) if (grant.sub === sub) grant.state = 'revoked';
  }

  isValidAccess(token: string, nowMs: number): boolean {
    const grant = this.access.get(token);
    return grant !== undefined && nowMs < grant.exp;
  }

  refreshCount(): number {
    return this.tokenCalls.filter((c) => c.grantType === 'refresh_token' && c.outcome === 'ok').length;
  }

  private async issue(sub: string, scope: string, nonce: string | null): Promise<Record<string, unknown>> {
    const iat = Math.floor(this.now() / 1000);
    const accessToken = `at-${++this.counter}-${sub.slice(0, 4)}`;
    this.access.set(accessToken, { sub, exp: this.now() + this.accessTtlSeconds * 1000 });
    const idToken = await new SignJWT({ ...(nonce === null ? {} : { nonce }), email: 'a@test' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(this.config.issuer)
      .setAudience(this.config.clientId)
      .setSubject(sub)
      .setIssuedAt(iat)
      .setExpirationTime(iat + this.accessTtlSeconds)
      .sign(this.key);
    const body: Record<string, unknown> = {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: this.accessTtlSeconds,
      id_token: this.idTokenOverride ?? idToken,
      scope,
    };
    if (this.offlineAccess && scope.split(' ').includes('offline_access')) {
      const refresh = `rt-${++this.counter}`;
      this.refresh.set(refresh, { sub, scope, state: 'active' });
      body['refresh_token'] = refresh;
    }
    return body;
  }

  readonly handler: Handler = async (req) => {
    const url = new URL(req.url);
    if (`${url.origin}${url.pathname}` !== this.config.tokenEndpoint || req.method !== 'POST') {
      return json(404, { error: 'not_found' });
    }
    const form = new URLSearchParams(await req.text());
    const grantType = form.get('grant_type') ?? '';
    const fail = (error: string, status = 400): Response => {
      this.tokenCalls.push({ grantType, outcome: error });
      return json(status, { error });
    };
    if (this.failNextWith !== undefined) {
      const status = this.failNextWith;
      this.failNextWith = undefined;
      return fail('server_error', status);
    }
    if (form.get('client_id') !== this.config.clientId) return fail('invalid_client', 401);
    if (grantType === 'authorization_code') {
      const grant = this.codes.get(form.get('code') ?? '');
      if (grant === undefined || grant.used) return fail('invalid_grant');
      if (form.get('redirect_uri') !== grant.redirectUri) return fail('invalid_grant');
      if ((await b64sha256(form.get('code_verifier') ?? '')) !== grant.challenge) return fail('invalid_grant');
      grant.used = true;
      this.tokenCalls.push({ grantType, outcome: 'ok' });
      return json(200, await this.issue(grant.sub, grant.scope, grant.nonce));
    }
    if (grantType === 'refresh_token') {
      const grant = this.refresh.get(form.get('refresh_token') ?? '');
      if (grant === undefined || grant.state !== 'active') return fail('invalid_grant');
      this.tokenCalls.push({ grantType, outcome: 'ok' });
      const body = await this.issue(grant.sub, grant.scope, null);
      if (this.bareRefresh) return json(200, { access_token: body['access_token'], token_type: 'Bearer' });
      grant.state = 'rotated';
      return json(200, body);
    }
    return fail('unsupported_grant_type');
  };
}

export interface EdgeEntry {
  method: string;
  path: string;
  status: number;
  error?: string;
}

/** The coordinator's DPoP edge in miniature, for proofs signed by the real client code. */
export class FakeCoordinator {
  readonly log: EdgeEntry[] = [];
  readonly devices = new Map<string, string>();
  /** Server clock; the client's clock may differ from it. */
  serverNow: () => number = () => T0;
  private nonce = crypto.randomUUID();
  private readonly seen = new Set<string>();
  private counter = 0;

  private readonly idp: FakeIdp;

  constructor(idp: FakeIdp) {
    this.idp = idp;
  }

  restart(): void {
    this.nonce = crypto.randomUUID();
    this.seen.clear();
  }

  readonly handler: Handler = async (req) => {
    const url = new URL(req.url);
    const headers = { 'dpop-nonce': this.nonce, date: new Date(this.serverNow()).toUTCString() };
    const entry: EdgeEntry = { method: req.method, path: url.pathname, status: 0 };
    this.log.push(entry);
    const deny = (error: string): Response => {
      entry.status = 401;
      entry.error = error;
      return json(401, { error }, { ...headers, 'www-authenticate': `DPoP error="${error}", algs="ES256"` });
    };

    const [scheme, token] = (req.headers.get('authorization') ?? '').split(' ');
    if (scheme !== 'DPoP' || token === undefined || !this.idp.isValidAccess(token, this.serverNow())) {
      return deny('invalid_token');
    }
    let payload: Record<string, unknown>;
    let jwk: JWK;
    try {
      const verified = await jwtVerify(req.headers.get('dpop') ?? '', EmbeddedJWK, { typ: 'dpop+jwt', algorithms: ['ES256'] });
      payload = verified.payload;
      jwk = verified.protectedHeader.jwk as JWK;
    } catch {
      return deny('invalid_dpop_proof');
    }
    if (['d', 'ext', 'key_ops'].some((k) => k in jwk)) return deny('invalid_dpop_proof');
    const jkt = await calculateJwkThumbprint(jwk);
    const enrolling = url.pathname === '/api/auth/devices';
    if (!enrolling && !this.devices.has(jkt)) return deny('invalid_dpop_proof');
    if (payload['htm'] !== req.method || payload['htu'] !== `${APP_ORIGIN}${url.pathname}`) return deny('invalid_dpop_proof');
    const now = Math.floor(this.serverNow() / 1000);
    const iat = payload['iat'] as number;
    if (typeof iat !== 'number' || iat < now - 30 || iat > now + 5) return deny('invalid_dpop_proof');
    if (payload['ath'] !== (await b64sha256(token))) return deny('invalid_dpop_proof');
    if (payload['nonce'] !== this.nonce) return deny('use_dpop_nonce');
    const jti = payload['jti'] as string;
    if (typeof jti !== 'string' || this.seen.has(jti)) return deny('invalid_dpop_proof');
    this.seen.add(jti);

    const ok = (status: number, body: unknown): Response => {
      entry.status = status;
      return json(status, body, headers);
    };
    if (enrolling && req.method === 'POST') {
      const existing = this.devices.get(jkt);
      if (existing !== undefined) return ok(200, { deviceId: existing, jkt, created: false });
      const deviceId = `00000000-0000-4000-8000-${String(++this.counter).padStart(12, '0')}`;
      this.devices.set(jkt, deviceId);
      return ok(201, { deviceId, jkt, enrolledAt: new Date(this.serverNow()).toISOString(), created: true });
    }
    if (url.pathname === '/api/auth/session') return ok(200, { jkt, deviceId: this.devices.get(jkt) });
    if (url.pathname === '/api/coordinator.v1.CompareService/Compare') {
      const body = (await req.json()) as { gtin14?: string };
      return ok(200, { resultJson: JSON.stringify({ gtin14: body.gtin14 }), coverage: { redacted: [] } });
    }
    return ok(404, { error: 'not_found' });
  };
}

/** Web Locks semantics for one process: requests for the same name run one at a time, in order. */
export class MemoryLocks {
  private readonly tails = new Map<string, Promise<unknown>>();
  readonly requested: string[] = [];

  request<T>(name: string, callback: () => Promise<T>): Promise<T> {
    this.requested.push(name);
    const previous = this.tails.get(name) ?? Promise.resolve();
    const run = previous.then(callback, callback);
    this.tails.set(
      name,
      run.catch(() => undefined),
    );
    return run;
  }
}

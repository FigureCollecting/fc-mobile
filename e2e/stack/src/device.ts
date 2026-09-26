// A Node-side device for tests and seeding: signs in through the mock issuer
// with auth-code + PKCE, holds an ES256 DPoP key, enrols, and calls the
// coordinator through the edge with proofs and the one-shot nonce retry.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose';

export interface DeviceOptions {
  /** The edge origin; every proof's htu is this plus the request path. */
  origin: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  /** A user's sub, email or username; the issuer's current user when absent. */
  loginHint?: string;
  scope?: string;
}

export interface CallResult {
  status: number;
  headers: Headers;
  body: unknown;
}

export interface Device {
  sub: string;
  jkt: string;
  accessToken: string;
  refreshToken: string | undefined;
  deviceId: string | undefined;
  enrol(label?: string): Promise<CallResult>;
  call(method: string, path: string, body?: unknown): Promise<CallResult>;
  connect(service: string, rpc: string, message: unknown): Promise<CallResult>;
  refresh(): Promise<void>;
}

const b64sha256 = (value: string): string => createHash('sha256').update(value, 'ascii').digest('base64url');

async function tokenRequest(endpoint: string, fields: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (res.status !== 200) throw new Error(`token endpoint ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

const subOf = (jwt: string): string =>
  (JSON.parse(Buffer.from(jwt.split('.')[1] as string, 'base64url').toString('utf8')) as { sub: string }).sub;

export async function loginDevice(options: DeviceOptions): Promise<Device> {
  const redirectUri = `${options.origin}/callback`;
  const verifier = randomBytes(32).toString('base64url');
  const state = randomUUID();
  const authorize = new URL(options.authorizationEndpoint);
  const params: Record<string, string> = {
    response_type: 'code',
    client_id: options.clientId,
    redirect_uri: redirectUri,
    scope: options.scope ?? 'openid profile email offline_access',
    state,
    code_challenge: b64sha256(verifier),
    code_challenge_method: 'S256',
  };
  if (options.loginHint !== undefined) params['login_hint'] = options.loginHint;
  for (const [k, v] of Object.entries(params)) authorize.searchParams.set(k, v);
  const redirect = await fetch(authorize, { redirect: 'manual' });
  const location = new URL(redirect.headers.get('location') ?? '', redirectUri);
  const code = location.searchParams.get('code');
  if (code === null || location.searchParams.get('state') !== state) {
    throw new Error(`authorize did not return a code: ${location.toString()}`);
  }
  let tokens = await tokenRequest(options.tokenEndpoint, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: options.clientId,
    code_verifier: verifier,
  });

  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const jwk: JWK = await exportJWK(publicKey);
  const jkt = await calculateJwkThumbprint(jwk, 'sha256');
  let nonce: string | undefined;

  const proof = (method: string, path: string, accessToken: string): Promise<string> =>
    new SignJWT({
      htm: method,
      htu: `${options.origin}${path}`,
      jti: randomUUID(),
      ath: b64sha256(accessToken),
      ...(nonce === undefined ? {} : { nonce }),
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk })
      .setIssuedAt()
      .sign(privateKey as CryptoKey);

  const device: Device = {
    sub: subOf(tokens['access_token'] as string),
    jkt,
    accessToken: tokens['access_token'] as string,
    refreshToken: tokens['refresh_token'] as string | undefined,
    deviceId: undefined,
    async call(method, path, body) {
      const send = async (): Promise<Response> =>
        fetch(`${options.origin}${path}`, {
          method,
          headers: {
            authorization: `DPoP ${device.accessToken}`,
            dpop: await proof(method, path, device.accessToken),
            'content-type': 'application/json',
            'connect-protocol-version': '1',
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      let res = await send();
      const retryNonce = res.headers.get('dpop-nonce');
      if (retryNonce !== null) nonce = retryNonce;
      if (res.status === 401 && (res.headers.get('www-authenticate') ?? '').includes('use_dpop_nonce')) {
        res = await send();
        nonce = res.headers.get('dpop-nonce') ?? nonce;
      }
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // not JSON; keep the text
      }
      return { status: res.status, headers: res.headers, body: parsed };
    },
    async enrol(label = 'stack device') {
      const result = await device.call('POST', '/api/auth/devices', { label });
      const id = (result.body as { deviceId?: unknown } | null)?.deviceId;
      if (typeof id === 'string') device.deviceId = id;
      return result;
    },
    connect: (service, rpc, message) => device.call('POST', `/api/${service}/${rpc}`, message),
    async refresh() {
      if (device.refreshToken === undefined) throw new Error('no refresh token (offline_access not granted)');
      tokens = await tokenRequest(options.tokenEndpoint, {
        grant_type: 'refresh_token',
        refresh_token: device.refreshToken,
        client_id: options.clientId,
      });
      device.accessToken = tokens['access_token'] as string;
      device.refreshToken = tokens['refresh_token'] as string | undefined;
    },
  };
  return device;
}

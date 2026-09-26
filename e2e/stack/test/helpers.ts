// Shared test helpers. Not a *.vitest.ts file, so no runner collects it.
import * as crypto from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { ENTITLEMENT_AUDIENCE, ENTITLEMENT_ISSUER } from '@figurecollecting/ingest-contract/entitlement';
import type { EntitlementKey } from '../src/entitlement.js';

export function mintAssertion(key: EntitlementKey, sub: string, ent: string[], nowMs = Date.now()): string {
  const iat = Math.floor(nowMs / 1000);
  const h = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: key.kid })).toString('base64url');
  const p = Buffer.from(
    JSON.stringify({ iss: ENTITLEMENT_ISSUER, aud: ENTITLEMENT_AUDIENCE, sub, ent, iat, exp: iat + 60, kid: key.kid }),
  ).toString('base64url');
  const sig = crypto.sign(null, Buffer.from(`${h}.${p}`), key.privateKey).toString('base64url');
  return `${h}.${p}.${sig}`;
}

export interface Echo {
  url: string;
  requests: Array<{ method: string; url: string; headers: http.IncomingHttpHeaders; body: string }>;
  close(): Promise<void>;
}

/** An upstream that answers with its own name, the path it saw and a DPoP-Nonce. */
export async function startEcho(name: string): Promise<Echo> {
  const requests: Echo['requests'] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      res.setHeader('content-type', 'application/json');
      res.setHeader('dpop-nonce', `nonce-from-${name}`);
      res.setHeader('connection', 'keep-alive');
      res.end(JSON.stringify({ upstream: name, url: req.url, body }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** A raw HTTP/1.1 request that never follows redirects and exposes socket errors. */
export function request(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: options.method ?? 'GET', headers: options.headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }),
      );
    });
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

export const form = (fields: Record<string, string>): string => new URLSearchParams(fields).toString();

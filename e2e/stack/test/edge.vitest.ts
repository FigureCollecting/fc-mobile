import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { routeFor, startEdge, type Edge } from '../src/edge.js';
import { request, startEcho, type Echo } from './helpers.js';

describe('edge path split (the tunnel rule)', () => {
  it.each([
    ['/api', 'coordinator'],
    ['/api/', 'coordinator'],
    ['/api/x', 'coordinator'],
    ['/api/coordinator.v1.CompareService/Compare', 'coordinator'],
    ['/apix', 'web'],
    ['/api-docs', 'web'],
    ['/', 'web'],
    ['/figure/123', 'web'],
    ['/assets/index.js', 'web'],
    ['/callback', 'web'],
  ])('%s -> %s', (path, route) => {
    expect(routeFor(path)).toBe(route);
  });
});

describe('edge proxy', () => {
  let coordinator: Echo;
  let web: Echo;
  let edge: Edge;
  const base = (): string => `http://127.0.0.1:${edge.port}`;
  const upstreamOf = (body: string): string => (JSON.parse(body) as { upstream: string }).upstream;

  beforeAll(async () => {
    coordinator = await startEcho('coordinator');
    web = await startEcho('web');
    edge = await startEdge({ coordinator: coordinator.url, web: web.url });
  });
  afterAll(async () => {
    await edge.close();
    await coordinator.close();
    await web.close();
  });
  beforeEach(() => {
    edge.clearFaults();
    edge.log.length = 0;
    coordinator.requests.length = 0;
    web.requests.length = 0;
  });

  it('names a localhost origin, which browsers treat as a secure context', () => {
    expect(edge.origin).toBe(`http://localhost:${edge.port}`);
  });

  it('routes /api to the coordinator unrewritten, query intact, and everything else to web', async () => {
    const api = await request(`${base()}/api/x?y=1`);
    expect(upstreamOf(api.body)).toBe('coordinator');
    expect(coordinator.requests[0]?.url).toBe('/api/x?y=1');
    expect(upstreamOf((await request(`${base()}/api`)).body)).toBe('coordinator');
    expect(upstreamOf((await request(`${base()}/apix`)).body)).toBe('web');
    expect(upstreamOf((await request(`${base()}/figure/7`)).body)).toBe('web');
    expect(edge.log.map((e) => e.route)).toEqual(['coordinator', 'coordinator', 'web', 'web']);
    expect(edge.log[0]).toMatchObject({ method: 'GET', path: '/api/x', status: 200 });
  });

  it('forwards method, body and auth headers, preserves Host, and returns DPoP-Nonce', async () => {
    const reply = await request(`${base()}/api/coordinator.v1.CompareService/Compare`, {
      method: 'POST',
      headers: { authorization: 'DPoP tok', dpop: 'proof', 'content-type': 'application/json', host: 'localhost:9999' },
      body: '{"gtin14":"04580557158691"}',
    });
    expect(reply.headers['dpop-nonce']).toBe('nonce-from-coordinator');
    const seen = coordinator.requests[0]!;
    expect(seen.method).toBe('POST');
    expect(seen.body).toBe('{"gtin14":"04580557158691"}');
    expect(seen.headers['authorization']).toBe('DPoP tok');
    expect(seen.headers['dpop']).toBe('proof');
    expect(seen.headers['host']).toBe('localhost:9999');
    expect(seen.headers['x-forwarded-proto']).toBe('http');
    expect(seen.headers['x-forwarded-for']).toBe('127.0.0.1');
    expect(reply.headers['connection']).not.toBe('keep-alive, keep-alive');
  });

  it('answers 502 when an upstream is down, like cloudflared', async () => {
    edge.setUpstream('web', 'http://127.0.0.1:1');
    const reply = await request(`${base()}/`);
    expect(reply.status).toBe(502);
    edge.setUpstream('web', web.url);
    expect((await request(`${base()}/`)).status).toBe(200);
  });

  it('drops the response after the upstream has handled the request', async () => {
    edge.addFault({ match: '^/api/coordinator\\.v1\\.SyncService/Push$', method: 'POST', action: 'drop-response' });
    expect(edge.faults()).toHaveLength(1);
    const push = `${base()}/api/coordinator.v1.SyncService/Push`;
    await expect(request(push, { method: 'POST', body: '{}' })).rejects.toThrow(/socket hang up|ECONNRESET/);
    expect(coordinator.requests).toHaveLength(1);
    expect(edge.log.at(-1)).toMatchObject({ fault: 'drop-response' });
    // One shot: the retry gets through.
    expect((await request(push, { method: 'POST', body: '{}' })).status).toBe(200);
    expect(coordinator.requests).toHaveLength(2);
    expect(edge.faults()).toHaveLength(0);
  });

  it('numbers every entry, so a reader resumes by seq even after the log is trimmed', async () => {
    const small = await startEdge({ coordinator: coordinator.url, web: web.url, logLimit: 3 });
    try {
      for (let i = 0; i < 5; i += 1) await request(`http://127.0.0.1:${small.port}/r${i}`);
      expect(small.log.map((e) => [e.seq, e.path])).toEqual([
        [3, '/r2'],
        [4, '/r3'],
        [5, '/r4'],
      ]);
    } finally {
      await small.close();
    }
  });

  it('ignores a fault whose method does not match', async () => {
    edge.addFault({ match: '^/api/', method: 'POST', action: 'status', status: 503 });
    expect((await request(`${base()}/api/x`)).status).toBe(200);
  });

  it('answers a status fault without reaching the upstream, repeatedly when times is 0', async () => {
    edge.addFault({ match: '^/$', action: 'status', status: 503, times: 0 });
    expect((await request(`${base()}/`)).status).toBe(503);
    expect((await request(`${base()}/`)).status).toBe(503);
    expect(web.requests).toHaveLength(0);
    edge.clearFaults();
    expect((await request(`${base()}/`)).status).toBe(200);
  });

  it('holds a hung request open until released', async () => {
    edge.addFault({ match: '^/api/', action: 'hang' });
    let settled = false;
    const pending = request(`${base()}/api/slow`).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise((r) => setTimeout(r, 150));
    expect(settled).toBe(false);
    expect(coordinator.requests).toHaveLength(0);
    edge.releaseHung();
    await pending;
    expect(settled).toBe(true);
  });

  it('stops listening for a true outage and comes back on the same port', async () => {
    const port = edge.port;
    await edge.stop();
    expect(edge.running()).toBe(false);
    await expect(request(`${base()}/`)).rejects.toThrow(/ECONNREFUSED/);
    await edge.stop();
    await edge.start();
    await edge.start();
    expect(edge.running()).toBe(true);
    expect(edge.port).toBe(port);
    expect((await request(`${base()}/`)).status).toBe(200);
  });

  it('rejects a fault with an invalid pattern', () => {
    expect(() => edge.addFault({ match: '(', action: 'hang' })).toThrow();
  });

  it('cuts the reply when the upstream dies mid-response', async () => {
    const flaky = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('partial');
      setTimeout(() => res.socket?.destroy(), 20);
    });
    await new Promise<void>((resolve) => flaky.listen(0, '127.0.0.1', () => resolve()));
    edge.setUpstream('web', `http://127.0.0.1:${(flaky.address() as AddressInfo).port}`);
    await expect(request(`${base()}/`)).rejects.toThrow(/aborted|ECONNRESET|socket hang up/);
    edge.setUpstream('web', web.url);
    flaky.closeAllConnections();
    await new Promise<void>((resolve) => flaky.close(() => resolve()));
  });
});

describe('edge listeners', () => {
  it('still serves 127.0.0.1 when [::1] is unavailable on that port', async () => {
    const blocker = http.createServer();
    const port = await new Promise<number>((resolve) => {
      blocker.once('error', () => resolve(0));
      blocker.listen(0, '::1', () => resolve((blocker.address() as AddressInfo).port));
    });
    const echo = await startEcho('web');
    const edge = await startEdge({ coordinator: echo.url, web: echo.url, port });
    expect((await request(`http://127.0.0.1:${edge.port}/`)).status).toBe(200);
    await edge.close();
    await echo.close();
    if (blocker.listening) await new Promise<void>((resolve) => blocker.close(() => resolve()));
  });

  it('refuses a port already taken on 127.0.0.1', async () => {
    const echo = await startEcho('web');
    const port = Number(new URL(echo.url).port);
    await expect(startEdge({ coordinator: echo.url, web: echo.url, port })).rejects.toThrow(/EADDRINUSE/);
    await echo.close();
  });
});

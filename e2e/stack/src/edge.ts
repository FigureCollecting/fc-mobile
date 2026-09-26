// The fc-app tunnel rule in miniature: ^/api(/.*)?$ to the coordinator with the
// path unrewritten, everything else to the web image. Faults and a real
// stop/start let e2e tests reproduce a dropped reply and a true outage.
import * as http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

export type Route = 'coordinator' | 'web';

export const API_PATH = /^\/api(\/.*)?$/;

export function routeFor(path: string): Route {
  return API_PATH.test(path) ? 'coordinator' : 'web';
}

export interface FaultRule {
  /** Regex source matched against the request path (no query). */
  match: string;
  method?: string;
  /** drop-response: forward, then cut the reply. hang: never answer. status: answer at once. */
  action: 'drop-response' | 'hang' | 'status';
  status?: number;
  /** How many requests it applies to; 0 means until cleared. Default 1. */
  times?: number;
}

export interface EdgeLogEntry {
  at: string;
  method: string;
  path: string;
  route: Route;
  status?: number;
  fault?: FaultRule['action'];
}

export interface EdgeOptions {
  coordinator: string;
  web: string;
  port?: number;
}

export interface Edge {
  origin: string;
  port: number;
  log: EdgeLogEntry[];
  setUpstream(route: Route, url: string): void;
  addFault(rule: FaultRule): void;
  clearFaults(): void;
  faults(): FaultRule[];
  releaseHung(): void;
  stop(): Promise<void>;
  start(): Promise<void>;
  running(): boolean;
  close(): Promise<void>;
}

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade',
]);
const LOG_LIMIT = 2000;

function forwardable(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(name) && value !== undefined) out[name] = value;
  }
  return out;
}

interface ActiveFault {
  rule: FaultRule;
  pattern: RegExp;
  remaining: number;
}

export async function startEdge(options: EdgeOptions): Promise<Edge> {
  const upstreams: Record<Route, URL> = { coordinator: new URL(options.coordinator), web: new URL(options.web) };
  const log: EdgeLogEntry[] = [];
  let active: ActiveFault[] = [];
  const hung = new Set<http.ServerResponse>();
  const sockets = new Set<Socket>();
  let servers: http.Server[] = [];
  let port = options.port ?? 0;

  const takeFault = (method: string, path: string): FaultRule | undefined => {
    const hit = active.find((f) => (f.rule.method === undefined || f.rule.method === method) && f.pattern.test(path));
    if (hit === undefined) return undefined;
    if (hit.remaining > 0) {
      hit.remaining -= 1;
      if (hit.remaining === 0) active = active.filter((f) => f !== hit);
    }
    return hit.rule;
  };

  const handler = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const method = req.method as string;
    const path = (req.url as string).split('?')[0] as string;
    const route = routeFor(path);
    const entry: EdgeLogEntry = { at: new Date().toISOString(), method, path, route };
    const done = (status?: number): void => {
      if (status !== undefined) entry.status = status;
      log.push(entry);
      if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT);
    };

    const fault = takeFault(method, path);
    if (fault !== undefined) entry.fault = fault.action;
    if (fault?.action === 'hang') {
      hung.add(res);
      res.once('close', () => hung.delete(res));
      done();
      return;
    }
    if (fault?.action === 'status') {
      const status = fault.status ?? 503;
      res.writeHead(status, { 'content-type': 'text/plain' }).end(`edge fault ${status}`);
      done(status);
      return;
    }

    const target = upstreams[route];
    const headers = forwardable(req.headers);
    headers['x-forwarded-for'] = req.socket.remoteAddress as string;
    headers['x-forwarded-proto'] = 'http';
    const upstream = http.request(
      { host: target.hostname, port: target.port, method, path: req.url, headers, agent: false },
      (upstreamRes) => {
        if (fault?.action === 'drop-response') {
          // The upstream has committed; consume its reply and cut ours.
          upstreamRes.resume();
          upstreamRes.on('end', () => {
            req.socket.destroy();
            done(upstreamRes.statusCode);
          });
          return;
        }
        res.writeHead(upstreamRes.statusCode as number, forwardable(upstreamRes.headers));
        upstreamRes.pipe(res);
        upstreamRes.on('end', () => done(upstreamRes.statusCode));
        // An upstream that dies mid-reply must cut ours too, or the client waits forever.
        upstreamRes.on('close', () => {
          if (!upstreamRes.complete) {
            res.destroy();
            done(502);
          }
        });
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }).end('Bad Gateway');
      else res.destroy();
      done(502);
    });
    req.pipe(upstream);
  };

  const listen = (host: string, wanted: number): Promise<http.Server | undefined> =>
    new Promise((resolve, reject) => {
      const server = http.createServer(handler);
      server.on('connection', (s) => {
        sockets.add(s);
        s.once('close', () => sockets.delete(s));
      });
      server.once('error', (err: NodeJS.ErrnoException) => {
        // ::1 is best effort: a host without IPv6 loopback still serves 127.0.0.1.
        if (host === '::1') resolve(undefined);
        else reject(err);
      });
      server.listen(wanted, host, () => resolve(server));
    });

  const start = async (): Promise<void> => {
    if (servers.length > 0) return;
    const v4 = (await listen('127.0.0.1', port)) as http.Server;
    port = (v4.address() as AddressInfo).port;
    const v6 = await listen('::1', port);
    servers = v6 === undefined ? [v4] : [v4, v6];
  };

  const stop = async (): Promise<void> => {
    const closing = servers;
    servers = [];
    for (const res of hung) res.destroy();
    for (const s of sockets) s.destroy();
    await Promise.all(closing.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  };

  await start();

  return {
    get origin() {
      return `http://localhost:${port}`;
    },
    get port() {
      return port;
    },
    log,
    setUpstream: (route, url) => {
      upstreams[route] = new URL(url);
    },
    addFault: (rule) => {
      active.push({ rule, pattern: new RegExp(rule.match), remaining: rule.times ?? 1 });
    },
    clearFaults: () => {
      active = [];
    },
    faults: () => active.map((f) => f.rule),
    releaseHung: () => {
      for (const res of hung) res.destroy();
    },
    stop,
    start,
    running: () => servers.length > 0,
    close: stop,
  };
}

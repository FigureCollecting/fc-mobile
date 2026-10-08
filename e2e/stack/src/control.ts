// The control API a test process uses to steer a running stack: outages,
// edge faults, issuer state, and what the fakes saw. Loopback only.
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CoordinatorProcess } from './coordinator.js';
import type { Edge, FaultRule } from './edge.js';
import { readBody, sendJson } from './http.js';
import type { IssuerSettings, MockIssuer } from './issuer.js';
import type { FakeOpenFga, Tuple } from './openfga.js';
import type { StackPostgres } from './postgres.js';
import type { FakeSpine } from './spine.js';
import type { StackWeb } from './web.js';

export interface ControlTarget {
  state: unknown;
  edge: Pick<Edge, 'log' | 'running' | 'stop' | 'start' | 'addFault' | 'clearFaults' | 'faults' | 'releaseHung'>;
  coordinator: Pick<CoordinatorProcess, 'running' | 'stop' | 'start' | 'restart'>;
  web: Pick<StackWeb, 'stop'>;
  startWeb(): Promise<void>;
  issuer: Pick<MockIssuer, 'log' | 'loginAs' | 'revokeUser' | 'configure' | 'settings'>;
  spine: Pick<FakeSpine, 'calls'>;
  openfga: Pick<FakeOpenFga, 'calls' | 'tuples' | 'write' | 'remove'>;
  postgres: Pick<StackPostgres, 'psql'>;
  stop(): Promise<void>;
}

export interface SyncCounts {
  /** Push receipts of the user, or of one client_id when asked. */
  receipts: number;
  feedEvents: number;
  /** facet_state rows of the user whose key starts with the prefix asked for (all when none). */
  facets: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLIENT_ID = /^[A-Za-z0-9._-]{1,128}$/;
const KEY_PREFIX = /^[a-z0-9/-]{0,64}$/;

/** Counts read straight from the coordinator database, for idempotency and seeding checks. Every input is checked before it reaches SQL. */
async function syncCounts(pg: Pick<StackPostgres, 'psql'>, query: URLSearchParams): Promise<SyncCounts> {
  const user = query.get('user') ?? '';
  const clientId = query.get('client_id');
  const prefix = query.get('prefix') ?? '';
  if (!UUID.test(user)) throw new Error(`bad user ${JSON.stringify(user)}`);
  if (clientId !== null && !CLIENT_ID.test(clientId)) throw new Error(`bad client_id ${JSON.stringify(clientId)}`);
  if (!KEY_PREFIX.test(prefix)) throw new Error(`bad prefix ${JSON.stringify(prefix)}`);
  const byClient = clientId === null ? '' : ` AND client_id = '${clientId}'`;
  const sql =
    `SELECT (SELECT count(*) FROM mutation_receipt WHERE user_id = '${user}'${byClient})` +
    ` || '|' || (SELECT count(*) FROM feed_event WHERE user_id = '${user}')` +
    ` || '|' || (SELECT count(*) FROM facet_state WHERE user_id = '${user}' AND facet_key LIKE '${prefix}%')`;
  const [receipts, feedEvents, facets] = (await pg.psql(sql, 'superuser')).trim().split('|').map(Number);
  return { receipts: receipts!, feedEvents: feedEvents!, facets: facets! };
}

export interface Control {
  url: string;
  close(): Promise<void>;
}

type Handler = (body: unknown, query: URLSearchParams) => unknown;

/** Entries after a cursor (`?since=<seq>`); the logs are read this way because the edge log is trimmed. */
function since<T extends { seq: number }>(log: T[], query: URLSearchParams): T[] {
  const raw = query.get('since') ?? '0';
  if (!/^\d{1,15}$/.test(raw)) throw new Error(`bad since ${raw}`);
  const cursor = Number(raw);
  return log.filter((e) => e.seq > cursor);
}

const cursorOf = (log: Array<{ seq: number }>): { seq: number } => ({ seq: log.at(-1)?.seq ?? 0 });

export async function startControl(target: ControlTarget, port: number, host = '127.0.0.1'): Promise<Control> {
  const ok = { ok: true };
  const routes: Record<string, Handler> = {
    'GET /state': () => target.state,
    'GET /health': () => ({ edge: target.edge.running(), coordinator: target.coordinator.running() }),
    'POST /edge/stop': async () => (await target.edge.stop(), ok),
    'POST /edge/start': async () => (await target.edge.start(), ok),
    'GET /edge/log': (_body, query) => since(target.edge.log, query),
    'GET /edge/cursor': () => cursorOf(target.edge.log),
    'GET /edge/faults': () => target.edge.faults(),
    'POST /edge/faults': (body) => (target.edge.addFault(body as FaultRule), ok),
    'DELETE /edge/faults': () => (target.edge.clearFaults(), ok),
    'POST /edge/release': () => (target.edge.releaseHung(), ok),
    'POST /coordinator/stop': async () => (await target.coordinator.stop(), ok),
    'POST /coordinator/start': async () => (await target.coordinator.start(), ok),
    'POST /coordinator/restart': async () => (await target.coordinator.restart(), ok),
    'POST /web/stop': async () => (await target.web.stop(), ok),
    'POST /web/start': async () => (await target.startWeb(), ok),
    'GET /issuer/log': (_body, query) => since(target.issuer.log, query),
    'GET /issuer/cursor': () => cursorOf(target.issuer.log),
    'POST /issuer/login-as': (body) => (target.issuer.loginAs((body as { sub: string }).sub), ok),
    'POST /issuer/revoke-user': (body) => ({ revoked: target.issuer.revokeUser((body as { sub: string }).sub) }),
    'POST /issuer/configure': (body) => (target.issuer.configure(body as Partial<IssuerSettings>), target.issuer.settings()),
    'GET /spine/calls': () => target.spine.calls,
    'DELETE /spine/calls': () => ((target.spine.calls.length = 0), ok),
    'GET /openfga/tuples': () => target.openfga.tuples(),
    'POST /openfga/tuples': (body) => (target.openfga.write(body as Tuple), ok),
    'DELETE /openfga/tuples': (body) => (target.openfga.remove(body as Tuple), ok),
    'GET /openfga/calls': () => target.openfga.calls,
    'GET /sync/counts': (_body, query) => syncCounts(target.postgres, query),
  };

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url as string, 'http://control');
      const key = `${req.method as string} ${url.pathname}`;
      if (key === 'POST /shutdown') {
        sendJson(res, 202, ok);
        // Answer first: stopping closes this server too.
        setImmediate(() => void target.stop());
        return;
      }
      const handler = routes[key];
      if (handler === undefined) return sendJson(res, 404, { error: `no route ${key}` });
      try {
        const raw = await readBody(req);
        const body: unknown = raw === '' ? undefined : JSON.parse(raw);
        sendJson(res, 200, await handler(body, url.searchParams));
      } catch (err) {
        sendJson(res, 400, { error: (err as Error).message });
      }
    })();
  });
  const bound = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve((server.address() as AddressInfo).port));
  });
  return {
    url: `http://${host}:${bound}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

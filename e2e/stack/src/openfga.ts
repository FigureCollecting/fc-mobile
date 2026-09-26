// Fake OpenFGA: openfga.v1 Check over gRPC on h2c, as the real service on
// :8081. Tuples are seeded by the harness and editable at runtime; auth is the
// preshared key of the coordinator's OPENFGA_API_TOKEN mode.
import * as http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { Code, ConnectError, type ConnectRouter } from '@connectrpc/connect';
import { connectNodeAdapter } from '@connectrpc/connect-node';
// Vendored verbatim from fc-coordinator c0db861 (its slice of openfga/api).
import { OpenFGAService } from './gen/openfga/v1/openfga_service_pb.js';

export interface Tuple {
  user: string;
  relation: string;
  object: string;
}

export interface FgaCall extends Tuple {
  storeId: string;
  allowed: boolean;
  at: string;
}

export interface FakeOpenFgaOptions {
  storeId: string;
  token: string;
  tuples?: Tuple[];
  host?: string;
  port?: number;
}

export interface FakeOpenFga {
  url: string;
  calls: FgaCall[];
  tuples(): Tuple[];
  write(tuple: Tuple): void;
  remove(tuple: Tuple): void;
  close(): Promise<void>;
}

const keyOf = (t: Tuple): string => `${t.user}#${t.relation}@${t.object}`;

export async function startFakeOpenFga(options: FakeOpenFgaOptions): Promise<FakeOpenFga> {
  const host = options.host ?? '127.0.0.1';
  const store = new Map<string, Tuple>();
  for (const t of options.tuples ?? []) store.set(keyOf(t), { ...t });
  const calls: FgaCall[] = [];

  const routes = (router: ConnectRouter): void => {
    router.service(OpenFGAService, {
      check: (req, ctx) => {
        if (ctx.requestHeader.get('authorization') !== `Bearer ${options.token}`) {
          throw new ConnectError('invalid preshared key', Code.Unauthenticated);
        }
        if (req.storeId !== options.storeId) throw new ConnectError('unknown store', Code.InvalidArgument);
        if (req.tupleKey === undefined) throw new ConnectError('tuple_key is required', Code.InvalidArgument);
        const asked: Tuple = { user: req.tupleKey.user, relation: req.tupleKey.relation, object: req.tupleKey.object };
        const allowed = store.has(keyOf(asked));
        calls.push({ ...asked, storeId: req.storeId, allowed, at: new Date().toISOString() });
        return { allowed, resolution: '' };
      },
    });
  };

  const server = http2.createServer(connectNodeAdapter({ routes }));
  const sessions = new Set<http2.ServerHttp2Session>();
  server.on('session', (s) => {
    sessions.add(s);
    s.once('close', () => sessions.delete(s));
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => resolve((server.address() as AddressInfo).port));
  });

  return {
    url: `http://${host}:${port}`,
    calls,
    tuples: () => [...store.values()].map((t) => ({ ...t })),
    write: (t) => {
      store.set(keyOf(t), { ...t });
    },
    remove: (t) => {
      store.delete(keyOf(t));
    },
    close: async () => {
      for (const s of sessions) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

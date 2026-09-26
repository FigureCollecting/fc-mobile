// Fake read.v1 SpineRead over the catalog fixture, on ingest-server's two wires:
// gRPC over h2c (:50062) and Connect over HTTP/1.1 (:50052). Paging, redirect
// resolution and redaction mirror fc-aggregation src/read/products.ts.
import { createHash } from 'node:crypto';
import type * as crypto from 'node:crypto';
import * as http from 'node:http';
import * as http2 from 'node:http2';
import type { AddressInfo, Socket } from 'node:net';
import { Code, ConnectError, type ConnectRouter, type HandlerContext } from '@connectrpc/connect';
import { connectNodeAdapter } from '@connectrpc/connect-node';
import {
  SpineRead,
  type CompareRequest,
  type GetProductImagesRequest,
  type GetProductsRequest,
  type ProductRef,
} from '@figurecollecting/ingest-contract/read';
import { ENTITLEMENTS_HEADER, INVENTORY_LEVELS } from '@figurecollecting/ingest-contract/entitlement';
import type { Catalog, FixtureClaim, FixtureProduct } from './catalog.js';
import { verifyEntitlementHeader } from './entitlement.js';

export const MAX_REFS = 200;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
export const SEMANTICS_REV = '5ac4f1e0d2b39a77';

/** The fixture's only gated key; availability (stockStatus) stays public, as live. */
const GATED_KEYS: ReadonlySet<string> = new Set(['stockOnHand']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNIT_SEP = '\u001f';

export type Wire = 'h2c' | 'h1';
export type Protocol = 'grpc' | 'grpc-web' | 'connect';

export interface SpineCall {
  method: 'compare' | 'getProducts' | 'getProductImages';
  wire: Wire;
  protocol: Protocol;
  entitlementOutcome: string;
  entitled: boolean;
  sub?: string;
  at: string;
}

export interface FakeSpineOptions {
  catalog: Catalog;
  keys: ReadonlyMap<string, crypto.KeyObject>;
  host?: string;
  h2cPort?: number;
  h1Port?: number;
}

export interface FakeSpine {
  h2cUrl: string;
  h1Url: string;
  calls: SpineCall[];
  close(): Promise<void>;
}

type WireRef = { productId: string } | { gtin14: string } | { sourceItem: { site: string; nativeId: string } };

const invalid = (message: string): ConnectError => new ConnectError(message, Code.InvalidArgument);

function toWireRef(ref: ProductRef): WireRef {
  switch (ref.ref.case) {
    case 'productId':
      if (ref.ref.value === '') throw invalid('product_id must not be empty');
      return { productId: ref.ref.value };
    case 'gtin14':
      if (ref.ref.value === '') throw invalid('gtin14 must not be empty');
      return { gtin14: ref.ref.value };
    case 'sourceItem':
      if (ref.ref.value.site === '' || ref.ref.value.nativeId === '') {
        throw invalid('source_item must carry both site and native_id');
      }
      return { sourceItem: { site: ref.ref.value.site, nativeId: ref.ref.value.nativeId } };
    default:
      throw invalid('each ref must set exactly one of product_id, gtin14 or source_item');
  }
}

function refKey(ref: WireRef): string {
  if ('productId' in ref) return `p:${ref.productId}`;
  if ('gtin14' in ref) return `g:${ref.gtin14}`;
  return `s:${ref.sourceItem.site}${UNIT_SEP}${ref.sourceItem.nativeId}`;
}

const fingerprint = (refs: readonly WireRef[]): string =>
  createHash('sha256').update(refs.map(refKey).join(UNIT_SEP), 'utf8').digest('hex').slice(0, 24);

const encodeToken = (offset: number, fp: string): string =>
  Buffer.from(JSON.stringify({ o: offset, f: fp }), 'utf8').toString('base64url');

function decodeToken(token: string, fp: string): number {
  let parsed: { o?: unknown; f?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as { o?: unknown; f?: unknown };
  } catch {
    throw invalid('page_token is not a token this server issued');
  }
  if (typeof parsed.o !== 'number' || !Number.isInteger(parsed.o) || parsed.o < 0 || typeof parsed.f !== 'string') {
    throw invalid('page_token is not a token this server issued');
  }
  if (parsed.f !== fp) throw invalid('page_token was issued for a different batch');
  return parsed.o;
}

const clampPageSize = (requested: number): number =>
  requested === 0 ? DEFAULT_PAGE_SIZE : Math.min(requested, MAX_PAGE_SIZE);

function checkNow(nowIso: string): void {
  if (Number.isNaN(Date.parse(nowIso))) throw invalid('now_iso must be a parseable ISO-8601 timestamp');
}

function idsForRef(catalog: Catalog, ref: WireRef): string[] {
  if ('productId' in ref) {
    return UUID_RE.test(ref.productId) && catalog.byId.has(ref.productId) ? [ref.productId] : [];
  }
  if ('gtin14' in ref) return catalog.idsForGtin(ref.gtin14);
  return catalog.idsForSource(ref.sourceItem.site, ref.sourceItem.nativeId);
}

/** Winner rule across a cluster: rank ascending (untiered last), then last_seen_at, then as_of. */
function beats(candidate: FixtureClaim, held: FixtureClaim): boolean {
  const cr = candidate.rank === null ? Number.POSITIVE_INFINITY : Number(candidate.rank);
  const hr = held.rank === null ? Number.POSITIVE_INFINITY : Number(held.rank);
  if (cr !== hr) return cr < hr;
  if (candidate.lastSeenAt !== held.lastSeenAt) return candidate.lastSeenAt > held.lastSeenAt;
  return candidate.asOf > held.asOf;
}

function facet(c: FixtureClaim): Record<string, unknown> {
  const base = { site: c.site, rank: c.rank, conf: c.conf, lang: c.lang, asOf: c.asOf, lastSeenAt: c.lastSeenAt };
  if (c.kind === 'term') return { kind: 'term', value: c.value, label: c.label, ...base };
  return { kind: c.kind, value: c.value, ...base };
}

interface Built {
  record: Record<string, unknown>;
  dropped: boolean;
}

function buildRecord(catalog: Catalog, headId: string, requestedAs: WireRef[], entitled: boolean): Built {
  const head = catalog.byId.get(headId) as FixtureProduct;
  const members = catalog.clusterOf(headId).map((id) => catalog.byId.get(id) as FixtureProduct);
  const best = new Map<string, FixtureClaim>();
  for (const member of members) {
    for (const c of member.claims) {
      const held = best.get(c.key);
      if (held === undefined || beats(c, held)) best.set(c.key, c);
    }
  }
  let dropped = false;
  const attrs: Record<string, unknown> = {};
  for (const key of [...best.keys()].sort()) {
    if (!entitled && GATED_KEYS.has(key)) {
      dropped = true;
      continue;
    }
    attrs[key] = facet(best.get(key) as FixtureClaim);
  }
  const display: Record<string, string> = {};
  for (const [k, v] of Object.entries(head.display)) if (v !== undefined && v !== '') display[k] = v;
  const identifiers = members.flatMap((m) =>
    [...m.identifiers].sort((a, b) =>
      a.idType === b.idType ? (a.value < b.value ? -1 : 1) : a.idType < b.idType ? -1 : 1,
    ),
  );
  return {
    record: {
      productId: head.productId,
      status: head.status,
      domain: head.domain,
      requestedAs,
      clusterSize: members.length,
      display,
      identifiers,
      attrs,
    },
    dropped,
  };
}

export function getProductsPage(
  catalog: Catalog,
  request: Pick<GetProductsRequest, 'refs' | 'nowIso' | 'pageSize' | 'pageToken'>,
  entitled: boolean,
): { productsJson: string; nextPageToken: string } {
  if (request.refs.length === 0) throw invalid('refs must not be empty');
  if (request.refs.length > MAX_REFS) throw invalid(`refs must not exceed ${MAX_REFS} entries`);
  const refs = request.refs.map(toWireRef);
  checkNow(request.nowIso);
  const pageSize = clampPageSize(request.pageSize);
  const fp = fingerprint(refs);
  const offset = request.pageToken === '' ? 0 : decodeToken(request.pageToken, fp);

  const headIds: string[] = [];
  const byHead = new Map<string, WireRef[]>();
  const unresolved: WireRef[] = [];
  for (const ref of refs) {
    const ids = idsForRef(catalog, ref);
    if (ids.length === 0) {
      unresolved.push(ref);
      continue;
    }
    for (const id of ids) {
      const head = catalog.resolveHead(id) as string;
      if (!byHead.has(head)) {
        byHead.set(head, []);
        headIds.push(head);
      }
      const list = byHead.get(head) as WireRef[];
      if (!list.some((r) => refKey(r) === refKey(ref))) list.push(ref);
    }
  }

  const pageIds = headIds.slice(offset, offset + pageSize);
  const nextPageToken = offset + pageSize < headIds.length ? encodeToken(offset + pageSize, fp) : '';
  let dropped = false;
  const products = pageIds.map((head) => {
    const built = buildRecord(catalog, head, byHead.get(head) as WireRef[], entitled);
    dropped ||= built.dropped;
    return built.record;
  });
  const body = {
    products,
    unresolved: offset === 0 ? unresolved : [],
    coverage: dropped ? { redacted: [INVENTORY_LEVELS] } : {},
  };
  return { productsJson: JSON.stringify(body), nextPageToken };
}

export function compareResult(catalog: Catalog, request: Pick<CompareRequest, 'seed' | 'nowIso'>, entitled: boolean): string {
  if (request.seed.case === undefined) throw invalid('seed must set gtin14 or head_id');
  checkNow(request.nowIso);
  const ids = request.seed.case === 'gtin14' ? catalog.idsForGtin(request.seed.value) : [request.seed.value];
  const headId = ids.length === 0 ? undefined : catalog.resolveHead(ids[0] as string);
  if (headId === undefined) return JSON.stringify({ heads: [], related: [], coverage: { semanticsRev: SEMANTICS_REV } });

  const head = catalog.byId.get(headId) as FixtureProduct;
  const stock = head.claims.find((c) => c.key === 'stockOnHand');
  const status = head.claims.find((c) => c.key === 'stockStatus')?.value ?? 'in_stock';
  const amount = String(5980 + (parseInt(headId.slice(0, 4), 16) % 30) * 1000);
  const offer: Record<string, unknown> = { price: { amount, currency: 'JPY' }, availability: status };
  const redact = stock !== undefined && !entitled;
  if (stock !== undefined && entitled) offer['stockOnHand'] = stock.value;
  return JSON.stringify({
    heads: [{ head: headId, perStore: [{ store: 'amiami', offers: [offer] }], editions: [] }],
    related: [],
    coverage: redact ? { redacted: [INVENTORY_LEVELS], semanticsRev: SEMANTICS_REV } : { semanticsRev: SEMANTICS_REV },
  });
}

export function productImagesPage(request: Pick<GetProductImagesRequest, 'productIds' | 'nowIso'>): {
  imagesJson: string;
  nextPageToken: string;
} {
  if (request.productIds.length === 0) throw invalid('product_ids must not be empty');
  if (request.productIds.length > MAX_REFS) throw invalid(`product_ids must not exceed ${MAX_REFS} entries`);
  if (request.productIds.some((id) => id === '')) throw invalid('product_id must not be empty');
  checkNow(request.nowIso);
  // No derivative exists anywhere yet, so the honest answer is an empty list.
  return { imagesJson: JSON.stringify({ products: [], coverage: {} }), nextPageToken: '' };
}

function protocolOf(contentType: string | null): Protocol {
  if (contentType?.startsWith('application/grpc-web') === true) return 'grpc-web';
  if (contentType?.startsWith('application/grpc') === true) return 'grpc';
  return 'connect';
}

export async function startFakeSpine(options: FakeSpineOptions): Promise<FakeSpine> {
  const { catalog, keys } = options;
  const host = options.host ?? '127.0.0.1';
  const calls: SpineCall[] = [];

  const record = (method: SpineCall['method'], wire: Wire, ctx: HandlerContext): boolean => {
    const verified = verifyEntitlementHeader(ctx.requestHeader.get(ENTITLEMENTS_HEADER), keys);
    const entitled = verified.outcome === 'granted' && verified.grants.has(INVENTORY_LEVELS);
    calls.push({
      method,
      wire,
      protocol: protocolOf(ctx.requestHeader.get('content-type')),
      entitlementOutcome: verified.outcome,
      entitled,
      ...(verified.sub === undefined ? {} : { sub: verified.sub }),
      at: new Date().toISOString(),
    });
    return entitled;
  };

  const routesFor = (wire: Wire) => (router: ConnectRouter): void => {
    router.service(SpineRead, {
      compare: (req, ctx) => ({ resultJson: compareResult(catalog, req, record('compare', wire, ctx)) }),
      getProducts: (req, ctx) => getProductsPage(catalog, req, record('getProducts', wire, ctx)),
      getProductImages: (req, ctx) => {
        record('getProductImages', wire, ctx);
        return productImagesPage(req);
      },
    });
  };

  // No allowHTTP1 on the h2c server: gRPC is HTTP/2 only, and a client that
  // fell back to HTTP/1.1 must fail here the way it would against :50062.
  const h2c = http2.createServer(connectNodeAdapter({ routes: routesFor('h2c') }));
  const h1 = http.createServer(connectNodeAdapter({ routes: routesFor('h1') }));
  const sessions = new Set<http2.ServerHttp2Session>();
  const sockets = new Set<Socket>();
  h2c.on('session', (s) => {
    sessions.add(s);
    s.once('close', () => sessions.delete(s));
  });
  h1.on('connection', (s) => {
    sockets.add(s);
    s.once('close', () => sockets.delete(s));
  });

  const listen = (server: http.Server | http2.Http2Server, port: number): Promise<number> =>
    new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => resolve((server.address() as AddressInfo).port));
    });
  const h2cPort = await listen(h2c, options.h2cPort ?? 0);
  const h1Port = await listen(h1, options.h1Port ?? 0);

  return {
    h2cUrl: `http://${host}:${h2cPort}`,
    h1Url: `http://${host}:${h1Port}`,
    calls,
    close: async () => {
      for (const s of sessions) s.destroy();
      for (const s of sockets) s.destroy();
      await Promise.all([
        new Promise<void>((resolve) => h2c.close(() => resolve())),
        new Promise<void>((resolve) => h1.close(() => resolve())),
      ]);
    },
  };
}

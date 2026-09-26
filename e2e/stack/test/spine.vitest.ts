import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { Code, ConnectError, createClient, type Client } from '@connectrpc/connect';
import { createConnectTransport, createGrpcTransport } from '@connectrpc/connect-node';
import {
  SpineRead,
  ProductRefSchema,
  type ProductRef,
} from '@figurecollecting/ingest-contract/read';
import { ENTITLEMENTS_HEADER, INVENTORY_LEVELS } from '@figurecollecting/ingest-contract/entitlement';
import { buildCatalog } from '../src/catalog.js';
import { generateEntitlementKey } from '../src/entitlement.js';
import { startFakeSpine, type FakeSpine } from '../src/spine.js';
import { mintAssertion } from './helpers.js';

const NOW = '2026-09-26T12:00:00.000Z';
const USER = '11111111-1111-4111-8111-111111111111';
const catalog = buildCatalog();
const key = generateEntitlementKey('ent-stack');

const byId = (id: string): ProductRef => create(ProductRefSchema, { ref: { case: 'productId', value: id } });
const byGtin = (g: string): ProductRef => create(ProductRefSchema, { ref: { case: 'gtin14', value: g } });
const bySource = (site: string, nativeId: string): ProductRef =>
  create(ProductRefSchema, { ref: { case: 'sourceItem', value: { site, nativeId } } });

interface ProductsJson {
  products: Array<{
    productId: string;
    status: string;
    domain: string;
    requestedAs: unknown[];
    clusterSize: number;
    display: Record<string, string>;
    identifiers: Array<{ idType: string; value: string; gtin14: string | null; site: string | null }>;
    attrs: Record<string, { kind: string; value: string | null; label?: string; asOf: string }>;
  }>;
  unresolved: unknown[];
  coverage: { redacted?: string[] };
}

const parse = (json: string): ProductsJson => JSON.parse(json) as ProductsJson;

async function expectCode(promise: Promise<unknown>, code: Code): Promise<void> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => ConnectError.from(e),
  );
  expect(err?.code).toBe(code);
}

describe('fake SpineRead', () => {
  let spine: FakeSpine;
  let grpc: Client<typeof SpineRead>;
  let connectH1: Client<typeof SpineRead>;

  beforeAll(async () => {
    spine = await startFakeSpine({ catalog, keys: key.keys });
    grpc = createClient(SpineRead, createGrpcTransport({ baseUrl: spine.h2cUrl }));
    connectH1 = createClient(SpineRead, createConnectTransport({ baseUrl: spine.h1Url, httpVersion: '1.1' }));
  });
  afterAll(async () => {
    await spine.close();
  });
  beforeEach(() => {
    spine.calls.length = 0;
  });

  it('pages a 200-ref batch over gRPC h2c at the default 50 and walks all 1,200 heads', async () => {
    const seen: string[] = [];
    for (let offset = 0; offset < 1200; offset += 200) {
      const refs = catalog.heads.slice(offset, offset + 200).map((p) => byId(p.productId));
      let pageToken = '';
      let pages = 0;
      do {
        const res = await grpc.getProducts({ refs, nowIso: NOW, pageToken });
        const body = parse(res.productsJson);
        expect(body.products.length).toBeLessThanOrEqual(50);
        seen.push(...body.products.map((p) => p.productId));
        pageToken = res.nextPageToken;
        pages += 1;
      } while (pageToken !== '');
      expect(pages).toBe(4);
    }
    expect(seen).toEqual(catalog.heads.map((p) => p.productId));
    expect(spine.calls.every((c) => c.wire === 'h2c' && c.protocol === 'grpc')).toBe(true);
  });

  it('clamps page_size to 200 and treats 0 as the default', async () => {
    const refs = catalog.heads.slice(0, 200).map((p) => byId(p.productId));
    const big = await grpc.getProducts({ refs, nowIso: NOW, pageSize: 500 });
    expect(parse(big.productsJson).products).toHaveLength(200);
    expect(big.nextPageToken).toBe('');
    const small = await grpc.getProducts({ refs: refs.slice(0, 3), nowIso: NOW, pageSize: 2 });
    expect(parse(small.productsJson).products).toHaveLength(2);
    expect(small.nextPageToken).not.toBe('');
  });

  it('projects display, identifiers and attrs the way the spine does', async () => {
    const head = catalog.heads[3]!;
    const res = await grpc.getProducts({ refs: [byId(head.productId)], nowIso: NOW });
    const [p] = parse(res.productsJson).products;
    expect(p?.productId).toBe(head.productId);
    expect(p?.status).toBe('active');
    expect(p?.display['name']).toBe(head.display.name);
    expect(p?.requestedAs).toEqual([{ productId: head.productId }]);
    expect(p?.clusterSize).toBe(1);
    expect(p?.attrs['image']?.value).toMatch(/^https:\/\/static\.myfigurecollection\.invalid\//);
    expect(p?.attrs['manufacturer']?.label).toBe(head.display.manufacturer);
    expect(p?.identifiers.some((i) => i.site === 'mfc')).toBe(true);
  });

  it('feeds every source field of the WK-02 ProductCard for all 1,200 heads', async () => {
    const cards: ProductsJson['products'] = [];
    for (let offset = 0; offset < 1200; offset += 200) {
      const refs = catalog.heads.slice(offset, offset + 200).map((p) => byId(p.productId));
      const res = await grpc.getProducts({ refs, nowIso: NOW, pageSize: 200 });
      cards.push(...parse(res.productsJson).products);
    }
    expect(cards).toHaveLength(1200);
    for (const card of cards) {
      expect(card.display['name']).toBeTruthy();
      expect(card.display['manufacturer']).toBeTruthy();
      expect(card.display['originSeries']).toBeTruthy();
      expect(card.display['scale']).toBeTruthy();
      expect(card.display['releaseYm']).toMatch(/^\d{4}-\d{2}$/);
      expect(card.attrs['character']?.label).toBeTruthy();
      expect(card.attrs['content_level']?.value).toMatch(/^(general|nsfw|unknown)$/);
      expect(card.attrs['name']?.asOf).toMatch(/^\d{4}-\d{2}-\d{2} /);
      if (card.domain === 'figure') expect(card.identifiers.some((i) => i.gtin14 !== null)).toBe(true);
    }
  });

  it('resolves merged ids to the survivor and folds the cluster, two-hop chains included', async () => {
    const loser = catalog.merged[0]!;
    const headId = catalog.resolveHead(loser.productId)!;
    const twoHop = catalog.merged.find((m) => m.redirectTo === loser.productId)!;
    expect(catalog.resolveHead(twoHop.productId)).toBe(headId);
    const res = await grpc.getProducts({
      refs: [byId(headId), byId(loser.productId), byId(headId), byId(twoHop.productId), byId(catalog.heads[1]!.productId)],
      nowIso: NOW,
    });
    const body = parse(res.productsJson);
    // One row per survivor, in first-naming-ref order, each distinct ref echoed once.
    expect(body.products.map((p) => p.productId)).toEqual([headId, catalog.heads[1]!.productId]);
    const survivor = body.products[0]!;
    expect(survivor.requestedAs).toEqual([
      { productId: headId },
      { productId: loser.productId },
      { productId: twoHop.productId },
    ]);
    expect(survivor.clusterSize).toBe(catalog.clusterOf(headId).length);
    expect(survivor.clusterSize).toBe(3);
    expect(survivor.identifiers.some((i) => i.value === loser.identifiers[0]!.value)).toBe(true);
    // The head's rank-1 name beats the merged record's rank-2 duplicate.
    expect(survivor.attrs['name']?.value).toBe(catalog.byId.get(headId)!.display.name);
    expect(survivor.attrs['sculptor']).toBeDefined();
  });

  it('resolves gtin14 and (site, native id) refs, and lists unknown refs as unresolved on page one only', async () => {
    const head = catalog.heads.find((p) => p.identifiers.some((i) => i.idType === 'jan'))!;
    const gtin = head.identifiers.find((i) => i.idType === 'jan')!.gtin14!;
    const mfc = catalog.heads[5]!.identifiers.find((i) => i.site === 'mfc')!.value;
    const refs = [
      byGtin(gtin),
      byGtin('00000000000000'),
      bySource('mfc', mfc),
      bySource('nowhere', '1'),
      byId('not-a-uuid'),
      byId(catalog.heads[8]!.productId),
    ];
    const first = await grpc.getProducts({ refs, nowIso: NOW, pageSize: 2 });
    const body = parse(first.productsJson);
    expect(body.products.map((p) => p.productId)).toEqual([head.productId, catalog.heads[5]!.productId]);
    expect(body.products[0]?.requestedAs).toEqual([{ gtin14: gtin }]);
    expect(body.products[1]?.requestedAs).toEqual([{ sourceItem: { site: 'mfc', nativeId: mfc } }]);
    expect(body.unresolved).toEqual([
      { gtin14: '00000000000000' },
      { sourceItem: { site: 'nowhere', nativeId: '1' } },
      { productId: 'not-a-uuid' },
    ]);
    const second = await grpc.getProducts({ refs, nowIso: NOW, pageSize: 2, pageToken: first.nextPageToken });
    expect(parse(second.productsJson).unresolved).toEqual([]);
    expect(parse(second.productsJson).products.map((p) => p.productId)).toEqual([catalog.heads[8]!.productId]);
  });

  it('withholds gated inventory without an assertion and names the withholding', async () => {
    const gated = catalog.heads[0]!;
    const res = await grpc.getProducts({ refs: [byId(gated.productId)], nowIso: NOW });
    const body = parse(res.productsJson);
    expect(body.products[0]?.attrs['stockOnHand']).toBeUndefined();
    expect(body.products[0]?.attrs['stockStatus']).toBeDefined();
    expect(body.coverage).toEqual({ redacted: [INVENTORY_LEVELS] });
    expect(spine.calls[0]).toMatchObject({ method: 'getProducts', entitlementOutcome: 'absent', entitled: false });

    const plain = await grpc.getProducts({ refs: [byId(catalog.heads[1]!.productId)], nowIso: NOW });
    expect(parse(plain.productsJson).coverage).toEqual({});
  });

  it('delivers gated inventory to a caller holding a valid assertion', async () => {
    const gated = catalog.heads[0]!;
    const headers = { [ENTITLEMENTS_HEADER]: mintAssertion(key, USER, [INVENTORY_LEVELS]) };
    const res = await grpc.getProducts({ refs: [byId(gated.productId)], nowIso: NOW }, { headers });
    const body = parse(res.productsJson);
    expect(body.products[0]?.attrs['stockOnHand']?.value).toBe('1');
    expect(body.coverage).toEqual({});
    expect(spine.calls[0]).toMatchObject({ entitlementOutcome: 'granted', entitled: true, sub: USER });

    const noGrant = { [ENTITLEMENTS_HEADER]: mintAssertion(key, USER, []) };
    const denied = await grpc.getProducts({ refs: [byId(gated.productId)], nowIso: NOW }, { headers: noGrant });
    expect(parse(denied.productsJson).coverage).toEqual({ redacted: [INVENTORY_LEVELS] });
  });

  it('rejects structural faults with INVALID_ARGUMENT', async () => {
    const refs = catalog.heads.slice(0, 3).map((p) => byId(p.productId));
    await expectCode(grpc.getProducts({ refs: [], nowIso: NOW }), Code.InvalidArgument);
    await expectCode(
      grpc.getProducts({ refs: catalog.heads.slice(0, 201).map((p) => byId(p.productId)), nowIso: NOW }),
      Code.InvalidArgument,
    );
    await expectCode(grpc.getProducts({ refs: [create(ProductRefSchema)], nowIso: NOW }), Code.InvalidArgument);
    await expectCode(grpc.getProducts({ refs: [byId('')], nowIso: NOW }), Code.InvalidArgument);
    await expectCode(grpc.getProducts({ refs: [byGtin('')], nowIso: NOW }), Code.InvalidArgument);
    await expectCode(grpc.getProducts({ refs: [bySource('mfc', '')], nowIso: NOW }), Code.InvalidArgument);
    await expectCode(grpc.getProducts({ refs, nowIso: 'yesterday' }), Code.InvalidArgument);
    await expectCode(grpc.getProducts({ refs, nowIso: NOW, pageToken: 'garbage' }), Code.InvalidArgument);
    const page = await grpc.getProducts({ refs, nowIso: NOW, pageSize: 1 });
    await expectCode(
      grpc.getProducts({ refs: refs.slice(1), nowIso: NOW, pageSize: 1, pageToken: page.nextPageToken }),
      Code.InvalidArgument,
    );
    const forged = Buffer.from(JSON.stringify({ o: -1, f: 'x' })).toString('base64url');
    await expectCode(grpc.getProducts({ refs, nowIso: NOW, pageToken: forged }), Code.InvalidArgument);
  });

  it('answers Compare by head id and gtin14, redacting stock without an assertion', async () => {
    const loser = catalog.merged[0]!;
    const head = catalog.byId.get(catalog.resolveHead(loser.productId)!)!;
    const byHead = await grpc.compare({ seed: { case: 'headId', value: loser.productId }, nowIso: NOW });
    const result = JSON.parse(byHead.resultJson) as {
      heads: Array<{ head: string; perStore: Array<{ offers: Array<Record<string, unknown>> }> }>;
      coverage: { redacted?: string[]; semanticsRev: string };
    };
    expect(result.heads[0]?.head).toBe(head.productId);
    expect(result.heads[0]?.perStore[0]?.offers[0]?.['stockOnHand']).toBeUndefined();
    expect(result.coverage.redacted).toEqual([INVENTORY_LEVELS]);
    expect(result.coverage.semanticsRev).toMatch(/^[0-9a-f]{16}$/);

    const gtin = head.identifiers.find((i) => i.idType === 'jan')?.gtin14 ?? catalog.heads[1]!.identifiers[0]!.gtin14!;
    const headers = { [ENTITLEMENTS_HEADER]: mintAssertion(key, USER, [INVENTORY_LEVELS]) };
    const entitled = JSON.parse(
      (await grpc.compare({ seed: { case: 'gtin14', value: gtin }, nowIso: NOW }, { headers })).resultJson,
    ) as typeof result;
    expect(entitled.heads[0]?.perStore[0]?.offers[0]?.['stockOnHand']).toMatch(/^\d+$/);
    expect(entitled.coverage.redacted).toBeUndefined();

    const unknown = JSON.parse(
      (await grpc.compare({ seed: { case: 'gtin14', value: '00000000000000' }, nowIso: NOW })).resultJson,
    ) as typeof result;
    expect(unknown.heads).toEqual([]);
    await expectCode(grpc.compare({ nowIso: NOW }), Code.InvalidArgument);
    await expectCode(grpc.compare({ seed: { case: 'headId', value: head.productId }, nowIso: 'x' }), Code.InvalidArgument);
  });

  it('serves GetProductImages with no derivatives, validating the batch', async () => {
    const res = await grpc.getProductImages({ productIds: [catalog.heads[0]!.productId], nowIso: NOW });
    expect(JSON.parse(res.imagesJson)).toEqual({ products: [], coverage: {} });
    expect(res.nextPageToken).toBe('');
    await expectCode(grpc.getProductImages({ productIds: [], nowIso: NOW }), Code.InvalidArgument);
    await expectCode(
      grpc.getProductImages({ productIds: catalog.heads.slice(0, 201).map((p) => p.productId), nowIso: NOW }),
      Code.InvalidArgument,
    );
    await expectCode(grpc.getProductImages({ productIds: [''], nowIso: NOW }), Code.InvalidArgument);
    await expectCode(grpc.getProductImages({ productIds: ['a'], nowIso: 'x' }), Code.InvalidArgument);
  });

  it('also serves Connect over HTTP/1.1 on the h1 port, recording the wire', async () => {
    const res = await connectH1.getProducts({ refs: [byId(catalog.heads[2]!.productId)], nowIso: NOW });
    expect(parse(res.productsJson).products).toHaveLength(1);
    expect(spine.calls[0]).toMatchObject({ wire: 'h1', protocol: 'connect' });
  });

  it('refuses gRPC on the h1 port, so a transport regression cannot pass silently', async () => {
    const wrong = createClient(SpineRead, createGrpcTransport({ baseUrl: spine.h1Url }));
    await expect(wrong.getProducts({ refs: [byId(catalog.heads[2]!.productId)], nowIso: NOW })).rejects.toThrow();
    expect(spine.calls).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';
import { buildCatalog, eanCheckDigit, HOLDING_STATUSES } from '../src/catalog.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KANA = /[぀-ヿ]/;

describe('catalog fixture', () => {
  const catalog = buildCatalog();

  it('seeds 1,200 active heads with unique uuid-v4 ids', () => {
    expect(catalog.heads).toHaveLength(1200);
    const ids = new Set(catalog.heads.map((p) => p.productId));
    expect(ids.size).toBe(1200);
    for (const p of catalog.heads) {
      expect(p.productId).toMatch(UUID_V4);
      expect(p.status).toBe('active');
    }
  });

  it('is deterministic for a seed and different across seeds', () => {
    const again = buildCatalog();
    expect(again.heads.map((p) => p.productId)).toEqual(catalog.heads.map((p) => p.productId));
    expect(again.heads[7]?.display).toEqual(catalog.heads[7]?.display);
    const other = buildCatalog({ seed: 7 });
    expect(other.heads[0]?.productId).not.toBe(catalog.heads[0]?.productId);
  });

  it('honours a smaller size', () => {
    expect(buildCatalog({ size: 10 }).heads).toHaveLength(10);
  });

  it('computes EAN-13 check digits', () => {
    expect(eanCheckDigit('458055715869')).toBe('1');
    expect(eanCheckDigit('490123456789')).toBe('4');
  });

  it('gives every JAN a valid check digit and a unique zero-padded gtin14', () => {
    const gtins = new Set<string>();
    let withJan = 0;
    for (const p of catalog.heads) {
      for (const id of p.identifiers.filter((i) => i.idType === 'jan')) {
        withJan += 1;
        expect(id.value).toMatch(/^\d{13}$/);
        expect(id.value.slice(12)).toBe(eanCheckDigit(id.value.slice(0, 12)));
        expect(id.gtin14).toBe(`0${id.value}`);
        gtins.add(id.gtin14!);
      }
    }
    expect(gtins.size).toBe(withJan);
    expect(withJan).toBeGreaterThan(1000);
  });

  it('includes statues without a JAN, Japanese titles and every content level shape', () => {
    const statues = catalog.heads.filter((p) => p.domain === 'statue');
    expect(statues.length).toBeGreaterThan(50);
    for (const s of statues) expect(s.identifiers.some((i) => i.idType === 'jan')).toBe(false);
    expect(catalog.heads.filter((p) => KANA.test(p.display.name ?? '')).length).toBeGreaterThan(200);
    const levels = new Set(catalog.heads.map((p) => p.claims.find((c) => c.key === 'content_level')?.value));
    expect(levels).toEqual(new Set(['general', 'nsfw', 'unknown']));
  });

  it('carries original-image claims, unmapped keys and gated inventory claims to exercise the allowlist', () => {
    for (const p of catalog.heads) {
      const image = p.claims.find((c) => c.key === 'image');
      expect(image?.value).toMatch(/^https:\/\/static\.myfigurecollection\.invalid\//);
    }
    expect(catalog.heads.filter((p) => p.claims.some((c) => c.key === 'x_fixture_unmapped')).length).toBeGreaterThan(100);
    const gated = catalog.heads.filter((p) => p.claims.some((c) => c.key === 'stockOnHand'));
    expect(gated.length).toBe(400);
  });

  it('resolves merged ids through the redirect chain, including a two-hop chain', () => {
    expect(catalog.merged.length).toBeGreaterThanOrEqual(60);
    for (const m of catalog.merged) {
      expect(m.status).toBe('merged');
      const head = catalog.resolveHead(m.productId);
      expect(head).toBeDefined();
      expect(catalog.byId.get(head!)?.status).toBe('active');
      expect(catalog.clusterOf(head!)).toContain(m.productId);
    }
    const twoHop = catalog.merged.filter((m) => catalog.byId.get(m.redirectTo!)?.status === 'merged');
    expect(twoHop.length).toBeGreaterThanOrEqual(3);
    expect(catalog.resolveHead('00000000-0000-4000-8000-000000000000')).toBeUndefined();
    expect(catalog.resolveHead(catalog.heads[0]!.productId)).toBe(catalog.heads[0]!.productId);
    expect(catalog.clusterOf(catalog.heads[1]!.productId)).toEqual([catalog.heads[1]!.productId]);
  });

  it('refuses a redirect cycle rather than looping', () => {
    const c = buildCatalog({ size: 30 });
    const a = c.merged.find((m) => c.byId.get(m.redirectTo!)?.status === 'merged')!;
    const b = c.byId.get(a.redirectTo!)!;
    const saved = b.redirectTo;
    b.redirectTo = a.productId;
    expect(() => c.resolveHead(a.productId)).toThrow(/cycle/);
    b.redirectTo = saved;
  });

  it('finds products by gtin14 and by (site, native id), merged records included', () => {
    const head = catalog.heads.find((p) => p.identifiers.some((i) => i.idType === 'jan'))!;
    const gtin = head.identifiers.find((i) => i.idType === 'jan')!.gtin14!;
    expect(catalog.idsForGtin(gtin)).toEqual([head.productId]);
    expect(catalog.idsForGtin('00000000000000')).toEqual([]);

    const mfc = head.identifiers.find((i) => i.site === 'mfc')!;
    expect(catalog.idsForSource('mfc', mfc.value)).toEqual([head.productId]);

    const loser = catalog.merged[0]!;
    const loserNative = loser.identifiers.find((i) => i.idType === 'source_native')!;
    expect(catalog.idsForSource(loserNative.site!, loserNative.value)).toEqual([loser.productId]);
    expect(catalog.idsForSource('nowhere', '1')).toEqual([]);
  });

  it('suggests a holding status for every head', () => {
    expect(catalog.holdings).toHaveLength(1200);
    const seen = new Set(catalog.holdings.map((h) => h.status));
    expect(seen).toEqual(new Set(HOLDING_STATUSES));
    expect(catalog.holdings[0]?.headId).toBe(catalog.heads[0]?.productId);
  });

  it('stamps claim times as raw PostgreSQL timestamptz tokens', () => {
    const claim = catalog.heads[0]!.claims[0]!;
    expect(claim.asOf).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}\+00$/);
    expect(claim.lastSeenAt >= claim.asOf).toBe(true);
  });
});

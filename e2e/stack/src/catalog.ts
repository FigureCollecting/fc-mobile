// Deterministic spine fixture: 1,200 active heads plus merged (ER-redirected)
// records, shaped like the rows fc-aggregation's getProducts reads. Everything
// is derived from one seed so a failing e2e run can be replayed exactly.
import { createHash } from 'node:crypto';

export type ClaimKind = 'text' | 'num' | 'date' | 'term' | 'json';

export interface FixtureClaim {
  key: string;
  kind: ClaimKind;
  value: string | null;
  json?: unknown;
  label?: string;
  site: string;
  rank: string | null;
  conf: string;
  lang: string | null;
  asOf: string;
  lastSeenAt: string;
}

export interface FixtureIdentifier {
  idType: 'jan' | 'source_native';
  value: string;
  gtin14: string | null;
  site: string | null;
}

export interface FixtureDisplay {
  name?: string;
  manufacturer?: string;
  originSeries?: string;
  productType?: string;
  scale?: string;
  releaseYm?: string;
  heightMm?: string;
}

export interface FixtureProduct {
  productId: string;
  status: 'active' | 'merged';
  domain: 'figure' | 'statue';
  display: FixtureDisplay;
  identifiers: FixtureIdentifier[];
  claims: FixtureClaim[];
  /** Set only on merged records: the next hop of the redirect chain. */
  redirectTo?: string;
}

export const HOLDING_STATUSES = ['owned', 'ordered', 'wished'] as const;
export type HoldingStatus = (typeof HOLDING_STATUSES)[number];

export interface Catalog {
  heads: FixtureProduct[];
  merged: FixtureProduct[];
  byId: Map<string, FixtureProduct>;
  holdings: Array<{ headId: string; status: HoldingStatus }>;
  resolveHead(id: string): string | undefined;
  clusterOf(headId: string): string[];
  idsForGtin(gtin14: string): string[];
  idsForSource(site: string, nativeId: string): string[];
}

export interface CatalogOptions {
  size?: number;
  seed?: number;
}

export const DEFAULT_CATALOG_SIZE = 1200;
export const DEFAULT_CATALOG_SEED = 20260926;

interface Character {
  en: string;
  ja: string;
  series: string;
}

const CHARACTERS: readonly Character[] = [
  { en: 'Hatsune Miku', ja: '初音ミク', series: 'Character Vocal Series' },
  { en: 'Kagamine Rin', ja: '鏡音リン', series: 'Character Vocal Series' },
  { en: 'Artoria Pendragon', ja: 'アルトリア・ペンドラゴン', series: 'Fate/Grand Order' },
  { en: 'Mash Kyrielight', ja: 'マシュ・キリエライト', series: 'Fate/Grand Order' },
  { en: 'Rem', ja: 'レム', series: 'Re:Zero' },
  { en: 'Emilia', ja: 'エミリア', series: 'Re:Zero' },
  { en: 'Gawr Gura', ja: 'がうる・ぐら', series: 'Hololive' },
  { en: 'Houshou Marine', ja: '宝鐘マリン', series: 'Hololive' },
  { en: 'Raiden Shogun', ja: '雷電将軍', series: 'Genshin Impact' },
  { en: 'Furina', ja: 'フリーナ', series: 'Genshin Impact' },
  { en: 'Anya Forger', ja: 'アーニャ・フォージャー', series: 'Spy x Family' },
  { en: 'Yor Forger', ja: 'ヨル・フォージャー', series: 'Spy x Family' },
  { en: 'Makima', ja: 'マキマ', series: 'Chainsaw Man' },
  { en: 'Power', ja: 'パワー', series: 'Chainsaw Man' },
  { en: 'Frieren', ja: 'フリーレン', series: "Frieren: Beyond Journey's End" },
  { en: 'Fern', ja: 'フェルン', series: "Frieren: Beyond Journey's End" },
  { en: 'Ai Hoshino', ja: '星野アイ', series: 'Oshi no Ko' },
  { en: 'Hitori Gotoh', ja: '後藤ひとり', series: 'Bocchi the Rock!' },
  { en: 'Shiroko', ja: 'シロコ', series: 'Blue Archive' },
  { en: 'Rei Ayanami', ja: '綾波レイ', series: 'Evangelion' },
];

const FIGURE_MAKERS = [
  'Good Smile Company', 'Max Factory', 'Kotobukiya', 'Alter', 'FuRyu', 'Bandai Spirits',
  'Aniplex', 'Phat Company', 'Taito', 'SEGA', 'Wonderful Works', 'Union Creative',
] as const;
const STATUE_STUDIOS = ['Myethos', 'Apex Innovation', 'Infinity Studio', 'Xing Kong Studio'] as const;
const VARIANTS = [
  { en: 'Racing Ver.', ja: 'レーシングVer.' },
  { en: 'Summer Ver.', ja: '夏服Ver.' },
  { en: 'Bunny Ver.', ja: 'バニーVer.' },
  { en: 'Casual Wear', ja: '私服Ver.' },
  { en: 'Birthday Ver.', ja: '誕生日Ver.' },
  { en: 'Kimono Ver.', ja: '着物Ver.' },
  { en: 'Deluxe Edition', ja: 'DX版' },
  { en: 'Reissue', ja: '再販' },
] as const;
const SCALES = ['1/7', '1/8', '1/6', '1/4', 'Non-scale'] as const;

/** mulberry32: small, fast and good enough for fixtures. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)] as T;
}

function uuidV4(rand: () => number): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(rand() * 256));
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Term ids are content-derived so a label always maps to the same id. */
function termId(kind: string, label: string): string {
  const hex = createHash('sha256').update(`${kind}\u001f${label}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function eanCheckDigit(body12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(body12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

function pgTimestamp(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}.${iso.slice(20, 23)}000+00`;
}

const BASE_MS = Date.UTC(2026, 5, 1);
const DAY_MS = 86_400_000;

export function buildCatalog(options: CatalogOptions = {}): Catalog {
  const size = options.size ?? DEFAULT_CATALOG_SIZE;
  const rand = prng(options.seed ?? DEFAULT_CATALOG_SEED);
  const usedJans = new Set<string>();

  const newJan = (): string => {
    for (;;) {
      const body = `${rand() < 0.5 ? '45' : '49'}${String(Math.floor(rand() * 1e10)).padStart(10, '0')}`;
      const jan = body + eanCheckDigit(body);
      if (!usedJans.has(jan)) {
        usedJans.add(jan);
        return jan;
      }
    }
  };

  const claim = (
    key: string,
    kind: ClaimKind,
    value: string | null,
    at: number,
    extra: Partial<FixtureClaim> = {},
  ): FixtureClaim => ({
    key,
    kind,
    value,
    site: 'mfc',
    rank: '1',
    conf: 'high',
    lang: null,
    asOf: pgTimestamp(at),
    lastSeenAt: pgTimestamp(at + 3 * DAY_MS),
    ...extra,
  });

  const term = (key: string, kind: string, label: string, at: number): FixtureClaim =>
    claim(key, 'term', termId(kind, label), at, { label });

  const heads: FixtureProduct[] = [];
  for (let i = 0; i < size; i += 1) {
    const statue = i % 10 === 9;
    const character = pick(rand, CHARACTERS);
    const variant = pick(rand, VARIANTS);
    const scale = statue ? '1/4' : pick(rand, SCALES);
    const maker = statue ? pick(rand, STATUE_STUDIOS) : pick(rand, FIGURE_MAKERS);
    const japanese = i % 3 === 1;
    const scaleText = scale === 'Non-scale' ? '' : ` ${scale}`;
    const name = statue
      ? `${character.en}${scaleText} Resin Statue`
      : japanese
        ? `${character.ja} ${variant.ja}${scale === 'Non-scale' ? '' : ` ${scale}スケールフィギュア`}`
        : `${character.en} ${variant.en}${scaleText}`;
    const year = 2019 + Math.floor(rand() * 9);
    const month = String(1 + Math.floor(rand() * 12)).padStart(2, '0');
    const releaseYm = `${year}-${month}`;
    const at = BASE_MS + Math.floor(rand() * 90) * DAY_MS + Math.floor(rand() * DAY_MS);
    const mfcId = String(100_000 + i * 13);

    const identifiers: FixtureIdentifier[] = [];
    if (!statue) {
      const jan = newJan();
      identifiers.push({ idType: 'jan', value: jan, gtin14: `0${jan}`, site: null });
    }
    identifiers.push({ idType: 'source_native', value: mfcId, gtin14: null, site: 'mfc' });
    if (i % 5 === 0) {
      identifiers.push({ idType: 'source_native', value: `FIGURE-0${String(10_000 + i)}`, gtin14: null, site: 'amiami' });
    }

    const contentLevel = i % 40 === 39 ? 'unknown' : i % 25 === 24 ? 'nsfw' : 'general';
    const claims: FixtureClaim[] = [
      term('character', 'character', character.en, at),
      claim('content_level', 'text', contentLevel, at),
      claim('image', 'text', `https://static.myfigurecollection.invalid/upload/items/1/${mfcId}-${i.toString(16)}.jpg`, at),
      term('manufacturer', 'manufacturer', maker, at),
      claim('name', 'text', name, at, { lang: japanese ? 'ja' : 'en' }),
      term('origin_series', 'origin_series', character.series, at),
      claim('release_date', 'date', `${releaseYm}-01`, at),
      claim('scale', 'text', scale, at),
    ];
    if (i % 7 === 3) claims.push(claim('x_fixture_unmapped', 'text', `unmapped-${i}`, at));
    if (i % 3 === 0) {
      claims.push(claim('stockOnHand', 'num', String(1 + (i % 9)), at, { site: 'amiami', rank: '2' }));
      claims.push(claim('stockStatus', 'text', i % 2 === 0 ? 'in_stock' : 'preorder', at, { site: 'amiami', rank: '2' }));
    }
    claims.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    heads.push({
      productId: uuidV4(rand),
      status: 'active',
      domain: statue ? 'statue' : 'figure',
      display: {
        name,
        manufacturer: maker,
        originSeries: character.series,
        productType: statue ? 'Statue' : 'Scale Figure',
        scale,
        releaseYm,
        heightMm: String(120 + Math.floor(rand() * 230)),
      },
      identifiers,
      claims,
    });
  }

  // ER merges: every 20th head absorbs one record; three more records hop
  // through an already-merged record, so a two-step chain is always present.
  const merged: FixtureProduct[] = [];
  const mergeInto = (target: FixtureProduct, k: number): FixtureProduct => {
    const at = BASE_MS - 30 * DAY_MS + k * 3_600_000;
    const identifiers: FixtureIdentifier[] = [
      { idType: 'source_native', value: `FIGURE-M${String(k).padStart(4, '0')}`, gtin14: null, site: 'amiami' },
    ];
    if (k % 2 === 0 && target.domain === 'figure') {
      const jan = newJan();
      identifiers.push({ idType: 'jan', value: jan, gtin14: `0${jan}`, site: null });
    }
    const record: FixtureProduct = {
      productId: uuidV4(rand),
      status: 'merged',
      domain: target.domain,
      display: { name: `${target.display.name ?? ''} (duplicate listing)` },
      identifiers,
      claims: [
        claim('name', 'text', `${target.display.name ?? ''} (duplicate listing)`, at, { site: 'amiami', rank: '2' }),
        term('sculptor', 'sculptor_artist', `Sculptor ${k}`, at),
      ],
      redirectTo: target.productId,
    };
    merged.push(record);
    return record;
  };
  const stride = 20;
  for (let k = 0; k * stride < size; k += 1) mergeInto(heads[k * stride] as FixtureProduct, k);
  const firstHop = merged.slice(0, 3);
  firstHop.forEach((record, n) => mergeInto(record, 1000 + n));

  const byId = new Map<string, FixtureProduct>();
  for (const p of [...heads, ...merged]) byId.set(p.productId, p);

  const gtinIndex = new Map<string, string[]>();
  const sourceIndex = new Map<string, string[]>();
  for (const p of byId.values()) {
    for (const id of p.identifiers) {
      if (id.gtin14 !== null) gtinIndex.set(id.gtin14, [...(gtinIndex.get(id.gtin14) ?? []), p.productId]);
      if (id.idType === 'source_native' && id.site !== null) {
        const key = `${id.site}\u001f${id.value}`;
        sourceIndex.set(key, [...(sourceIndex.get(key) ?? []), p.productId]);
      }
    }
  }

  const resolveHead = (id: string): string | undefined => {
    const seen = new Set<string>();
    let current = byId.get(id);
    while (current !== undefined && current.status === 'merged') {
      if (seen.has(current.productId)) throw new Error(`redirect cycle at ${current.productId}`);
      seen.add(current.productId);
      current = byId.get(current.redirectTo as string);
    }
    return current?.productId;
  };

  const clusterOf = (headId: string): string[] => [
    headId,
    ...merged.filter((m) => m.productId !== headId && resolveHead(m.productId) === headId).map((m) => m.productId),
  ];

  const holdings = heads.map((p, i) => {
    const bucket = i % 20;
    const status: HoldingStatus = bucket < 12 ? 'owned' : bucket < 15 ? 'ordered' : 'wished';
    return { headId: p.productId, status };
  });

  return {
    heads,
    merged,
    byId,
    holdings,
    resolveHead,
    clusterOf,
    idsForGtin: (gtin14) => gtinIndex.get(gtin14) ?? [],
    idsForSource: (site, nativeId) => sourceIndex.get(`${site}\u001f${nativeId}`) ?? [],
  };
}

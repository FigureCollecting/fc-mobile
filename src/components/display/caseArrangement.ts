/**
 * PACK1 (Ross 10-26): the order the case stands its figures in, chosen per device in the View card, apart from the
 * list's sort (Q3 a: until custom layouts, the tiles keep their own sort and the case its arrangement). Six orders:
 * series, then scale, then name (the default); scale, then series, then name; series, then name; scale, then name;
 * name; date added, newest first.
 *
 * A group is the first key's value: a series for the series-first orders, a scale for the scale-first ones; name and
 * date added have none, each figure standing alone. The packer fills a gap only with figures of the same group (Q2 a,
 * packCabinets).
 *
 * Missing values sort after the known ones, as their own group: "Unknown series", "No scale". A scale compares by its
 * ratio, the larger first (1/4 before 1/7); a scale given in words (Nendoroid, prize, non-scale) is the one non-scale
 * group after every ratio. Names and series compare without case or accents, numbers in them as numbers. Date added is
 * the holding's created time (the list's "Added": createdAt), the newest first, those with none last.
 */
import type { Figure } from '@figurecollecting/fc-shared';

export type CaseArrangement = 'series-scale-name' | 'scale-series-name' | 'series-name' | 'scale-name' | 'name' | 'date-added';

export const CASE_ARRANGEMENTS: readonly CaseArrangement[] = ['series-scale-name', 'scale-series-name', 'series-name', 'scale-name', 'name', 'date-added'];

export const DEFAULT_CASE_ARRANGEMENT: CaseArrangement = 'series-scale-name';

export const ARRANGEMENT_LABEL: Record<CaseArrangement, string> = {
  'series-scale-name': 'Series, then scale, then name',
  'scale-series-name': 'Scale, then series, then name',
  'series-name': 'Series, then name',
  'scale-name': 'Scale, then name',
  name: 'Name',
  'date-added': 'Date added, newest first',
};

export function isCaseArrangement(value: unknown): value is CaseArrangement {
  return typeof value === 'string' && (CASE_ARRANGEMENTS as readonly string[]).includes(value);
}

/** The group of the figures with no series. */
export const UNKNOWN_SERIES = 'Unknown series';
/** The group of the figures with a scale in words: Nendoroid, prize, non-scale. */
export const NON_SCALE = 'Non-scale';
/** The group of the figures with no scale. */
export const NO_SCALE = 'No scale';

/** One key's group: `rank` orders the groups (a series by its key, a scale by its ratio's denominator). */
export interface KeyGroup {
  readonly key: string;
  readonly rank: number;
}

// case, accents and width folded; numbers in a name compared as numbers
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const fold = (text: string): string => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** 1/7, 1:7, 1 / 2.5: a ratio. */
const RATIO = /1\s*[/:]\s*(\d+(?:\.\d+)?)/;
/** What the facets call a figure with no scale (facets.ts), and nothing at all. */
const NO_SCALE_TEXT = /^(unspecified)?$/i;

/** A series group: the series folded (Re:Zero and re:zero are one), else Unknown series, after every series. */
export function seriesGroupOf(figure: Figure): KeyGroup {
  const key = fold(figure.origin ?? '');
  return key === '' ? { key: UNKNOWN_SERIES, rank: 1 } : { key, rank: 0 };
}

/** A scale group: its ratio (1/4 ranks 4, before 1/7), else non-scale (any words), else No scale. */
export function scaleGroupOf(figure: Figure): KeyGroup {
  const text = (figure.scale ?? '').trim();
  if (NO_SCALE_TEXT.test(text)) return { key: NO_SCALE, rank: Infinity };
  const ratio = RATIO.exec(text);
  const denominator = ratio ? Number(ratio[1]) : 0;
  return denominator > 0 ? { key: `scale:${denominator}`, rank: denominator } : { key: NON_SCALE, rank: Number.MAX_VALUE };
}

type Compare = (a: Figure, b: Figure) => number;

const bySeries: Compare = (a, b) => {
  const x = seriesGroupOf(a);
  const y = seriesGroupOf(b);
  // (two keys the collator calls equal stay apart, so a group is never split by another)
  return x.rank - y.rank || collator.compare(x.key, y.key) || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
};
const byScale: Compare = (a, b) => {
  const x = scaleGroupOf(a).rank;
  const y = scaleGroupOf(b).rank;
  return x === y ? 0 : x < y ? -1 : 1;
};
const byName: Compare = (a, b) => collator.compare(a.name ?? '', b.name ?? '');
/** The newest first; none (no holding time) last. ISO times compare as strings, as the list's sort does (sortFigures). */
const byAdded: Compare = (a, b) => {
  const x = a.createdAt ?? '';
  const y = b.createdAt ?? '';
  return x === y ? 0 : x === '' ? 1 : y === '' ? -1 : x > y ? -1 : 1;
};
const byId: Compare = (a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0);

const KEYS: Record<CaseArrangement, readonly Compare[]> = {
  'series-scale-name': [bySeries, byScale, byName],
  'scale-series-name': [byScale, bySeries, byName],
  'series-name': [bySeries, byName],
  'scale-name': [byScale, byName],
  name: [byName],
  'date-added': [byAdded, byName],
};

/** The group a figure stands in: the first key's value; null for name and date added (no groups). */
function groupKeyOf(arrangement: CaseArrangement, figure: Figure): string | null {
  if (arrangement === 'series-scale-name' || arrangement === 'series-name') return seriesGroupOf(figure).key;
  if (arrangement === 'scale-series-name' || arrangement === 'scale-name') return scaleGroupOf(figure).key;
  return null;
}

/**
 * The case's figures in `arrangement`'s order, each keeping its list index (the tap's and the pictures' index), with
 * the group each stands in: the first key's value, or null (name and date added: it stands alone). Ties fall to the id,
 * so the list's sort never shows through.
 */
export function arrangeCase<T extends { readonly figure: Figure; readonly index: number }>(items: readonly T[], arrangement: CaseArrangement): { items: T[]; groups: (string | null)[] } {
  const keys = [...KEYS[arrangement], byId];
  const sorted = [...items].sort((a, b) => {
    for (const compare of keys) {
      const order = compare(a.figure, b.figure);
      if (order !== 0) return order;
    }
    return a.index - b.index;
  });
  return { items: sorted, groups: sorted.map((item) => groupKeyOf(arrangement, item.figure)) };
}

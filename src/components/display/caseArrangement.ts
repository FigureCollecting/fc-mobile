/**
 * PACK1 (Ross 10-26): the order the case stands its figures in, chosen per device in the View card, apart from the
 * list's sort (Q3 a: until custom layouts, the tiles keep their own sort and the case its arrangement). Six orders:
 * series, then scale, then name (the default); scale, then series, then name; series, then name; scale, then name;
 * name; date added, oldest first.
 *
 * A group is the first key's value: a series for the series-first orders, a scale for the scale-first ones; name and
 * date added have none, each figure standing alone. The packer fills a gap only with figures of the same group (Q2 a,
 * packCabinets).
 *
 * Missing values sort after the known ones, as their own group: "Unknown series", "No scale". A scale compares by its
 * ratio, the larger first (1/4 before 1/7); a scale given in words (Nendoroid, prize, non-scale) is the one non-scale
 * group after every ratio. Names and series compare without case or accents, numbers in them as numbers. Date added is
 * the holding's created time in the list's own "Added" order (sortFigures: createdAt, the oldest first, one with none
 * before them all, those added at once in the list's order), so the two never disagree.
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
  'date-added': 'Date added, oldest first',
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

/** What a figure is arranged by, read once (the sort compares each figure some log n times). */
interface Keys {
  readonly series: KeyGroup;
  readonly scale: KeyGroup;
  readonly name: string;
  readonly added: string;
  readonly id: string;
}
const keysOf = (f: Figure): Keys => ({ series: seriesGroupOf(f), scale: scaleGroupOf(f), name: f.name ?? '', added: f.createdAt ?? '', id: f._id });

type Compare = (a: Keys, b: Keys) => number;

// (two series keys the collator calls equal stay apart, so a group is never split by another)
const bySeries: Compare = ({ series: x }, { series: y }) => x.rank - y.rank || collator.compare(x.key, y.key) || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
const byScale: Compare = ({ scale: x }, { scale: y }) => (x.rank === y.rank ? 0 : x.rank < y.rank ? -1 : 1);
const byName: Compare = (a, b) => collator.compare(a.name, b.name);
/** The list's "Added" (sortFigures, ascending): ISO times compared as strings, the oldest first, none ('') before them. */
const byAdded: Compare = (a, b) => (a.added < b.added ? -1 : a.added > b.added ? 1 : 0);
const byId: Compare = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Each order's keys; a tie past them keeps the list's order (date added: those added at once, as the list does). */
const KEYS: Record<CaseArrangement, readonly Compare[]> = {
  'series-scale-name': [bySeries, byScale, byName, byId],
  'scale-series-name': [byScale, bySeries, byName, byId],
  'series-name': [bySeries, byName, byId],
  'scale-name': [byScale, byName, byId],
  name: [byName, byId],
  'date-added': [byAdded],
};

/** The group a figure stands in: the first key's value; null for name and date added (no groups). */
function groupKeyOf(arrangement: CaseArrangement, keys: Keys): string | null {
  if (arrangement === 'series-scale-name' || arrangement === 'series-name') return keys.series.key;
  if (arrangement === 'scale-series-name' || arrangement === 'scale-name') return keys.scale.key;
  return null;
}

/** The positions of `figures` in `arrangement`'s order, a tie past its keys by `listIndex`, and each one's group. */
function arranged(figures: readonly Figure[], arrangement: CaseArrangement, listIndex: (position: number) => number): { positions: number[]; groups: (string | null)[] } {
  const keys = figures.map(keysOf);
  const compares = KEYS[arrangement];
  const positions = figures
    .map((_, p) => p)
    .sort((p, q) => {
      for (const compare of compares) {
        const order = compare(keys[p], keys[q]);
        if (order !== 0) return order;
      }
      return listIndex(p) - listIndex(q);
    });
  return { positions, groups: positions.map((p) => groupKeyOf(arrangement, keys[p])) };
}

/**
 * The list's figures in `arrangement`'s order, as their places in the list (`order`), with the group each stands in:
 * read from the figures alone, so once per list and arrangement, not again each time a picture read packs the case.
 */
export function arrangeOrder(figures: readonly Figure[], arrangement: CaseArrangement): { order: number[]; groups: (string | null)[] } {
  const { positions, groups } = arranged(figures, arrangement, (p) => p);
  return { order: positions, groups };
}

/**
 * The case's figures in `arrangement`'s order, each keeping its list index (the tap's and the pictures' index), with
 * the group each stands in: the first key's value, or null (name and date added: it stands alone). Ties fall to the id,
 * so the list's sort never shows through; date added alone keeps the list's order for those added at once.
 */
export function arrangeCase<T extends { readonly figure: Figure; readonly index: number }>(items: readonly T[], arrangement: CaseArrangement): { items: T[]; groups: (string | null)[] } {
  const { positions, groups } = arranged(
    items.map((item) => item.figure),
    arrangement,
    (p) => items[p].index,
  );
  return { items: positions.map((p) => items[p]), groups };
}

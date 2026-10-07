// Derived views over the user's facet rows (sync.proto rule 6): occurrences,
// the display rule, effective tags and library presence. Pure: computed from
// the displayed values (the replica with the outbox laid over it) every time,
// never stored, so a facet arriving in any order changes the view and nothing
// else. What this client cannot read is kept by the store and hidden here.
import {
  COLLECTION_KINDS,
  DEFAULT_COLLECTION_ID,
  OCCURRENCE_STATUSES,
  parseCollectionRef,
  type CollectionKind,
  type OccurrenceStatus,
} from '@figurecollecting/fc-api-contract';
import type { FacetRecord } from '../storage/records';
import { readPayload } from './payload';

export type CopyFlag = 'dangling' | 'other_kind';
export type HiddenReason = 'no_head' | 'unknown_status';

export interface CopyView {
  occ_id: string;
  /** The displayed head, null when the copy has none it can read. */
  head_id: string | null;
  /** The live status, null when removed (tombstoned), never written, or unreadable. */
  status: OccurrenceStatus | null;
  /** The copy's filing as written and readable, "{kind}/{cid|default}"; null when none. */
  filed: string | null;
  /** The collection the copy shows in, "{kind}/{cid|default}"; null when not shown. */
  shown_in: string | null;
  /** Why a live copy shows in its default instead of its filing. */
  flag: CopyFlag | null;
  /** Why a copy with a live status is not shown: a partial batch or a status a later release added. */
  hidden: HiddenReason | null;
  /** The disposal of a former copy; null beside any other status. */
  disposal: Record<string, unknown> | null;
  /** The copy's own tags (existing tags only), sorted. */
  tags: string[];
  origin: { site: string; native_id: string; ordinal: number } | null;
}

export interface CollectionView {
  ref: string;
  kind: CollectionKind;
  coll_id: string;
  /** The live name; null for an unnamed default. */
  name: string | null;
}

export interface LocalView {
  /** Every copy any readable occ facet names, by occ_id. Hidden and removed copies included. */
  copies: CopyView[];
  /** The four implicit defaults and every user collection with a live name: by kind, its default first. */
  collections: CollectionView[];
  /** Live tags: id to name. */
  tags: Map<string, string>;
  /** Figures in the library: a live copy's head or any live uf facet. */
  library: Set<string>;
  figureTags: Map<string, Set<string>>;
  /** Keyed "{head_id}/{kind}". */
  kindTags: Map<string, Set<string>>;
}

export interface CopyFilter {
  head_id?: string;
  kind?: OccurrenceStatus;
  shown_in?: string;
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The row's displayed payload, read through its family's schema; undefined when tombstoned, absent or unreadable. */
function live(rec: FacetRecord | undefined): Record<string, unknown> | undefined {
  if (rec?.family === undefined || rec.value?.op !== 'upsert') return undefined;
  return readPayload(rec.family, rec.value.payload);
}

function suffixOf(key: string, occId: string): string {
  return key.slice(`occ/${occId}/`.length);
}

export function buildView(records: readonly FacetRecord[]): LocalView {
  const occRows = new Map<string, Map<string, FacetRecord>>();
  const names = new Map<string, string>();
  const tags = new Map<string, string>();
  const figureTags = new Map<string, Set<string>>();
  const kindTags = new Map<string, Set<string>>();
  const library = new Set<string>();
  const add = (m: Map<string, Set<string>>, k: string, v: string) => m.set(k, (m.get(k) ?? new Set()).add(v));

  for (const rec of records) {
    if (rec.occ_id !== undefined) {
      const rows = occRows.get(rec.occ_id) ?? new Map<string, FacetRecord>();
      rows.set(suffixOf(rec.facet_key, rec.occ_id), rec);
      occRows.set(rec.occ_id, rows);
      continue;
    }
    // live() reads only a row whose family this client knows.
    const payload = live(rec);
    if (payload === undefined) continue;
    const family = rec.family!;
    if (family === 'coll/name') names.set(rec.facet_key.slice('coll/'.length, -'/name'.length), payload.name as string);
    if (family === 'tag/name') tags.set(rec.tag_id!, payload.name as string);
    if (family.startsWith('uf/')) library.add(rec.head_id!);
    if (family === 'uf/tag') add(figureTags, rec.head_id!, rec.tag_id!);
    if (family === 'uf/ktag') add(kindTags, `${rec.head_id!}/${rec.facet_key.split('/')[3]}`, rec.tag_id!);
  }

  const collections: CollectionView[] = COLLECTION_KINDS.map((kind) => ({
    ref: `${kind}/${DEFAULT_COLLECTION_ID}`,
    kind,
    coll_id: DEFAULT_COLLECTION_ID,
    name: names.get(`${kind}/${DEFAULT_COLLECTION_ID}`) ?? null,
  }));
  for (const [ref, name] of names) {
    const parsed = parseCollectionRef(ref)!;
    if (parsed.collId !== DEFAULT_COLLECTION_ID) collections.push({ ref, kind: parsed.kind, coll_id: parsed.collId, name });
  }
  // Per kind, its default first.
  collections.sort((a, b) => byText(a.kind, b.kind) || Number(b.coll_id === DEFAULT_COLLECTION_ID) - Number(a.coll_id === DEFAULT_COLLECTION_ID) || byText(a.coll_id, b.coll_id));
  const exists = new Set(collections.map((c) => c.ref));

  const copies: CopyView[] = [];
  for (const [occId, rows] of occRows) {
    const head = live(rows.get('head'))?.head_id as string | undefined;
    const statusRow = rows.get('status');
    const statusPayload = live(statusRow);
    const status = (statusPayload?.status as OccurrenceStatus | undefined) ?? null;
    const unknownStatus = statusRow?.value?.op === 'upsert' && statusPayload === undefined;
    const hidden: HiddenReason | null = unknownStatus ? 'unknown_status' : status !== null && head === undefined ? 'no_head' : null;
    const shown = status !== null && hidden === null;

    const filed = rows.get('collection');
    const ref = live(filed)?.collection as string | undefined;
    let shownIn: string | null = null;
    let flag: CopyFlag | null = null;
    if (shown) {
      const parsed = ref === undefined ? undefined : parseCollectionRef(ref);
      if (ref !== undefined && exists.has(ref) && parsed!.kind === status) {
        shownIn = ref;
      } else {
        shownIn = `${status}/${DEFAULT_COLLECTION_ID}`;
        if (ref !== undefined || filed?.value?.op === 'upsert') flag = ref !== undefined && exists.has(ref) ? 'other_kind' : 'dangling';
      }
      library.add(head!);
    }

    const ownTags: string[] = [];
    for (const [suffix, rec] of rows) {
      if (suffix.startsWith('tag/') && live(rec) !== undefined && tags.has(rec.tag_id!)) ownTags.push(rec.tag_id!);
    }
    const disposal = status === 'former' ? (live(rows.get('disposal')) ?? null) : null;
    const origin = live(rows.get('origin')) as CopyView['origin'] | undefined;

    copies.push({
      occ_id: occId,
      head_id: head ?? null,
      status,
      filed: ref ?? null,
      shown_in: shownIn,
      flag,
      hidden,
      disposal,
      tags: ownTags.sort(byText),
      origin: origin ?? null,
    });
  }
  copies.sort((a, b) => byText(a.occ_id, b.occ_id));
  return { copies, collections, tags, library, figureTags, kindTags };
}

/** The copies the view shows, by occ_id, filtered. */
export function shownCopies(view: LocalView, filter: CopyFilter = {}): CopyView[] {
  return view.copies.filter(
    (c) =>
      c.shown_in !== null &&
      (filter.head_id === undefined || c.head_id === filter.head_id) &&
      (filter.kind === undefined || c.status === filter.kind) &&
      (filter.shown_in === undefined || c.shown_in === filter.shown_in),
  );
}

/** Live copies of a figure per status. A held count is the owned one: former is never held. */
export function countsFor(view: LocalView, headId: string): Record<OccurrenceStatus, number> {
  const counts = Object.fromEntries(OCCURRENCE_STATUSES.map((s) => [s, 0])) as Record<OccurrenceStatus, number>;
  for (const c of shownCopies(view, { head_id: headId })) counts[c.status!] += 1;
  return counts;
}

/** A shown copy's own tags, its figure's, and its figure's for its status (existing tags only), sorted. */
export function effectiveTags(view: LocalView, occId: string): string[] {
  const copy = view.copies.find((c) => c.occ_id === occId);
  if (copy?.shown_in == null) return [];
  const all = new Set(copy.tags);
  for (const t of view.figureTags.get(copy.head_id!) ?? []) if (view.tags.has(t)) all.add(t);
  for (const t of view.kindTags.get(`${copy.head_id!}/${copy.status!}`) ?? []) if (view.tags.has(t)) all.add(t);
  return [...all].sort(byText);
}

export function inLibrary(view: LocalView, headId: string): boolean {
  return view.library.has(headId);
}

/**
 * One of N identical copies, by occurrence id alone (sync.proto rule 6, PICKS): the lowest
 * to receive or keep, the highest to remove, so two devices acting on one intent converge.
 */
export function pickCopy(view: LocalView, filter: CopyFilter & { head_id: string; kind: OccurrenceStatus }, purpose: 'receive' | 'keep' | 'remove'): CopyView | undefined {
  const candidates = shownCopies(view, filter);
  return purpose === 'remove' ? candidates.at(-1) : candidates[0];
}

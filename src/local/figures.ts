// The screens' read model (WK-15): the signed-in user's facets and product cards, as the fc-shared
// Figure shape the pages already bind to. One item per figure and kind (the Owned, Ordered, Wished
// and No longer owned tabs), its shown copies stacked xN, product facts from the ProductCard. No
// image of any kind is ever put on an item (MG-2): no imageUrl, no displayMeta. A derivative is the
// detail screen's to ask GetProductImages for.
//
// ER merges (sync.proto rule 6): a card groups the copies whose head is any of its requested_as and
// sums them; each uf field shows the live facet with the higher version among those heads (the lower
// head_id on a tie), and new writes go to that facet's head, or to the card's head when none holds it.
import type { CollectionStatus, Figure } from '@figurecollecting/fc-shared';
import { compareVersion, type OccurrenceStatus } from '@figurecollecting/fc-api-contract';
import type { FacetRecord, ProductRecord } from '../storage/records';
import { buildView, effectiveTags, shownCopies, type CopyView } from '../sync/occurrences';
import { readPayload } from '../sync/payload';

export type ItemSync = 'known' | 'pending' | 'offline-stale';
export type UfField = 'score' | 'note' | 'wishability';

export interface UfValue<T> {
  value: T;
  /** The head the shown facet sits under. */
  head: string;
  version: string;
  editedAt: string | null;
}

export interface LocalMeta {
  /** The figure as displayed: its card's head, or the copies' head before a card arrives. */
  headId: string;
  /** Every head the item answers for: requested_as, its copies' heads and its uf facets' heads. */
  heads: string[];
  /** The tab: the copies' status. figureOf's detail takes the first kind it holds. */
  kind: OccurrenceStatus;
  /** Shown copies, by occurrence id. */
  copies: CopyView[];
  sync: ItemSync;
  /** The card's newest as_of, for the offline-stale badge; null without a card. */
  asOf: string | null;
  hasCard: boolean;
  character: string | null;
  series: string | null;
  gtin14s: string[];
  uf: { score?: UfValue<number>; note?: UfValue<string>; wishability?: UfValue<number> };
  /** Where a new write of each uf field goes. */
  ufTarget: Record<UfField, string>;
}

export interface LocalFigure extends Figure {
  local: LocalMeta;
}

export interface FigureInputs {
  sub: string;
  facets: readonly FacetRecord[];
  products: readonly ProductRecord[];
  /** The server is out of reach (or sync is held): settled items are offline-stale. */
  stale: boolean;
}

const KINDS: readonly OccurrenceStatus[] = ['owned', 'ordered', 'wished', 'former'];
const UF_FIELDS: readonly UfField[] = ['score', 'note', 'wishability'];
const COLLECTION_STATUSES = new Set<string>(['owned', 'ordered', 'wished']);
const UNTITLED = 'Untitled figure';

/** A GTIN-14 with a leading zero is a JAN/EAN-13; anything else is shown as it is. */
export function jan13(gtin14: string): string {
  return /^0\d{13}$/.test(gtin14) ? gtin14.slice(1) : gtin14;
}

const time = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? -Infinity : t;
};

interface Model {
  view: ReturnType<typeof buildView>;
  display: (head: string) => string;
  product: (display: string) => ProductRecord | undefined;
  heads: Map<string, Set<string>>;
  pendingOcc: Set<string>;
  pendingHead: Set<string>;
  uf: Map<string, LocalMeta['uf']>;
  statusAt: Map<string, string>;
  stale: boolean;
  sub: string;
}

function model(input: FigureInputs): Model {
  const byId = new Map<string, ProductRecord>();
  for (const p of input.products) {
    byId.set(p.head_id, p);
    for (const r of p.card.requestedAs) if (r.ref.case === 'headId') byId.set(r.ref.value, p);
  }
  const display = (head: string): string => byId.get(head)?.card.headId ?? head;
  const heads = new Map<string, Set<string>>();
  const addHead = (head: string): void => {
    const d = display(head);
    heads.set(d, (heads.get(d) ?? new Set([d])).add(head));
  };
  for (const p of input.products) {
    for (const r of p.card.requestedAs) if (r.ref.case === 'headId') addHead(r.ref.value);
    addHead(p.head_id);
  }

  const pendingOcc = new Set<string>();
  const pendingHead = new Set<string>();
  const uf = new Map<string, LocalMeta['uf']>();
  const statusAt = new Map<string, string>();
  for (const rec of input.facets) {
    if (rec.occ_id !== undefined) {
      if (rec.pending_id !== null) pendingOcc.add(rec.occ_id);
      if (rec.family === 'occ/status' && rec.value?.op === 'upsert') {
        const at = readPayload('occ/status', rec.value.payload)?.edited_at;
        if (typeof at === 'string') statusAt.set(rec.occ_id, at);
      }
      continue;
    }
    if (rec.head_id === undefined || rec.family?.startsWith('uf/') !== true) continue;
    addHead(rec.head_id);
    const d = display(rec.head_id);
    if (rec.pending_id !== null) pendingHead.add(d);
    const field = rec.family.slice(3) as UfField;
    if (!UF_FIELDS.includes(field) || rec.value?.op !== 'upsert') continue;
    const payload = readPayload(rec.family, rec.value.payload);
    if (payload === undefined) continue;
    const next: UfValue<never> = {
      value: payload[field] as never,
      head: rec.head_id,
      version: rec.value.version,
      editedAt: typeof payload['edited_at'] === 'string' ? payload['edited_at'] : null,
    };
    const shown = uf.get(d) ?? {};
    const held = shown[field];
    const order = held === undefined ? 1 : compareVersion(next.version, held.version);
    if (order > 0 || (order === 0 && next.head < held!.head)) shown[field] = next;
    uf.set(d, shown);
  }

  const view = buildView(input.facets as FacetRecord[]);
  for (const c of view.copies) if (c.head_id !== null) addHead(c.head_id);
  return { view, display, product: (d) => byId.get(d), heads, pendingOcc, pendingHead, uf, statusAt, stale: input.stale, sub: input.sub };
}

function toFigure(m: Model, d: string, kind: OccurrenceStatus, copies: CopyView[], counted: CopyView[]): LocalFigure {
  const product = m.product(d);
  const card = product?.card;
  const uf = m.uf.get(d) ?? {};
  const pending = m.pendingHead.has(d) || copies.some((c) => m.pendingOcc.has(c.occ_id));
  const tagNames = new Set<string>();
  for (const c of copies) for (const t of effectiveTags(m.view, c.occ_id)) tagNames.add(m.view.tags.get(t)!);
  const stamps = copies.map((c) => m.statusAt.get(c.occ_id)).filter((s): s is string => s !== undefined);
  const newest = stamps.reduce<string | undefined>((a, b) => (a === undefined || time(b) > time(a) ? b : a), undefined) ?? '';
  const dims = { heightMm: card?.heightMm, widthMm: card?.widthMm, depthMm: card?.depthMm };
  const hasDims = Object.values(dims).some((v) => v !== undefined);
  const gtins = card?.gtin14s ?? [];

  const figure: LocalFigure = {
    _id: d,
    name: card?.title?.value || UNTITLED,
    manufacturer: card?.manufacturer?.value ?? '',
    scale: card?.scale?.value ?? '',
    userId: m.sub,
    createdAt: newest,
    updatedAt: newest,
    quantity: counted.length,
    local: {
      headId: d,
      heads: [...(m.heads.get(d) ?? new Set([d]))].sort(),
      kind,
      copies,
      sync: pending ? 'pending' : m.stale ? 'offline-stale' : 'known',
      asOf: product?.as_of ?? null,
      hasCard: card !== undefined,
      character: card?.character?.value || null,
      series: card?.series?.value || null,
      gtin14s: [...gtins],
      uf,
      ufTarget: { score: uf.score?.head ?? d, note: uf.note?.head ?? d, wishability: uf.wishability?.head ?? d },
    },
  };
  if (COLLECTION_STATUSES.has(kind)) figure.collectionStatus = kind as CollectionStatus;
  if (card?.series?.value) figure.origin = card.series.value;
  if (gtins[0] !== undefined) figure.jan = jan13(gtins[0]);
  if (hasDims) figure.dimensions = Object.fromEntries(Object.entries(dims).filter(([, v]) => v !== undefined));
  if (card?.releaseYm?.value) figure.releases = [{ date: card.releaseYm.value }];
  if (uf.note !== undefined) figure.note = uf.note.value;
  if (uf.score !== undefined) figure.rating = uf.score.value;
  if (uf.wishability !== undefined) figure.wishRating = uf.wishability.value;
  if (tagNames.size > 0) figure.tags = [...tagNames].sort();
  return figure;
}

/** One item per displayed figure and kind, by head then kind (owned, ordered, wished, former). */
export function buildFigures(input: FigureInputs): LocalFigure[] {
  const m = model(input);
  const groups = new Map<string, Map<OccurrenceStatus, CopyView[]>>();
  for (const c of shownCopies(m.view)) {
    const d = m.display(c.head_id!);
    const byKind = groups.get(d) ?? new Map<OccurrenceStatus, CopyView[]>();
    byKind.set(c.status!, [...(byKind.get(c.status!) ?? []), c]);
    groups.set(d, byKind);
  }
  const out: LocalFigure[] = [];
  for (const d of [...groups.keys()].sort()) {
    const byKind = groups.get(d)!;
    for (const kind of KINDS) {
      const copies = byKind.get(kind);
      if (copies !== undefined) out.push(toFigure(m, d, kind, copies, copies));
    }
  }
  return out;
}

/** The detail of the figure `headId` names (through its card): every shown copy, of every kind. */
export function figureOf(input: FigureInputs, headId: string): LocalFigure | undefined {
  const m = model(input);
  const d = m.display(headId);
  const copies = shownCopies(m.view).filter((c) => m.display(c.head_id!) === d);
  if (copies.length === 0) return undefined;
  const kind = KINDS.find((k) => copies.some((c) => c.status === k))!;
  return toFigure(m, d, kind, copies, copies.filter((c) => c.status === kind));
}

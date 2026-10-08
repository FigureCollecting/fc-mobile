// The conflict review (GR-Q1, Ross 09-26) as read from the local replica: the import's figure items
// imp/mfc/figure/{head} (import.proto THE REVIEW SET), each with the app's value and MFC's, and the
// user's answer res/mfc/{head} when it names the item's rev. The client decides nothing: it shows
// what the server raised and writes the answer the user gives (contract 0.3.0, knowing keep).
import { answerKey, importMarkerKey, type FacetFamily } from '@figurecollecting/fc-api-contract';
import type { FacetRecord } from '../storage/records';
import { figureOf, type FigureInputs, type LocalFigure } from './figures';

export type ReviewKind = 'conflict' | 'divergence';
export type ReviewChoice = 'keep' | 'take' | 'per_copy';

export interface ReviewPart {
  label: string;
  app: string;
  /** When the app's side was last edited (edited_at, display only); null when nothing holds it. */
  appEditedAt: string | null;
  mfc: string;
}

export interface ReviewItem {
  headId: string;
  name: string;
  rev: string;
  kind: ReviewKind;
  /** The import that raised this rev. */
  importNumber: number;
  /** The export date of that import, when the marker still names it. */
  exportDate: string | null;
  parts: ReviewPart[];
  /** The user's answer to this rev, written and maybe not yet synced. */
  answered: ReviewChoice | null;
}

export interface ReviewSet {
  conflicts: ReviewItem[];
  divergences: ReviewItem[];
}

interface Side {
  base?: unknown;
  app?: unknown;
  mfc?: unknown;
  status?: unknown;
}

interface FigureItem {
  rev: string;
  kind: ReviewKind;
  import: number;
  counts: Record<'owned' | 'ordered' | 'wished', { app: number; mfc: number }>;
  fields: Record<'score' | 'note' | 'wishability', Side>;
}

const KINDS = ['owned', 'ordered', 'wished'] as const;
const KIND_LABEL = { owned: 'Owned', ordered: 'Ordered', wished: 'Wished' } as const;
const FIELDS = ['score', 'note', 'wishability'] as const;
const FIELD_LABEL = { score: 'Score', note: 'Note', wishability: 'Wishability' } as const;
const FIGURE_FAMILY: FacetFamily = 'imp/figure';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function payloadOf(rec: FacetRecord | undefined): Record<string, unknown> | undefined {
  if (rec?.value?.op !== 'upsert') return undefined;
  try {
    const v: unknown = JSON.parse(rec.value.payload);
    return isObj(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** The figure item's payload, or undefined when this client cannot read it (stored, hidden). */
export function readFigureItem(payload: Record<string, unknown> | undefined): FigureItem | undefined {
  if (payload === undefined) return undefined;
  const { rev, kind, counts, fields } = payload;
  if (typeof rev !== 'string' || (kind !== 'conflict' && kind !== 'divergence') || typeof payload['import'] !== 'number') return undefined;
  if (!isObj(counts) || !isObj(fields)) return undefined;
  for (const k of KINDS) {
    const c = counts[k];
    if (!isObj(c) || typeof c['app'] !== 'number' || typeof c['mfc'] !== 'number') return undefined;
  }
  for (const f of FIELDS) if (!isObj(fields[f])) return undefined;
  return payload as unknown as FigureItem;
}

const show = (v: unknown): string => (v === undefined || v === null || v === '' ? 'none' : String(v));

function parts(item: FigureItem, figures: readonly LocalFigure[], figure: LocalFigure | undefined): ReviewPart[] {
  const out: ReviewPart[] = [];
  for (const k of KINDS) {
    const c = item.counts[k];
    if (c.app === c.mfc) continue;
    const held = figures.find((f) => f.local.headId === figure?.local.headId && f.local.kind === k);
    out.push({ label: KIND_LABEL[k], app: String(c.app), appEditedAt: held?.createdAt || null, mfc: String(c.mfc) });
  }
  for (const f of FIELDS) {
    const side = item.fields[f];
    const disputed = item.kind === 'conflict' ? side.status === 'conflict' : side.app !== side.mfc;
    if (!disputed) continue;
    out.push({ label: FIELD_LABEL[f], app: show(side.app), appEditedAt: figure?.local.uf[f]?.editedAt ?? null, mfc: show(side.mfc) });
  }
  return out;
}

/** The pending figure items of the MFC import, conflicts and divergences, each in head order. */
export function buildReview(input: FigureInputs & { figures: readonly LocalFigure[] }): ReviewSet {
  const byKey = new Map(input.facets.map((r) => [r.facet_key, r]));
  const marker = payloadOf(byKey.get(importMarkerKey('mfc')));
  const set: ReviewSet = { conflicts: [], divergences: [] };
  const items = input.facets.filter((r) => r.family === FIGURE_FAMILY && r.facet_key.startsWith('imp/mfc/figure/')).sort((a, b) => (a.facet_key < b.facet_key ? -1 : 1));
  for (const rec of items) {
    const item = readFigureItem(payloadOf(rec));
    if (item === undefined) continue;
    const headId = rec.head_id ?? rec.facet_key.slice('imp/mfc/figure/'.length);
    const figure = figureOf(input, headId);
    const answer = payloadOf(byKey.get(answerKey('mfc', headId)));
    const entry: ReviewItem = {
      headId,
      name: figure?.name ?? 'A figure no longer in your collection',
      rev: item.rev,
      kind: item.kind,
      importNumber: item.import,
      exportDate: marker?.['import'] === item.import && typeof marker['export_date'] === 'string' ? marker['export_date'] : null,
      parts: parts(item, input.figures, figure),
      answered: answer?.['item'] === 'figure' && answer['rev'] === item.rev ? (answer['choice'] as ReviewChoice) : null,
    };
    (item.kind === 'conflict' ? set.conflicts : set.divergences).push(entry);
  }
  return set;
}

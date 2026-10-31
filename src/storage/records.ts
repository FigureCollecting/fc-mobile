// Row shapes of the v3 local store. Every row's key starts with the user's sub,
// so a query bound to one sub can never range over another user's rows.
import type { FacetFamily, ProductCard } from '@figurecollecting/fc-api-contract';

export type FacetOp = 'upsert' | 'delete';

/** One facet at one version. `payload` is JSON text, empty for a tombstone. */
export interface FacetValue {
  version: string;
  op: FacetOp;
  payload: string;
}

// Every row stores whatever the server sent, but only a key form this client knows is
// indexed and read (sync.proto rule 6, READERS). The derived fields are recomputed from
// facet_key and value on every write and on every store upgrade (sync/facetIndex.ts).
export interface FacetRecord {
  sub: string;
  facet_key: string;
  /** The key's family; absent for a key form this client does not know (stored, hidden). */
  family?: FacetFamily;
  /** occ/{occ}/...: the copy. Indexes by_occ. */
  occ_id?: string;
  /** The figure: from the key, or for occ/{occ}/head from its displayed payload. Indexes by_head. */
  head_id?: string;
  /** occ/../tag/{tag}, uf/../tag/{tag}, uf/../ktag/../{tag} and tag/{tag}/name. Indexes by_tag. */
  tag_id?: string;
  /** What the UI shows: the replica with the unanswered outbox laid over it. null holds nothing. */
  value: FacetValue | null;
  /** The replica: the newest value the server has reported, from Delta or a Push result's current. */
  known: FacetValue | null;
  /** Outbox id of the unanswered local edit that `value` is, or null. */
  pending_id: number | null;
  /** A value this device wrote that another device replaced with a different one: 'replaced by another device'. */
  overwritten: FacetValue | null;
}

export type OutboxState = 'PENDING' | 'IN_FLIGHT' | 'APPLIED' | 'STALE' | 'REVIEW' | 'REJECTED';

export interface OutboxEntry {
  id?: number;
  sub: string;
  facet_key: string;
  op: FacetOp;
  payload: string;
  edit_version: string;
  /** The facet's local version the edit was minted over; null when it held none. */
  base_version: string | null;
  state: OutboxState;
  attempts: number;
  /** The commit_cursor of the last server transaction applied when the edit was minted, or ''. Never changes. */
  basis: string;
  /** The id of the first entry written with it: one intent's writes travel in one Push batch. */
  group?: number;
  /** The batch idempotency key, set once the entry is frozen into a batch. */
  client_id?: string;
  batch_pos?: number;
  created_at: number;
  /**
   * The random id (W3C trace-id form, from newTraceId) of the user action that minted the edit, sent only as
   * its SyncEvent.origin_trace. Kept only until the change is answered: the answer deletes it, whatever the
   * outcome, except on a version_future edit awaiting its re-mint, which hands it to the new row. Set at mint
   * only while the Diagnostic ids switch is on, carried by a rebase, and taken off every row on the device but
   * a sent batch when the switch goes off. None on an edit queued before it existed: nothing is backfilled.
   */
  origin_trace?: string;
  /** The server's outcome as answered (DUPLICATE is kept distinct from APPLIED). */
  outcome?: string;
  reason?: string;
  /** REJECTED version_future: re-minted after the next Status's rebase, if still the facet's intent. */
  remint?: 'awaiting' | 'done' | 'skipped';
  reminted_as?: number;
  adopted_version?: string | null;
  /** A REJECTED edit the user has been shown and dismissed; kept, never deleted. */
  dismissed?: boolean;
}

/** Hlc state as stored: micros as decimal text, so no store needs BigInt support. */
export interface HlcRecord {
  micros: string;
  counter: number;
}

export interface SyncMeta {
  sub: string;
  device_id: string;
  /** Delta resume token; empty means from the start of the feed. */
  cursor: string;
  hlc: HlcRecord;
  /** Server minus wall clock, from the latest Status. */
  offset_ms: number;
  /** Highest REJECTED edit version since the last Status; non-null means a fresh Status is owed. */
  rejected_past: string | null;
  server_cursor?: string;
  pending_review?: number;
  status_at?: number;
  /**
   * Labelled heads (uf/label) the catalogue answered `unresolved` (it has no product for them: a figure held under a head the
   * importer minted), by the wall-clock ms it said so. The engine does not ask again until UNRESOLVED_TTL_MS passes, a pull-to-refresh, or a
   * card for the head arrives (putProducts forgets it). None on a meta stored before the field existed.
   */
  unresolved?: Record<string, number>;
}

/**
 * The shape of the cards the app caches (CARD-REFRESH-1): a cached card stored under an older version counts as due on the
 * next sync, whatever its age, so a card that gained fields reaches every device without waiting out the 24 h TTL. Bump it
 * when the card format gains fields the screens read. 1: the cards before this field existed (a record with none is 1);
 * 2: cards with height, width and depth (COORD-DIMS-1); 3: cards with the product kind and the source's category
 * (FIGURES-ONLY-1), so the case can leave goods off its shelves.
 */
export const CARD_SCHEMA_VERSION = 3;

export interface ProductRecord {
  sub: string;
  head_id: string;
  card: ProductCard;
  /** The CARD_SCHEMA_VERSION the card was stored under; none on a record stored before the field existed (1). */
  card_schema?: number;
  /** The newest as_of among the card's texts, for the offline-stale badge; null when none carries one. */
  as_of: string | null;
  /** Wall-clock ms when the card was fetched. */
  fetched_at: number;
}

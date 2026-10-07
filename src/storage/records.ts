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
  /** The server's outcome as answered (DUPLICATE is kept distinct from APPLIED). */
  outcome?: string;
  reason?: string;
  /** REJECTED version_future: re-minted after the next Status's rebase, if still the facet's intent. */
  remint?: 'awaiting' | 'done' | 'skipped';
  reminted_as?: number;
  adopted_version?: string | null;
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
}

export interface ProductRecord {
  sub: string;
  head_id: string;
  card: ProductCard;
  /** The newest as_of among the card's texts, for the offline-stale badge; null when none carries one. */
  as_of: string | null;
  /** Wall-clock ms when the card was fetched. */
  fetched_at: number;
}

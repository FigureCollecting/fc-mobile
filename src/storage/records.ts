// Row shapes of the v2 local store. Every row's key starts with the user's sub,
// so a query bound to one sub can never range over another user's rows.
import type { ProductCard, UserFacetField } from '@figurecollecting/fc-api-contract';

export type FacetOp = 'upsert' | 'delete';

/** One facet at one version. `payload` is JSON text, empty for a tombstone. */
export interface FacetValue {
  version: string;
  op: FacetOp;
  payload: string;
}

export interface FacetRecord {
  sub: string;
  facet_key: string;
  /** Set only for the four user-owned keys; indexes the holding view. */
  head_id?: string;
  field?: UserFacetField;
  /** local[facet_key]: what the UI shows and what the merge rule compares. null holds nothing. */
  value: FacetValue | null;
  /** The newest value the server has reported, from Delta or a Push result's current. */
  known: FacetValue | null;
  /** Outbox id of the unanswered local edit that `value` is, or null. */
  pending_id: number | null;
  /** The local edit a newer remote value replaced: shown as 'overwritten by another device'. */
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
  /** The batch idempotency key, set once the entry is frozen into a batch. */
  client_id?: string;
  batch_pos?: number;
  created_at: number;
  /** The server's outcome as answered (DUPLICATE is kept distinct from APPLIED). */
  outcome?: string;
  reason?: string;
  /** A newer remote value replaced this edit before it was answered. */
  superseded?: boolean;
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

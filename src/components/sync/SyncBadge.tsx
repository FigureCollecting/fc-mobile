import type { ItemSync } from '../../local/figures';
import { Style } from '../../styles/Style';

export interface AsOfOptions {
  now?: number;
  timeZone?: string;
}

/** "as of 14:05 CDT" for today in the device's zone, "as of Oct 3, 14:05 CDT" for another day. */
export function formatAsOf(at: string | number, opts: AsOfOptions = {}): string {
  const ms = typeof at === 'number' ? at : Date.parse(at);
  if (Number.isNaN(ms)) return 'as of an unknown time';
  const zone = opts.timeZone === undefined ? {} : { timeZone: opts.timeZone };
  const day = (t: number) => new Intl.DateTimeFormat('en-US', { ...zone, year: 'numeric', month: 'numeric', day: 'numeric' }).format(t);
  const time = new Intl.DateTimeFormat('en-US', { ...zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' }).format(ms);
  if (day(ms) === day(opts.now ?? Date.now())) return `as of ${time}`;
  const date = new Intl.DateTimeFormat('en-US', { ...zone, month: 'short', day: 'numeric' }).format(ms);
  return `as of ${date}, ${time}`;
}

export interface SyncBadgeProps extends AsOfOptions {
  sync: ItemSync;
  asOf: string | number | null;
  /** For aria-describedby on the item it badges. */
  id: string;
}

const LABEL: Record<Exclude<ItemSync, 'offline-stale'>, string> = { known: 'Synced', pending: 'Pending' };

// One badge per item: known (quiet: a screen reader hears it), pending, or offline-stale with when
// its data was last current.
export function SyncBadge({ sync, asOf, id, now, timeZone }: SyncBadgeProps) {
  const text = sync === 'offline-stale' ? (asOf === null ? 'Offline' : formatAsOf(asOf, { now, timeZone })) : LABEL[sync];
  return (
    <span id={id} class={`sync-badge sync-badge--${sync}`} data-sync={sync}>
      {text}
      <Style css={`
        .sync-badge {
          display: inline-block;
          max-width: 100%;
          padding: 1px 6px;
          border-radius: 8px;
          font-size: 10px;
          line-height: 13px;
          font-weight: 600;
          overflow-wrap: anywhere;
        }
        .sync-badge--pending {
          background: var(--accent-warning, #d97706);
          color: #fff;
        }
        .sync-badge--offline-stale {
          background: rgba(0, 0, 0, 0.6);
          color: #fff;
        }
        .sync-badge--known {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          clip-path: inset(50%);
          white-space: nowrap;
          padding: 0;
        }
      `} />
    </span>
  );
}

import type { ReadonlySignal } from '@preact/signals';
import type { SyncState } from '../../sync/engine';
import { Style } from '../../styles/Style';

export interface SyncStatusLineProps {
  state: ReadonlySignal<SyncState>;
  onDismissRejected: () => void;
}

const changes = (n: number): string => (n === 1 ? '1 change' : `${n} changes`);
const code = (reason: string): string => reason.split(':')[0]!.trim() || 'refused';

// What sync is doing, in place and quietly: never a toast, never a navigation. Nothing shows while
// everything is synced.
export function SyncStatusLine({ state, onDismissRejected }: SyncStatusLineProps) {
  const { reachability, pending, rejected, overwritten } = state.value;
  const lines: string[] = [];
  if (reachability === 'unreachable') {
    lines.push(`Can't reach server.${pending > 0 ? ` ${changes(pending)} waiting to sync.` : ''} Your changes are kept on this device.`);
  } else if (pending > 0) {
    lines.push(`${changes(pending)} waiting to sync.`);
  }
  if (overwritten > 0) lines.push(`${overwritten === 1 ? '1 edit' : `${overwritten} edits`} overwritten by another device.`);
  if (lines.length === 0 && rejected.length === 0) return null;

  return (
    <div class="sync-status-line" role="status" aria-live="polite" data-reachability={reachability} data-pending={pending}>
      {lines.map((text) => (
        <span key={text}>{text}</span>
      ))}
      {rejected.length > 0 && (
        <span class="sync-status-line__rejected">
          {`${changes(rejected.length)} could not be saved (${[...new Set(rejected.map((r) => code(r.reason)))].join(', ')}).`}
          <button type="button" class="sync-status-line__button" onClick={onDismissRejected}>
            Dismiss
          </button>
        </span>
      )}

      <Style css={`
        .sync-status-line {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: center;
          gap: 4px 12px;
          padding: 6px 16px;
          background: var(--surface-2, #f1f3f5);
          color: var(--text-1, #212529);
          font-size: 13px;
          flex-shrink: 0;
        }
        .sync-status-line__button {
          margin-left: 8px;
          padding: 2px 10px;
          border-radius: 999px;
          border: 1px solid currentColor;
          background: transparent;
          color: inherit;
          font: inherit;
        }
      `} />
    </div>
  );
}

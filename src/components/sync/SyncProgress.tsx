import type { SyncPhase } from '@figurecollecting/fc-shared';

interface SyncProgressProps {
  phase: SyncPhase | null;
  completed: number;
  total: number;
  failed: number;
  skipped: number;
  message?: string | null;
  byStatus?: {
    owned: { queued: number; completed: number; failed: number };
    ordered: { queued: number; completed: number; failed: number };
    wished: { queued: number; completed: number; failed: number };
  };
  onCancel?: () => void;
}

const PHASE_LABELS: Record<string, string> = {
  validating: 'Validating cookies',
  exporting: 'Exporting collection',
  parsing: 'Parsing data',
  fetching_lists: 'Fetching lists',
  queueing: 'Queueing items',
  enriching: 'Enriching figures',
  completed: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const PHASE_ORDER = ['validating', 'exporting', 'parsing', 'enriching', 'completed'];

export function SyncProgress({
  phase,
  completed,
  total,
  failed,
  skipped,
  message,
  byStatus,
  onCancel,
}: SyncProgressProps) {
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  const phaseLabel = phase ? PHASE_LABELS[phase] ?? phase : 'Preparing';
  const isActive = phase !== 'completed' && phase !== 'failed' && phase !== 'cancelled';

  return (
    <div class="sync-progress">
      {/* Phase steps */}
      <div class="sync-progress__phases">
        {PHASE_ORDER.map((p) => {
          const currentIndex = PHASE_ORDER.indexOf(phase ?? '');
          const stepIndex = PHASE_ORDER.indexOf(p);
          let state: 'done' | 'active' | 'pending' = 'pending';
          if (stepIndex < currentIndex || phase === 'completed') state = 'done';
          else if (stepIndex === currentIndex) state = 'active';

          return (
            <div key={p} class={`sync-progress__phase sync-progress__phase--${state}`}>
              <div class="sync-progress__phase-dot">
                {state === 'done' ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : state === 'active' ? (
                  <span class="sync-progress__phase-pulse" />
                ) : null}
              </div>
              <span class="sync-progress__phase-label">
                {PHASE_LABELS[p] ?? p}
              </span>
            </div>
          );
        })}
      </div>

      {/* Main progress bar */}
      <div class="sync-progress__bar-section">
        <div class="sync-progress__bar-header">
          <span class="sync-progress__bar-label">{phaseLabel}</span>
          <span class="sync-progress__bar-pct">{percentage}%</span>
        </div>
        <div class="sync-progress__bar-track">
          <div
            class={`sync-progress__bar-fill ${isActive ? 'sync-progress__bar-fill--active' : ''}`}
            style={{ width: `${percentage}%` }}
          />
        </div>
        <div class="sync-progress__bar-counts">
          <span>{completed} / {total} items</span>
          {failed > 0 && <span class="sync-progress__count-failed">{failed} failed</span>}
          {skipped > 0 && <span class="sync-progress__count-skipped">{skipped} skipped</span>}
        </div>
      </div>

      {/* Per-status breakdown */}
      {byStatus && (
        <div class="sync-progress__statuses">
          <StatusMiniBar label="Owned" color="var(--accent-success)" data={byStatus.owned} />
          <StatusMiniBar label="Ordered" color="var(--accent-warning)" data={byStatus.ordered} />
          <StatusMiniBar label="Wished" color="var(--accent-info)" data={byStatus.wished} />
        </div>
      )}

      {/* Current message */}
      {message && (
        <p class="sync-progress__message">{message}</p>
      )}

      {/* Cancel button */}
      {isActive && onCancel && (
        <button class="sync-progress__cancel" type="button" onClick={onCancel}>
          Cancel Sync
        </button>
      )}

      <style>{`
        .sync-progress {
          display: flex;
          flex-direction: column;
          gap: var(--space-5);
        }

        /* Phase steps */
        .sync-progress__phases {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--space-1);
        }

        .sync-progress__phase {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-1);
          flex: 1;
        }

        .sync-progress__phase-dot {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--surface-primary);
          border: 2px solid var(--border-default);
          transition: all var(--transition-normal);
          position: relative;
        }

        .sync-progress__phase--done .sync-progress__phase-dot {
          background: var(--accent-success);
          border-color: var(--accent-success);
          color: white;
        }

        .sync-progress__phase--active .sync-progress__phase-dot {
          border-color: var(--brand-500);
          background: var(--brand-500);
        }

        .sync-progress__phase-pulse {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: white;
          animation: phase-pulse 1.2s ease-in-out infinite;
        }

        @keyframes phase-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(0.6); opacity: 0.5; }
        }

        .sync-progress__phase-label {
          font-size: 0.625rem;
          color: var(--text-tertiary);
          text-align: center;
          line-height: var(--line-height-tight);
        }

        .sync-progress__phase--done .sync-progress__phase-label,
        .sync-progress__phase--active .sync-progress__phase-label {
          color: var(--text-secondary);
        }

        /* Main progress bar */
        .sync-progress__bar-section {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .sync-progress__bar-header {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
        }

        .sync-progress__bar-label {
          font-size: var(--font-sm);
          font-weight: var(--font-weight-semibold);
          color: var(--text-primary);
        }

        .sync-progress__bar-pct {
          font-size: var(--font-sm);
          font-weight: var(--font-weight-bold);
          color: var(--brand-400);
        }

        .sync-progress__bar-track {
          height: 8px;
          background: var(--surface-primary);
          border-radius: var(--radius-full);
          overflow: hidden;
        }

        .sync-progress__bar-fill {
          height: 100%;
          background: var(--brand-500);
          border-radius: var(--radius-full);
          transition: width 300ms var(--spring-snappy);
        }

        .sync-progress__bar-fill--active {
          background: linear-gradient(
            90deg,
            var(--brand-500) 0%,
            var(--brand-400) 50%,
            var(--brand-500) 100%
          );
          background-size: 200% 100%;
          animation: progress-shimmer 2s linear infinite;
        }

        @keyframes progress-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        .sync-progress__bar-counts {
          display: flex;
          gap: var(--space-3);
          font-size: var(--font-xs);
          color: var(--text-secondary);
        }

        .sync-progress__count-failed {
          color: var(--accent-danger);
        }

        .sync-progress__count-skipped {
          color: var(--text-tertiary);
        }

        /* Per-status breakdown */
        .sync-progress__statuses {
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        /* Message */
        .sync-progress__message {
          font-size: var(--font-xs);
          color: var(--text-tertiary);
          text-align: center;
          font-style: italic;
        }

        /* Cancel */
        .sync-progress__cancel {
          width: 100%;
          padding: var(--space-3);
          background: transparent;
          border: 1px solid var(--border-default);
          border-radius: var(--radius-lg);
          color: var(--text-secondary);
          font-size: var(--font-sm);
          font-weight: var(--font-weight-medium);
          min-height: var(--touch-min);
          transition: all var(--transition-fast);
        }

        .sync-progress__cancel:active {
          background: var(--surface-tertiary);
          color: var(--accent-danger);
          border-color: var(--accent-danger);
        }
      `}</style>
    </div>
  );
}

/** Mini progress bar for a single status (owned/ordered/wished) */
function StatusMiniBar({
  label,
  color,
  data,
}: {
  label: string;
  color: string;
  data: { queued: number; completed: number; failed: number };
}) {
  const total = data.queued + data.completed + data.failed;
  const pct = total > 0 ? Math.round((data.completed / total) * 100) : 0;

  if (total === 0) return null;

  return (
    <div class="status-mini-bar">
      <div class="status-mini-bar__header">
        <span class="status-mini-bar__label" style={{ color }}>{label}</span>
        <span class="status-mini-bar__count">{data.completed}/{total}</span>
      </div>
      <div class="status-mini-bar__track">
        <div
          class="status-mini-bar__fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>

      <style>{`
        .status-mini-bar {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
        }

        .status-mini-bar__header {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
        }

        .status-mini-bar__label {
          font-size: var(--font-xs);
          font-weight: var(--font-weight-semibold);
        }

        .status-mini-bar__count {
          font-size: var(--font-xs);
          color: var(--text-tertiary);
        }

        .status-mini-bar__track {
          height: 4px;
          background: var(--surface-primary);
          border-radius: var(--radius-full);
          overflow: hidden;
        }

        .status-mini-bar__fill {
          height: 100%;
          border-radius: var(--radius-full);
          transition: width 300ms var(--spring-snappy);
        }
      `}</style>
    </div>
  );
}

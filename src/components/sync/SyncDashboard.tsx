import { useRef, useCallback } from 'preact/hooks';
import type { MfcCookies } from '@figurecollecting/fc-shared';
import { useSync } from '../../hooks/useSync';
import { CookieInput } from './CookieInput';
import { SyncProgress } from './SyncProgress';

interface SyncDashboardProps {
  onViewCollection?: () => void;
}

export function SyncDashboard({ onViewCollection }: SyncDashboardProps) {
  const {
    uiPhase,
    syncPhase,
    progress,
    message,
    error,
    openCookieSetup,
    validateCookies,
    startSync,
    cancelSync,
    reset,
  } = useSync();

  const cookiesRef = useRef<MfcCookies | null>(null);

  const handleCookieSubmit = useCallback(async (cookies: MfcCookies) => {
    cookiesRef.current = cookies;
    const valid = await validateCookies(cookies);
    if (valid) {
      await startSync(cookies);
    }
  }, [validateCookies, startSync]);

  const handleRetry = useCallback(() => {
    if (cookiesRef.current) {
      startSync(cookiesRef.current);
    } else {
      openCookieSetup();
    }
  }, [startSync, openCookieSetup]);

  return (
    <div class="sync-dashboard">
      <h2 class="sync-dashboard__title">MFC Sync</h2>

      {/* Idle state */}
      {uiPhase === 'idle' && (
        <div class="sync-dashboard__idle">
          <div class="sync-dashboard__icon-container">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--brand-400)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.66 0 3-4.03 3-9s-1.34-9-3-9m0 18c-1.66 0-3-4.03-3-9s1.34-9 3-9m-9 9a9 9 0 0 1 9-9" />
            </svg>
          </div>
          <p class="sync-dashboard__idle-text">
            Sync your collection from MyFigureCollection to keep everything up to date.
          </p>
          <button
            class="sync-dashboard__start-btn"
            type="button"
            onClick={openCookieSetup}
          >
            Start Sync
          </button>
        </div>
      )}

      {/* Cookie setup */}
      {(uiPhase === 'cookie-setup' || uiPhase === 'validating-cookies') && (
        <CookieInput
          onSubmit={handleCookieSubmit}
          isValidating={uiPhase === 'validating-cookies'}
          error={error}
        />
      )}

      {/* Syncing */}
      {uiPhase === 'syncing' && (
        <SyncProgress
          phase={syncPhase}
          completed={progress.completed}
          total={progress.total}
          failed={progress.failed}
          skipped={progress.skipped}
          message={message}
          byStatus={progress.byStatus}
          onCancel={cancelSync}
        />
      )}

      {/* Complete */}
      {uiPhase === 'complete' && (
        <div class="sync-dashboard__complete">
          <div class="sync-dashboard__complete-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent-success)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="16 9 10.5 15 8 12.5" />
            </svg>
          </div>
          <h3 class="sync-dashboard__complete-title">Sync Complete</h3>
          <div class="sync-dashboard__complete-stats">
            <div class="sync-dashboard__stat">
              <span class="sync-dashboard__stat-value">{progress.completed}</span>
              <span class="sync-dashboard__stat-label">Synced</span>
            </div>
            {progress.failed > 0 && (
              <div class="sync-dashboard__stat sync-dashboard__stat--failed">
                <span class="sync-dashboard__stat-value">{progress.failed}</span>
                <span class="sync-dashboard__stat-label">Failed</span>
              </div>
            )}
            {progress.skipped > 0 && (
              <div class="sync-dashboard__stat">
                <span class="sync-dashboard__stat-value">{progress.skipped}</span>
                <span class="sync-dashboard__stat-label">Skipped</span>
              </div>
            )}
          </div>
          <div class="sync-dashboard__complete-actions">
            {onViewCollection && (
              <button
                class="sync-dashboard__action-btn sync-dashboard__action-btn--primary"
                type="button"
                onClick={onViewCollection}
              >
                View Collection
              </button>
            )}
            <button
              class="sync-dashboard__action-btn"
              type="button"
              onClick={reset}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {uiPhase === 'error' && (
        <div class="sync-dashboard__error">
          <div class="sync-dashboard__error-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent-danger)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
          </div>
          <h3 class="sync-dashboard__error-title">Sync Failed</h3>
          <p class="sync-dashboard__error-message">{error}</p>
          <div class="sync-dashboard__error-actions">
            <button
              class="sync-dashboard__action-btn sync-dashboard__action-btn--primary"
              type="button"
              onClick={handleRetry}
            >
              Retry
            </button>
            <button
              class="sync-dashboard__action-btn"
              type="button"
              onClick={reset}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <style>{`
        .sync-dashboard {
          display: flex;
          flex-direction: column;
          gap: var(--space-5);
        }

        .sync-dashboard__title {
          font-size: var(--font-xl);
          font-weight: var(--font-weight-bold);
          color: var(--text-primary);
        }

        /* Idle */
        .sync-dashboard__idle {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-4);
          padding: var(--space-6) 0;
        }

        .sync-dashboard__icon-container {
          width: 80px;
          height: 80px;
          border-radius: var(--radius-full);
          background: var(--surface-primary);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .sync-dashboard__idle-text {
          font-size: var(--font-sm);
          color: var(--text-secondary);
          text-align: center;
          line-height: var(--line-height-normal);
          max-width: 280px;
        }

        .sync-dashboard__start-btn {
          padding: var(--space-3) var(--space-8);
          background: var(--brand-500);
          color: var(--text-primary);
          border-radius: var(--radius-lg);
          font-weight: var(--font-weight-semibold);
          font-size: var(--font-base);
          min-height: var(--touch-min);
          min-width: 160px;
          transition: background var(--transition-fast);
        }

        .sync-dashboard__start-btn:active {
          background: var(--brand-600);
        }

        /* Complete */
        .sync-dashboard__complete {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-4);
          padding: var(--space-4) 0;
        }

        .sync-dashboard__complete-icon {
          animation: sync-check-pop 400ms var(--spring-bouncy);
        }

        @keyframes sync-check-pop {
          from { transform: scale(0.5); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }

        .sync-dashboard__complete-title {
          font-size: var(--font-lg);
          font-weight: var(--font-weight-bold);
          color: var(--accent-success);
        }

        .sync-dashboard__complete-stats {
          display: flex;
          gap: var(--space-6);
        }

        .sync-dashboard__stat {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }

        .sync-dashboard__stat-value {
          font-size: var(--font-xl);
          font-weight: var(--font-weight-bold);
          color: var(--text-primary);
        }

        .sync-dashboard__stat--failed .sync-dashboard__stat-value {
          color: var(--accent-danger);
        }

        .sync-dashboard__stat-label {
          font-size: var(--font-xs);
          color: var(--text-secondary);
        }

        .sync-dashboard__complete-actions,
        .sync-dashboard__error-actions {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          width: 100%;
          max-width: 280px;
        }

        .sync-dashboard__action-btn {
          width: 100%;
          padding: var(--space-3);
          border-radius: var(--radius-lg);
          font-weight: var(--font-weight-semibold);
          font-size: var(--font-sm);
          min-height: var(--touch-min);
          transition: all var(--transition-fast);
          background: transparent;
          border: 1px solid var(--border-default);
          color: var(--text-secondary);
        }

        .sync-dashboard__action-btn:active {
          background: var(--surface-tertiary);
        }

        .sync-dashboard__action-btn--primary {
          background: var(--brand-500);
          border-color: var(--brand-500);
          color: var(--text-primary);
        }

        .sync-dashboard__action-btn--primary:active {
          background: var(--brand-600);
        }

        /* Error */
        .sync-dashboard__error {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-4);
          padding: var(--space-4) 0;
        }

        .sync-dashboard__error-icon {
          animation: sync-error-shake 400ms ease-out;
        }

        @keyframes sync-error-shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }

        .sync-dashboard__error-title {
          font-size: var(--font-lg);
          font-weight: var(--font-weight-bold);
          color: var(--accent-danger);
        }

        .sync-dashboard__error-message {
          font-size: var(--font-sm);
          color: var(--text-secondary);
          text-align: center;
          line-height: var(--line-height-normal);
          max-width: 280px;
        }
      `}</style>
    </div>
  );
}

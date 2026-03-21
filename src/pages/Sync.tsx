import { useCallback } from 'preact/hooks';
import { useLocation } from 'wouter';
import { Header } from '../components/layout/Header';
import { SyncDashboard } from '../components/sync/SyncDashboard';

export function Sync() {
  const [, setLocation] = useLocation();

  const handleViewCollection = useCallback(() => {
    setLocation('/');
  }, [setLocation]);

  const handleBack = useCallback(() => {
    setLocation('/profile');
  }, [setLocation]);

  return (
    <div class="page-sync">
      <Header
        title="MFC Sync"
        action={
          <button class="sync-back-btn" type="button" onClick={handleBack} aria-label="Back to Profile">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        }
      />
      <div class="page-sync__content">
        <SyncDashboard onViewCollection={handleViewCollection} />
      </div>

      <style>{`
        .page-sync__content {
          padding: var(--space-4);
          padding-bottom: var(--space-12);
        }

        .sync-back-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: var(--touch-min);
          height: var(--touch-min);
          color: var(--text-secondary);
          border-radius: var(--radius-md);
          transition: color var(--transition-fast);
        }

        .sync-back-btn:active {
          color: var(--text-primary);
          background: var(--surface-tertiary);
        }
      `}</style>
    </div>
  );
}

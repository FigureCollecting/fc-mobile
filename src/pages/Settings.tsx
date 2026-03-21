import { useState, useCallback, useEffect } from 'preact/hooks';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Header } from '../components/layout/Header';
import { BottomSheet } from '../components/ui/BottomSheet';
import { theme } from '../stores/theme';
import type { Theme } from '../stores/theme';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { getCacheStats, clearAllCaches } from '../storage/cacheManager';
import type { CacheStats } from '../storage/cacheManager';
import { hapticLight, hapticMedium, hapticHeavy } from '../utils/haptics';

const APP_VERSION = '0.1.0';

const SYNC_INTERVALS = [
  { value: 'manual', label: 'Manual' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
] as const;

type SyncInterval = (typeof SYNC_INTERVALS)[number]['value'];

/** Back arrow for header navigation */
function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      class="settings__back-btn"
      type="button"
      onClick={onClick}
      aria-label="Go back"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );
}

/** Toggle switch component */
function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      class={`toggle ${checked ? 'toggle--on' : ''} ${disabled ? 'toggle--disabled' : ''}`}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => { hapticLight(); onChange(!checked); }}
    >
      <span class="toggle__thumb" />
    </button>
  );
}

/** 3-way theme selector */
function ThemeSelector() {
  const current = theme.value;

  const handleSelect = (t: Theme) => {
    hapticLight();
    theme.value = t;
  };

  return (
    <div class="theme-selector">
      {(['dark', 'light', 'system'] as Theme[]).map((t) => (
        <button
          key={t}
          class={`theme-selector__option ${current === t ? 'theme-selector__option--active' : ''}`}
          type="button"
          onClick={() => handleSelect(t)}
          aria-pressed={current === t}
        >
          {t === 'dark' && (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
          {t === 'light' && (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="5" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          )}
          {t === 'system' && (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          )}
          <span>{t.charAt(0).toUpperCase() + t.slice(1)}</span>
        </button>
      ))}
    </div>
  );
}

export function Settings() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  // Cache stats
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [cacheClearing, setCacheClearing] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  // Notifications
  const push = usePushNotifications();
  const [priceAlerts, setPriceAlerts] = useState(() => localStorage.getItem('fc-price-alerts') !== 'false');
  const [syncNotifs, setSyncNotifs] = useState(() => localStorage.getItem('fc-sync-notifs') !== 'false');

  // Sync preferences
  const [syncOwned, setSyncOwned] = useState(() => localStorage.getItem('fc-sync-owned') !== 'false');
  const [syncOrdered, setSyncOrdered] = useState(() => localStorage.getItem('fc-sync-ordered') !== 'false');
  const [syncWished, setSyncWished] = useState(() => localStorage.getItem('fc-sync-wished') !== 'false');
  const [syncInterval, setSyncInterval] = useState<SyncInterval>(
    () => (localStorage.getItem('fc-sync-interval') as SyncInterval) || 'manual',
  );

  // Delete account
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Load cache stats
  useEffect(() => {
    getCacheStats().then(setCacheStats).catch(() => {});
  }, []);

  // Persist notification preferences
  const handlePriceAlerts = useCallback((v: boolean) => {
    setPriceAlerts(v);
    localStorage.setItem('fc-price-alerts', String(v));
  }, []);

  const handleSyncNotifs = useCallback((v: boolean) => {
    setSyncNotifs(v);
    localStorage.setItem('fc-sync-notifs', String(v));
  }, []);

  // Persist sync preferences
  const handleSyncOwned = useCallback((v: boolean) => {
    setSyncOwned(v);
    localStorage.setItem('fc-sync-owned', String(v));
  }, []);

  const handleSyncOrdered = useCallback((v: boolean) => {
    setSyncOrdered(v);
    localStorage.setItem('fc-sync-ordered', String(v));
  }, []);

  const handleSyncWished = useCallback((v: boolean) => {
    setSyncWished(v);
    localStorage.setItem('fc-sync-wished', String(v));
  }, []);

  const handleSyncInterval = useCallback((e: Event) => {
    const val = (e.target as HTMLSelectElement).value as SyncInterval;
    hapticLight();
    setSyncInterval(val);
    localStorage.setItem('fc-sync-interval', val);
  }, []);

  // Clear cache
  const handleClearCache = useCallback(async () => {
    setCacheClearing(true);
    hapticMedium();
    try {
      await clearAllCaches();
      queryClient.clear();
      setCacheStats({ figureCount: 0, pendingOpsCount: 0, estimatedSizeKb: 0 });
    } finally {
      setCacheClearing(false);
      setClearConfirmOpen(false);
    }
  }, [queryClient]);

  // Delete account (placeholder)
  const handleDeleteAccount = useCallback(() => {
    hapticHeavy();
    // TODO: integrate with backend DELETE /auth/account
    setDeleteConfirmOpen(false);
  }, []);

  const formatSize = (kb: number) => {
    if (kb < 1024) return `${kb} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  };

  return (
    <div class="page-settings">
      <Header
        title="Settings"
        leading={<BackButton onClick={() => setLocation('/profile')} />}
      />

      <div class="settings__content">

        {/* ── Appearance ── */}
        <section class="settings__section">
          <h3 class="settings__section-title">Appearance</h3>
          <div class="settings__row settings__row--column">
            <span class="settings__label">Theme</span>
            <ThemeSelector />
          </div>
        </section>

        {/* ── Data & Storage ── */}
        <section class="settings__section">
          <h3 class="settings__section-title">Data & Storage</h3>

          {cacheStats && (
            <div class="settings__row">
              <span class="settings__label">Cached Figures</span>
              <span class="settings__value">{cacheStats.figureCount}</span>
            </div>
          )}

          {cacheStats && (
            <div class="settings__row">
              <span class="settings__label">Storage Used</span>
              <span class="settings__value">{formatSize(cacheStats.estimatedSizeKb)}</span>
            </div>
          )}

          <button
            class="settings__row settings__row--action"
            type="button"
            onClick={() => { hapticLight(); setClearConfirmOpen(true); }}
          >
            <span class="settings__label settings__label--warning">Clear Cache</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </section>

        {/* ── Notifications ── */}
        <section class="settings__section">
          <h3 class="settings__section-title">Notifications</h3>

          {push.isSupported && (
            <div class="settings__row">
              <span class="settings__label">Push Notifications</span>
              <Toggle
                checked={push.isSubscribed}
                onChange={(v) => v ? push.requestPermission() : push.unsubscribe()}
                disabled={push.loading || push.permission === 'denied'}
              />
            </div>
          )}

          {push.permission === 'denied' && (
            <p class="settings__hint">Push notifications are blocked in browser settings.</p>
          )}

          <div class="settings__row">
            <span class="settings__label">Price Alerts</span>
            <Toggle checked={priceAlerts} onChange={handlePriceAlerts} />
          </div>

          <div class="settings__row">
            <span class="settings__label">Sync Complete</span>
            <Toggle checked={syncNotifs} onChange={handleSyncNotifs} />
          </div>
        </section>

        {/* ── Sync ── */}
        <section class="settings__section">
          <h3 class="settings__section-title">Sync</h3>

          <div class="settings__row">
            <span class="settings__label">Sync Owned</span>
            <Toggle checked={syncOwned} onChange={handleSyncOwned} />
          </div>

          <div class="settings__row">
            <span class="settings__label">Sync Ordered</span>
            <Toggle checked={syncOrdered} onChange={handleSyncOrdered} />
          </div>

          <div class="settings__row">
            <span class="settings__label">Sync Wished</span>
            <Toggle checked={syncWished} onChange={handleSyncWished} />
          </div>

          <div class="settings__row">
            <span class="settings__label">Auto-Sync Interval</span>
            <select
              class="settings__select"
              value={syncInterval}
              onChange={handleSyncInterval}
            >
              {SYNC_INTERVALS.map((i) => (
                <option key={i.value} value={i.value}>{i.label}</option>
              ))}
            </select>
          </div>
        </section>

        {/* ── About ── */}
        <section class="settings__section">
          <h3 class="settings__section-title">About</h3>

          <div class="settings__row">
            <span class="settings__label">Version</span>
            <span class="settings__value">{APP_VERSION}</span>
          </div>

          <a
            class="settings__row settings__row--action"
            href="https://github.com/FigureCollecting"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span class="settings__label">View on GitHub</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>

          <a
            class="settings__row settings__row--action"
            href="https://github.com/FigureCollecting/fc-mobile/issues/new"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span class="settings__label">Report an Issue</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>

          <div class="settings__row">
            <span class="settings__label settings__label--muted">
              Built with Preact, Wouter, React Query
            </span>
          </div>
        </section>

        {/* ── Account ── */}
        <section class="settings__section">
          <h3 class="settings__section-title">Account</h3>

          <button
            class="settings__row settings__row--action"
            type="button"
            onClick={() => { hapticLight(); setLocation('/profile/security'); }}
          >
            <span class="settings__label">Change Password</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>

          <button
            class="settings__row settings__row--action"
            type="button"
            onClick={() => { hapticHeavy(); setDeleteConfirmOpen(true); }}
          >
            <span class="settings__label settings__label--danger">Delete Account</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-danger)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </section>
      </div>

      {/* Clear cache confirmation */}
      <BottomSheet open={clearConfirmOpen} onClose={() => setClearConfirmOpen(false)} snapPoint="half">
        <div class="settings__confirm">
          <h3 class="settings__confirm-title">Clear Cache?</h3>
          <p class="settings__confirm-text">
            This will remove all cached figures and stored data. Your account data on the server is not affected.
          </p>
          <button
            class="settings__confirm-btn settings__confirm-btn--warning"
            type="button"
            onClick={handleClearCache}
            disabled={cacheClearing}
          >
            {cacheClearing ? 'Clearing...' : 'Clear Cache'}
          </button>
          <button
            class="settings__confirm-btn settings__confirm-btn--cancel"
            type="button"
            onClick={() => setClearConfirmOpen(false)}
          >
            Cancel
          </button>
        </div>
      </BottomSheet>

      {/* Delete account confirmation */}
      <BottomSheet open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} snapPoint="half">
        <div class="settings__confirm">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--accent-danger)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <h3 class="settings__confirm-title">Delete Account?</h3>
          <p class="settings__confirm-text">
            This action is permanent and cannot be undone. All your data, collection, and preferences will be permanently deleted.
          </p>
          <button
            class="settings__confirm-btn settings__confirm-btn--danger"
            type="button"
            onClick={handleDeleteAccount}
          >
            Delete My Account
          </button>
          <button
            class="settings__confirm-btn settings__confirm-btn--cancel"
            type="button"
            onClick={() => setDeleteConfirmOpen(false)}
          >
            Cancel
          </button>
        </div>
      </BottomSheet>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .page-settings {
    display: flex;
    flex-direction: column;
    min-height: 100%;
  }

  .settings__back-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--touch-min);
    height: var(--touch-min);
    margin-left: calc(-1 * var(--space-2));
  }

  .settings__content {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-4);
    padding-bottom: calc(var(--space-12) + var(--bottom-nav-height));
  }

  /* Sections */
  .settings__section {
    display: flex;
    flex-direction: column;
  }

  .settings__section-title {
    font-size: var(--font-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0 var(--space-2);
    margin-bottom: var(--space-2);
  }

  /* Rows */
  .settings__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-2);
    border-bottom: 1px solid var(--border-subtle);
    min-height: var(--touch-min);
    font-size: var(--font-sm);
    color: var(--text-primary);
    text-decoration: none;
    background: transparent;
    text-align: left;
    width: 100%;
  }

  .settings__row--column {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
  }

  .settings__row--action {
    cursor: pointer;
    transition: background var(--transition-fast);
    border-radius: 0;
  }

  .settings__row--action:active {
    background: var(--surface-tertiary);
  }

  .settings__label {
    color: var(--text-primary);
  }

  .settings__label--warning {
    color: var(--accent-warning);
  }

  .settings__label--danger {
    color: var(--accent-danger);
  }

  .settings__label--muted {
    color: var(--text-tertiary);
    font-size: var(--font-xs);
  }

  .settings__value {
    color: var(--text-secondary);
    font-size: var(--font-xs);
  }

  .settings__hint {
    font-size: var(--font-xs);
    color: var(--text-tertiary);
    padding: 0 var(--space-2) var(--space-2);
  }

  .settings__select {
    min-height: 36px;
    padding: var(--space-1) var(--space-3);
    font-size: var(--font-sm);
    border-radius: var(--radius-sm);
    background: var(--surface-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border-default);
    min-width: 100px;
  }

  /* Toggle */
  .toggle {
    position: relative;
    width: 52px;
    height: 30px;
    border-radius: var(--radius-full);
    background: var(--surface-tertiary);
    transition: background var(--transition-fast);
    flex-shrink: 0;
    cursor: pointer;
    padding: 3px;
  }

  .toggle--on {
    background: var(--brand-500);
  }

  .toggle--disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .toggle__thumb {
    display: block;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-full);
    background: white;
    transition: transform var(--transition-fast);
    box-shadow: var(--shadow-sm);
  }

  .toggle--on .toggle__thumb {
    transform: translateX(22px);
  }

  /* Theme selector */
  .theme-selector {
    display: flex;
    gap: var(--space-2);
    width: 100%;
  }

  .theme-selector__option {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface-secondary);
    border: 2px solid transparent;
    color: var(--text-secondary);
    font-size: var(--font-sm);
    font-weight: var(--font-weight-medium);
    min-height: var(--touch-min);
    transition: all var(--transition-fast);
    cursor: pointer;
  }

  .theme-selector__option--active {
    border-color: var(--brand-500);
    color: var(--brand-400);
    background: var(--surface-tertiary);
  }

  .theme-selector__option:active:not(.theme-selector__option--active) {
    background: var(--surface-tertiary);
  }

  /* Confirm dialogs */
  .settings__confirm {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4) 0;
  }

  .settings__confirm-title {
    font-size: var(--font-xl);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
  }

  .settings__confirm-text {
    font-size: var(--font-sm);
    color: var(--text-secondary);
    text-align: center;
    line-height: var(--line-height-normal);
    max-width: 280px;
  }

  .settings__confirm-btn {
    width: 100%;
    max-width: 280px;
    padding: var(--space-3);
    border-radius: var(--radius-lg);
    font-weight: var(--font-weight-semibold);
    font-size: var(--font-base);
    min-height: var(--touch-min);
    transition: all var(--transition-fast);
    cursor: pointer;
  }

  .settings__confirm-btn--warning {
    background: var(--accent-warning);
    color: #1a1a1a;
  }

  .settings__confirm-btn--warning:active {
    background: #d97706;
  }

  .settings__confirm-btn--warning:disabled {
    opacity: 0.6;
  }

  .settings__confirm-btn--danger {
    background: var(--accent-danger);
    color: white;
  }

  .settings__confirm-btn--danger:active {
    background: #dc2626;
  }

  .settings__confirm-btn--cancel {
    background: transparent;
    border: 1px solid var(--border-default);
    color: var(--text-secondary);
  }

  .settings__confirm-btn--cancel:active {
    background: var(--surface-tertiary);
  }
`;

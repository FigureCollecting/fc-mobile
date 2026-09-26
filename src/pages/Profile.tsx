import { useState, useCallback } from 'preact/hooks';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Header } from '../components/layout/Header';
import { BottomSheet } from '../components/ui/BottomSheet';
import { CollectionStats } from '../components/profile/CollectionStats';
import { SyncDashboard } from '../components/sync/SyncDashboard';
import { useAuthStore } from '../stores/auth';
import { clearCache } from '../storage/figureCache';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { useUnreadCount } from '../hooks/useNotifications';

const APP_VERSION = '0.1.0';

/** Chevron icon for list items */
function ChevronRight() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export function Profile() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  const [syncSheetOpen, setSyncSheetOpen] = useState(false);
  const [signOutSheetOpen, setSignOutSheetOpen] = useState(false);
  const [cacheClearing, setCacheClearing] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);
  const push = usePushNotifications();
  const { data: unreadCount = 0 } = useUnreadCount();

  const initials = user?.username
    ? user.username.slice(0, 2).toUpperCase()
    : '??';

  const handleClearCache = useCallback(async () => {
    setCacheClearing(true);
    try {
      await clearCache();
      queryClient.clear();
      setCacheCleared(true);
      setTimeout(() => setCacheCleared(false), 2000);
    } finally {
      setCacheClearing(false);
    }
  }, [queryClient]);

  const handleSignOut = useCallback(() => {
    useAuthStore.getState().logout();
    clearCache().catch(() => {});
    queryClient.clear();
    setSignOutSheetOpen(false);
    setLocation('/');
  }, [queryClient, setLocation]);

  const handleViewCollection = useCallback(() => {
    setSyncSheetOpen(false);
    setLocation('/');
  }, [setLocation]);

  // Not authenticated: simple sign-in prompt
  if (!isAuthenticated) {
    return (
      <div class="page-profile">
        <Header title="Profile" />
        <div class="profile__centered">
          <div class="profile__avatar profile__avatar--placeholder">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M5.5 21a8.5 8.5 0 0 1 13 0" />
            </svg>
          </div>
          <h2 class="profile__name">Welcome, Collector</h2>
          <p class="profile__subtitle">Sign in to sync your data</p>

          <div class="profile__section">
            <h3 class="profile__section-title">App</h3>
            <div class="profile__item">
              <span>Version</span>
              <span class="profile__item-value">{APP_VERSION}</span>
            </div>
          </div>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  const settingsGear = (
    <button
      class="profile__gear-btn"
      type="button"
      onClick={() => setLocation('/settings')}
      aria-label="Settings"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </button>
  );

  // Authenticated profile
  return (
    <div class="page-profile">
      <Header title="Profile" action={settingsGear} />
      <div class="profile__content">

        {/* User card */}
        <div class="profile__user-card">
          <div class="profile__avatar">
            <span class="profile__initials">{initials}</span>
          </div>
          <div class="profile__user-info">
            <h2 class="profile__name">{user?.username}</h2>
            <p class="profile__email">{user?.email}</p>
          </div>
        </div>

        {/* Collection stats */}
        <CollectionStats />

        {/* Quick actions */}
        <div class="profile__section">
          <h3 class="profile__section-title">Quick Actions</h3>

          <button class="profile__item profile__item--action" type="button" onClick={() => setLocation('/notifications')}>
            <div class="profile__item-left">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand-400)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              <span>Notifications</span>
            </div>
            <div class="profile__item-right">
              {unreadCount > 0 && <span class="profile__notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
              <ChevronRight />
            </div>
          </button>

          <button class="profile__item profile__item--action" type="button" onClick={() => setLocation('/import')}>
            <div class="profile__item-left">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand-400)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span>Import Collection</span>
            </div>
            <ChevronRight />
          </button>

          <button class="profile__item profile__item--action" type="button" onClick={() => setLocation('/export')}>
            <div class="profile__item-left">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand-400)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Export & Share</span>
            </div>
            <ChevronRight />
          </button>

          <button class="profile__item profile__item--action" type="button" onClick={() => setSyncSheetOpen(true)}>
            <div class="profile__item-left">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand-400)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.66 0 3-4.03 3-9s-1.34-9-3-9m0 18c-1.66 0-3-4.03-3-9s1.34-9 3-9m-9 9a9 9 0 0 1 9-9" />
              </svg>
              <span>MFC Sync</span>
            </div>
            <ChevronRight />
          </button>

          <button
            class="profile__item profile__item--action"
            type="button"
            onClick={handleClearCache}
            disabled={cacheClearing}
          >
            <div class="profile__item-left">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-warning)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
              <span>{cacheClearing ? 'Clearing...' : 'Clear Cache'}</span>
            </div>
            {cacheCleared ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-success)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <ChevronRight />
            )}
          </button>

          <div class="profile__item">
            <div class="profile__item-left">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
              <span>Dark Mode</span>
            </div>
            <span class="profile__item-value">On</span>
          </div>

          {push.isSupported && (
            <button
              class="profile__item profile__item--action"
              type="button"
              onClick={push.isSubscribed ? push.unsubscribe : push.requestPermission}
              disabled={push.loading}
            >
              <div class="profile__item-left">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={push.isSubscribed ? 'var(--accent-success)' : 'var(--text-tertiary)'} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                <span>{push.loading ? 'Updating...' : 'Push Notifications'}</span>
              </div>
              <span class="profile__item-value">
                {push.permission === 'denied'
                  ? 'Blocked'
                  : push.isSubscribed
                    ? 'On'
                    : 'Off'}
              </span>
            </button>
          )}
        </div>

        {/* Features gated until their mobile condensation pass */}
        <div class="profile__section">
          <h3 class="profile__section-title">Coming to Mobile</h3>
          {['Price Tracker', 'Analytics', 'Release Calendar', 'Collection DNA'].map((feature) => (
            <div key={feature} class="profile__item profile__item--gated" aria-disabled="true">
              <div class="profile__item-left">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="11" width="18" height="10" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>{feature}</span>
              </div>
              <span class="profile__soon-pill">after redesign</span>
            </div>
          ))}
        </div>

        {/* Account */}
        <div class="profile__section">
          <h3 class="profile__section-title">Account</h3>

          <div class="profile__item">
            <div class="profile__item-left">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span>Change Password</span>
            </div>
            <ChevronRight />
          </div>

          <div class="profile__item">
            <div class="profile__item-left">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <path d="M12 12h.01" />
                <path d="M17 12h.01" />
                <path d="M7 12h.01" />
              </svg>
              <span>Two-Factor Authentication</span>
            </div>
            <ChevronRight />
          </div>

          <button
            class="profile__item profile__item--action profile__item--danger"
            type="button"
            onClick={() => setSignOutSheetOpen(true)}
          >
            <div class="profile__item-left">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-danger)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span>Sign Out</span>
            </div>
          </button>
        </div>

        {/* App info */}
        <div class="profile__section profile__section--footer">
          <p class="profile__footer-text">Figure Collector v{APP_VERSION}</p>
          <p class="profile__footer-text">Mobile App</p>
        </div>
      </div>

      {/* Sync bottom sheet */}
      <BottomSheet open={syncSheetOpen} onClose={() => setSyncSheetOpen(false)} snapPoint="full">
        <SyncDashboard onViewCollection={handleViewCollection} />
      </BottomSheet>

      {/* Sign out confirmation sheet */}
      <BottomSheet open={signOutSheetOpen} onClose={() => setSignOutSheetOpen(false)} snapPoint="half">
        <div class="sign-out-confirm">
          <h3 class="sign-out-confirm__title">Sign Out?</h3>
          <p class="sign-out-confirm__text">
            Your cached data will be cleared and you will need to sign in again.
          </p>
          <button
            class="sign-out-confirm__btn sign-out-confirm__btn--danger"
            type="button"
            onClick={handleSignOut}
          >
            Sign Out
          </button>
          <button
            class="sign-out-confirm__btn sign-out-confirm__btn--cancel"
            type="button"
            onClick={() => setSignOutSheetOpen(false)}
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
  .profile__gear-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--touch-min);
    height: var(--touch-min);
    border-radius: var(--radius-full);
    transition: background var(--transition-fast);
  }

  .profile__gear-btn:active {
    background: var(--surface-tertiary);
  }

  .profile__content {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-4);
    padding-bottom: var(--space-12);
  }

  .profile__centered {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--space-8) var(--space-4);
    gap: var(--space-3);
  }

  /* User card */
  .profile__user-card {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4);
    background: var(--surface-secondary);
    border-radius: var(--radius-lg);
  }

  .profile__avatar {
    width: 56px;
    height: 56px;
    border-radius: var(--radius-full);
    background: var(--brand-500);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .profile__avatar--placeholder {
    background: var(--surface-secondary);
    width: 80px;
    height: 80px;
  }

  .profile__initials {
    font-size: var(--font-lg);
    font-weight: var(--font-weight-bold);
    color: white;
    line-height: 1;
  }

  .profile__user-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .profile__name {
    font-size: var(--font-lg);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    line-height: var(--line-height-tight);
  }

  .profile__subtitle {
    font-size: var(--font-sm);
    color: var(--text-secondary);
  }

  .profile__email {
    font-size: var(--font-sm);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Sections */
  .profile__section {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .profile__section-title {
    font-size: var(--font-xs);
    font-weight: var(--font-weight-semibold);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0 var(--space-2);
    margin-bottom: var(--space-2);
  }

  .profile__section--footer {
    align-items: center;
    padding-top: var(--space-4);
    gap: 2px;
  }

  .profile__footer-text {
    font-size: var(--font-xs);
    color: var(--text-tertiary);
  }

  /* List items */
  .profile__item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-2);
    border-bottom: 1px solid var(--border-subtle);
    font-size: var(--font-sm);
    color: var(--text-primary);
    min-height: var(--touch-min);
    text-align: left;
    width: 100%;
  }

  .profile__item--action {
    cursor: pointer;
    transition: background var(--transition-fast);
    border-radius: 0;
    background: transparent;
  }

  .profile__item--action:active:not(:disabled) {
    background: var(--surface-tertiary);
  }

  .profile__item--action:disabled {
    opacity: 0.6;
  }

  .profile__item--danger span {
    color: var(--accent-danger);
  }

  .profile__item-left {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .profile__item--gated {
    opacity: 0.55;
  }

  .profile__soon-pill {
    font-size: var(--font-2xs);
    color: var(--text-tertiary);
    background: var(--surface-tertiary);
    padding: 2px 8px;
    border-radius: var(--radius-full);
    white-space: nowrap;
  }

  .profile__item-value {
    color: var(--text-secondary);
    font-size: var(--font-xs);
  }

  .profile__item-right {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .profile__notif-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: var(--radius-full);
    background: var(--accent-danger);
    color: white;
    font-size: 0.625rem;
    font-weight: var(--font-weight-bold);
    line-height: 1;
  }

  /* Sign out confirmation */
  .sign-out-confirm {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4) 0;
  }

  .sign-out-confirm__title {
    font-size: var(--font-xl);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
  }

  .sign-out-confirm__text {
    font-size: var(--font-sm);
    color: var(--text-secondary);
    text-align: center;
    line-height: var(--line-height-normal);
    max-width: 280px;
  }

  .sign-out-confirm__btn {
    width: 100%;
    max-width: 280px;
    padding: var(--space-3);
    border-radius: var(--radius-lg);
    font-weight: var(--font-weight-semibold);
    font-size: var(--font-base);
    min-height: var(--touch-min);
    transition: all var(--transition-fast);
  }

  .sign-out-confirm__btn--danger {
    background: var(--accent-danger);
    color: white;
  }

  .sign-out-confirm__btn--danger:active {
    background: #dc2626;
  }

  .sign-out-confirm__btn--cancel {
    background: transparent;
    border: 1px solid var(--border-default);
    color: var(--text-secondary);
  }

  .sign-out-confirm__btn--cancel:active {
    background: var(--surface-tertiary);
  }
`;

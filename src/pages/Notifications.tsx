import { useCallback } from 'preact/hooks';
import { useLocation } from 'wouter';
import { Header } from '../components/layout/Header';
import { PullToRefresh } from '../components/ui/PullToRefresh';
import { NotificationItem } from '../components/notifications/NotificationItem';
import {
  useNotifications,
  useMarkAsRead,
  useMarkAllRead,
  useDeleteNotification,
} from '../hooks/useNotifications';
import type { Notification } from '../hooks/useNotifications';

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      class="notif-back-btn"
      type="button"
      onClick={onClick}
      aria-label="Go back"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>

      <style>{`
        .notif-back-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: var(--touch-min);
          height: var(--touch-min);
          border-radius: var(--radius-md);
          transition: background var(--transition-fast);
          margin-left: calc(var(--space-2) * -1);
        }

        .notif-back-btn:active {
          background: var(--surface-tertiary);
        }
      `}</style>
    </button>
  );
}

function MarkAllReadButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      class="notif-mark-all-btn"
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Mark all as read"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>

      <style>{`
        .notif-mark-all-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: var(--touch-min);
          height: var(--touch-min);
          color: var(--brand-400);
          border-radius: var(--radius-md);
          transition: color var(--transition-fast), background var(--transition-fast);
        }

        .notif-mark-all-btn:active:not(:disabled) {
          background: var(--surface-tertiary);
        }

        .notif-mark-all-btn:disabled {
          color: var(--text-tertiary);
          opacity: 0.5;
        }
      `}</style>
    </button>
  );
}

export function Notifications() {
  const [, setLocation] = useLocation();
  const { data, isLoading, isError, refetch } = useNotifications();
  const markAsRead = useMarkAsRead();
  const markAllRead = useMarkAllRead();
  const deleteNotification = useDeleteNotification();

  const notifications = data?.data ?? [];
  const hasUnread = notifications.some((n) => !n.read);

  const handleRefresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const handleTap = useCallback(
    (notification: Notification) => {
      if (!notification.read) {
        markAsRead.mutate(notification._id);
      }
      if (notification.url) {
        setLocation(notification.url);
      }
    },
    [markAsRead, setLocation],
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteNotification.mutate(id);
    },
    [deleteNotification],
  );

  const handleMarkAllRead = useCallback(() => {
    markAllRead.mutate();
  }, [markAllRead]);

  const headerAction = hasUnread ? (
    <MarkAllReadButton onClick={handleMarkAllRead} disabled={markAllRead.isPending} />
  ) : undefined;

  // Loading skeleton
  if (isLoading) {
    return (
      <div class="page-notifications">
        <Header
          title="Notifications"
          leading={<BackButton onClick={() => setLocation('/profile')} />}
        />
        <div class="notif-skeleton-list">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} class="notif-skeleton">
              <div class="notif-skeleton__icon" />
              <div class="notif-skeleton__content">
                <div class="notif-skeleton__title" />
                <div class="notif-skeleton__body" />
              </div>
            </div>
          ))}
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  // Error
  if (isError) {
    return (
      <div class="page-notifications">
        <Header
          title="Notifications"
          leading={<BackButton onClick={() => setLocation('/profile')} />}
        />
        <PullToRefresh onRefresh={handleRefresh}>
          <p class="notif-empty">Failed to load notifications. Pull down to retry.</p>
        </PullToRefresh>
        <style>{styles}</style>
      </div>
    );
  }

  // Empty state
  if (notifications.length === 0) {
    return (
      <div class="page-notifications">
        <Header
          title="Notifications"
          leading={<BackButton onClick={() => setLocation('/profile')} />}
        />
        <PullToRefresh onRefresh={handleRefresh}>
          <div class="notif-empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <p class="notif-empty-state__text">No notifications yet</p>
          </div>
        </PullToRefresh>
        <style>{styles}</style>
      </div>
    );
  }

  // Notifications list
  return (
    <div class="page-notifications">
      <Header
        title="Notifications"
        leading={<BackButton onClick={() => setLocation('/profile')} />}
        action={headerAction}
      />
      <PullToRefresh onRefresh={handleRefresh}>
        <div class="notif-list">
          {notifications.map((notification) => (
            <NotificationItem
              key={notification._id}
              notification={notification}
              onTap={handleTap}
              onDelete={handleDelete}
            />
          ))}
        </div>
      </PullToRefresh>
      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .notif-empty {
    text-align: center;
    color: var(--text-secondary);
    padding: var(--space-8) var(--space-4);
    font-size: var(--font-sm);
  }

  .notif-empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-12) var(--space-4);
    gap: var(--space-3);
  }

  .notif-empty-state__text {
    font-size: var(--font-sm);
    color: var(--text-tertiary);
  }

  .notif-list {
    display: flex;
    flex-direction: column;
  }

  /* Skeleton loading */
  .notif-skeleton-list {
    display: flex;
    flex-direction: column;
  }

  .notif-skeleton {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
  }

  .notif-skeleton__icon {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-full);
    background: var(--surface-tertiary);
    flex-shrink: 0;
    animation: notif-skeleton-pulse 1.5s ease-in-out infinite;
  }

  .notif-skeleton__content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: 4px;
  }

  .notif-skeleton__title {
    height: 14px;
    width: 60%;
    background: var(--surface-tertiary);
    border-radius: var(--radius-sm);
    animation: notif-skeleton-pulse 1.5s ease-in-out infinite;
  }

  .notif-skeleton__body {
    height: 12px;
    width: 85%;
    background: var(--surface-tertiary);
    border-radius: var(--radius-sm);
    animation: notif-skeleton-pulse 1.5s ease-in-out infinite;
    animation-delay: 0.15s;
  }

  @keyframes notif-skeleton-pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 0.8; }
  }
`;

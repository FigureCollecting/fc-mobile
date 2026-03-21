import { useCallback } from 'preact/hooks';
import { SwipeAction } from '../ui/SwipeAction';
import { relativeTime } from '../../utils/time';
import type { Notification } from '../../hooks/useNotifications';

interface NotificationItemProps {
  notification: Notification;
  onTap: (notification: Notification) => void;
  onDelete: (id: string) => void;
}

function NotificationIcon({ type }: { type: Notification['type'] }) {
  switch (type) {
    case 'price_alert':
      return (
        <div class="notif-item__icon notif-item__icon--price">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </div>
      );
    case 'sync_complete':
      return (
        <div class="notif-item__icon notif-item__icon--success">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      );
    case 'sync_error':
      return (
        <div class="notif-item__icon notif-item__icon--error">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </div>
      );
    case 'collection_update':
      return (
        <div class="notif-item__icon notif-item__icon--collection">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          </svg>
        </div>
      );
    default:
      return (
        <div class="notif-item__icon notif-item__icon--default">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
      );
  }
}

function DeleteAction() {
  return (
    <div class="notif-item__delete-action">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h18" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
      <span>Delete</span>

      <style>{`
        .notif-item__delete-action {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          color: white;
          font-size: var(--font-xs);
          font-weight: var(--font-weight-semibold);
        }
      `}</style>
    </div>
  );
}

export function NotificationItem({ notification, onTap, onDelete }: NotificationItemProps) {
  const handleTap = useCallback(() => {
    onTap(notification);
  }, [notification, onTap]);

  const handleDelete = useCallback(() => {
    onDelete(notification._id);
  }, [notification._id, onDelete]);

  return (
    <SwipeAction onSwipeLeft={handleDelete} rightContent={<DeleteAction />}>
      <button
        class={`notif-item ${notification.read ? '' : 'notif-item--unread'}`}
        type="button"
        onClick={handleTap}
      >
        <NotificationIcon type={notification.type} />

        <div class="notif-item__content">
          <div class="notif-item__header">
            <span class={`notif-item__title ${notification.read ? '' : 'notif-item__title--unread'}`}>
              {notification.title}
            </span>
            <span class="notif-item__time">{relativeTime(notification.createdAt)}</span>
          </div>
          <p class="notif-item__body">{notification.body}</p>
        </div>

        {!notification.read && <span class="notif-item__dot" />}
      </button>

      <style>{`
        .notif-item {
          display: flex;
          align-items: flex-start;
          gap: var(--space-3);
          padding: var(--space-3) var(--space-4);
          width: 100%;
          text-align: left;
          min-height: var(--touch-recommended);
          transition: background var(--transition-fast);
          border-bottom: 1px solid var(--border-subtle);
          position: relative;
        }

        .notif-item--unread {
          background: rgba(99, 102, 241, 0.06);
        }

        .notif-item:active {
          background: var(--surface-tertiary);
        }

        .notif-item__icon {
          width: 36px;
          height: 36px;
          border-radius: var(--radius-full);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          margin-top: 2px;
        }

        .notif-item__icon--price {
          background: rgba(245, 158, 11, 0.15);
          color: var(--accent-warning);
        }

        .notif-item__icon--success {
          background: rgba(34, 197, 94, 0.15);
          color: var(--accent-success);
        }

        .notif-item__icon--error {
          background: rgba(239, 68, 68, 0.15);
          color: var(--accent-danger);
        }

        .notif-item__icon--collection {
          background: rgba(59, 130, 246, 0.15);
          color: var(--accent-info);
        }

        .notif-item__icon--default {
          background: var(--surface-tertiary);
          color: var(--text-secondary);
        }

        .notif-item__content {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .notif-item__header {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: var(--space-2);
        }

        .notif-item__title {
          font-size: var(--font-sm);
          color: var(--text-primary);
          line-height: var(--line-height-tight);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .notif-item__title--unread {
          font-weight: var(--font-weight-bold);
        }

        .notif-item__time {
          font-size: var(--font-xs);
          color: var(--text-tertiary);
          white-space: nowrap;
          flex-shrink: 0;
        }

        .notif-item__body {
          font-size: var(--font-xs);
          color: var(--text-secondary);
          line-height: var(--line-height-normal);
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .notif-item__dot {
          position: absolute;
          top: 50%;
          right: var(--space-3);
          transform: translateY(-50%);
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--brand-500);
          flex-shrink: 0;
        }
      `}</style>
    </SwipeAction>
  );
}

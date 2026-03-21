import { useCallback } from 'preact/hooks';
import { BottomSheet } from '../ui/BottomSheet';
import type { CollectionStatus } from '@figurecollecting/fc-shared';
import { hapticMedium } from '../../utils/haptics';

interface StatusSheetProps {
  open: boolean;
  onClose: () => void;
  currentStatus?: CollectionStatus;
  onSelect: (status: CollectionStatus) => void;
  isUpdating?: boolean;
  /** Label shown in header, e.g. "Change Status" or "Set Status (3 figures)" */
  title?: string;
}

const STATUS_OPTIONS: { value: CollectionStatus; label: string; icon: string; cssClass: string }[] = [
  {
    value: 'owned',
    label: 'Owned',
    cssClass: 'status-sheet__btn--owned',
    icon: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" />',
  },
  {
    value: 'ordered',
    label: 'Ordered',
    cssClass: 'status-sheet__btn--ordered',
    icon: '<circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />',
  },
  {
    value: 'wished',
    label: 'Wished',
    cssClass: 'status-sheet__btn--wished',
    icon: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />',
  },
];

export function StatusSheet({ open, onClose, currentStatus, onSelect, isUpdating, title }: StatusSheetProps) {
  const handleSelect = useCallback(
    (status: CollectionStatus) => {
      if (isUpdating) return;
      hapticMedium();
      onSelect(status);
    },
    [onSelect, isUpdating],
  );

  return (
    <BottomSheet open={open} onClose={onClose} snapPoint="half">
      <div class="status-sheet">
        <h2 class="status-sheet__title">{title ?? 'Change Status'}</h2>

        <div class="status-sheet__options">
          {STATUS_OPTIONS.map((opt) => {
            const isCurrent = currentStatus === opt.value;
            return (
              <button
                key={opt.value}
                class={`status-sheet__btn ${opt.cssClass} ${isCurrent ? 'status-sheet__btn--current' : ''}`}
                onClick={() => handleSelect(opt.value)}
                type="button"
                disabled={isUpdating}
                aria-pressed={isCurrent}
              >
                <svg
                  class="status-sheet__icon"
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  dangerouslySetInnerHTML={{ __html: opt.icon }}
                />
                <span class="status-sheet__label">{opt.label}</span>
                {isCurrent && <span class="status-sheet__current-tag">Current</span>}
              </button>
            );
          })}
        </div>

        {isUpdating && (
          <p class="status-sheet__updating">Updating...</p>
        )}
      </div>

      <style>{`
        .status-sheet {
          padding-bottom: var(--space-4);
        }

        .status-sheet__title {
          font-size: var(--font-lg);
          font-weight: var(--font-weight-bold);
          color: var(--text-primary);
          margin-bottom: var(--space-5);
        }

        .status-sheet__options {
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .status-sheet__btn {
          display: flex;
          align-items: center;
          gap: var(--space-4);
          min-height: 64px;
          padding: var(--space-4);
          background: var(--surface-tertiary);
          border-radius: var(--radius-lg);
          border: 2px solid transparent;
          color: var(--text-primary);
          font-size: var(--font-base);
          font-weight: var(--font-weight-semibold);
          transition: all var(--transition-fast);
        }

        .status-sheet__btn:active:not(:disabled) {
          transform: scale(0.98);
        }

        .status-sheet__btn:disabled {
          opacity: 0.5;
        }

        /* Owned — green */
        .status-sheet__btn--owned {
          color: var(--accent-success);
        }

        .status-sheet__btn--owned.status-sheet__btn--current {
          background: rgba(34, 197, 94, 0.15);
          border-color: var(--accent-success);
        }

        /* Ordered — amber */
        .status-sheet__btn--ordered {
          color: var(--accent-warning);
        }

        .status-sheet__btn--ordered.status-sheet__btn--current {
          background: rgba(245, 158, 11, 0.15);
          border-color: var(--accent-warning);
        }

        /* Wished — blue */
        .status-sheet__btn--wished {
          color: var(--accent-info);
        }

        .status-sheet__btn--wished.status-sheet__btn--current {
          background: rgba(59, 130, 246, 0.15);
          border-color: var(--accent-info);
        }

        .status-sheet__icon {
          flex-shrink: 0;
        }

        .status-sheet__label {
          flex: 1;
          text-align: left;
        }

        .status-sheet__current-tag {
          font-size: var(--font-xs);
          font-weight: var(--font-weight-medium);
          opacity: 0.7;
        }

        .status-sheet__updating {
          text-align: center;
          color: var(--text-tertiary);
          font-size: var(--font-sm);
          margin-top: var(--space-4);
        }
      `}</style>
    </BottomSheet>
  );
}

import { useCallback } from 'preact/hooks';
import { BottomSheet } from '../ui/BottomSheet';
import { hapticHeavy } from '../../utils/haptics';

interface DeleteSheetProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isDeleting?: boolean;
  /** Figure name (single delete) */
  figureName?: string;
  /** Figure thumbnail URL (single delete) */
  imageUrl?: string;
  /** Number of figures selected (bulk delete) */
  count?: number;
}

export function DeleteSheet({ open, onClose, onConfirm, isDeleting, figureName, imageUrl, count }: DeleteSheetProps) {
  const isBulk = count != null && count > 1;

  const handleConfirm = useCallback(() => {
    if (isDeleting) return;
    hapticHeavy();
    onConfirm();
  }, [onConfirm, isDeleting]);

  return (
    <BottomSheet open={open} onClose={onClose} snapPoint="half">
      <div class="delete-sheet">
        <div class="delete-sheet__icon-wrapper">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--accent-danger)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </div>

        <h2 class="delete-sheet__title">
          {isBulk ? `Delete ${count} figures?` : 'Delete this figure?'}
        </h2>

        {!isBulk && figureName && (
          <div class="delete-sheet__figure-info">
            {imageUrl && (
              <img class="delete-sheet__thumb" src={imageUrl} alt="" />
            )}
            <p class="delete-sheet__name">{figureName}</p>
          </div>
        )}

        <p class="delete-sheet__warning">
          {isBulk
            ? `This will permanently remove ${count} figures from your collection. This action cannot be undone.`
            : 'This will permanently remove this figure from your collection. This action cannot be undone.'}
        </p>

        <div class="delete-sheet__actions">
          <button
            class="delete-sheet__btn delete-sheet__btn--cancel"
            onClick={onClose}
            type="button"
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            class="delete-sheet__btn delete-sheet__btn--delete"
            onClick={handleConfirm}
            type="button"
            disabled={isDeleting}
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>

      <style>{`
        .delete-sheet {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          padding: var(--space-4) 0;
        }

        .delete-sheet__icon-wrapper {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 72px;
          height: 72px;
          border-radius: var(--radius-full);
          background: rgba(239, 68, 68, 0.1);
          margin-bottom: var(--space-4);
        }

        .delete-sheet__title {
          font-size: var(--font-lg);
          font-weight: var(--font-weight-bold);
          color: var(--text-primary);
          margin-bottom: var(--space-4);
        }

        .delete-sheet__figure-info {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-3);
          background: var(--surface-tertiary);
          border-radius: var(--radius-md);
          margin-bottom: var(--space-4);
          max-width: 100%;
        }

        .delete-sheet__thumb {
          width: 48px;
          height: 48px;
          border-radius: var(--radius-sm);
          object-fit: cover;
          flex-shrink: 0;
          background: var(--surface-secondary);
        }

        .delete-sheet__name {
          font-size: var(--font-sm);
          font-weight: var(--font-weight-medium);
          color: var(--text-primary);
          text-align: left;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .delete-sheet__warning {
          font-size: var(--font-sm);
          color: var(--text-secondary);
          line-height: var(--line-height-normal);
          margin-bottom: var(--space-6);
          padding: 0 var(--space-2);
        }

        .delete-sheet__actions {
          display: flex;
          gap: var(--space-3);
          width: 100%;
        }

        .delete-sheet__btn {
          flex: 1;
          min-height: var(--touch-min);
          border-radius: var(--radius-md);
          font-size: var(--font-sm);
          font-weight: var(--font-weight-semibold);
          transition: all var(--transition-fast);
        }

        .delete-sheet__btn:disabled {
          opacity: 0.5;
        }

        .delete-sheet__btn--cancel {
          background: var(--surface-tertiary);
          color: var(--text-secondary);
        }

        .delete-sheet__btn--cancel:active:not(:disabled) {
          background: var(--surface-elevated);
        }

        .delete-sheet__btn--delete {
          background: var(--accent-danger);
          color: white;
        }

        .delete-sheet__btn--delete:active:not(:disabled) {
          opacity: 0.85;
        }
      `}</style>
    </BottomSheet>
  );
}

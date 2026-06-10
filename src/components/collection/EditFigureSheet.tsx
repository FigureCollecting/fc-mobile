import { useState, useCallback, useEffect } from 'preact/hooks';
import { BottomSheet } from '../ui/BottomSheet';
import type { Figure, CollectionStatus } from '@figurecollecting/fc-shared';
import { hapticLight } from '../../utils/haptics';

interface EditFigureSheetProps {
  open: boolean;
  onClose: () => void;
  figure: Figure;
  onSave: (data: EditFormData) => void;
  isSaving?: boolean;
}

export interface EditFormData {
  collectionStatus?: CollectionStatus;
  note?: string;
  purchasePrice?: number;
  purchaseCurrency?: string;
  purchaseDate?: string;
}

const STATUS_OPTIONS: { value: CollectionStatus; label: string; cssClass: string }[] = [
  { value: 'owned', label: 'Owned', cssClass: 'edit-sheet__status-btn--owned' },
  { value: 'ordered', label: 'Ordered', cssClass: 'edit-sheet__status-btn--ordered' },
  { value: 'wished', label: 'Wished', cssClass: 'edit-sheet__status-btn--wished' },
];

const CURRENCY_OPTIONS = ['JPY', 'USD', 'EUR', 'GBP', 'CAD', 'AUD'];

export function EditFigureSheet({ open, onClose, figure, onSave, isSaving }: EditFigureSheetProps) {
  const [status, setStatus] = useState<CollectionStatus | undefined>(figure.collectionStatus);
  const [note, setNote] = useState(figure.note ?? '');
  const [price, setPrice] = useState(figure.purchaseInfo?.price?.toString() ?? '');
  const [currency, setCurrency] = useState(figure.purchaseInfo?.currency ?? 'JPY');
  const [purchaseDate, setPurchaseDate] = useState(figure.purchaseInfo?.date?.split('T')[0] ?? '');

  // Reset form when figure changes
  useEffect(() => {
    setStatus(figure.collectionStatus);
    setNote(figure.note ?? '');
    setPrice(figure.purchaseInfo?.price?.toString() ?? '');
    setCurrency(figure.purchaseInfo?.currency ?? 'JPY');
    setPurchaseDate(figure.purchaseInfo?.date?.split('T')[0] ?? '');
  }, [figure._id]);

  const handleStatusToggle = useCallback((value: CollectionStatus) => {
    hapticLight();
    setStatus(value);
  }, []);

  const handleSave = useCallback(() => {
    hapticLight();
    const data: EditFormData = {};

    if (status !== figure.collectionStatus) data.collectionStatus = status;
    if (note !== (figure.note ?? '')) data.note = note;

    const priceNum = price ? parseFloat(price) : undefined;
    if (priceNum !== figure.purchaseInfo?.price) data.purchasePrice = priceNum;
    if (currency !== (figure.purchaseInfo?.currency ?? 'JPY')) data.purchaseCurrency = currency;
    if (purchaseDate !== (figure.purchaseInfo?.date?.split('T')[0] ?? '')) data.purchaseDate = purchaseDate || undefined;

    onSave(data);
  }, [status, note, price, currency, purchaseDate, figure, onSave]);

  return (
    <BottomSheet open={open} onClose={onClose} snapPoint="half">
      <div class="edit-sheet">
        <div class="edit-sheet__header">
          <h2 class="edit-sheet__title">Edit Figure</h2>
          <p class="edit-sheet__subtitle">{figure.name}</p>
        </div>

        {/* Collection Status */}
        <section class="edit-sheet__section">
          <label class="edit-sheet__label">Collection Status</label>
          <div class="edit-sheet__status-row">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                class={`edit-sheet__status-btn ${opt.cssClass} ${status === opt.value ? 'edit-sheet__status-btn--active' : ''}`}
                onClick={() => handleStatusToggle(opt.value)}
                type="button"
                aria-pressed={status === opt.value}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        {/* Notes */}
        <section class="edit-sheet__section">
          <label class="edit-sheet__label" for="edit-note">Notes</label>
          <textarea
            id="edit-note"
            class="edit-sheet__textarea"
            value={note}
            onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
            placeholder="Add a note..."
            rows={3}
          />
        </section>

        {/* Purchase Price + Currency */}
        <section class="edit-sheet__section">
          <label class="edit-sheet__label" for="edit-price">Purchase Price</label>
          <div class="edit-sheet__price-row">
            <select
              class="edit-sheet__currency-select"
              value={currency}
              onChange={(e) => setCurrency((e.target as HTMLSelectElement).value)}
              aria-label="Currency"
            >
              {CURRENCY_OPTIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <input
              id="edit-price"
              class="edit-sheet__input"
              type="number"
              inputMode="decimal"
              value={price}
              onInput={(e) => setPrice((e.target as HTMLInputElement).value)}
              placeholder="0"
              min="0"
              step="0.01"
            />
          </div>
        </section>

        {/* Purchase Date */}
        <section class="edit-sheet__section">
          <label class="edit-sheet__label" for="edit-date">Purchase Date</label>
          <input
            id="edit-date"
            class="edit-sheet__input"
            type="date"
            value={purchaseDate}
            onInput={(e) => setPurchaseDate((e.target as HTMLInputElement).value)}
          />
        </section>

        {/* Actions */}
        <div class="edit-sheet__actions">
          <button
            class="edit-sheet__btn edit-sheet__btn--cancel"
            onClick={onClose}
            type="button"
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            class="edit-sheet__btn edit-sheet__btn--save"
            onClick={handleSave}
            type="button"
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <style>{`
        .edit-sheet {
          padding-bottom: var(--space-4);
        }

        .edit-sheet__header {
          margin-bottom: var(--space-5);
        }

        .edit-sheet__title {
          font-size: var(--font-lg);
          font-weight: var(--font-weight-bold);
          color: var(--text-primary);
        }

        .edit-sheet__subtitle {
          font-size: var(--font-sm);
          color: var(--text-secondary);
          margin-top: var(--space-1);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .edit-sheet__section {
          margin-bottom: var(--space-5);
        }

        .edit-sheet__label {
          display: block;
          font-size: var(--font-xs);
          font-weight: var(--font-weight-semibold);
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: var(--space-2);
        }

        /* Status toggle row */
        .edit-sheet__status-row {
          display: flex;
          gap: var(--space-2);
        }

        .edit-sheet__status-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: var(--touch-min);
          border-radius: var(--radius-md);
          font-size: var(--font-sm);
          font-weight: var(--font-weight-semibold);
          color: var(--text-secondary);
          background: var(--surface-tertiary);
          border: 2px solid transparent;
          transition: all var(--transition-fast);
        }

        .edit-sheet__status-btn--owned.edit-sheet__status-btn--active {
          background: rgba(34, 197, 94, 0.15);
          border-color: var(--accent-success);
          color: var(--accent-success);
        }

        .edit-sheet__status-btn--ordered.edit-sheet__status-btn--active {
          background: rgba(245, 158, 11, 0.15);
          border-color: var(--accent-warning);
          color: var(--accent-warning);
        }

        .edit-sheet__status-btn--wished.edit-sheet__status-btn--active {
          background: rgba(59, 130, 246, 0.15);
          border-color: var(--accent-info);
          color: var(--accent-info);
        }

        /* Textarea */
        .edit-sheet__textarea {
          width: 100%;
          min-height: 80px;
          padding: var(--space-3);
          background: var(--surface-tertiary);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          font-size: var(--font-sm);
          font-family: inherit;
          resize: vertical;
          line-height: var(--line-height-normal);
        }

        .edit-sheet__textarea:focus {
          outline: none;
          border-color: var(--brand-500);
        }

        .edit-sheet__textarea::placeholder {
          color: var(--text-tertiary);
        }

        /* Price row */
        .edit-sheet__price-row {
          display: flex;
          gap: var(--space-2);
        }

        .edit-sheet__currency-select {
          width: 80px;
          min-height: var(--touch-min);
          padding: var(--space-2) var(--space-3);
          background: var(--surface-tertiary);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          font-size: var(--font-sm);
          appearance: none;
          -webkit-appearance: none;
        }

        .edit-sheet__currency-select:focus {
          outline: none;
          border-color: var(--brand-500);
        }

        /* Input */
        .edit-sheet__input {
          flex: 1;
          min-height: var(--touch-min);
          padding: var(--space-2) var(--space-3);
          background: var(--surface-tertiary);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          font-size: var(--font-sm);
          font-family: inherit;
        }

        .edit-sheet__input:focus {
          outline: none;
          border-color: var(--brand-500);
        }

        .edit-sheet__input::placeholder {
          color: var(--text-tertiary);
        }

        /* Actions */
        .edit-sheet__actions {
          display: flex;
          gap: var(--space-3);
          margin-top: var(--space-6);
        }

        .edit-sheet__btn {
          flex: 1;
          min-height: var(--touch-min);
          border-radius: var(--radius-md);
          font-size: var(--font-sm);
          font-weight: var(--font-weight-semibold);
          transition: all var(--transition-fast);
        }

        .edit-sheet__btn:disabled {
          opacity: 0.5;
        }

        .edit-sheet__btn--cancel {
          background: var(--surface-tertiary);
          color: var(--text-secondary);
        }

        .edit-sheet__btn--cancel:active:not(:disabled) {
          background: var(--surface-elevated);
        }

        .edit-sheet__btn--save {
          background: var(--brand-500);
          color: white;
        }

        .edit-sheet__btn--save:active:not(:disabled) {
          background: var(--brand-600);
        }
      `}</style>
    </BottomSheet>
  );
}

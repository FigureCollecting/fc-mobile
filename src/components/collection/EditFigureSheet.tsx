import { useState, useCallback, useEffect } from 'preact/hooks';
import { BottomSheet } from '../ui/BottomSheet';
import type { CollectionStatus } from '@figurecollecting/fc-shared';
import type { FigureEdit } from '../../hooks/useFigureMutations';
import type { LocalFigure } from '../../local/figures';
import { hapticLight } from '../../utils/haptics';
import { Style } from '../../styles/Style';

interface EditFigureSheetProps {
  open: boolean;
  onClose: () => void;
  figure: LocalFigure;
  onSave: (data: FigureEdit) => void;
  isSaving?: boolean;
}

const STATUS_OPTIONS: { value: CollectionStatus; label: string; cssClass: string }[] = [
  { value: 'owned', label: 'Owned', cssClass: 'edit-sheet__status-btn--owned' },
  { value: 'ordered', label: 'Ordered', cssClass: 'edit-sheet__status-btn--ordered' },
  { value: 'wished', label: 'Wished', cssClass: 'edit-sheet__status-btn--wished' },
];

const SCORES = Array.from({ length: 10 }, (_, i) => i + 1);

/** Status, count, score and note: each a local write (WK-15); nothing here needs the network. */
export function EditFigureSheet({ open, onClose, figure, onSave, isSaving }: EditFigureSheetProps) {
  const [status, setStatus] = useState<CollectionStatus | undefined>(figure.collectionStatus);
  const [count, setCount] = useState(String(figure.quantity ?? 1));
  const [score, setScore] = useState(figure.rating === undefined ? '' : String(figure.rating));
  const [note, setNote] = useState(figure.note ?? '');

  // Reset the form when the figure changes.
  useEffect(() => {
    setStatus(figure.collectionStatus);
    setCount(String(figure.quantity ?? 1));
    setScore(figure.rating === undefined ? '' : String(figure.rating));
    setNote(figure.note ?? '');
  }, [figure._id]);

  const countValue = Number(count);
  const countValid = Number.isInteger(countValue) && countValue >= 1;

  const handleSave = useCallback(() => {
    hapticLight();
    const data: FigureEdit = {};
    if (status !== undefined && status !== figure.collectionStatus) data.collectionStatus = status;
    if (countValid && countValue !== (figure.quantity ?? 1)) data.quantity = countValue;
    const nextScore = score === '' ? undefined : Number(score);
    if (nextScore !== figure.rating) data.rating = nextScore ?? null;
    if (note !== (figure.note ?? '')) data.note = note;
    onSave(data);
  }, [status, countValid, countValue, score, note, figure, onSave]);

  return (
    <BottomSheet open={open} onClose={onClose} snapPoint="half">
      <form
        class="edit-sheet"
        aria-label="Edit figure"
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
      >
        <div class="edit-sheet__header">
          <h2 class="edit-sheet__title">Edit Figure</h2>
          <p class="edit-sheet__subtitle">{figure.name}</p>
        </div>

        {figure.collectionStatus !== undefined && (
          <section class="edit-sheet__section">
            <span class="edit-sheet__label">Collection Status</span>
            <div class="edit-sheet__status-row">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  class={`edit-sheet__status-btn ${opt.cssClass} ${status === opt.value ? 'edit-sheet__status-btn--active' : ''}`}
                  onClick={() => {
                    hapticLight();
                    setStatus(opt.value);
                  }}
                  type="button"
                  aria-pressed={status === opt.value}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>
        )}

        <section class="edit-sheet__section edit-sheet__row">
          <div class="edit-sheet__field">
            <label class="edit-sheet__label" for="edit-count">Copies</label>
            <input
              id="edit-count"
              class="edit-sheet__input"
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={count}
              aria-invalid={!countValid}
              onInput={(e) => setCount((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="edit-sheet__field">
            <label class="edit-sheet__label" for="edit-score">Score</label>
            <select id="edit-score" class="edit-sheet__input" value={score} onChange={(e) => setScore((e.target as HTMLSelectElement).value)}>
              <option value="">None</option>
              {SCORES.map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section class="edit-sheet__section">
          <div class="edit-sheet__field">
            <label class="edit-sheet__label" for="edit-note">Notes</label>
            <textarea
              id="edit-note"
              class="edit-sheet__textarea"
              value={note}
              onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
              placeholder="Add a note..."
              rows={3}
              maxLength={10000}
            />
          </div>
        </section>

        <div class="edit-sheet__actions">
          <button class="edit-sheet__btn edit-sheet__btn--cancel" onClick={onClose} type="button" disabled={isSaving}>
            Cancel
          </button>
          <button class="edit-sheet__btn edit-sheet__btn--save" type="submit" disabled={isSaving || !countValid}>
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>

      <Style css={`
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
        .edit-sheet__row {
          display: flex;
          gap: var(--space-3);
        }
        .edit-sheet__field {
          display: flex;
          flex-direction: column;
          flex: 1;
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
        .edit-sheet__status-row {
          display: flex;
          gap: var(--space-2);
        }
        .edit-sheet__status-btn {
          flex: 1;
          min-height: var(--touch-min);
          border-radius: var(--radius-md);
          border: 1.5px solid var(--border-default);
          background: var(--surface-secondary);
          color: var(--text-secondary);
          font-weight: var(--font-weight-semibold);
        }
        .edit-sheet__status-btn--active {
          border-color: var(--brand-500);
          background: var(--brand-500);
          color: #fff;
        }
        .edit-sheet__input,
        .edit-sheet__textarea {
          width: 100%;
          min-height: var(--touch-min);
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-md);
          border: 1px solid var(--border-default);
          background: var(--surface-secondary);
          color: var(--text-primary);
          font-size: var(--font-base);
        }
        .edit-sheet__actions {
          display: flex;
          gap: var(--space-3);
        }
        .edit-sheet__btn {
          flex: 1;
          min-height: var(--touch-min);
          border-radius: var(--radius-md);
          font-weight: var(--font-weight-semibold);
        }
        .edit-sheet__btn--cancel {
          background: var(--surface-tertiary);
          color: var(--text-primary);
        }
        .edit-sheet__btn--save {
          background: var(--brand-500);
          color: #fff;
        }
        .edit-sheet__btn:disabled {
          opacity: 0.5;
        }
      `} />
    </BottomSheet>
  );
}

import { useState, useCallback, useEffect } from 'preact/hooks';
import { BottomSheet } from '../ui/BottomSheet';
import type { AlertType, PriceAlert } from '../../hooks/usePrices';

interface AlertSheetProps {
  open: boolean;
  onClose: () => void;
  figureId: string;
  figureName: string;
  existingAlert?: PriceAlert;
  availableSites: string[];
  onSave: (alert: {
    _id?: string;
    figureId: string;
    figureName: string;
    type: AlertType;
    targetPrice?: number;
    currency?: string;
    sites: string[];
    pushEnabled: boolean;
  }) => void;
  onDelete?: (alertId: string) => void;
}

const ALERT_TYPES: { value: AlertType; label: string; description: string }[] = [
  { value: 'price_below', label: 'Price drops below', description: 'Get notified when price falls under your target' },
  { value: 'back_in_stock', label: 'Back in stock', description: 'Get notified when item becomes available' },
  { value: 'any_change', label: 'Any price change', description: 'Get notified on any price update' },
];

const CURRENCY_OPTIONS = ['JPY', 'USD', 'EUR', 'GBP'];

export function AlertSheet({
  open,
  onClose,
  figureId,
  figureName,
  existingAlert,
  availableSites,
  onSave,
  onDelete,
}: AlertSheetProps) {
  const [alertType, setAlertType] = useState<AlertType>(existingAlert?.type ?? 'price_below');
  const [targetPrice, setTargetPrice] = useState<string>(
    existingAlert?.targetPrice != null ? String(existingAlert.targetPrice) : '',
  );
  const [currency, setCurrency] = useState(existingAlert?.currency ?? 'JPY');
  const [selectedSites, setSelectedSites] = useState<string[]>(existingAlert?.sites ?? [...availableSites]);
  const [pushEnabled, setPushEnabled] = useState(existingAlert?.pushEnabled ?? true);

  // Reset state when sheet opens with different alert
  useEffect(() => {
    if (open) {
      setAlertType(existingAlert?.type ?? 'price_below');
      setTargetPrice(existingAlert?.targetPrice != null ? String(existingAlert.targetPrice) : '');
      setCurrency(existingAlert?.currency ?? 'JPY');
      setSelectedSites(existingAlert?.sites ?? [...availableSites]);
      setPushEnabled(existingAlert?.pushEnabled ?? true);
    }
  }, [open, existingAlert, availableSites]);

  const toggleSite = useCallback((site: string) => {
    setSelectedSites((prev) => {
      if (prev.includes(site)) {
        // Don't allow deselecting all sites
        if (prev.length <= 1) return prev;
        return prev.filter((s) => s !== site);
      }
      return [...prev, site];
    });
  }, []);

  const handleSave = useCallback(() => {
    const parsedPrice = parseFloat(targetPrice);
    onSave({
      _id: existingAlert?._id,
      figureId,
      figureName,
      type: alertType,
      targetPrice: alertType === 'price_below' && !isNaN(parsedPrice) ? parsedPrice : undefined,
      currency: alertType === 'price_below' ? currency : undefined,
      sites: selectedSites,
      pushEnabled,
    });
    onClose();
  }, [alertType, targetPrice, currency, selectedSites, pushEnabled, figureId, figureName, existingAlert, onSave, onClose]);

  const handleDelete = useCallback(() => {
    if (existingAlert?._id && onDelete) {
      onDelete(existingAlert._id);
      onClose();
    }
  }, [existingAlert, onDelete, onClose]);

  const isValid = alertType !== 'price_below' || (targetPrice !== '' && !isNaN(parseFloat(targetPrice)));

  return (
    <BottomSheet open={open} onClose={onClose} snapPoint="half">
      <div class="alert-sheet">
        <div class="alert-sheet__header">
          <h2 class="alert-sheet__title">{existingAlert ? 'Edit Alert' : 'New Alert'}</h2>
          <p class="alert-sheet__subtitle">{figureName}</p>
        </div>

        {/* Alert Type */}
        <section class="alert-sheet__section">
          <h3 class="alert-sheet__section-title">Alert Type</h3>
          <div class="alert-sheet__type-list">
            {ALERT_TYPES.map((opt) => (
              <button
                key={opt.value}
                class={`alert-sheet__type-btn ${alertType === opt.value ? 'alert-sheet__type-btn--active' : ''}`}
                onClick={() => setAlertType(opt.value)}
                type="button"
              >
                <span class="alert-sheet__type-label">{opt.label}</span>
                <span class="alert-sheet__type-desc">{opt.description}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Target Price (only for price_below) */}
        {alertType === 'price_below' && (
          <section class="alert-sheet__section">
            <h3 class="alert-sheet__section-title">Target Price</h3>
            <div class="alert-sheet__price-input">
              <select
                class="alert-sheet__currency-select"
                value={currency}
                onChange={(e) => setCurrency((e.target as HTMLSelectElement).value)}
              >
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <input
                class="alert-sheet__price-field"
                type="number"
                inputMode="decimal"
                placeholder="0.00"
                value={targetPrice}
                onInput={(e) => setTargetPrice((e.target as HTMLInputElement).value)}
              />
            </div>
          </section>
        )}

        {/* Sites */}
        {availableSites.length > 0 && (
          <section class="alert-sheet__section">
            <h3 class="alert-sheet__section-title">Monitor Sites</h3>
            <div class="alert-sheet__sites">
              {availableSites.map((site) => {
                const checked = selectedSites.includes(site);
                return (
                  <button
                    key={site}
                    class={`alert-sheet__site-btn ${checked ? 'alert-sheet__site-btn--checked' : ''}`}
                    onClick={() => toggleSite(site)}
                    type="button"
                    aria-pressed={checked}
                  >
                    <span class="alert-sheet__check-icon">
                      {checked ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--brand-500)" stroke="none">
                          <rect x="2" y="2" width="20" height="20" rx="4" />
                          <path d="M9 12l2 2 4-4" stroke="white" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2">
                          <rect x="2" y="2" width="20" height="20" rx="4" />
                        </svg>
                      )}
                    </span>
                    <span>{site}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Push Notification Toggle */}
        <section class="alert-sheet__section">
          <button
            class="alert-sheet__toggle-row"
            onClick={() => setPushEnabled(!pushEnabled)}
            type="button"
            aria-pressed={pushEnabled}
          >
            <div class="alert-sheet__toggle-info">
              <span class="alert-sheet__toggle-label">Push Notifications</span>
              <span class="alert-sheet__toggle-desc">Receive alerts on your device</span>
            </div>
            <div class={`alert-sheet__toggle ${pushEnabled ? 'alert-sheet__toggle--on' : ''}`}>
              <div class="alert-sheet__toggle-knob" />
            </div>
          </button>
        </section>

        {/* Actions */}
        <div class="alert-sheet__actions">
          {existingAlert && onDelete && (
            <button
              class="alert-sheet__btn alert-sheet__btn--delete"
              onClick={handleDelete}
              type="button"
            >
              Delete
            </button>
          )}
          <button
            class="alert-sheet__btn alert-sheet__btn--save"
            onClick={handleSave}
            type="button"
            disabled={!isValid}
          >
            {existingAlert ? 'Update Alert' : 'Create Alert'}
          </button>
        </div>
      </div>

      <style>{`
        .alert-sheet {
          padding-bottom: var(--space-4);
        }

        .alert-sheet__header {
          margin-bottom: var(--space-5);
        }

        .alert-sheet__title {
          font-size: var(--font-lg);
          font-weight: var(--font-weight-bold);
          color: var(--text-primary);
        }

        .alert-sheet__subtitle {
          font-size: var(--font-sm);
          color: var(--text-secondary);
          margin-top: var(--space-1);
        }

        .alert-sheet__section {
          margin-bottom: var(--space-5);
        }

        .alert-sheet__section-title {
          font-size: var(--font-xs);
          font-weight: var(--font-weight-semibold);
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: var(--space-3);
        }

        /* Alert type buttons */
        .alert-sheet__type-list {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .alert-sheet__type-btn {
          display: flex;
          flex-direction: column;
          gap: 2px;
          text-align: left;
          min-height: var(--touch-min);
          padding: var(--space-3) var(--space-4);
          background: var(--surface-tertiary);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          transition: all var(--transition-fast);
        }

        .alert-sheet__type-btn--active {
          background: rgba(9, 103, 210, 0.12);
          border-color: var(--brand-500);
        }

        .alert-sheet__type-label {
          font-size: var(--font-sm);
          font-weight: var(--font-weight-semibold);
          color: var(--text-primary);
        }

        .alert-sheet__type-desc {
          font-size: var(--font-xs);
          color: var(--text-tertiary);
        }

        /* Price input */
        .alert-sheet__price-input {
          display: flex;
          gap: var(--space-2);
          align-items: center;
        }

        .alert-sheet__currency-select {
          min-height: var(--touch-min);
          padding: var(--space-2) var(--space-3);
          background: var(--surface-tertiary);
          color: var(--text-primary);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          font-size: var(--font-sm);
          font-weight: var(--font-weight-medium);
          appearance: none;
          -webkit-appearance: none;
          min-width: 72px;
          text-align: center;
        }

        .alert-sheet__price-field {
          flex: 1;
          min-height: var(--touch-min);
          padding: var(--space-2) var(--space-4);
          background: var(--surface-tertiary);
          color: var(--text-primary);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          font-size: var(--font-lg);
          font-weight: var(--font-weight-bold);
        }

        .alert-sheet__price-field::placeholder {
          color: var(--text-tertiary);
          font-weight: var(--font-weight-normal);
        }

        /* Sites checkboxes */
        .alert-sheet__sites {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
        }

        .alert-sheet__site-btn {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          min-height: var(--touch-min);
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-md);
          font-size: var(--font-sm);
          color: var(--text-primary);
          transition: background var(--transition-fast);
        }

        .alert-sheet__site-btn:active {
          background: var(--surface-tertiary);
        }

        .alert-sheet__check-icon {
          display: flex;
          align-items: center;
          flex-shrink: 0;
        }

        /* Push notification toggle */
        .alert-sheet__toggle-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          min-height: var(--touch-min);
          padding: var(--space-2) 0;
        }

        .alert-sheet__toggle-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
          text-align: left;
        }

        .alert-sheet__toggle-label {
          font-size: var(--font-sm);
          font-weight: var(--font-weight-medium);
          color: var(--text-primary);
        }

        .alert-sheet__toggle-desc {
          font-size: var(--font-xs);
          color: var(--text-tertiary);
        }

        .alert-sheet__toggle {
          position: relative;
          width: 48px;
          height: 28px;
          background: var(--surface-tertiary);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-full);
          transition: all var(--transition-fast);
          flex-shrink: 0;
        }

        .alert-sheet__toggle--on {
          background: var(--brand-500);
          border-color: var(--brand-500);
        }

        .alert-sheet__toggle-knob {
          position: absolute;
          top: 2px;
          left: 2px;
          width: 22px;
          height: 22px;
          background: white;
          border-radius: 50%;
          transition: transform var(--transition-fast);
        }

        .alert-sheet__toggle--on .alert-sheet__toggle-knob {
          transform: translateX(20px);
        }

        /* Action buttons */
        .alert-sheet__actions {
          display: flex;
          gap: var(--space-3);
          margin-top: var(--space-6);
        }

        .alert-sheet__btn {
          flex: 1;
          min-height: var(--touch-min);
          border-radius: var(--radius-md);
          font-size: var(--font-sm);
          font-weight: var(--font-weight-semibold);
          transition: all var(--transition-fast);
        }

        .alert-sheet__btn--delete {
          background: rgba(239, 68, 68, 0.15);
          color: var(--accent-danger);
        }

        .alert-sheet__btn--delete:active {
          background: rgba(239, 68, 68, 0.25);
        }

        .alert-sheet__btn--save {
          background: var(--brand-500);
          color: white;
        }

        .alert-sheet__btn--save:active {
          background: var(--brand-600);
        }

        .alert-sheet__btn--save:disabled {
          opacity: 0.5;
          pointer-events: none;
        }
      `}</style>
    </BottomSheet>
  );
}

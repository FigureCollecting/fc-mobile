import { useState } from 'preact/hooks';
import { BottomSheet } from '../ui/BottomSheet';
import type { Disposal } from '../../storage/userStore';
import { Style } from '../../styles/Style';

const REASONS: Array<[Disposal['reason'], string]> = [
  ['sold', 'Sold'],
  ['traded', 'Traded'],
  ['gifted', 'Gifted'],
  ['damaged', 'Damaged'],
  ['lost', 'Lost'],
  ['stolen', 'Stolen'],
  ['other', 'Other'],
];
const CURRENCIES = ['USD', 'JPY', 'EUR', 'GBP', 'CAD', 'AUD'];
const AMOUNT = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,4})?$/;

interface DisposalSheetProps {
  open: boolean;
  /** "1 copy" or "3 copies". */
  what: string;
  onClose: () => void;
  onSave: (disposal: Disposal) => void;
}

/** 'Mark sold/traded/gifted/…' (GR-Q3): status former and the disposal, written in one batch. */
export function DisposalSheet({ open, what, onClose, onSave }: DisposalSheetProps) {
  const [reason, setReason] = useState<Disposal['reason']>('sold');
  const [on, setOn] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [note, setNote] = useState('');
  const amountValid = amount === '' || AMOUNT.test(amount);

  const save = (e: Event) => {
    e.preventDefault();
    if (!amountValid) return;
    const disposal: Disposal = { reason };
    if (on !== '') disposal.on = on;
    if (counterparty.trim() !== '') disposal.counterparty = counterparty.trim();
    if (amount !== '') disposal.price = { amount, currency };
    if (note.trim() !== '') disposal.note = note.trim();
    onSave(disposal);
  };

  return (
    <BottomSheet open={open} onClose={onClose} snapPoint="full">
      <form class="disposal-sheet" aria-label="No longer owned" onSubmit={save}>
        <h2 class="disposal-sheet__title">{`No longer owned: ${what}`}</h2>
        <div class="disposal-sheet__field">
          <label for="disposal-reason">How it left</label>
          <select id="disposal-reason" value={reason} onChange={(e) => setReason((e.target as HTMLSelectElement).value as Disposal['reason'])}>
            {REASONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div class="disposal-sheet__field">
          <label for="disposal-on">Date</label>
          <input id="disposal-on" type="date" value={on} onInput={(e) => setOn((e.target as HTMLInputElement).value)} />
        </div>
        <div class="disposal-sheet__field">
          <label for="disposal-counterparty">To or from</label>
          <input id="disposal-counterparty" type="text" maxLength={200} value={counterparty} onInput={(e) => setCounterparty((e.target as HTMLInputElement).value)} />
        </div>
        <div class="disposal-sheet__row">
          <div class="disposal-sheet__field">
            <label for="disposal-price">Price</label>
            <input id="disposal-price"
              type="text"
              inputMode="decimal"
              value={amount}
              aria-invalid={!amountValid}
              onInput={(e) => setAmount((e.target as HTMLInputElement).value.trim())}
            />
          </div>
          <div class="disposal-sheet__field">
            <label for="disposal-currency">Currency</label>
            <select id="disposal-currency" value={currency} onChange={(e) => setCurrency((e.target as HTMLSelectElement).value)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div class="disposal-sheet__field">
          <label for="disposal-note">Note</label>
          <textarea id="disposal-note" rows={2} maxLength={2000} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
        </div>
        <div class="disposal-sheet__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" class="disposal-sheet__save" disabled={!amountValid}>
            Save
          </button>
        </div>
        <Style css={`
          .disposal-sheet {
            display: flex;
            flex-direction: column;
            gap: var(--space-3);
            padding: var(--space-4) var(--space-page);
          }
          .disposal-sheet__title {
            font-size: var(--font-lg);
            font-weight: 700;
          }
          .disposal-sheet__row {
            display: flex;
            gap: var(--space-3);
          }
          .disposal-sheet__field {
            display: flex;
            flex-direction: column;
            gap: var(--space-1);
            flex: 1;
            font-size: var(--font-xs);
            color: var(--text-tertiary);
          }
          .disposal-sheet__field input,
          .disposal-sheet__field select,
          .disposal-sheet__field textarea {
            min-height: 44px;
            padding: var(--space-2) var(--space-3);
            border-radius: var(--radius-md);
            border: 1px solid var(--border-default);
            background: var(--surface-secondary);
            color: var(--text-primary);
            font-size: var(--font-base);
          }
          .disposal-sheet__actions {
            display: flex;
            gap: var(--space-3);
          }
          .disposal-sheet__actions button {
            flex: 1;
            min-height: 44px;
            border-radius: var(--radius-md);
            background: var(--surface-tertiary);
            font-weight: 600;
          }
          .disposal-sheet__actions .disposal-sheet__save {
            background: var(--brand-500);
            color: #fff;
          }
        `} />
      </form>
    </BottomSheet>
  );
}

import type { LocalFigure } from '../../local/figures';
import { Style } from '../../styles/Style';

const REASON: Record<string, string> = {
  sold: 'Sold',
  traded: 'Traded',
  gifted: 'Gifted',
  damaged: 'Damaged',
  lost: 'Lost',
  stolen: 'Stolen',
  other: 'Other',
};

export function formatDisposalDate(on: string): string {
  const [y, m, d] = on.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y!, m! - 1, d!));
}

export function formatPrice(price: { amount: string; currency: string }): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: price.currency }).format(Number(price.amount));
  } catch {
    return `${price.amount} ${price.currency}`;
  }
}

interface Disposal {
  reason?: string;
  on?: string;
  note?: string;
  counterparty?: string;
  price?: { amount: string; currency: string };
}

/** One former copy's disposal, as the No longer owned tab and the detail show it. */
export function DisposalLine({ disposal }: { disposal: Disposal | null }) {
  if (disposal === null) return <span class="disposal">No longer owned</span>;
  const parts = [
    REASON[disposal.reason ?? ''] ?? 'No longer owned',
    disposal.on === undefined ? undefined : formatDisposalDate(disposal.on),
    disposal.counterparty,
    disposal.price === undefined ? undefined : formatPrice(disposal.price),
  ].filter((p): p is string => p !== undefined);
  return (
    <span class="disposal">
      {parts.join(' · ')}
      {disposal.note !== undefined && <span class="disposal__note">{disposal.note}</span>}
    </span>
  );
}

interface FormerListProps {
  figures: LocalFigure[];
  onOpen: (figure: LocalFigure) => void;
}

/** The No longer owned tab (GR-Q3): each former copy with its disposal. */
export function FormerList({ figures, onOpen }: FormerListProps) {
  return (
    <ul class="former-list" aria-label="No longer owned">
      {figures.flatMap((f) =>
        f.local.copies.map((c) => (
          <li key={c.occ_id} class="former-list__item">
            <button type="button" class="former-list__button" onClick={() => onOpen(f)}>
              <span class="former-list__name">{f.name}</span>
              <DisposalLine disposal={c.disposal as Disposal | null} />
            </button>
          </li>
        )),
      )}
      <Style css={`
        .former-list {
          list-style: none;
          margin: 0;
          padding: 0 var(--space-page) var(--space-4);
        }
        .former-list__item + .former-list__item {
          border-top: 1px solid var(--border-subtle);
        }
        .former-list__button {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 2px;
          width: 100%;
          min-height: 44px;
          padding: var(--space-2) 0;
          text-align: left;
        }
        .former-list__name {
          font-weight: 600;
          color: var(--text-primary);
        }
        .disposal {
          display: flex;
          flex-direction: column;
          font-size: var(--font-sm);
          color: var(--text-secondary);
        }
        .disposal__note {
          font-style: italic;
          color: var(--text-tertiary);
        }
      `} />
    </ul>
  );
}

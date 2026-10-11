/**
 * The case screen's pull-up tabs (Ross 2026-10-09, IC1-R1..R3): four slots,
 * two each side of the raised + of the tab bar: View, Reserved | + | Info,
 * Refine. Reserved is held as an empty slot until it has a job (IC1-R3), so
 * the others never move. The order is kept per device (CC14); the View card
 * can swap the sides.
 */
import type { CaseTab } from './casePrefs';
import { Style } from '../../styles/Style';

export type CaseCard = Exclude<CaseTab, 'reserved'>;

const LABEL: Record<CaseCard, string> = { view: 'View', info: 'Info', refine: 'Refine' };

function Icon({ tab }: { tab: CaseCard }) {
  const common = {
    width: 15,
    height: 15,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  } as const;
  if (tab === 'view') {
    return (
      <svg {...common}>
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  if (tab === 'info') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="11" x2="12" y2="16" />
        <circle cx="12" cy="8" r="0.6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <circle cx="9" cy="7" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="8" cy="17" r="2" />
    </svg>
  );
}

interface CaseTabsProps {
  order: readonly CaseTab[];
  /** Info opens the figure last tapped; until then there is nothing to show. */
  infoEnabled: boolean;
  open: CaseCard | null;
  onTab: (tab: CaseCard) => void;
}

export function CaseTabs({ order, infoEnabled, open, onTab }: CaseTabsProps) {
  const slot = (tab: CaseTab) => {
    if (tab === 'reserved') return <span key={tab} class="case-tabs__slot case-tabs__slot--reserved" data-tab={tab} aria-hidden="true" />;
    return (
      <button
        key={tab}
        type="button"
        class={`case-tabs__slot case-tabs__tab ${open === tab ? 'case-tabs__tab--open' : ''}`}
        data-tab={tab}
        aria-label={LABEL[tab]}
        aria-expanded={open === tab}
        disabled={tab === 'info' && !infoEnabled}
        onClick={() => onTab(tab)}
      >
        <Icon tab={tab} />
        <span>{LABEL[tab]}</span>
      </button>
    );
  };
  return (
    <nav class="case-tabs" aria-label="Case cards">
      {order.slice(0, 2).map(slot)}
      <span class="case-tabs__dock" data-tab="dock" aria-hidden="true" />
      {order.slice(2).map(slot)}
      <Style css={styles} />
    </nav>
  );
}

const styles = `
  .case-tabs {
    position: fixed;
    left: 0;
    right: 0;
    bottom: calc(var(--bottom-nav-height) + var(--safe-area-bottom, 0px));
    z-index: 99;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    gap: 4px;
    padding: 0 6px;
    pointer-events: none;
  }
  .case-tabs__slot { flex: 0 1 84px; min-width: 0; height: 32px; }
  .case-tabs__dock { flex: none; width: calc(var(--fab-size) + 8px); }
  .case-tabs__tab {
    pointer-events: auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    border-radius: 11px 11px 0 0;
    background: var(--surface-secondary);
    border: 1px solid var(--border-subtle);
    border-bottom: 0;
    color: var(--text-secondary);
    font-size: var(--font-2xs);
    font-weight: var(--font-weight-semibold, 600);
  }
  .case-tabs__tab span { line-height: 1; }
  .case-tabs__tab--open { color: var(--brand-400); }
  .case-tabs__tab:disabled { opacity: 0.45; }
`;

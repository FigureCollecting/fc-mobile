/**
 * ADDFAB b (nav rework, plan section 7): "Add figures" in a page's header, beside its other actions. While it shows, the
 * tab bar's raised + is away (stores/add); the sheet it opens is the tab bar's.
 */
import { useLayoutEffect } from 'preact/hooks';
import { hapticLight } from '../../utils/haptics';
import { addAllowed, hostAddInHeader, openAdd } from '../../stores/add';
import { Style } from '../../styles/Style';

export function HeaderAdd() {
  // SIGNED-OUT-ADD: none for a visitor with no account (stores/add addAllowed); hosting only while it shows.
  const allowed = addAllowed();
  useLayoutEffect(() => (allowed ? hostAddInHeader() : undefined), [allowed]);
  if (!allowed) return null;
  return (
    <button
      class="header-add"
      type="button"
      aria-label="Add figures"
      title="Add figures"
      onClick={() => {
        hapticLight();
        openAdd();
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      <Style css={styles} />
    </button>
  );
}

const styles = `
  .header-add {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-full);
    background: var(--brand-500);
    color: #fff;
  }
  .header-add:active { background: var(--brand-600); }
`;

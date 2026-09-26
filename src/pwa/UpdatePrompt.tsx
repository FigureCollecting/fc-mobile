import { useState } from 'preact/hooks';
import { Style } from '../styles/Style';
import { applyUpdate, updateReady } from './updates';

/** Shown until the user takes the waiting build; there is no dismiss, so an old shell does not linger. */
export function UpdatePrompt() {
  const [applying, setApplying] = useState(false);
  if (!updateReady.value) return null;

  const reload = () => {
    setApplying(true);
    void applyUpdate();
  };

  return (
    <div class="pwa-notice" role="status">
      <span class="pwa-notice__text">A new version is ready.</span>
      <button class="pwa-notice__btn" type="button" onClick={reload} disabled={applying}>
        {applying ? 'Updating…' : 'Reload'}
      </button>
      <Style css={NOTICE_CSS} />
    </div>
  );
}

export const NOTICE_CSS = `
  .pwa-notices {
    position: fixed;
    left: var(--space-3);
    right: var(--space-3);
    bottom: calc(var(--bottom-nav-height, 64px) + var(--safe-area-bottom, 0px) + var(--space-3));
    z-index: 10000;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    pointer-events: none;
  }
  .pwa-notice {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-lg);
    background: var(--surface-secondary);
    color: var(--text-primary);
    box-shadow: var(--shadow-lg);
    font-size: var(--font-sm);
    pointer-events: auto;
  }
  .pwa-notice__text { flex: 1; }
  .pwa-notice__btn {
    min-height: var(--touch-min);
    padding: 0 var(--space-4);
    border-radius: var(--radius-full);
    background: var(--brand-500);
    color: white;
    font-weight: var(--font-weight-semibold);
  }
  .pwa-notice__btn:disabled { opacity: 0.6; }
  .pwa-notice__btn--quiet { background: transparent; color: var(--text-secondary); }
  .pwa-notice__title { display: block; margin-bottom: var(--space-1); }
  .pwa-notice__body { color: var(--text-secondary); line-height: var(--line-height-normal); }
`;

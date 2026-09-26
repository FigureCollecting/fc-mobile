import type { ComponentChildren } from 'preact';
import { useChromeStore } from '../../stores/chrome';
import { HeaderMark } from '../brand/HeaderMark';

interface SlimHeaderProps {
  /** Contextual info (result count, breadcrumb chip) — NOT a page title. */
  context?: ComponentChildren;
  /** Compact action cluster on the right. */
  actions?: ComponentChildren;
}

/**
 * Slim (~48px) contextual header. Carries context + actions only — page
 * titles are deleted app-wide (the tab bar already says where you are).
 * Collapses out of the way on scroll-down.
 */
export function SlimHeader({ context, actions }: SlimHeaderProps) {
  const hidden = useChromeStore((s) => s.hidden);

  return (
    <header class={`slim-header ${hidden ? 'slim-header--hidden' : ''}`}>
      <div class="slim-header__leading">
        <HeaderMark />
        <div class="slim-header__context">{context}</div>
      </div>
      {actions && <div class="slim-header__actions">{actions}</div>}

      <style>{`
        .slim-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-2);
          height: calc(var(--header-height) + var(--safe-area-top));
          padding: 0 var(--space-page);
          padding-top: var(--safe-area-top);
          background: color-mix(in srgb, var(--surface-primary) 88%, transparent);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          position: sticky;
          top: 0;
          z-index: 20;
          transition: transform var(--transition-normal);
        }

        .slim-header--hidden {
          transform: translateY(calc(-100% - 1px));
        }

        .slim-header__leading {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          min-width: 0;
        }

        .slim-header__context {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          min-width: 0;
          font-size: var(--font-sm);
          font-weight: var(--font-weight-semibold);
          color: var(--text-secondary);
          line-height: var(--line-height-ui);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .slim-header__actions {
          display: flex;
          align-items: center;
          gap: var(--space-1);
          flex-shrink: 0;
        }
      `}</style>
    </header>
  );
}

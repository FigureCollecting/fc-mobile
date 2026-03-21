import { useLocation } from 'wouter';
import { hapticLight } from '../../utils/haptics';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Collection', icon: 'grid' },
  { path: '/discover', label: 'Discover', icon: 'compass' },
  { path: '/prices', label: 'Prices', icon: 'chart' },
  { path: '/profile', label: 'Profile', icon: 'user' },
];

function NavIcon({ icon, active }: { icon: string; active: boolean }) {
  const color = active ? 'var(--brand-500)' : 'var(--text-tertiary)';

  switch (icon) {
    case 'grid':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      );
    case 'compass':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill={active ? color : 'none'} />
        </svg>
      );
    case 'chart':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 3v18h18" />
          <path d="M7 16l4-8 4 4 5-6" />
        </svg>
      );
    case 'user':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M5.5 21a8.5 8.5 0 0 1 13 0" />
        </svg>
      );
    default:
      return null;
  }
}

export function BottomNav() {
  const [location, setLocation] = useLocation();

  return (
    <nav class="bottom-nav" role="navigation" aria-label="Main navigation">
      {NAV_ITEMS.map((item) => {
        const active = location === item.path;
        return (
          <button
            key={item.path}
            class={`bottom-nav__item ${active ? 'bottom-nav__item--active' : ''}`}
            onClick={() => { hapticLight(); setLocation(item.path); }}
            aria-current={active ? 'page' : undefined}
            aria-label={item.label}
          >
            <span class="bottom-nav__icon">
              <NavIcon icon={item.icon} active={active} />
            </span>
            <span class="bottom-nav__label">{item.label}</span>
            {active && <span class="bottom-nav__indicator" />}
          </button>
        );
      })}

      <style>{`
        .bottom-nav {
          display: flex;
          align-items: center;
          justify-content: space-around;
          height: var(--bottom-nav-height);
          padding-bottom: var(--safe-area-bottom);
          background-color: var(--surface-secondary);
          border-top: 1px solid var(--border-subtle);
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          z-index: 100;
        }

        .bottom-nav__item {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          min-width: var(--touch-recommended);
          min-height: var(--touch-recommended);
          padding: var(--space-1) var(--space-2);
          position: relative;
          transition: color var(--transition-fast);
        }

        .bottom-nav__icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
        }

        .bottom-nav__label {
          font-size: var(--font-xs);
          font-weight: var(--font-weight-medium);
          color: var(--text-tertiary);
          transition: color var(--transition-fast);
        }

        .bottom-nav__item--active .bottom-nav__label {
          color: var(--brand-500);
        }

        .bottom-nav__indicator {
          position: absolute;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 32px;
          height: 3px;
          background-color: var(--brand-500);
          border-radius: 0 0 var(--radius-full) var(--radius-full);
          animation: indicator-appear 250ms var(--spring-bouncy);
        }

        @keyframes indicator-appear {
          from {
            transform: translateX(-50%) scaleX(0);
            opacity: 0;
          }
          to {
            transform: translateX(-50%) scaleX(1);
            opacity: 1;
          }
        }
      `}</style>
    </nav>
  );
}

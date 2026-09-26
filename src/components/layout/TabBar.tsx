import { useState } from 'preact/hooks';
import { useLocation } from 'wouter';
import { hapticLight } from '../../utils/haptics';
import { Badge } from '../ui/Badge';
import { useUnreadCount } from '../../hooks/useNotifications';
import { useChromeStore } from '../../stores/chrome';
import { BottomSheet } from '../ui/BottomSheet';

interface TabItem {
  path: string;
  label: string;
  icon: string;
}

/** 4-slot tab bar; the docked center Add action lives between slots 2 and 3. */
const LEFT_TABS: TabItem[] = [
  { path: '/', label: 'Collection', icon: 'grid' },
  { path: '/discover', label: 'Search', icon: 'search' },
];

const RIGHT_TABS: TabItem[] = [
  { path: '/stats', label: 'Stats', icon: 'stats' },
  { path: '/profile', label: 'Profile', icon: 'user' },
];

function TabIcon({ icon, active }: { icon: string; active: boolean }) {
  const color = active ? 'var(--brand-400)' : 'var(--text-tertiary)';
  switch (icon) {
    case 'grid':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      );
    case 'search':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      );
    case 'stats':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 20V10" />
          <path d="M12 20V4" />
          <path d="M6 20v-6" />
        </svg>
      );
    case 'user':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M5.5 21a8.5 8.5 0 0 1 13 0" />
        </svg>
      );
    default:
      return null;
  }
}

function Tab({ item, unread }: { item: TabItem; unread?: number }) {
  const [location, setLocation] = useLocation();
  const active = location === item.path;
  return (
    <button
      class={`tab-bar__item ${active ? 'tab-bar__item--active' : ''}`}
      onClick={() => { hapticLight(); setLocation(item.path); }}
      aria-current={active ? 'page' : undefined}
      aria-label={item.label}
      type="button"
    >
      <span class="tab-bar__icon">
        <TabIcon icon={item.icon} active={active} />
        {item.icon === 'user' && <Badge count={unread ?? 0} />}
      </span>
      <span class="tab-bar__label">{item.label}</span>
    </button>
  );
}

/** Center Add action sheet — routes into the existing add flows. */
function AddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [, setLocation] = useLocation();
  const go = (path: string) => { onClose(); setLocation(path); };
  return (
    <BottomSheet open={open} onClose={onClose} snapPoint="half">
      <div class="add-sheet">
        <h2 class="add-sheet__title">Add figures</h2>
        <button class="add-sheet__option" type="button" onClick={() => go('/sync')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand-400)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3" />
          </svg>
          <span>Sync from MFC</span>
        </button>
        <button class="add-sheet__option" type="button" onClick={() => go('/import')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand-400)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span>Import from CSV</span>
        </button>
        <style>{`
          .add-sheet { display: flex; flex-direction: column; gap: var(--space-1); padding-bottom: var(--space-4); }
          .add-sheet__title {
            font-size: var(--font-base);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
            margin-bottom: var(--space-2);
          }
          .add-sheet__option {
            display: flex; align-items: center; gap: var(--space-3);
            min-height: var(--touch-min);
            padding: var(--space-2) var(--space-3);
            border-radius: var(--radius-md);
            font-size: var(--font-sm);
            color: var(--text-primary);
          }
          .add-sheet__option:active { background: var(--surface-tertiary); }
        `}</style>
      </div>
    </BottomSheet>
  );
}

export function TabBar() {
  const { data: unreadCount = 0 } = useUnreadCount();
  const hidden = useChromeStore((s) => s.hidden);
  const [addOpen, setAddOpen] = useState(false);

  return (
    <>
      <nav
        class={`tab-bar ${hidden ? 'tab-bar--hidden' : ''}`}
        role="navigation"
        aria-label="Main navigation"
      >
        {LEFT_TABS.map((t) => <Tab key={t.path} item={t} />)}
        <div class="tab-bar__dock" aria-hidden="false">
          <button
            class="tab-bar__add"
            type="button"
            aria-label="Add figures"
            onClick={() => { hapticLight(); setAddOpen(true); }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
        {RIGHT_TABS.map((t) => <Tab key={t.path} item={t} unread={unreadCount} />)}

        <style>{`
          .tab-bar {
            display: flex;
            align-items: stretch;
            height: calc(var(--bottom-nav-height) + var(--safe-area-bottom));
            padding-bottom: var(--safe-area-bottom);
            background: var(--surface-secondary);
            border-top: 1px solid var(--border-subtle);
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            z-index: 100;
            transition: transform var(--transition-normal);
          }

          .tab-bar--hidden {
            transform: translateY(calc(100% + 16px));
          }

          .tab-bar__item {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 1px;
            min-height: var(--touch-min);
            position: relative;
          }

          .tab-bar__icon {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 22px;
            height: 22px;
            position: relative;
          }

          .tab-bar__label {
            font-size: var(--font-2xs);
            font-weight: var(--font-weight-medium);
            color: var(--text-tertiary);
            line-height: 1;
          }

          .tab-bar__item--active .tab-bar__label {
            color: var(--brand-400);
          }

          .tab-bar__dock {
            width: calc(var(--fab-size) + 12px);
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
          }

          .tab-bar__add {
            position: absolute;
            top: calc(var(--fab-size) / -3);
            width: var(--fab-size);
            height: var(--fab-size);
            border-radius: var(--radius-full);
            background: var(--brand-500);
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: var(--shadow-md);
            transition: transform var(--transition-fast);
          }

          .tab-bar__add:active {
            transform: scale(0.94);
            background: var(--brand-600);
          }
        `}</style>
      </nav>
      <AddSheet open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}

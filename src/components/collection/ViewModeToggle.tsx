import { useCallback } from 'preact/hooks';
import { hapticLight } from '../../utils/haptics';

export type ViewMode = 'grid' | 'list' | 'compact';

const VIEW_MODE_KEY = 'fc-collection-view-mode';

interface ViewModeToggleProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export function getStoredViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    if (stored === 'grid' || stored === 'list' || stored === 'compact') return stored;
  } catch {
    // localStorage unavailable
  }
  return 'grid';
}

export function storeViewMode(mode: ViewMode): void {
  try {
    localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    // localStorage unavailable
  }
}

const MODES: { value: ViewMode; label: string; icon: string }[] = [
  { value: 'grid', label: 'Grid', icon: 'grid' },
  { value: 'list', label: 'List', icon: 'list' },
  { value: 'compact', label: 'Compact', icon: 'compact' },
];

function ModeIcon({ icon }: { icon: string }) {
  switch (icon) {
    case 'grid':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="1" y="1" width="6" height="6" rx="1" />
          <rect x="9" y="1" width="6" height="6" rx="1" />
          <rect x="1" y="9" width="6" height="6" rx="1" />
          <rect x="9" y="9" width="6" height="6" rx="1" />
        </svg>
      );
    case 'list':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="1" y1="3" x2="15" y2="3" />
          <line x1="1" y1="8" x2="15" y2="8" />
          <line x1="1" y1="13" x2="15" y2="13" />
        </svg>
      );
    case 'compact':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="1" y="1" width="4" height="4" rx="0.5" />
          <rect x="6" y="1" width="4" height="4" rx="0.5" />
          <rect x="11" y="1" width="4" height="4" rx="0.5" />
          <rect x="1" y="6" width="4" height="4" rx="0.5" />
          <rect x="6" y="6" width="4" height="4" rx="0.5" />
          <rect x="11" y="6" width="4" height="4" rx="0.5" />
          <rect x="1" y="11" width="4" height="4" rx="0.5" />
          <rect x="6" y="11" width="4" height="4" rx="0.5" />
          <rect x="11" y="11" width="4" height="4" rx="0.5" />
        </svg>
      );
    default:
      return null;
  }
}

export function ViewModeToggle({ mode, onChange }: ViewModeToggleProps) {
  const handleClick = useCallback(
    (newMode: ViewMode) => {
      if (newMode !== mode) {
        hapticLight();
        storeViewMode(newMode);
        onChange(newMode);
      }
    },
    [mode, onChange],
  );

  return (
    <div class="view-mode-toggle" role="radiogroup" aria-label="View mode">
      {MODES.map((m) => (
        <button
          key={m.value}
          class={`view-mode-toggle__btn ${mode === m.value ? 'view-mode-toggle__btn--active' : ''}`}
          onClick={() => handleClick(m.value)}
          type="button"
          role="radio"
          aria-checked={mode === m.value}
          aria-label={m.label}
        >
          <ModeIcon icon={m.icon} />
        </button>
      ))}

      <style>{`
        .view-mode-toggle {
          display: flex;
          align-items: center;
          background: var(--surface-tertiary);
          border-radius: var(--radius-md);
          padding: 2px;
          gap: 2px;
        }

        .view-mode-toggle__btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 28px;
          border-radius: calc(var(--radius-md) - 2px);
          color: var(--text-tertiary);
          transition: color 150ms ease, background 150ms ease;
        }

        .view-mode-toggle__btn--active {
          background: var(--surface-secondary);
          color: var(--brand-400);
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
        }

        .view-mode-toggle__btn:active {
          transform: scale(0.95);
        }
      `}</style>
    </div>
  );
}

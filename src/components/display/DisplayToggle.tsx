import { hapticLight } from '../../utils/haptics';
import { DENSITIES } from './density';
import type { Density } from './density';
import { CASE_MOTIFS } from './CaseShelf';
import type { CaseMotif } from './CaseShelf';
import type { LayoutMode } from '../../hooks/useFigureListParams';

interface DisplayToggleProps {
  layout: LayoutMode;
  density: Density;
  motif: CaseMotif;
  onLayout: (layout: LayoutMode) => void;
  onDensity: (density: Density) => void;
  onMotif: (motif: CaseMotif) => void;
}

const DENSITY_LABEL: Record<Density, string> = {
  comfortable: 'Comfortable',
  compact: 'Compact',
  gallery: 'Gallery',
};

/**
 * Header display controls: A/B layout toggle (virtual case vs justified
 * rows), density cycler, and — in case mode — the case motif cycler.
 */
export function DisplayToggle({ layout, density, motif, onLayout, onDensity, onMotif }: DisplayToggleProps) {
  const cycleDensity = () => {
    const next = DENSITIES[(DENSITIES.indexOf(density) + 1) % DENSITIES.length];
    hapticLight();
    onDensity(next);
  };

  const cycleMotif = () => {
    const values = CASE_MOTIFS.map((m) => m.value);
    const next = values[(values.indexOf(motif) + 1) % values.length];
    hapticLight();
    onMotif(next);
  };

  const motifLabel = CASE_MOTIFS.find((m) => m.value === motif)?.label ?? motif;

  return (
    <div class="display-toggle">
      <div class="display-toggle__group" role="radiogroup" aria-label="Display mode">
        <button
          class={`display-toggle__btn ${layout === 'case' ? 'display-toggle__btn--active' : ''}`}
          type="button"
          role="radio"
          aria-checked={layout === 'case'}
          aria-label="Display case"
          onClick={() => { if (layout !== 'case') { hapticLight(); onLayout('case'); } }}
        >
          {/* shelf with figures */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <path d="M1.5 5.5h13" />
            <path d="M1.5 12.5h13" />
            <path d="M4 5.5V3.2M6.5 5.5V2.4M11 5.5V3" />
            <path d="M4.5 12.5v-2.6M9 12.5V9.6M12 12.5v-2.2" />
          </svg>
        </button>
        <button
          class={`display-toggle__btn ${layout === 'rows' ? 'display-toggle__btn--active' : ''}`}
          type="button"
          role="radio"
          aria-checked={layout === 'rows'}
          aria-label="Justified rows"
          onClick={() => { if (layout !== 'rows') { hapticLight(); onLayout('rows'); } }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
            <rect x="1" y="2" width="6" height="5" rx="0.5" />
            <rect x="8.5" y="2" width="6.5" height="5" rx="0.5" />
            <rect x="1" y="9" width="9" height="5" rx="0.5" />
            <rect x="11.5" y="9" width="3.5" height="5" rx="0.5" />
          </svg>
        </button>
      </div>

      <button
        class="display-toggle__cycle"
        type="button"
        aria-label={`Density: ${DENSITY_LABEL[density]}`}
        title={`Density: ${DENSITY_LABEL[density]}`}
        onClick={cycleDensity}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          {density === 'comfortable' && <><rect x="2" y="2" width="12" height="12" rx="1" /></>}
          {density === 'compact' && <><rect x="2" y="2" width="5.5" height="5.5" rx="0.5" /><rect x="8.5" y="2" width="5.5" height="5.5" rx="0.5" /><rect x="2" y="8.5" width="5.5" height="5.5" rx="0.5" /><rect x="8.5" y="8.5" width="5.5" height="5.5" rx="0.5" /></>}
          {density === 'gallery' && <><rect x="1.5" y="1.5" width="3.6" height="3.6" /><rect x="6.2" y="1.5" width="3.6" height="3.6" /><rect x="10.9" y="1.5" width="3.6" height="3.6" /><rect x="1.5" y="6.2" width="3.6" height="3.6" /><rect x="6.2" y="6.2" width="3.6" height="3.6" /><rect x="10.9" y="6.2" width="3.6" height="3.6" /><rect x="1.5" y="10.9" width="3.6" height="3.6" /><rect x="6.2" y="10.9" width="3.6" height="3.6" /><rect x="10.9" y="10.9" width="3.6" height="3.6" /></>}
        </svg>
      </button>

      {layout === 'case' && (
        <button
          class="display-toggle__cycle"
          type="button"
          aria-label={`Case motif: ${motifLabel}`}
          title={`Case: ${motifLabel}`}
          onClick={cycleMotif}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2.5" y="1.5" width="11" height="13" rx="1" />
            <path d="M2.5 8h11" />
            <path d="M5.5 5.5l5-3" opacity="0.6" />
          </svg>
        </button>
      )}

      <style>{`
        .display-toggle {
          display: flex;
          align-items: center;
          gap: var(--space-1);
        }

        .display-toggle__group {
          display: flex;
          align-items: center;
          background: var(--surface-tertiary);
          border-radius: var(--radius-md);
          padding: 2px;
          gap: 2px;
        }

        .display-toggle__btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 34px;
          height: 28px;
          border-radius: calc(var(--radius-md) - 2px);
          color: var(--text-tertiary);
          transition: color 150ms ease, background 150ms ease;
        }

        .display-toggle__btn--active {
          background: var(--surface-secondary);
          color: var(--brand-400);
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
        }

        .display-toggle__cycle {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: var(--radius-md);
          color: var(--text-secondary);
        }

        .display-toggle__cycle:active {
          background: var(--surface-tertiary);
          color: var(--text-primary);
        }
      `}</style>
    </div>
  );
}

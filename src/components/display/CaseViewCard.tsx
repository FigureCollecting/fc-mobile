/**
 * The View tab's card: how the case looks, kept on this device (CC14): the
 * view (whole cabinets, one cabinet, one shelf), which cabinets line the
 * wall, the room's ceiling (CC9, which limits what may stand on a top), the
 * clearance every compartment keeps above a figure (CLEAR-1) and which side the
 * tabs sit on. What a sideways swipe does (CC4: walk the
 * camera or pan the wall) moved to the header, beside the display modes
 * (CAM1, Ross 10-18).
 * One quiet line says how many goods and media the case leaves off its shelves (FIGURES-ONLY-1).
 * Discontinued cabinets say so and never get a buy link (Ross 2026-10-11).
 * The card fits above the tab bar and scrolls its body, so a tap reaches
 * every choice on either Fold8 panel (CC5).
 */
import { BottomSheet } from '../ui/BottomSheet';
import { Style } from '../../styles/Style';
import { CLEARANCE_MAX_MM, CLEARANCE_STEP_MM, inchesToMm } from './cabinetProfile';
import { IN_MM } from './caseCamera';
import { WALL_PATTERNS, type CasePrefs, type CaseView } from './casePrefs';

const VIEWS: readonly [CaseView, string][] = [
  ['wall', 'Whole cabinets'],
  ['cabinet', 'One cabinet'],
  ['shelf', 'One shelf'],
];

interface CaseViewCardProps {
  open: boolean;
  prefs: CasePrefs;
  onChange: (patch: Partial<CasePrefs>) => void;
  onClose: () => void;
  /** FIGURES-ONLY-1: "22 goods not shelved", or null when the case leaves nothing off. */
  notShelved?: string | null;
}

export function CaseViewCard({ open, prefs, onChange, onClose, notShelved = null }: CaseViewCardProps) {
  const ceilingIn = Math.round((prefs.ceilingMm / IN_MM) * 10) / 10;
  const clearanceIn = Math.round((prefs.clearanceMm / IN_MM) * 100) / 100;
  return (
    <BottomSheet open={open} onClose={onClose} snapPoint="fit">
      <div class="case-card">
        <fieldset class="case-card__group">
          <legend>View</legend>
          {VIEWS.map(([value, label]) => (
            <label key={value} class="case-card__choice">
              <input type="radio" name="case-view" checked={prefs.view === value} onChange={() => onChange({ view: value })} />
              {label}
            </label>
          ))}
        </fieldset>

        <fieldset class="case-card__group">
          <legend>Cabinets</legend>
          {WALL_PATTERNS.map((pattern) => {
            const discontinued = pattern.profiles.length === 1 && pattern.profiles[0].discontinued;
            return (
              <label key={pattern.id} class="case-card__choice">
                <input type="radio" name="case-pattern" checked={prefs.pattern === pattern.id} onChange={() => onChange({ pattern: pattern.id })} />
                {pattern.label}
                {discontinued && <span class="case-card__note"> (no longer sold)</span>}
              </label>
            );
          })}
        </fieldset>

        <label class="case-card__ceiling">
          Room ceiling (in)
          <input
            type="number"
            min={60}
            max={240}
            step={1}
            value={ceilingIn}
            onChange={(e) => {
              const inches = Number((e.currentTarget as HTMLInputElement).value);
              const raw = (e.currentTarget as HTMLInputElement).value.trim();
              if (raw !== '' && Number.isFinite(inches) && inches > 0) onChange({ ceilingMm: inchesToMm(inches) });
            }}
          />
        </label>

        <label class="case-card__ceiling">
          Clearance above a figure (in)
          <input
            type="number"
            min={0}
            max={CLEARANCE_MAX_MM / IN_MM}
            step={CLEARANCE_STEP_MM / IN_MM}
            value={clearanceIn}
            onChange={(e) => {
              const raw = (e.currentTarget as HTMLInputElement).value.trim();
              const inches = Number(raw);
              if (raw !== '' && Number.isFinite(inches) && inches >= 0 && inches <= CLEARANCE_MAX_MM / IN_MM) onChange({ clearanceMm: inchesToMm(inches) });
            }}
          />
        </label>

        <button type="button" class="case-card__swap" onClick={() => onChange({ tabOrder: [...prefs.tabOrder].reverse() })}>
          Swap tab sides
        </button>

        {notShelved !== null && <p class="case-card__note case-card__shelved">{notShelved}</p>}
      </div>
      <Style css={styles} />
    </BottomSheet>
  );
}

const styles = `
  .case-card { display: flex; flex-direction: column; gap: var(--space-3); padding-bottom: var(--space-4); }
  .case-card__group { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
  .case-card__group legend { font-size: var(--font-xs); font-weight: var(--font-weight-semibold); color: var(--text-secondary); margin-bottom: var(--space-1); }
  .case-card__choice { display: flex; align-items: center; gap: var(--space-2); min-height: 36px; font-size: var(--font-sm); color: var(--text-primary); }
  .case-card__note { color: var(--text-tertiary); font-size: var(--font-xs); }
  .case-card__ceiling { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); font-size: var(--font-sm); color: var(--text-primary); }
  .case-card__ceiling input { width: 80px; min-height: 36px; padding: 0 var(--space-2); border-radius: var(--radius-sm); background: var(--surface-tertiary); color: var(--text-primary); }
  .case-card__swap { align-self: flex-start; min-height: 36px; padding: 0 var(--space-3); border-radius: var(--radius-full); color: var(--brand-400); }
`;

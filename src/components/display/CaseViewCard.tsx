/**
 * The View tab's card: how the case looks, kept on this device (CC14): the
 * back wall's colour (WALL-COLOUR-1), which cabinets line the
 * wall, the room's ceiling (CC9, which limits what may stand on a top), the
 * clearance every compartment keeps above a figure (CLEAR-1) and which side the
 * tabs sit on. What a sideways swipe does (CC4: walk the
 * camera or pan the wall) moved to the header, beside the display modes
 * (CAM1, Ross 10-18), and so did the view (whole cabinets, one cabinet, one
 * shelf: VIEWCARD-1, Ross 10-20, the header's Case menu chooses it).
 * "Doesn't fit (N)" opens the list of the figures the wall cannot take, whether or not
 * the case's chip for them is hidden (MISFIT-CHIP-1).
 * One quiet line says how many goods and media the case leaves off its shelves (FIGURES-ONLY-1).
 * Discontinued cabinets say so and never get a buy link (Ross 2026-10-11).
 * The card fits above the tab bar and scrolls its body, so a tap reaches
 * every choice on either Fold8 panel (CC5).
 */
import { BottomSheet } from '../ui/BottomSheet';
import { Style } from '../../styles/Style';
import { CLEARANCE_MAX_MM, CLEARANCE_STEP_MM, inchesToMm } from './cabinetProfile';
import { IN_MM } from './caseCamera';
import { WALL_PATTERNS, type CasePrefs } from './casePrefs';
import { WALL_PRESETS, swatchStyle } from './wallColour';

interface CaseViewCardProps {
  open: boolean;
  prefs: CasePrefs;
  onChange: (patch: Partial<CasePrefs>) => void;
  onClose: () => void;
  /** MISFIT-CHIP-1: how many figures do not fit the wall; the entry below shows only when some do. */
  misfitCount?: number;
  /** Opens the list of them, the chip hidden or not. */
  onShowMisfits?: () => void;
  /** FIGURES-ONLY-1: "22 goods not shelved", or null when the case leaves nothing off. */
  notShelved?: string | null;
  /** SIZE-BASIS-1: how many of the case's figures are sized from an estimate (sizeBasis.ts); none or unknown says nothing. */
  estimatedCount?: number;
}

export function CaseViewCard({ open, prefs, onChange, onClose, misfitCount = 0, onShowMisfits, notShelved = null, estimatedCount = 0 }: CaseViewCardProps) {
  const ceilingIn = Math.round((prefs.ceilingMm / IN_MM) * 10) / 10;
  const clearanceIn = Math.round((prefs.clearanceMm / IN_MM) * 100) / 100;
  return (
    <BottomSheet open={open} onClose={onClose} snapPoint="fit">
      <div class="case-card">
        <fieldset class="case-card__group">
          <legend>Back wall</legend>
          {WALL_PRESETS.map((p) => (
            <label key={p.id} class="case-card__choice">
              <input type="radio" name="case-wall" checked={prefs.wall === p.id} onChange={() => onChange({ wall: p.id })} />
              <span class="case-card__swatch" style={swatchStyle(p.id, prefs.wallCustom)} aria-hidden="true" />
              {p.label}
            </label>
          ))}
          <div class="case-card__custom">
            <label class="case-card__choice">
              <input type="radio" name="case-wall" checked={prefs.wall === 'custom'} onChange={() => onChange({ wall: 'custom' })} />
              <span class="case-card__swatch" style={swatchStyle('custom', prefs.wallCustom)} aria-hidden="true" />
              Custom
            </label>
            <input
              type="color"
              class="case-card__picker"
              aria-label="Custom wall colour"
              value={prefs.wallCustom}
              onInput={(e) => onChange({ wall: 'custom', wallCustom: (e.currentTarget as HTMLInputElement).value })}
            />
          </div>
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

        {/* SIZE-BASIS-1 (Ross 10-18): outline the figures whose height or width is a guess, and say how many there are */}
        <div class="case-card__sizes">
          <label class="case-card__choice">
            <input type="checkbox" checked={prefs.showEstimated} onChange={() => onChange({ showEstimated: !prefs.showEstimated })} />
            Show estimated sizes
          </label>
          {estimatedCount > 0 && (
            <p class="case-card__note case-card__estimated">{estimatedCount === 1 ? '1 figure sized from an estimate' : `${estimatedCount} figures sized from estimates`}</p>
          )}
        </div>

        {misfitCount > 0 && onShowMisfits !== undefined && (
          <button type="button" class="case-card__misfits" onClick={onShowMisfits}>
            {`Doesn't fit (${misfitCount})`}
          </button>
        )}

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
  .case-card__misfits { align-self: flex-start; min-height: 36px; padding: 0 var(--space-3); border-radius: var(--radius-full); color: var(--brand-400); }
  .case-card__sizes { display: flex; flex-direction: column; gap: var(--space-1); }
  .case-card__sizes .case-card__note { margin: 0; padding-left: calc(13px + var(--space-2)); }
  .case-card__swatch { width: 18px; height: 18px; border-radius: var(--radius-full); border: 1px solid var(--border-subtle, rgba(128, 128, 128, 0.45)); background: var(--swatch-dark); flex: none; }
  [data-theme='light'] .case-card__swatch { background: var(--swatch-light); }
  .case-card__custom { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
  .case-card__picker { width: 44px; height: 32px; padding: 0; border: 0; background: none; }
  .case-card__swap { align-self: flex-start; min-height: 36px; padding: 0 var(--space-3); border-radius: var(--radius-full); color: var(--brand-400); }
`;

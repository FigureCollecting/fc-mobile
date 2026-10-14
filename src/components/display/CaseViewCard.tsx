/**
 * The View tab's card: how the case looks, kept on this device (CC14): the
 * view (whole cabinets, one cabinet, one shelf), which cabinets line the
 * wall, what a sideways swipe does (CC4: walk the camera or pan the wall, a
 * playable toggle so Ross decides hands-on), the renderer beside it
 * (CASE-GL: Classic or Canvas), the room's ceiling (CC9, which
 * limits what may stand on a top) and which side the tabs sit on.
 * Discontinued cabinets say so and never get a buy link (Ross 2026-10-11).
 * The card fits above the tab bar and scrolls its body, so a tap reaches
 * every choice on either Fold8 panel (CC5).
 */
import { BottomSheet } from '../ui/BottomSheet';
import { Style } from '../../styles/Style';
import { inchesToMm } from './cabinetProfile';
import { IN_MM } from './caseCamera';
import { WALL_PATTERNS, type CasePrefs, type CaseRenderer, type CaseView, type SwipeMode } from './casePrefs';

const VIEWS: readonly [CaseView, string][] = [
  ['wall', 'Whole cabinets'],
  ['cabinet', 'One cabinet'],
  ['shelf', 'One shelf'],
];

const SWIPES: readonly [SwipeMode, string][] = [
  ['camera', 'Move the camera'],
  ['pan', 'Pan the wall'],
];

/** CASE-GL: Classic (CSS 3D) or Canvas (one WebGL canvas), beside the swipe so Ross compares them hands-on. */
const RENDERERS: readonly [CaseRenderer, string][] = [
  ['classic', 'Classic'],
  ['canvas', 'Canvas'],
];

interface CaseViewCardProps {
  open: boolean;
  prefs: CasePrefs;
  onChange: (patch: Partial<CasePrefs>) => void;
  onClose: () => void;
}

export function CaseViewCard({ open, prefs, onChange, onClose }: CaseViewCardProps) {
  const ceilingIn = Math.round((prefs.ceilingMm / IN_MM) * 10) / 10;
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

        <fieldset class="case-card__group">
          <legend>Swipe</legend>
          {SWIPES.map(([value, label]) => (
            <label key={value} class="case-card__choice">
              <input type="radio" name="case-swipe" checked={prefs.swipe === value} onChange={() => onChange({ swipe: value })} />
              {label}
            </label>
          ))}
        </fieldset>

        <fieldset class="case-card__group">
          <legend>Renderer</legend>
          {RENDERERS.map(([value, label]) => (
            <label key={value} class="case-card__choice">
              <input type="radio" name="case-renderer" checked={prefs.renderer === value} onChange={() => onChange({ renderer: value })} />
              {label}
            </label>
          ))}
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

        <button type="button" class="case-card__swap" onClick={() => onChange({ tabOrder: [...prefs.tabOrder].reverse() })}>
          Swap tab sides
        </button>
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

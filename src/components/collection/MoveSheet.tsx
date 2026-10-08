import { BottomSheet } from '../ui/BottomSheet';
import { Style } from '../../styles/Style';

export interface MoveTarget {
  /** A collection ref, e.g. "ordered/default". */
  ref: string;
  label: string;
}

interface MoveSheetProps {
  open: boolean;
  title: string;
  targets: MoveTarget[];
  onPick: (target: MoveTarget) => void;
  onClose: () => void;
}

/** 'Move N copies to…': the tabs (their default collections) and any collection of a kind. */
export function MoveSheet({ open, title, targets, onPick, onClose }: MoveSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} snapPoint="half">
      <div class="move-sheet">
        <h2 class="move-sheet__title">{title}</h2>
        {targets.map((t) => (
          <button key={t.ref} type="button" class="move-sheet__target" onClick={() => onPick(t)}>
            {t.label}
          </button>
        ))}
        <Style css={`
          .move-sheet {
            display: flex;
            flex-direction: column;
            gap: var(--space-2);
            padding: var(--space-4) var(--space-page);
          }
          .move-sheet__title {
            font-size: var(--font-lg);
            font-weight: 700;
          }
          .move-sheet__target {
            min-height: 44px;
            padding: 0 var(--space-4);
            border-radius: var(--radius-md);
            background: var(--surface-secondary);
            text-align: left;
            font-size: var(--font-base);
          }
        `} />
      </div>
    </BottomSheet>
  );
}

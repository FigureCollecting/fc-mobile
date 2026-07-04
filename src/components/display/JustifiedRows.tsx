import { useRef } from 'preact/hooks';
import type { Figure } from '@figurecollecting/fc-shared';
import { packJustified } from './packJustified';
import { ROW_HEIGHT } from './density';
import type { Density } from './density';
import { useElementWidth } from '../../hooks/useElementWidth';

interface JustifiedRowsProps {
  figures: Figure[];
  density: Density;
  onSelect?: (figure: Figure, index: number) => void;
}

/**
 * Display B — justified rows: fixed row height, native-aspect widths,
 * edge-to-edge, always uncropped.
 */
export function JustifiedRows({ figures, density, onSelect }: JustifiedRowsProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(hostRef, 360);
  const rows = packJustified(figures, width, ROW_HEIGHT[density]);

  return (
    <div class="jrows" ref={hostRef}>
      {rows.map((row, i) => (
        <div key={i} class="jrows__row" style={{ height: `${row.height}px` }}>
          {row.items.map((item) => (
            <button
              key={item.figure._id}
              class="jrows__item"
              style={{ width: `${item.w}px` }}
              type="button"
              onClick={onSelect ? () => onSelect(item.figure, item.index) : undefined}
            >
              {item.figure.imageUrl ? (
                <img class="jrows__img" src={item.figure.imageUrl} alt="" loading="lazy" />
              ) : (
                <span class="jrows__placeholder" aria-hidden="true" />
              )}
              <span class="sr-only">{item.figure.name}</span>
            </button>
          ))}
        </div>
      ))}

      <style>{`
        .jrows {
          display: flex;
          flex-direction: column;
          gap: 2px;
          width: 100%;
        }

        .jrows__row {
          display: flex;
          gap: 2px;
          overflow: hidden;
        }

        .jrows__item {
          position: relative;
          flex-shrink: 0;
          height: 100%;
          padding: 0;
          background: var(--surface-secondary);
          -webkit-user-select: none;
          user-select: none;
          -webkit-touch-callout: none;
        }

        .jrows__item:active {
          opacity: 0.85;
        }

        .jrows__img {
          width: 100%;
          height: 100%;
          /* NEVER crop: the whole figure, native aspect */
          object-fit: contain;
        }

        .jrows__placeholder {
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, var(--surface-tertiary), var(--surface-secondary));
        }
      `}</style>
    </div>
  );
}

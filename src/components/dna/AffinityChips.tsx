interface AffinityItem {
  label: string;
  count: number;
}

interface AffinityChipsProps {
  title: string;
  items: AffinityItem[];
}

const CHIP_COLORS = [
  'var(--brand-500)',
  'var(--accent-info)',
  'var(--accent-success)',
  'var(--accent-warning)',
  'var(--accent-danger)',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
];

export function AffinityChips({ title, items }: AffinityChipsProps) {
  return (
    <div class="affinity-chips">
      <h3 class="affinity-chips__title">{title}</h3>
      <div class="affinity-chips__scroll">
        {items.map((item, i) => (
          <span
            key={item.label}
            class="affinity-chips__chip"
            style={{ background: CHIP_COLORS[i % CHIP_COLORS.length] }}
          >
            <span class="affinity-chips__label">{item.label}</span>
            <span class="affinity-chips__count">{item.count}</span>
          </span>
        ))}
      </div>

      <style>{`
        .affinity-chips {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .affinity-chips__title {
          font-size: var(--font-xs);
          font-weight: var(--font-weight-semibold);
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 0 var(--space-1);
        }

        .affinity-chips__scroll {
          display: flex;
          gap: var(--space-2);
          overflow-x: auto;
          padding: var(--space-1) 0;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }

        .affinity-chips__scroll::-webkit-scrollbar {
          display: none;
        }

        .affinity-chips__chip {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-full);
          white-space: nowrap;
          flex-shrink: 0;
        }

        .affinity-chips__label {
          font-size: var(--font-sm);
          font-weight: var(--font-weight-semibold);
          color: white;
        }

        .affinity-chips__count {
          font-size: var(--font-xs);
          font-weight: var(--font-weight-bold);
          color: rgba(255, 255, 255, 0.8);
          background: rgba(255, 255, 255, 0.2);
          padding: 2px 8px;
          border-radius: var(--radius-full);
          line-height: 1.3;
        }
      `}</style>
    </div>
  );
}

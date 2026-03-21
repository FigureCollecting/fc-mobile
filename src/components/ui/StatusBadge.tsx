import type { CollectionStatus } from '@figurecollecting/fc-shared';

interface StatusBadgeProps {
  status?: CollectionStatus;
  size?: 'sm' | 'md';
}

const STATUS_CONFIG: Record<string, { label: string; cssClass: string }> = {
  owned: { label: 'Owned', cssClass: 'status-badge--owned' },
  ordered: { label: 'Ordered', cssClass: 'status-badge--ordered' },
  wished: { label: 'Wished', cssClass: 'status-badge--wished' },
};

export function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  if (!status) return null;

  const config = STATUS_CONFIG[status];
  if (!config) return null;

  return (
    <span class={`status-badge status-badge--${size} ${config.cssClass}`}>
      {config.label}

      <style>{`
        .status-badge {
          display: inline-flex;
          align-items: center;
          font-weight: var(--font-weight-semibold);
          border-radius: var(--radius-full);
          white-space: nowrap;
          line-height: 1;
        }

        .status-badge--sm {
          font-size: 0.625rem;
          padding: 3px 8px;
        }

        .status-badge--md {
          font-size: var(--font-xs);
          padding: 4px 10px;
        }

        .status-badge--owned {
          background: rgba(34, 197, 94, 0.15);
          color: var(--accent-success);
        }

        .status-badge--ordered {
          background: rgba(245, 158, 11, 0.15);
          color: var(--accent-warning);
        }

        .status-badge--wished {
          background: rgba(59, 130, 246, 0.15);
          color: var(--accent-info);
        }
      `}</style>
    </span>
  );
}

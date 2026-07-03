import { useState, useEffect } from 'preact/hooks';

interface LastSyncedBadgeProps {
  /** Unix timestamp (ms) of when the cached data was last fetched. */
  timestamp: number | null | undefined;
}

/**
 * Small badge displayed alongside stale/cached content so users know the
 * data they're seeing isn't live. Updates once a minute so the relative
 * string stays accurate without user interaction.
 */
export function LastSyncedBadge({ timestamp }: LastSyncedBadgeProps) {
  const [, tick] = useState(0);

  useEffect(() => {
    if (!timestamp) return;
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [timestamp]);

  if (!timestamp) return null;

  const label = formatAgo(Date.now() - timestamp);
  return (
    <div class="last-synced" role="status" aria-live="polite">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
      <span>Last synced {label}</span>

      <style>{`
        .last-synced {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          margin: var(--space-2) var(--space-4);
          background: var(--surface-secondary);
          color: var(--text-tertiary);
          border-radius: var(--radius-full);
          font-size: var(--font-xs);
          width: fit-content;
        }
      `}</style>
    </div>
  );
}

function formatAgo(deltaMs: number): string {
  if (deltaMs < 0) return 'just now';
  const mins = Math.floor(deltaMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

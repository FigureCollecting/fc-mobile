import { useState, useEffect } from 'preact/hooks';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { getPendingOpsCount } from '../../storage/pendingOps';

export function OfflineBanner() {
  const online = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (online.value) return;

    let cancelled = false;

    const check = async () => {
      const count = await getPendingOpsCount();
      if (!cancelled) setPendingCount(count);
    };

    void check();

    // Re-check periodically while offline
    const interval = setInterval(() => void check(), 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [online.value]);

  if (online.value) return null;

  return (
    <div class="offline-banner" role="status" aria-live="polite">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
        <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <line x1="12" y1="20" x2="12.01" y2="20" />
      </svg>
      <span>
        {"You're offline — showing cached data"}
        {pendingCount > 0 && ` (${pendingCount} pending ${pendingCount === 1 ? 'change' : 'changes'})`}
      </span>

      <style>{`
        .offline-banner {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 8px 16px;
          background: var(--amber-600, #d97706);
          color: #fff;
          font-size: 13px;
          font-weight: 500;
          text-align: center;
          z-index: 1000;
          flex-shrink: 0;
        }

        .offline-banner svg {
          flex-shrink: 0;
        }
      `}</style>
    </div>
  );
}

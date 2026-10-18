import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { localSession } from '../../local/session';
import { Style } from '../../styles/Style';

// Shown while the browser says offline, and while the sync engine's probe cannot reach the server
// although the browser says online (captive Wi-Fi): the probe is bounded at 3 s and runs on the
// offline event and 1 s after an edit, so the banner follows a dead network within a few seconds.
// OFFLINE-BANNER-1: a cold launch's first failed probe is only "Connecting…" (the engine retries once before it
// says unreachable), so a launch with the radio still warming never says "can't reach the server" for a server that is fine.
export function OfflineBanner() {
  const online = useOnlineStatus();
  const state = localSession.value?.engine.state.value;
  // The sync engine's waiting edits: the one outbox.
  const pendingCount = state?.pending ?? 0;
  const unreachable = state?.reachability === 'unreachable';
  // the browser saying offline outranks the engine's own state
  const connecting = state?.reachability === 'connecting' && online.value;

  if (online.value && !unreachable && !connecting) return null;

  return (
    <div class={`offline-banner ${connecting ? 'offline-banner--connecting' : ''}`} role="status" aria-live="polite">
      {connecting ? (
        <span class="offline-banner__dot" aria-hidden="true" />
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="1" y1="1" x2="23" y2="23" />
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
          <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
          <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
          <line x1="12" y1="20" x2="12.01" y2="20" />
        </svg>
      )}
      <span>
        {connecting ? 'Connecting…' : online.value ? "Can't reach the server — showing what's on this device" : "You're offline — showing what's on this device"}
        {pendingCount > 0 && ` (${pendingCount} pending ${pendingCount === 1 ? 'change' : 'changes'})`}
      </span>

      <Style css={`
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

        /* a launch still reaching the server: calm, not the warning colour */
        .offline-banner--connecting {
          background: var(--surface-tertiary);
          color: var(--text-secondary);
        }

        .offline-banner__dot {
          flex-shrink: 0;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: currentColor;
          animation: offline-banner-pulse 1s ease-in-out infinite;
        }

        @keyframes offline-banner-pulse {
          50% { opacity: 0.25; }
        }

        @media (prefers-reduced-motion: reduce) {
          .offline-banner__dot { animation: none; }
        }
      `} />
    </div>
  );
}

import { useState } from 'preact/hooks';
import { wsConnected } from '../../services/websocket';

/**
 * Tiny colored dot indicating WebSocket connection state.
 * Green = connected, red = disconnected.
 * Tap to toggle a brief label.
 */
export function ConnectionStatus() {
  const [showLabel, setShowLabel] = useState(false);
  const connected = wsConnected.value;

  return (
    <button
      type="button"
      class="connection-status"
      onClick={() => setShowLabel((v) => !v)}
      aria-label={connected ? 'Connected' : 'Disconnected'}
    >
      <span
        class="connection-status__dot"
        style={{ background: connected ? 'var(--accent-success, #22c55e)' : 'var(--accent-danger, #ef4444)' }}
      />
      {showLabel && (
        <span class="connection-status__label">
          {connected ? 'Live' : 'Offline'}
        </span>
      )}

      <style>{`
        .connection-status {
          display: inline-flex;
          align-items: center;
          gap: var(--space-1, 4px);
          background: none;
          border: none;
          padding: var(--space-1, 4px);
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }

        .connection-status__dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
          transition: background 0.3s ease;
        }

        .connection-status__label {
          font-size: var(--font-xs, 12px);
          color: var(--text-secondary);
          white-space: nowrap;
        }
      `}</style>
    </button>
  );
}

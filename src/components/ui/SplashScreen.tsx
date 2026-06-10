import { useState, useEffect } from 'preact/hooks';

interface SplashScreenProps {
  /** How long to show the splash after marking ready (ms) */
  fadeDuration?: number;
  /** Called when splash fully disappears */
  onDone?: () => void;
}

/**
 * Full-screen splash with the app logo.
 * Call markReady() to begin the fade-out transition.
 */
export function SplashScreen({ fadeDuration = 400, onDone }: SplashScreenProps) {
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    // Mark ready after a short delay to ensure paint
    const id = setTimeout(() => setReady(true), 100);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(() => {
      setVisible(false);
      onDone?.();
    }, fadeDuration);
    return () => clearTimeout(id);
  }, [ready, fadeDuration, onDone]);

  if (!visible) return null;

  return (
    <div
      class="splash-screen"
      style={{
        opacity: ready ? 0 : 1,
        transition: `opacity ${fadeDuration}ms var(--ease-out)`,
      }}
    >
      <div class="splash-screen__content">
        <svg class="splash-screen__logo" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--brand-500)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
        <span class="splash-screen__name">FigureCollecting</span>
      </div>

      <style>{`
        .splash-screen {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--surface-primary);
          pointer-events: none;
        }

        .splash-screen__content {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-4);
        }

        .splash-screen__logo {
          animation: splash-pulse 1.5s ease-in-out infinite;
        }

        .splash-screen__name {
          font-size: var(--font-xl);
          font-weight: var(--font-weight-bold);
          color: var(--text-primary);
          letter-spacing: -0.01em;
        }

        @keyframes splash-pulse {
          0%, 100% { opacity: 0.7; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }
      `}</style>
    </div>
  );
}

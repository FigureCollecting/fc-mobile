import { useLocation } from 'wouter';

interface GatedScreenProps {
  /** Display name of the gated feature (e.g. "Price Tracker"). */
  feature: string;
}

/**
 * Placeholder for desktop features gated OFF on mobile until each gets its
 * own condensation pass. Deep links still land here (no dead routes), but
 * nothing in the primary navigation points at these screens.
 */
export function GatedScreen({ feature }: GatedScreenProps) {
  const [, setLocation] = useLocation();

  return (
    <div class="gated-screen">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="10" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      <p class="gated-screen__feature">{feature}</p>
      <p class="gated-screen__note">
        Not in the mobile app yet — it arrives with its own mobile-first redesign.
      </p>
      <button class="gated-screen__back" type="button" onClick={() => setLocation('/')}>
        Back to Collection
      </button>

      <style>{`
        .gated-screen {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: var(--space-stack);
          min-height: 60vh;
          padding: var(--space-page);
          text-align: center;
        }

        .gated-screen__feature {
          font-size: var(--font-lg);
          font-weight: var(--font-weight-semibold);
          color: var(--text-primary);
          margin-top: var(--space-2);
        }

        .gated-screen__note {
          font-size: var(--font-sm);
          color: var(--text-secondary);
          line-height: var(--line-height-ui);
          max-width: 300px;
        }

        .gated-screen__back {
          margin-top: var(--space-4);
          min-height: var(--touch-min);
          padding: var(--space-2) var(--space-5);
          background: var(--brand-500);
          color: white;
          border-radius: var(--radius-md);
          font-size: var(--font-sm);
          font-weight: var(--font-weight-semibold);
        }

        .gated-screen__back:active {
          background: var(--brand-600);
        }
      `}</style>
    </div>
  );
}

import { Header } from '../components/layout/Header';

export function Profile() {
  return (
    <div class="page-profile">
      <Header title="Profile" />
      <div class="page-profile__content">
        <div class="page-profile__avatar">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M5.5 21a8.5 8.5 0 0 1 13 0" />
          </svg>
        </div>
        <h2 class="page-profile__greeting">Welcome, Collector</h2>
        <p class="page-profile__subtitle">Sign in to sync your data</p>

        <button class="page-profile__button" type="button">
          Sign In
        </button>

        <div class="page-profile__section">
          <h3 class="page-profile__section-title">Settings</h3>
          <div class="page-profile__option">
            <span>Sync Status</span>
            <span class="page-profile__option-value">Not connected</span>
          </div>
          <div class="page-profile__option">
            <span>Cache Size</span>
            <span class="page-profile__option-value">0 MB</span>
          </div>
          <div class="page-profile__option">
            <span>Version</span>
            <span class="page-profile__option-value">0.1.0</span>
          </div>
        </div>
      </div>

      <style>{`
        .page-profile__content {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: var(--space-8) var(--space-4);
          gap: var(--space-3);
        }

        .page-profile__avatar {
          width: 80px;
          height: 80px;
          background: var(--surface-secondary);
          border-radius: var(--radius-full);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: var(--space-2);
        }

        .page-profile__greeting {
          font-size: var(--font-xl);
          font-weight: var(--font-weight-bold);
          color: var(--text-primary);
        }

        .page-profile__subtitle {
          font-size: var(--font-sm);
          color: var(--text-secondary);
        }

        .page-profile__button {
          margin-top: var(--space-4);
          padding: var(--space-3) var(--space-8);
          background: var(--brand-500);
          color: var(--text-primary);
          border-radius: var(--radius-lg);
          font-weight: var(--font-weight-semibold);
          font-size: var(--font-base);
          min-height: var(--touch-min);
          min-width: 160px;
          transition: background var(--transition-fast);
        }

        .page-profile__button:active {
          background: var(--brand-600);
        }

        .page-profile__section {
          width: 100%;
          max-width: 400px;
          margin-top: var(--space-8);
        }

        .page-profile__section-title {
          font-size: var(--font-sm);
          font-weight: var(--font-weight-semibold);
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 0 var(--space-2);
          margin-bottom: var(--space-3);
        }

        .page-profile__option {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: var(--space-4) var(--space-2);
          border-bottom: 1px solid var(--border-subtle);
          font-size: var(--font-sm);
          color: var(--text-primary);
          min-height: var(--touch-min);
        }

        .page-profile__option-value {
          color: var(--text-secondary);
        }
      `}</style>
    </div>
  );
}

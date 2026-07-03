import type { ComponentChildren } from 'preact';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  children?: ComponentChildren;
}

/**
 * Standard error state with optional retry affordance.
 * Replaces silent mock-data fallbacks across pages.
 */
export function ErrorState({
  title = 'Something went wrong',
  message = "We couldn't load this right now. Check your connection and try again.",
  onRetry,
  retryLabel = 'Retry',
  children,
}: ErrorStateProps) {
  return (
    <div class="error-state" role="alert">
      <div class="error-state__icon">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <h2 class="error-state__title">{title}</h2>
      <p class="error-state__message">{message}</p>
      {onRetry && (
        <button
          class="error-state__retry"
          type="button"
          onClick={onRetry}
        >
          {retryLabel}
        </button>
      )}
      {children}

      <style>{styles}</style>
    </div>
  );
}

/**
 * Placeholder for pages whose backend isn't live yet. No fabricated data —
 * just a clear message and a back-to-collection nudge.
 */
interface ComingSoonProps {
  feature?: string;
  onBack?: () => void;
}

export function ComingSoon({ feature = 'This feature', onBack }: ComingSoonProps) {
  return (
    <div class="error-state error-state--coming-soon" role="status">
      <div class="error-state__icon error-state__icon--muted">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      </div>
      <h2 class="error-state__title">Coming soon</h2>
      <p class="error-state__message">
        {feature} — backend not yet available.
      </p>
      {onBack && (
        <button
          class="error-state__retry"
          type="button"
          onClick={onBack}
        >
          Back to Collection
        </button>
      )}

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-12) var(--space-4);
    text-align: center;
  }

  .error-state__icon {
    padding: var(--space-4);
    background: rgba(239, 68, 68, 0.1);
    color: var(--accent-danger);
    border-radius: var(--radius-full);
    margin-bottom: var(--space-2);
  }

  .error-state__icon--muted {
    background: var(--surface-secondary);
    color: var(--text-tertiary);
  }

  .error-state__title {
    font-size: var(--font-lg);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
  }

  .error-state__message {
    font-size: var(--font-sm);
    color: var(--text-secondary);
    max-width: 320px;
    line-height: var(--line-height-normal);
  }

  .error-state__retry {
    margin-top: var(--space-3);
    min-height: var(--touch-min);
    padding: var(--space-3) var(--space-8);
    background: var(--brand-500);
    color: white;
    border-radius: var(--radius-md);
    font-size: var(--font-sm);
    font-weight: var(--font-weight-semibold);
    transition: background var(--transition-fast);
  }

  .error-state__retry:active {
    background: var(--brand-600);
  }
`;

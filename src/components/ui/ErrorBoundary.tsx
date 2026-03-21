import { Component } from 'preact';
import type { ComponentChildren } from 'preact';
import { clearAllCaches } from '../../storage/cacheManager';

interface Props {
  children: ComponentChildren;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches render errors and shows a user-friendly recovery screen.
 * Must be a class component (Preact's error boundary pattern).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error('[ErrorBoundary]', error);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleClearAndReload = async () => {
    try {
      await clearAllCaches();
    } catch {
      // Best effort
    }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div class="error-boundary">
          <div class="error-boundary__content">
            <svg class="error-boundary__icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent-danger)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>

            <h2 class="error-boundary__title">Something went wrong</h2>
            <p class="error-boundary__message">
              An unexpected error occurred. You can try again or clear the cache and reload.
            </p>

            <div class="error-boundary__actions">
              <button
                class="error-boundary__btn error-boundary__btn--primary"
                type="button"
                onClick={this.handleRetry}
              >
                Try Again
              </button>
              <button
                class="error-boundary__btn error-boundary__btn--secondary"
                type="button"
                onClick={this.handleClearAndReload}
              >
                Clear Cache & Reload
              </button>
            </div>
          </div>

          <style>{styles}</style>
        </div>
      );
    }

    return this.props.children;
  }
}

const styles = `
  .error-boundary {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100%;
    padding: var(--space-8);
    background: var(--surface-primary);
  }

  .error-boundary__content {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    max-width: 320px;
    gap: var(--space-4);
  }

  .error-boundary__icon {
    margin-bottom: var(--space-2);
  }

  .error-boundary__title {
    font-size: var(--font-xl);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
  }

  .error-boundary__message {
    font-size: var(--font-sm);
    color: var(--text-secondary);
    line-height: var(--line-height-normal);
  }

  .error-boundary__actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: 100%;
    margin-top: var(--space-2);
  }

  .error-boundary__btn {
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-lg);
    font-weight: var(--font-weight-semibold);
    font-size: var(--font-base);
    min-height: var(--touch-min);
    transition: all var(--transition-fast);
    cursor: pointer;
  }

  .error-boundary__btn--primary {
    background: var(--brand-500);
    color: white;
  }

  .error-boundary__btn--primary:active {
    background: var(--brand-600);
  }

  .error-boundary__btn--secondary {
    background: transparent;
    border: 1px solid var(--border-default);
    color: var(--text-secondary);
  }

  .error-boundary__btn--secondary:active {
    background: var(--surface-tertiary);
  }
`;

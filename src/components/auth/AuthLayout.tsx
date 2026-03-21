import { type ComponentChildren } from 'preact';

interface AuthLayoutProps {
  children: ComponentChildren;
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div class="auth-layout">
      <div class="auth-layout__inner">
        {/* Logo */}
        <div class="auth-layout__logo">
          <div class="auth-layout__logo-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--brand-500)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </div>
          <h1 class="auth-layout__app-name">Figure Collector</h1>
        </div>

        {/* Content */}
        <div class="auth-layout__content">
          {children}
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .auth-layout {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    background: var(--surface-primary);
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: var(--safe-area-top) var(--safe-area-right) var(--safe-area-bottom) var(--safe-area-left);
  }

  .auth-layout__inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    max-width: 400px;
    margin: 0 auto;
    padding: var(--space-8) var(--space-5);
    gap: var(--space-8);
  }

  .auth-layout__logo {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding-top: var(--space-8);
  }

  .auth-layout__logo-icon {
    width: 72px;
    height: 72px;
    border-radius: var(--radius-xl);
    background: var(--surface-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .auth-layout__app-name {
    font-size: var(--font-2xl);
    font-weight: var(--font-weight-bold);
    color: var(--text-primary);
    line-height: var(--line-height-tight);
  }

  .auth-layout__content {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }
`;

import type { ReadonlySignal } from '@preact/signals';
import { useLocation } from 'wouter';
import type { AuthStatus } from '../../auth/session';
import { Style } from '../../styles/Style';

export interface SyncAuthBannerProps {
  session: { status: ReadonlySignal<AuthStatus>; signIn(returnTo?: string): Promise<void> };
}

// In-place prompt: an auth problem never navigates away from what the user is looking at.
export function SyncAuthBanner({ session }: SyncAuthBannerProps) {
  const [location] = useLocation();
  const status = session.status.value;
  if (status !== 'signed-out' && status !== 'reauth-required') return null;

  return (
    <div class="sync-auth-banner" role="status" aria-live="polite">
      <span>
        {status === 'reauth-required'
          ? 'Sign in to sync. Your changes are kept on this device until then.'
          : 'Sign in to sync your collection.'}
      </span>
      <button type="button" class="sync-auth-banner__button" onClick={() => void session.signIn(location)}>
        Sign in
      </button>

      <Style css={`
        .sync-auth-banner {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 8px 16px;
          background: var(--brand-600, #0552b5);
          color: #fff;
          font-size: 13px;
          font-weight: 500;
          flex-shrink: 0;
        }
        .sync-auth-banner__button {
          padding: 4px 12px;
          border-radius: 999px;
          border: 1px solid currentColor;
          background: transparent;
          color: inherit;
          font: inherit;
        }
      `} />
    </div>
  );
}

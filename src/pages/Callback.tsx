import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'wouter';
import { LoginError } from '../auth/errors';
import type { AuthStatus } from '../auth/session';

export interface CallbackProps {
  session: {
    completeSignIn(url: string): Promise<{ returnTo: string }>;
    signIn(returnTo?: string): Promise<void>;
    start(): Promise<AuthStatus>;
  };
  url?: string;
}

// The OIDC redirect target. Replaces itself in history so the code never
// lingers; a failure stays here with a retry rather than bouncing anywhere.
export function Callback({ session, url = window.location.href }: CallbackProps) {
  const [, setLocation] = useLocation();
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const { returnTo } = await session.completeSignIn(url);
        if (live) setLocation(returnTo, { replace: true });
      } catch (err) {
        // A reload of /callback after it already worked: the state is spent, the session is fine.
        if (err instanceof LoginError && err.code === 'unknown_state' && (await session.start()) === 'signed-in') {
          if (live) setLocation('/', { replace: true });
          return;
        }
        if (live) setFailure((err as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [session, url, setLocation]);

  return (
    <div class="callback-page">
      {failure === undefined ? (
        <p>Signing you in…</p>
      ) : (
        <>
          <p>Sign-in did not finish.</p>
          <p class="callback-page__detail">{failure}</p>
          <button type="button" onClick={() => void session.signIn('/')}>
            Try again
          </button>
        </>
      )}
      <style>{`
        .callback-page {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          padding: var(--space-12, 48px) var(--space-4, 16px);
          text-align: center;
        }
        .callback-page__detail {
          color: var(--text-secondary, #888);
          font-size: 13px;
        }
      `}</style>
    </div>
  );
}

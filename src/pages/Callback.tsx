import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'wouter';
import { LoginError, ReloadRequiredError } from '../auth/errors';
import type { AuthStatus } from '../auth/session';
import { reloadToLatest } from '../pwa/updates';
import { Style } from '../styles/Style';

export interface CallbackProps {
  session: {
    completeSignIn(url: string): Promise<{ returnTo: string }>;
    signIn(returnTo?: string): Promise<void>;
    start(): Promise<AuthStatus>;
  };
  url?: string;
  /** Reload the page into the newest build. */
  reload?: () => void;
}

interface Failure {
  detail: string;
  returnTo: string;
  /** A newer build owns the local store: only a reload helps, not another sign-in. */
  reload?: true;
}

const reloadLatest = (): void => void reloadToLatest();

function failureOf(err: unknown): Failure {
  if (err instanceof ReloadRequiredError) {
    return { detail: 'This page needs a reload to keep syncing. Your changes are kept on this device.', returnTo: '/', reload: true };
  }
  if (!(err instanceof LoginError)) return { detail: (err as Error).message, returnTo: '/' };
  // A spent or crafted link: say nothing it said.
  if (err.code === 'unknown_state') return { detail: 'This sign-in link has expired or was already used.', returnTo: '/' };
  return { detail: err.message, returnTo: err.returnTo ?? '/' };
}

// The OIDC redirect target. Replaces itself in history so the code never lingers.
// A failure stays here with a retry and a way back that needs no network.
export function Callback({ session, url = window.location.href, reload = reloadLatest }: CallbackProps) {
  const [, setLocation] = useLocation();
  const [failure, setFailure] = useState<Failure>();

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const { returnTo } = await session.completeSignIn(url);
        if (live) setLocation(returnTo, { replace: true });
      } catch (err) {
        let failed = err;
        // A reload of /callback after it already worked: the state is spent, the session is fine.
        if (err instanceof LoginError && err.code === 'unknown_state') {
          try {
            if ((await session.start()) === 'signed-in') {
              if (live) setLocation('/', { replace: true });
              return;
            }
          } catch (startErr) {
            // The session cannot start (a newer build took the store): that is what to show.
            failed = startErr;
          }
        }
        if (live) setFailure(failureOf(failed));
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
          <p class="callback-page__detail">{failure.detail}</p>
          {failure.reload === true ? (
            <button type="button" onClick={reload}>
              Reload
            </button>
          ) : (
            <button type="button" onClick={() => void session.signIn(failure.returnTo).catch((err: unknown) => setFailure(failureOf(err)))}>
              Try again
            </button>
          )}
          <button type="button" onClick={() => setLocation(failure.returnTo, { replace: true })}>
            Back to your collection
          </button>
        </>
      )}
      <Style css={`
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
      `} />
    </div>
  );
}

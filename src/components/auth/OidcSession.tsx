import { useEffect } from 'preact/hooks';
import { useLocation } from 'wouter';
import { getAuthSession } from '../../auth';
import { SyncAuthBanner } from './SyncAuthBanner';

// The OIDC build's stand-in for the legacy /login redirect: start the session
// and show the sign-in-to-sync banner. Lazy-loaded, so legacy builds never ship it.
export default function OidcSession() {
  const session = getAuthSession();
  const [location] = useLocation();

  useEffect(() => {
    void session.start();
    if (import.meta.env.VITE_E2E_HOOKS === 'true') {
      void import('../../auth/e2eHooks').then((m) => m.installE2eHooks(session));
    }
  }, [session]);

  return location === '/callback' ? null : <SyncAuthBanner session={session} />;
}

import { useEffect } from 'preact/hooks';
import { useLocation } from 'wouter';
import { getAuthSession } from '../../auth';
import { reloadToLatest } from '../../pwa/updates';
import { SyncAuthBanner } from './SyncAuthBanner';

const reload = (): void => void reloadToLatest();

// The OIDC build's stand-in for the legacy /login redirect: start the session
// and show the sign-in-to-sync banner. Lazy-loaded, so legacy builds never ship it.
export default function OidcSession() {
  const session = getAuthSession();
  const [location] = useLocation();

  useEffect(() => {
    // boot() never rejects: a store this build cannot open shows the reload banner.
    void session.boot();
    if (import.meta.env.VITE_E2E_HOOKS === 'true') {
      void import('../../auth/e2eHooks').then((m) => m.installE2eHooks(session));
    }
  }, [session]);

  return location === '/callback' ? null : <SyncAuthBanner session={session} reload={reload} />;
}

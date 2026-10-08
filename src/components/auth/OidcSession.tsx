import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'wouter';
import { getAuthSession } from '../../auth';
import { reloadToLatest } from '../../pwa/updates';
import { startBrowserSync, type BrowserSync } from '../../sync/browser';
import { SyncStatusLine } from '../sync/SyncStatusLine';
import { SyncAuthBanner } from './SyncAuthBanner';

const reload = (): void => void reloadToLatest();

// The OIDC build's stand-in for the legacy /login redirect: start the session and the page's
// sync, and show the sign-in-to-sync banner and what sync is doing. Lazy-loaded, so legacy
// builds never ship it.
export default function OidcSession() {
  const session = getAuthSession();
  const [location] = useLocation();
  const [sync, setSync] = useState<BrowserSync>();

  useEffect(() => {
    // boot() never rejects: a store this build cannot open shows the reload banner.
    void session.boot();
    const e2e = import.meta.env.VITE_E2E_HOOKS === 'true';
    if (e2e) void import('../../auth/e2eHooks').then((m) => m.installE2eHooks(session));
    // The stack's auth suite counts the edge's requests exactly and turns sync off; only an e2e build reads the switch.
    if (e2e && localStorage.getItem('fc.e2e.sync') === 'off') return;
    // Sync holds until the session can sync, and queues edits meanwhile.
    const started = startBrowserSync(session);
    setSync(started);
    if (e2e) void import('../../sync/e2eHooks').then((m) => m.installSyncHooks(started.engine));
  }, [session]);

  if (location === '/callback') return null;
  return (
    <>
      <SyncAuthBanner session={session} reload={reload} />
      {sync !== undefined && <SyncStatusLine state={sync.engine.state} onDismissRejected={() => void sync.engine.dismissRejected()} />}
    </>
  );
}

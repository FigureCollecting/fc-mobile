import { useState, useCallback, useRef } from 'preact/hooks';
import { lazy, Suspense } from 'preact/compat';
import { useLocation } from 'wouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from './components/layout/AppShell';
import { ToastContainer } from './components/ui/Toast';
import { Onboarding } from './pages/Onboarding';
import { Privacy } from './pages/Privacy';
import { isFixtureMode } from './dev-fixtures/fixtures';
import { UpdatePrompt } from './pwa/UpdatePrompt';
import { UpdatedNotice } from './pwa/UpdatedNotice';

// Sign-in is OIDC + PKCE + DPoP against Authentik (src/auth), which owns registration and second
// factors; the session publishes the page's sync to the screens. Lazy, so the first paint does not
// wait for it. Dev fixture mode runs fully offline with no session at all.
const OidcSession = lazy(() => import('./components/auth/OidcSession'));

const ONBOARDING_KEY = 'onboarding_complete';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 60_000,
      gcTime: 1000 * 60 * 30, // 30 min garbage collection
      networkMode: 'offlineFirst',
    },
  },
});

/** /privacy as it gets typed or pasted: in any letter case, with or without slashes after it. */
function isPrivacyAddress(location: string): boolean {
  let end = location.length;
  while (end > 1 && location[end - 1] === '/') end -= 1;
  return location.slice(0, end).toLowerCase() === '/privacy';
}

function AppInner() {
  // Shown once (tracked in localStorage); fixture mode skips it so dev boots into the fixtures.
  const [showOnboarding, setShowOnboarding] = useState(() => !isFixtureMode() && !localStorage.getItem(ONBOARDING_KEY));
  const [location, setLocation] = useLocation();
  // Set once the app's frame has been drawn: from then a session may be syncing, and it is never taken down.
  const appUp = useRef(false);

  const handleOnboardingComplete = useCallback(
    (action: 'register' | 'login' | 'guest') => {
      localStorage.setItem(ONBOARDING_KEY, '1');
      setShowOnboarding(false);
      setLocation('/');
      // Authentik's own pages create the account or sign in; the collection is where it lands.
      if (action !== 'guest') void import('./auth').then((m) => m.getAuthSession().signIn('/').catch(() => undefined));
    },
    [setLocation],
  );

  // P1: /privacy opened by its address, or from the onboarding, is the page alone. Anyone can read it: it waits for
  // no account, starts no session and asks the server for nothing. Inside the running app it is a screen (AppShell).
  if (isPrivacyAddress(location) && !appUp.current) {
    return <Privacy standalone />;
  }

  if (showOnboarding) {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

  appUp.current = true;
  return (
    <>
      {!isFixtureMode() && (
        <Suspense fallback={null}>
          <OidcSession />
        </Suspense>
      )}
      <AppShell />
    </>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppInner />
      <ToastContainer />
      {/* Outside AppInner so it shows over onboarding too. The iOS install
          banner sits in AppShell's layout instead. */}
      <div class="pwa-notices">
        <UpdatePrompt />
        <UpdatedNotice />
      </div>
    </QueryClientProvider>
  );
}

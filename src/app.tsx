import { useState, useCallback } from 'preact/hooks';
import { lazy, Suspense } from 'preact/compat';
import { useLocation } from 'wouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from './components/layout/AppShell';
import { ToastContainer } from './components/ui/Toast';
import { Onboarding } from './pages/Onboarding';
import { isFixtureMode } from './dev-fixtures/fixtures';
import { UpdatePrompt } from './pwa/UpdatePrompt';

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

function AppInner() {
  // Shown once (tracked in localStorage); fixture mode skips it so dev boots into the fixtures.
  const [showOnboarding, setShowOnboarding] = useState(() => !isFixtureMode() && !localStorage.getItem(ONBOARDING_KEY));
  const [, setLocation] = useLocation();

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

  if (showOnboarding) {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

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
      </div>
    </QueryClientProvider>
  );
}

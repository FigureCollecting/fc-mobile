import { useState, useEffect, useCallback } from 'preact/hooks';
import { useLocation } from 'wouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from './components/layout/AppShell';
import { ToastContainer } from './components/ui/Toast';
import { useSyncOnReconnect } from './hooks/useSyncOnReconnect';
import { useWebSocket } from './hooks/useWebSocket';
import { useLiveCollection } from './hooks/useLiveCollection';
import { useLiveNotifications } from './hooks/useLiveNotifications';
import { useAuthStore } from './stores/auth';
import { Onboarding } from './pages/Onboarding';
import { isFixtureMode } from './dev-fixtures/fixtures';

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

const PUBLIC_ROUTES = ['/login', '/register', '/2fa'];

function AuthRedirect() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [location, setLocation] = useLocation();

  useEffect(() => {
    // Dev fixture mode runs fully offline with no real auth — never bounce to
    // login, so `npm run dev` lands straight on the collection.
    if (isFixtureMode()) return;
    // If not authenticated and not on a public route, redirect to login
    if (!isAuthenticated && !PUBLIC_ROUTES.includes(location)) {
      setLocation('/login');
    }
    // If authenticated and on /login or /register, redirect home. /2fa is
    // intentionally omitted: the user is mid-auth there and doesn't yet have
    // a full token.
    if (isAuthenticated && (location === '/login' || location === '/register')) {
      setLocation('/');
    }
  }, [isAuthenticated, location, setLocation]);

  return null;
}

function AppInner() {
  useWebSocket();
  useLiveCollection();
  useLiveNotifications();
  useSyncOnReconnect();

  // Onboarding policy:
  // - If the user already has a token, skip onboarding entirely and persist
  //   the "done" flag so returning users don't see it on future launches.
  // - Otherwise show it once (tracked via localStorage).
  const [showOnboarding, setShowOnboarding] = useState(() => {
    // Fixture mode skips onboarding too, so dev boots directly into fixtures.
    if (isFixtureMode()) return false;
    const hasToken = !!useAuthStore.getState().user?.token;
    if (hasToken) {
      if (!localStorage.getItem(ONBOARDING_KEY)) {
        localStorage.setItem(ONBOARDING_KEY, '1');
      }
      return false;
    }
    return !localStorage.getItem(ONBOARDING_KEY);
  });
  const [, setLocation] = useLocation();

  const handleOnboardingComplete = useCallback(
    (action: 'register' | 'login' | 'guest') => {
      localStorage.setItem(ONBOARDING_KEY, '1');
      setShowOnboarding(false);

      switch (action) {
        case 'register':
          setLocation('/register');
          break;
        case 'login':
          setLocation('/login');
          break;
        case 'guest':
          // Stay on collection — AuthRedirect will handle if needed
          setLocation('/');
          break;
      }
    },
    [setLocation],
  );

  if (showOnboarding) {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

  return (
    <>
      <AuthRedirect />
      <AppShell />
    </>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppInner />
      <ToastContainer />
    </QueryClientProvider>
  );
}

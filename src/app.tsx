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

const PUBLIC_ROUTES = ['/login', '/register'];

function AuthRedirect() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [location, setLocation] = useLocation();

  useEffect(() => {
    // If not authenticated and not on a public route, redirect to login
    if (!isAuthenticated && !PUBLIC_ROUTES.includes(location)) {
      setLocation('/login');
    }
    // If authenticated and on an auth route, redirect to collection
    if (isAuthenticated && PUBLIC_ROUTES.includes(location)) {
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

  const [showOnboarding, setShowOnboarding] = useState(
    () => !localStorage.getItem(ONBOARDING_KEY),
  );
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

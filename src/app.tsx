import { useEffect } from 'preact/hooks';
import { useLocation } from 'wouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from './components/layout/AppShell';
import { useSyncOnReconnect } from './hooks/useSyncOnReconnect';
import { useAuthStore } from './stores/auth';

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
  useSyncOnReconnect();
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
    </QueryClientProvider>
  );
}

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from './components/layout/AppShell';
import { useSyncOnReconnect } from './hooks/useSyncOnReconnect';

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
  useSyncOnReconnect();
  return <AppShell />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppInner />
    </QueryClientProvider>
  );
}

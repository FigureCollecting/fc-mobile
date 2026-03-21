import { useEffect } from 'preact/hooks';
import { useLocation } from 'wouter';
import { useAuthStore } from '../stores/auth';

/**
 * Redirects unauthenticated users to /login.
 * Returns true if the user is authenticated.
 */
export function useAuthGuard(): boolean {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isAuthenticated) {
      setLocation('/login');
    }
  }, [isAuthenticated, setLocation]);

  return isAuthenticated;
}

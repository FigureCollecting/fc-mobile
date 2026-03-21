// Re-export the shared auth store, configured for mobile
import {
  useAuthStore as useSharedAuthStore,
  configureAuthStore,
} from '@figurecollecting/fc-shared';
import type { AuthState } from '@figurecollecting/fc-shared';

// Configure for mobile (no cookie clearing needed, no theme sync)
configureAuthStore({
  onLogout: () => {
    console.log('Logged out — clearing mobile cache');
  },
});

export { useSharedAuthStore as useAuthStore };
export type { AuthState };

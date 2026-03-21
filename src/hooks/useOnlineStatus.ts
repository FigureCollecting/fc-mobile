import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';

const isOnline = signal(typeof navigator !== 'undefined' ? navigator.onLine : true);

export function useOnlineStatus() {
  useEffect(() => {
    const handleOnline = () => {
      isOnline.value = true;
    };
    const handleOffline = () => {
      isOnline.value = false;
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

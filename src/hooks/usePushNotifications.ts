import { useState, useEffect, useCallback } from 'preact/hooks';
import { api } from '../api/client';

/**
 * Hook for managing Web Push notification subscriptions.
 *
 * Provides permission state, subscription status, and controls
 * to request/revoke notification permissions.
 *
 * Usage: Call requestPermission() after a meaningful user interaction,
 * not on page load.
 */
export function usePushNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default',
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  // Check current subscription status on mount
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    navigator.serviceWorker.ready.then(async (registration) => {
      const existing = await registration.pushManager.getSubscription();
      setIsSubscribed(!!existing);
    }).catch(() => {
      // Service worker not ready yet
    });
  }, []);

  const subscribe = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('[Push] Push notifications not supported');
      return;
    }

    setLoading(true);
    try {
      // Fetch VAPID public key from backend
      const { data: vapidData } = await api.get<{ success: boolean; vapidPublicKey: string }>(
        '/push/vapid-key',
      );

      if (!vapidData.success || !vapidData.vapidPublicKey) {
        console.warn('[Push] Push notifications not configured on server');
        return;
      }

      const registration = await navigator.serviceWorker.ready;

      // Convert VAPID key to Uint8Array
      const applicationServerKey = urlBase64ToUint8Array(vapidData.vapidPublicKey);

      // Subscribe via the Push API
      const pushSubscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
      });

      const subscriptionJson = pushSubscription.toJSON();

      // Send subscription to backend
      await api.post('/push/subscribe', {
        endpoint: subscriptionJson.endpoint,
        keys: {
          p256dh: subscriptionJson.keys?.p256dh,
          auth: subscriptionJson.keys?.auth,
        },
        userAgent: navigator.userAgent,
      });

      setIsSubscribed(true);
    } catch (err) {
      console.error('[Push] Failed to subscribe:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return;

    const result = await Notification.requestPermission();
    setPermission(result);

    if (result === 'granted') {
      await subscribe();
    }
  }, [subscribe]);

  const unsubscribe = useCallback(async () => {
    if (!('serviceWorker' in navigator)) return;

    setLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        const endpoint = subscription.endpoint;

        // Unsubscribe from push manager
        await subscription.unsubscribe();

        // Remove from backend (axios DELETE with body requires { data })
        await api.delete('/push/unsubscribe', { data: { endpoint } });
      }

      setIsSubscribed(false);
    } catch (err) {
      console.error('[Push] Failed to unsubscribe:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    permission,
    isSubscribed,
    loading,
    requestPermission,
    unsubscribe,
    /** Whether the browser supports push notifications */
    isSupported: typeof window !== 'undefined' && 'PushManager' in window,
  };
}

/**
 * Convert a base64url-encoded string to a Uint8Array
 * (needed for applicationServerKey)
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

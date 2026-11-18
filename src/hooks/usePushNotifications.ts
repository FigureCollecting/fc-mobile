import { useState, useEffect, useCallback } from 'preact/hooks';

/**
 * The browser's notification permission and push subscription.
 *
 * No server holds push subscriptions, so nothing here sends a request: requestPermission asks the
 * browser and stops there, and unsubscribe drops a subscription the browser still holds.
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
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.ready.then(async (registration) => {
      const existing = await registration.pushManager.getSubscription();
      setIsSubscribed(!!existing);
    }).catch(() => {
      // Service worker not ready yet
    });
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return;

    setPermission(await Notification.requestPermission());
  }, []);

  const unsubscribe = useCallback(async () => {
    if (!('serviceWorker' in navigator)) return;

    setLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) await subscription.unsubscribe();

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

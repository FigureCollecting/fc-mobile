import { useEffect } from 'preact/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '../services/websocket';
import { showToast } from '../stores/toast';

interface NotificationEvent {
  type: string;
  title: string;
  body?: string;
}

/**
 * Listen for real-time notification events via WebSocket.
 * Invalidates notification queries and shows toasts for price alerts.
 */
export function useLiveNotifications() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleNew = (data: NotificationEvent) => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });

      if (data.type === 'price_alert') {
        showToast(data.title, 'info');
      }
    };

    const handleUpdate = () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    };

    socket.on('notification:new', handleNew);
    socket.on('notification:update', handleUpdate);
    socket.on('notification:deleted', handleUpdate);

    return () => {
      socket.off('notification:new', handleNew);
      socket.off('notification:update', handleUpdate);
      socket.off('notification:deleted', handleUpdate);
    };
  }, [queryClient]);
}

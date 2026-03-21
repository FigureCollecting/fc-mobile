import { useEffect } from 'preact/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '../services/websocket';
import { showToast } from '../stores/toast';

/**
 * Listen for real-time collection changes via WebSocket.
 * Invalidates relevant queries and shows toast notifications.
 */
export function useLiveCollection() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleUpdate = (data: { action: string; figure: { name?: string } }) => {
      // Invalidate collection queries to refetch
      queryClient.invalidateQueries({ queryKey: ['figures'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });

      const name = data.figure?.name ?? 'figure';
      if (data.action === 'created') showToast(`Added: ${name}`, 'success');
      if (data.action === 'deleted') showToast(`Removed: ${name}`, 'info');
      if (data.action === 'updated') showToast(`Updated: ${name}`, 'info');
    };

    socket.on('collection:update', handleUpdate);
    return () => {
      socket.off('collection:update', handleUpdate);
    };
  }, [queryClient]);
}

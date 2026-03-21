import { useEffect } from 'preact/hooks';
import { useAuthStore } from '../stores/auth';
import {
  connectWebSocket,
  disconnectWebSocket,
  wsConnected,
} from '../services/websocket';

export function useWebSocket() {
  const token = useAuthStore((s) => s.user?.token);

  useEffect(() => {
    if (token) {
      connectWebSocket(token);
    }
    return () => disconnectWebSocket();
  }, [token]);

  return { connected: wsConnected };
}

import { useState, useEffect } from 'preact/hooks';
import { getSocket } from '../services/websocket';

export interface LiveSyncEvent {
  type: string;
  phase?: string;
  progress?: number;
  total?: number;
  message?: string;
  timestamp: number;
}

/**
 * Subscribe to real-time sync events for a specific session.
 * Returns the accumulated event log for display.
 */
export function useLiveSync(sessionId: string | null) {
  const [events, setEvents] = useState<LiveSyncEvent[]>([]);

  useEffect(() => {
    if (!sessionId) return;
    const socket = getSocket();
    if (!socket) return;

    socket.emit('sync:subscribe', sessionId);

    const handleEvent = (data: LiveSyncEvent) => {
      setEvents((prev) => [...prev, { ...data, timestamp: Date.now() }]);
    };

    socket.on('sync:phase-change', handleEvent);
    socket.on('sync:item-update', handleEvent);
    socket.on('sync:complete', handleEvent);

    return () => {
      socket.off('sync:phase-change', handleEvent);
      socket.off('sync:item-update', handleEvent);
      socket.off('sync:complete', handleEvent);
      socket.emit('sync:unsubscribe', sessionId);
    };
  }, [sessionId]);

  return events;
}

import { io, Socket } from 'socket.io-client';
import { signal } from '@preact/signals';

const API_URL = import.meta.env.VITE_API_URL || 'https://figurecollecting.com';

// Connection state as a signal for reactive UI
export const wsConnected = signal(false);

let socket: Socket | null = null;

export function connectWebSocket(token: string): Socket {
  if (socket?.connected) return socket;

  socket = io(API_URL, {
    path: '/ws',
    auth: { token },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    reconnectionAttempts: Infinity,
    transports: ['websocket', 'polling'],
  });

  socket.on('connect', () => {
    wsConnected.value = true;
    console.log('[WS] Connected');
  });

  socket.on('disconnect', () => {
    wsConnected.value = false;
    console.log('[WS] Disconnected');
  });

  return socket;
}

export function disconnectWebSocket(): void {
  socket?.disconnect();
  socket = null;
  wsConnected.value = false;
}

export function getSocket(): Socket | null {
  return socket;
}

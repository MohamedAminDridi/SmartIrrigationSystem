import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';

export function useSocket(farmId, handlers = {}) {
  const token  = useAuthStore(s => s.token);
  const socket = useRef(null);

  useEffect(() => {
    // Don't connect if not logged in — avoids the invalid URL error
    if (!token) return;

    // Dev  (VITE_API_URL unset): same-origin → Vite proxy → backend:5000
    // Prod (VITE_API_URL set) : connects directly to the public backend URL
    socket.current = io(import.meta.env.VITE_API_URL || undefined, {
      auth:       { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay:    2000,
    });

    socket.current.on('connect', () => {
      if (farmId) socket.current.emit('join:farm', farmId);
    });

    socket.current.on('connect_error', (err) => {
      console.warn('Socket connection error:', err.message);
    });

    // Register all event handlers
    Object.entries(handlers).forEach(([event, fn]) => {
      socket.current.on(event, fn);
    });

    return () => {
      if (farmId) socket.current.emit('leave:farm', farmId);
      socket.current.disconnect();
      socket.current = null;
    };
  }, [farmId, token]);

  return socket;
}
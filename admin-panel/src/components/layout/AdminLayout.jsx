import { Outlet }       from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { io }           from 'socket.io-client';
import Sidebar          from './Sidebar';
import TopBar           from './TopBar';
import api              from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useAlertStore } from '../../store/alertStore';

// ── Severity styles ───────────────────────────────────────────────
const TOAST_STYLE = {
  critical: 'bg-red-600   border-red-700   text-white',
  warning:  'bg-yellow-500 border-yellow-600 text-white',
  info:     'bg-blue-600  border-blue-700   text-white',
};
const TOAST_ICON = { critical: '🚨', warning: '⚠️', info: 'ℹ️' };

function AlertToast({ toast, onClose }) {
  useEffect(() => {
    const t = setTimeout(() => onClose(toast._toastId), 6000);
    return () => clearTimeout(t);
  }, [toast._toastId]);

  const style = TOAST_STYLE[toast.severity] || TOAST_STYLE.warning;
  const icon  = TOAST_ICON[toast.severity]  || '🔔';

  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border shadow-xl max-w-sm w-full
                     transition-all duration-300 ${style}`}>
      <span className="text-xl leading-none mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold uppercase opacity-80 mb-0.5">
          {toast.severity} alert
        </p>
        <p className="text-sm font-medium leading-snug">{toast.message}</p>
      </div>
      <button onClick={() => onClose(toast._toastId)}
        className="opacity-70 hover:opacity-100 text-lg leading-none mt-0.5">×</button>
    </div>
  );
}

// ── Main layout ───────────────────────────────────────────────────
export default function AdminLayout() {
  const { token }                                  = useAuthStore();
  const { setUnreadCount, incrementUnread,
          addToast, toasts, removeToast }           = useAlertStore();
  const socketRef = useRef(null);

  useEffect(() => {
    if (!token) return;

    // Load current unread count on mount
    api.get('/alerts?acknowledged=false&limit=200')
      .then(r => setUnreadCount((r.data.data || []).length))
      .catch(() => {});

    // Connect socket and join all farm rooms
    api.get('/farms').then(r => {
      const farms = r.data.data?.farms || [];
      if (!farms.length) return;

      const socket = io(import.meta.env.VITE_API_URL || undefined, {
        auth:       { token },
        transports: ['websocket', 'polling'],
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        farms.forEach(f => socket.emit('join:farm', f._id));
      });

      socket.on('alert:new', (alert) => {
        incrementUnread();
        addToast(alert);
      });
    }).catch(() => {});

    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>

      {/* ── Toast stack (bottom-right) ── */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 items-end pointer-events-none">
        {toasts.map(t => (
          <div key={t._toastId} className="pointer-events-auto">
            <AlertToast toast={t} onClose={removeToast} />
          </div>
        ))}
      </div>
    </div>
  );
}

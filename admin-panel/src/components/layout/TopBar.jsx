import { useAuthStore }  from '../../store/authStore';
import { useAlertStore }  from '../../store/alertStore';
import { useNavigate, Link } from 'react-router-dom';

export default function TopBar() {
  const { user, logout } = useAuthStore();
  const unreadCount      = useAlertStore(s => s.unreadCount);
  const nav = useNavigate();

  const handleLogout = () => { logout(); nav('/login'); };

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
      <div />
      <div className="flex items-center gap-4">

        {/* Bell icon with unread badge */}
        <Link to="/alerts" className="relative text-gray-500 hover:text-gray-800 transition-colors">
          <span className="text-xl">🔔</span>
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white
                             text-[10px] font-bold px-1 rounded-full min-w-[1rem]
                             text-center leading-tight">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>

        <span className="text-sm text-gray-600">{user?.name || 'Admin'}</span>
        <button onClick={handleLogout}
          className="text-xs text-gray-500 hover:text-red-600 border border-gray-200
                     px-3 py-1.5 rounded-lg transition-colors">
          Logout
        </button>
      </div>
    </header>
  );
}

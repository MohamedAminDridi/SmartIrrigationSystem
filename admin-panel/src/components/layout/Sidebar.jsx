import { NavLink }       from 'react-router-dom';
import { useAlertStore } from '../../store/alertStore';

const links = [
  { to: '/dashboard',  label: 'Dashboard',    icon: '▦'  },
  { to: '/farms',      label: 'Farms',        icon: '🗺'  },
  { to: '/gateways',   label: 'Gateways',     icon: '📡'  },
  { to: '/nodes',      label: 'Nodes',        icon: '🔌'  },
  { to: '/alerts',     label: 'Alerts',       icon: '🔔', badge: true },
  { to: '/analytics',  label: 'Analytics',    icon: '📊'  },
  { to: '/twin',       label: '3D Twin',      icon: '🌐'  },
  { to: '/users',      label: 'Users',        icon: '👥'  },
  { to: '/ota',        label: 'OTA Updates',  icon: '☁'  },
  { to: '/settings',   label: 'Settings',     icon: '⚙'  },
];

export default function Sidebar() {
  const unreadCount = useAlertStore(s => s.unreadCount);

  return (
    <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
      <div className="px-5 py-4 border-b border-gray-200">
        <span className="text-green-700 font-semibold text-sm tracking-wide">💧 IrriAdmin</span>
      </div>
      <nav className="flex-1 py-3 space-y-0.5 px-2">
        {links.map(l => (
          <NavLink key={l.to} to={l.to}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive ? 'bg-green-50 text-green-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`
            }>
            <span className="text-base">{l.icon}</span>
            <span className="flex-1">{l.label}</span>
            {l.badge && unreadCount > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold
                               px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center leading-none">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

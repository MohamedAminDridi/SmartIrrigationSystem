import { useEffect, useState, useRef } from 'react';
import { io }          from 'socket.io-client';
import api             from '../services/api';
import { useAuthStore }  from '../store/authStore';
import { useAlertStore } from '../store/alertStore';

function timeAgo(date) {
  if (!date) return '—';
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 5)    return 'just now';
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)return `${Math.floor(s / 3600)}h ago`;
  return new Date(date).toLocaleDateString();
}

const SEV = {
  critical: {
    pill:   'bg-red-100 text-red-700',
    border: 'border-red-200',
    bg:     'bg-red-50',
    icon:   '🚨',
    dot:    'bg-red-500',
    badge:  'bg-red-500',
    label:  'Critical',
  },
  warning: {
    pill:   'bg-yellow-100 text-yellow-700',
    border: 'border-yellow-200',
    bg:     'bg-yellow-50',
    icon:   '⚠️',
    dot:    'bg-yellow-500',
    badge:  'bg-yellow-500',
    label:  'Warning',
  },
  info: {
    pill:   'bg-blue-100 text-blue-700',
    border: 'border-blue-200',
    bg:     'bg-blue-50',
    icon:   'ℹ️',
    dot:    'bg-blue-500',
    badge:  'bg-blue-500',
    label:  'Info',
  },
};

const TYPE_LABEL = {
  device_offline:   '📵 Offline',
  low_battery:      '🔋 Battery',
  threshold_breach: '📊 Threshold',
};

// ── Alert row ─────────────────────────────────────────────────────
function AlertRow({ alert, onAck }) {
  const s    = SEV[alert.severity] || SEV.warning;
  const acked = alert.acknowledged;

  return (
    <div className={`flex items-start gap-4 p-4 border-l-4 rounded-r-2xl transition-all ${
      acked ? `border-gray-200 bg-white` : `${s.border} ${s.bg}`
    }`}>
      {/* Icon */}
      <div className={`flex-shrink-0 w-9 h-9 rounded-2xl flex items-center justify-center text-lg ${
        acked ? 'bg-gray-100' : s.bg
      }`}>
        {acked ? '✅' : s.icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          {!acked && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.pill}`}>
              {s.label}
            </span>
          )}
          {alert.type && (
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
              {TYPE_LABEL[alert.type] || alert.type}
            </span>
          )}
          {acked && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
              ✓ Acknowledged
            </span>
          )}
        </div>
        <p className={`text-sm font-medium ${acked ? 'text-gray-400' : 'text-gray-800'}`}>
          {alert.message}
        </p>
        {alert.metric && (
          <p className="text-xs text-gray-400 mt-0.5 font-mono">
            {alert.metric} = {alert.value} (threshold: {alert.condition} {alert.threshold})
          </p>
        )}
        <p className="text-xs text-gray-400 mt-1">{timeAgo(alert.createdAt)}</p>
      </div>

      {/* Ack button */}
      {!acked && (
        <button onClick={() => onAck(alert._id)}
          className="flex-shrink-0 text-xs font-semibold text-green-700 border-2 border-green-200
                     px-3 py-1.5 rounded-xl hover:bg-green-50 hover:border-green-400
                     transition-all active:scale-95">
          Ack ✓
        </button>
      )}
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────
function StatCard({ icon, label, value, color, sub }) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-2xl">{icon}</span>
        {sub && <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">{sub}</span>}
      </div>
      <p className={`text-2xl font-black mt-1 ${color}`}>{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────
export default function AlertsPage() {
  const [alerts,  setAlerts]  = useState([]);
  const [filter,  setFilter]  = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [, setTick]           = useState(0);
  const token                 = useAuthStore(s => s.token);
  const { decrementUnread, setUnreadCount } = useAlertStore();
  const socketRef             = useRef(null);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t+1), 5000);
    return () => clearInterval(id);
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res  = await api.get(`/alerts${filter ? `?severity=${filter}` : ''}`);
      const list = res.data.data || [];
      setAlerts(list);
      setUnreadCount(list.filter(a => !a.acknowledged).length);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [filter]);

  // Live socket
  useEffect(() => {
    if (!token) return;
    api.get('/farms').then(r => {
      const farms = r.data.data?.farms || [];
      if (!farms.length) return;
      const s = io(import.meta.env.VITE_API_URL || undefined, {
        auth: { token }, transports: ['websocket','polling'],
      });
      socketRef.current = s;
      s.on('connect', () => farms.forEach(f => s.emit('join:farm', f._id)));
      s.on('alert:new', (a) => {
        if (!filter || a.severity === filter) setAlerts(prev => [a, ...prev]);
      });
    }).catch(() => {});
    return () => { socketRef.current?.disconnect(); socketRef.current = null; };
  }, [token, filter]);

  const ack = async (id) => {
    await api.put(`/alerts/${id}/acknowledge`);
    setAlerts(prev => prev.map(a => a._id === id ? { ...a, acknowledged: true } : a));
    decrementUnread();
  };

  const ackAll = async () => {
    const unacked = alerts.filter(a => !a.acknowledged);
    await Promise.all(unacked.map(a => api.put(`/alerts/${a._id}/acknowledge`)));
    setAlerts(prev => prev.map(a => ({ ...a, acknowledged: true })));
    setUnreadCount(0);
  };

  const filtered = alerts.filter(a => !typeFilter || a.type === typeFilter);

  const total    = alerts.length;
  const unread   = alerts.filter(a => !a.acknowledged).length;
  const critical = alerts.filter(a => a.severity === 'critical' && !a.acknowledged).length;
  const warning  = alerts.filter(a => a.severity === 'warning'  && !a.acknowledged).length;

  return (
    <div className="space-y-6">

      {/* Hero */}
      <div className={`relative overflow-hidden rounded-3xl p-6 text-white shadow-lg ${
        critical > 0
          ? 'bg-gradient-to-br from-red-600 via-red-600 to-orange-600 shadow-red-200'
          : warning > 0
          ? 'bg-gradient-to-br from-yellow-500 via-orange-500 to-amber-600 shadow-orange-200'
          : 'bg-gradient-to-br from-green-600 via-emerald-600 to-teal-600 shadow-green-200'
      }`}>
        <div className="absolute -top-8 -right-8 w-40 h-40 bg-white/10 rounded-full"/>
        <div className="absolute -bottom-12 right-24 w-56 h-56 bg-white/5 rounded-full"/>
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-white/70 text-sm">Monitoring</p>
            <h1 className="text-3xl font-black mt-1">Alerts</h1>
            <p className="text-white/80 text-sm mt-1">
              {unread > 0
                ? `${unread} unacknowledged alert${unread > 1 ? 's' : ''}`
                : '✓ All clear — no active alerts'}
            </p>
          </div>
          <div className="flex gap-2">
            {unread > 0 && (
              <button onClick={ackAll}
                className="bg-white/20 hover:bg-white/30 text-white text-sm font-semibold
                           px-4 py-2 rounded-xl transition border border-white/30">
                Acknowledge all
              </button>
            )}
            <button onClick={load}
              className="bg-white text-gray-700 text-sm font-semibold px-4 py-2 rounded-xl
                         hover:bg-gray-50 transition shadow-lg">
              ↻ Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon="🔔" label="Total alerts"    value={total}    color="text-gray-800"/>
        <StatCard icon="🚨" label="Critical (unack)" value={critical} color={critical > 0 ? 'text-red-600' : 'text-gray-400'}
          sub={critical > 0 ? 'Action needed' : undefined}/>
        <StatCard icon="⚠️" label="Warnings (unack)" value={warning}  color={warning > 0 ? 'text-yellow-600' : 'text-gray-400'}/>
        <StatCard icon="✅" label="Acknowledged"     value={total - unread} color="text-green-700"/>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Severity */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {[
            ['', 'All'],
            ['critical', '🚨 Critical'],
            ['warning',  '⚠️ Warning'],
            ['info',     'ℹ️ Info'],
          ].map(([v, label]) => (
            <button key={v} onClick={() => setFilter(v)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                filter === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>{label}</button>
          ))}
        </div>
        {/* Type */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {[
            ['', 'All types'],
            ['device_offline',   '📵 Offline'],
            ['low_battery',      '🔋 Battery'],
            ['threshold_breach', '📊 Threshold'],
          ].map(([v, label]) => (
            <button key={v} onClick={() => setTypeFilter(v)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                typeFilter === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>{label}</button>
          ))}
        </div>
      </div>

      {/* Alert list */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse"/>)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-24 border-2 border-dashed border-gray-200 rounded-3xl">
          <div className="text-7xl mb-4">✅</div>
          <p className="text-xl font-bold text-gray-700">No alerts</p>
          <p className="text-sm text-gray-400 mt-1">Your farm is running smoothly</p>
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden divide-y divide-gray-100">
          {/* Unacknowledged first */}
          {filtered.filter(a => !a.acknowledged).length > 0 && (
            <div className="px-4 py-2.5 bg-gray-50 flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                🔔 Unacknowledged ({filtered.filter(a => !a.acknowledged).length})
              </p>
            </div>
          )}
          {filtered.filter(a => !a.acknowledged).map(a => (
            <AlertRow key={a._id} alert={a} onAck={ack}/>
          ))}

          {/* Acknowledged section */}
          {filtered.filter(a => a.acknowledged).length > 0 && (
            <div className="px-4 py-2.5 bg-gray-50">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                ✓ Acknowledged ({filtered.filter(a => a.acknowledged).length})
              </p>
            </div>
          )}
          {filtered.filter(a => a.acknowledged).map(a => (
            <AlertRow key={a._id} alert={a} onAck={ack}/>
          ))}
        </div>
      )}
    </div>
  );
}

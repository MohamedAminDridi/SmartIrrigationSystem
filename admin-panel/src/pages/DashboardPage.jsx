import { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useAlertStore } from '../store/alertStore';

// ── Helpers ───────────────────────────────────────────────────────
function timeAgo(date) {
  if (!date) return '—';
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 5)    return 'just now';
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)return `${Math.floor(s / 3600)}h ago`;
  return new Date(date).toLocaleDateString();
}
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
function soilColor(p) {
  if (p == null) return 'text-gray-400';
  if (p < 20)   return 'text-red-600';
  if (p < 40)   return 'text-yellow-600';
  if (p < 70)   return 'text-green-700';
  return 'text-blue-600';
}
function soilGrad(p) {
  if (p == null) return 'from-gray-200 to-gray-300';
  if (p < 20)   return 'from-red-400 to-red-500';
  if (p < 40)   return 'from-yellow-400 to-orange-400';
  if (p < 70)   return 'from-green-400 to-green-600';
  return 'from-blue-400 to-blue-600';
}
function soilText(p) {
  if (p == null) return '—';
  if (p < 20)   return 'Very dry';
  if (p < 40)   return 'Dry';
  if (p < 70)   return 'Good';
  return 'Wet';
}

const SEV = {
  critical: { bg: 'bg-red-50',     dot: 'bg-red-500',    text: 'text-red-700',    pill: 'bg-red-100 text-red-700' },
  warning:  { bg: 'bg-yellow-50',  dot: 'bg-yellow-500', text: 'text-yellow-700', pill: 'bg-yellow-100 text-yellow-700' },
  info:     { bg: 'bg-blue-50',    dot: 'bg-blue-500',   text: 'text-blue-700',   pill: 'bg-blue-100 text-blue-700' },
};
const FARM_GRADS = [
  'from-green-500 to-emerald-600',
  'from-teal-500 to-cyan-600',
  'from-blue-500 to-indigo-600',
  'from-violet-500 to-purple-600',
  'from-orange-500 to-amber-600',
  'from-rose-500 to-pink-600',
];

// ── Alert row ─────────────────────────────────────────────────────
function AlertRow({ alert }) {
  const s = SEV[alert.severity] || SEV.warning;
  return (
    <div className={`flex items-start gap-3 px-5 py-3 ${s.bg}`}>
      <span className={`flex-shrink-0 w-2 h-2 rounded-full mt-1.5 ${s.dot}`}/>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${s.text} truncate`}>{alert.message}</p>
        <p className="text-xs text-gray-400 mt-0.5">{timeAgo(alert.createdAt)}</p>
      </div>
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${s.pill}`}>
        {alert.severity}
      </span>
    </div>
  );
}

// ── KPI card ──────────────────────────────────────────────────────
function KpiCard({ icon, label, value, color, sub, link, danger }) {
  const inner = (
    <div className={`bg-white rounded-2xl border shadow-sm p-4 transition-all hover:shadow-md ${
      danger ? 'border-red-200' : 'border-gray-100'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-2xl">{icon}</span>
        {sub && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            danger ? 'bg-red-50 text-red-600' : 'bg-gray-50 text-gray-500'
          }`}>{sub}</span>
        )}
      </div>
      <p className={`text-2xl font-black leading-tight ${color}`}>{value ?? '—'}</p>
      <p className="text-xs text-gray-400 mt-0.5">{label}</p>
    </div>
  );
  return link ? <Link to={link}>{inner}</Link> : inner;
}

// ── Farm overview row ─────────────────────────────────────────────
function FarmRow({ farm, farmNodes, farmGWs, idx }) {
  const gradient   = FARM_GRADS[idx % FARM_GRADS.length];
  const nodesOn    = farmNodes.filter(n => n.status === 'online').length;
  const nodesOff   = farmNodes.filter(n => n.status === 'offline').length;
  const gwOn       = farmGWs.filter(g => g.status === 'online').length;
  const hasOffline = nodesOff > 0 || gwOn < farmGWs.length;

  return (
    <Link to={`/farms/${farm._id}`}
      className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors group">
      {/* Color dot */}
      <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center flex-shrink-0 text-white text-sm font-bold`}>
        {farm.name.charAt(0).toUpperCase()}
      </div>
      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{farm.name}</p>
        <p className="text-xs text-gray-400">{farm.crop_type || 'No crop'} · {farm.size_ha ? `${farm.size_ha} ha` : '—'}</p>
      </div>
      {/* Status chips */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
          nodesOff > 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700'
        }`}>
          🔌 {nodesOn}/{farmNodes.length}
        </span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
          gwOn < farmGWs.length ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-700'
        }`}>
          📡 {gwOn}/{farmGWs.length}
        </span>
      </div>
      <span className="text-gray-300 group-hover:text-green-500 transition-colors text-xs">→</span>
    </Link>
  );
}

// ── Node mini card ────────────────────────────────────────────────
function NodeMiniCard({ node, live, farmId }) {
  const d      = live || {};
  const soil   = d.soil_moisture_pct ?? null;
  const temp   = d.temperature_c ?? null;
  const bat    = d.battery_pct ?? node.battery_pct;
  const charging = d.charging ?? d.battery_charging ?? node.battery_charging;
  const online = node.status === 'online';
  const batColor = bat == null ? 'text-gray-400' : bat > 60 ? 'text-green-600' : bat > 30 ? 'text-yellow-500' : 'text-red-500';

  return (
    <Link to={`/farms/${farmId}`}
      className={`rounded-2xl border p-3 space-y-2 transition-all hover:shadow-md hover:-translate-y-0.5 block ${
        online ? 'bg-white border-green-200' : 'bg-red-50 border-red-200'
      }`}>
      {/* Top bar */}
      <div className={`h-0.5 -mx-3 -mt-3 rounded-t-2xl ${
        online ? 'bg-gradient-to-r from-green-400 to-emerald-500' : 'bg-red-400'
      }`}/>
      <div className="flex items-start justify-between gap-1">
        <p className="text-xs font-semibold text-gray-800 truncate leading-tight">{node.name}</p>
        <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full mt-0.5 ${
          online ? 'bg-green-500' : 'bg-red-500'
        }`}/>
      </div>
      {/* Soil bar */}
      <div className="space-y-0.5">
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">🌱 Soil</span>
          <span className={`font-semibold ${soilColor(soil)}`}>{soil != null ? `${soil}%` : '—'}</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full bg-gradient-to-r ${soilGrad(soil)} transition-all duration-500`}
               style={{ width: `${soil ?? 0}%` }}/>
        </div>
      </div>
      {/* Temp + Battery */}
      <div className="flex items-center justify-between">
        {temp != null ? (
          <p className={`text-xs font-bold ${temp > 35 ? 'text-red-500' : temp > 28 ? 'text-orange-500' : 'text-gray-500'}`}>🌡️ {temp.toFixed(1)}°C</p>
        ) : <span />}
        <p className={`text-xs font-bold ${charging ? 'text-amber-500' : batColor}`}>
          {charging ? '⚡' : '🔋'} {bat != null ? `${bat}%` : '—'}
        </p>
      </div>
    </Link>
  );
}

// ── Main page ─────────────────────────────────────────────────────
export default function DashboardPage() {
  const [farmsData, setFarmsData] = useState([]); // [{farm, nodes, gateways}]
  const [alerts,    setAlerts]    = useState([]);
  const [summary,   setSummary]   = useState(null);
  const [liveData,  setLiveData]  = useState({});
  const [loading,   setLoading]   = useState(true);
  const [, setTick]               = useState(0);

  const token       = useAuthStore(s => s.token);
  const user        = useAuthStore(s => s.user);
  const unreadCount = useAlertStore(s => s.unreadCount);
  const socketRef   = useRef(null);
  const nav         = useNavigate();

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const [farmsRes, alertsRes] = await Promise.all([
          api.get('/farms'),
          api.get('/alerts?acknowledged=false&limit=5'),
        ]);
        const farmList = farmsRes.data.data.farms || [];
        setAlerts(alertsRes.data.data || []);

        if (farmList.length > 0) {
          const [nodeResults, gwResults] = await Promise.all([
            Promise.all(farmList.map(f =>
              api.get(`/farms/${f._id}/nodes`).then(r => r.data.data.nodes || []).catch(() => [])
            )),
            Promise.all(farmList.map(f =>
              api.get(`/farms/${f._id}/gateways`).then(r => r.data.data.gateways || []).catch(() => [])
            )),
          ]);

          const combined = farmList.map((farm, i) => ({
            farm,
            nodes:    nodeResults[i],
            gateways: gwResults[i],
          }));
          setFarmsData(combined);

          // Analytics summary for first farm
          api.get(`/analytics/farms/${farmList[0]._id}/summary?from=7d`)
            .then(r => setSummary(r.data.data?.summary))
            .catch(() => {});
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Live socket across all farms
  useEffect(() => {
    if (!token || farmsData.length === 0) return;
    const s = io(import.meta.env.VITE_API_URL || undefined, {
      auth: { token }, transports: ['websocket', 'polling'],
    });
    socketRef.current = s;
    s.on('connect', () => farmsData.forEach(fd => s.emit('join:farm', fd.farm._id)));
    s.on('sensor:data', d => {
      setLiveData(prev => ({ ...prev, [d.deviceId]: d }));
      setFarmsData(prev => prev.map(fd => ({
        ...fd,
        nodes: fd.nodes.map(n =>
          n.device_id === d.deviceId ? { ...n, status: 'online', last_seen: new Date() } : n
        ),
      })));
    });
    s.on('node:status', d => {
      const on = d.online ?? (d.status === 'online');
      setFarmsData(prev => prev.map(fd => ({
        ...fd,
        nodes: fd.nodes.map(n =>
          n.device_id === d.device_id ? { ...n, status: on ? 'online' : 'offline' } : n
        ),
      })));
    });
    s.on('gateway:status', d => {
      setFarmsData(prev => prev.map(fd => ({
        ...fd,
        gateways: fd.gateways.map(g =>
          g.device_id === d.device_id ? { ...g, status: d.status } : g
        ),
      })));
    });
    s.on('alert:new', a => setAlerts(prev => [a, ...prev].slice(0, 5)));
    return () => { socketRef.current?.disconnect(); socketRef.current = null; };
  }, [token, farmsData.length]);

  // Aggregated stats
  const allNodes    = farmsData.flatMap(fd => fd.nodes);
  const allGWs      = farmsData.flatMap(fd => fd.gateways);
  const nodesOnline = allNodes.filter(n => n.status === 'online').length;
  const nodesOff    = allNodes.filter(n => n.status === 'offline').length;
  const gwOnline    = allGWs.filter(g => g.status === 'online').length;
  const gwOff       = allGWs.filter(g => g.status === 'offline').length;
  const hasCritical = alerts.some(a => a.severity === 'critical');

  const systemOk = nodesOff === 0 && gwOff === 0 && unreadCount === 0;
  const heroGrad = hasCritical && unreadCount > 0
    ? 'from-red-600 via-rose-600 to-orange-600 shadow-red-200'
    : unreadCount > 0
    ? 'from-yellow-500 via-orange-500 to-amber-600 shadow-orange-200'
    : 'from-green-600 via-emerald-600 to-teal-600 shadow-green-200';

  return (
    <div className="space-y-6 pb-8">

      {/* ── Hero ── */}
      <div className={`relative overflow-hidden rounded-3xl p-6 text-white shadow-lg bg-gradient-to-br ${heroGrad}`}>
        <div className="absolute -top-8 -right-8 w-40 h-40 bg-white/10 rounded-full"/>
        <div className="absolute -bottom-12 right-24 w-56 h-56 bg-white/5 rounded-full"/>
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-white/70 text-sm">{greeting()}, {user?.name || 'Admin'}</p>
            <h1 className="text-3xl font-black mt-1">Dashboard</h1>
            <p className="text-white/80 text-sm mt-1">
              {systemOk
                ? '✓ All systems operational'
                : [
                    nodesOff  > 0 && `${nodesOff} node${nodesOff > 1 ? 's' : ''} offline`,
                    gwOff     > 0 && `${gwOff} gateway${gwOff > 1 ? 's' : ''} offline`,
                    unreadCount > 0 && `${unreadCount} active alert${unreadCount > 1 ? 's' : ''}`,
                  ].filter(Boolean).join(' · ')
              }
            </p>
          </div>
          <div className="text-right">
            <p className="text-white/60 text-xs">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
            <p className="text-white/80 text-sm font-medium mt-0.5">
              {farmsData.length} farm{farmsData.length !== 1 ? 's' : ''} monitored
            </p>
          </div>
        </div>
      </div>

      {/* ── KPI row ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon="🗺" label="Total farms"
          value={farmsData.length}
          color="text-gray-900"
          link="/farms"/>
        <KpiCard icon="🔌" label="Nodes online"
          value={loading ? '…' : `${nodesOnline} / ${allNodes.length}`}
          color={nodesOff > 0 ? 'text-red-600' : 'text-green-700'}
          sub={!loading && (nodesOff > 0 ? `${nodesOff} offline` : 'All online')}
          danger={nodesOff > 0}
          link="/nodes"/>
        <KpiCard icon="🔔" label="Active alerts"
          value={unreadCount}
          color={unreadCount > 0 ? 'text-red-600' : 'text-gray-400'}
          sub={unreadCount > 0 ? 'Needs attention' : 'All clear'}
          danger={unreadCount > 0}
          link="/alerts"/>
        <KpiCard icon="📡" label="Gateways"
          value={loading ? '…' : `${gwOnline} / ${allGWs.length}`}
          color={gwOff > 0 ? 'text-red-600' : 'text-blue-700'}
          sub={!loading && (gwOff > 0 ? `${gwOff} offline` : 'All online')}
          danger={gwOff > 0}
          link="/gateways"/>
      </div>

      {/* ── Analytics banner (7d summary) ── */}
      {summary && (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">7-day analytics</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-gray-100">
            {[
              {
                icon: '🌱', label: 'Avg soil moisture',
                value: summary.avg_soil_moisture != null ? `${summary.avg_soil_moisture}%` : '—',
                color: soilColor(summary.avg_soil_moisture),
                sub: soilText(summary.avg_soil_moisture),
              },
              {
                icon: '🌡️', label: 'Avg temperature',
                value: summary.avg_temperature != null ? `${summary.avg_temperature}°C` : '—',
                color: summary.avg_temperature > 35 ? 'text-red-600' : summary.avg_temperature > 28 ? 'text-orange-500' : 'text-gray-800',
              },
              {
                icon: '🔌', label: 'Active nodes',
                value: summary.active_nodes ?? '—',
                color: 'text-gray-900',
              },
              {
                icon: '📊', label: 'Total readings',
                value: summary.total_readings?.toLocaleString() ?? '—',
                color: 'text-gray-900',
                sub: 'Sensor packets',
              },
            ].map(m => (
              <div key={m.label} className="px-5 py-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">{m.icon}</span>
                  {m.sub && <span className="text-xs text-gray-400">{m.sub}</span>}
                </div>
                <p className={`text-xl font-black ${m.color}`}>{m.value}</p>
                <p className="text-xs text-gray-400 mt-0.5">{m.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 2-col: Alerts + Farm overview ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Active alerts */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2">
              🔔 Active Alerts
              {unreadCount > 0 && (
                <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                  {unreadCount}
                </span>
              )}
            </h2>
            <Link to="/alerts" className="text-xs text-green-600 hover:underline font-medium">
              View all →
            </Link>
          </div>
          {alerts.length === 0 ? (
            <div className="p-10 text-center">
              <div className="text-5xl mb-3">✅</div>
              <p className="text-sm font-semibold text-gray-700">No active alerts</p>
              <p className="text-xs text-gray-400 mt-1">Your farms are running smoothly</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {alerts.map((a, i) => <AlertRow key={a._id || i} alert={a}/>)}
              {unreadCount > 5 && (
                <div className="px-5 py-3 text-center">
                  <Link to="/alerts" className="text-xs text-green-600 hover:underline font-medium">
                    + {unreadCount - 5} more alerts — view all
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Farm overview */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
            <h2 className="font-bold text-gray-900">🗺 Farm Overview</h2>
            <Link to="/farms" className="text-xs text-green-600 hover:underline font-medium">
              Manage →
            </Link>
          </div>
          {loading ? (
            <div className="p-5 space-y-3">
              {[1, 2].map(i => (
                <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse"/>
              ))}
            </div>
          ) : farmsData.length === 0 ? (
            <div className="p-10 text-center">
              <div className="text-5xl mb-3">🌱</div>
              <p className="text-sm font-semibold text-gray-700">No farms yet</p>
              <Link to="/farms"
                className="text-xs text-green-600 hover:underline mt-2 inline-block">
                + Create first farm
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {farmsData.map((fd, i) => (
                <FarmRow
                  key={fd.farm._id}
                  farm={fd.farm}
                  farmNodes={fd.nodes}
                  farmGWs={fd.gateways}
                  idx={i}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Live nodes grid ── */}
      {allNodes.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900">
              🔌 Live Nodes
              <span className="ml-2 text-sm text-gray-400 font-normal">{allNodes.length} total</span>
            </h2>
            <Link to="/nodes" className="text-xs text-green-600 hover:underline font-medium">
              All nodes →
            </Link>
          </div>
          {nodesOff > 0 && (
            <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
              <span className="text-lg">🚨</span>
              <p className="text-sm font-semibold text-red-700">
                {nodesOff} node{nodesOff > 1 ? 's' : ''} offline — check LoRa connection
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
            {farmsData.flatMap(fd =>
              fd.nodes.map(node => (
                <NodeMiniCard
                  key={node._id}
                  node={node}
                  live={liveData[node.device_id]}
                  farmId={fd.farm._id}
                />
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Quick links ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { to: '/nodes',    icon: '🔌', label: 'Nodes',     desc: 'View & control'     },
          { to: '/gateways', icon: '📡', label: 'Gateways',  desc: 'Network status'     },
          { to: '/alerts',   icon: '🔔', label: 'Alerts',    desc: 'Review & acknowledge' },
          { to: '/analytics',icon: '📊', label: 'Analytics', desc: 'Trends & reports'   },
        ].map(l => (
          <Link key={l.to} to={l.to}
            className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm
                       hover:shadow-md hover:-translate-y-0.5 transition-all group">
            <span className="text-2xl">{l.icon}</span>
            <p className="font-semibold text-gray-900 mt-2 text-sm group-hover:text-green-700 transition-colors">
              {l.label}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">{l.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts';
import api from '../services/api';
import { useAuthStore } from '../store/authStore';

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════
function timeAgo(date) {
  if (!date) return '—';
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 5)    return 'just now';
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return new Date(date).toLocaleTimeString();
}

function soilGradient(p) {
  if (p == null) return 'from-gray-200 to-gray-300';
  if (p < 20)   return 'from-red-400 to-red-500';
  if (p < 40)   return 'from-yellow-400 to-orange-400';
  if (p < 70)   return 'from-green-400 to-green-600';
  return 'from-blue-400 to-blue-600';
}
function soilLabel(p) {
  if (p == null) return { text: 'No data',  color: 'text-gray-400' };
  if (p < 20)   return { text: 'Very dry',  color: 'text-red-500'  };
  if (p < 40)   return { text: 'Dry',       color: 'text-yellow-600'};
  if (p < 70)   return { text: 'Good',      color: 'text-green-600' };
  return               { text: 'Saturated', color: 'text-blue-600'  };
}

function batIcon(p) {
  if (p == null) return '🔋';
  if (p > 60)   return '🔋';
  if (p > 30)   return '🪫';
  return '⚠️';
}
function batColor(p) {
  if (p == null) return 'text-gray-400';
  if (p > 60)   return 'text-green-600';
  if (p > 30)   return 'text-yellow-500';
  return 'text-red-500';
}

function rssiInfo(r) {
  if (r == null || r === 0) return { label: '—',         color: 'text-gray-400', bars: 0 };
  if (r >= -50) return { label: `${r} dBm`, color: 'text-green-600',  bars: 4 };
  if (r >= -65) return { label: `${r} dBm`, color: 'text-green-500',  bars: 3 };
  if (r >= -75) return { label: `${r} dBm`, color: 'text-yellow-500', bars: 2 };
  return               { label: `${r} dBm`, color: 'text-red-500',    bars: 1 };
}

// RSSI bars icon
function RssiBars({ bars }) {
  return (
    <span className="inline-flex items-end gap-px h-3.5">
      {[1,2,3,4].map(i => (
        <span key={i} className={`inline-block w-1 rounded-sm ${
          i <= bars ? 'bg-current' : 'bg-current opacity-20'
        }`} style={{ height: `${i * 25}%` }}/>
      ))}
    </span>
  );
}

// Status pill — ONLINE=green, OFFLINE=RED
function StatusPill({ status, size = 'sm' }) {
  const online = status === 'online';
  const base   = size === 'lg' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs';
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold rounded-full ${base} ${
      online
        ? 'bg-green-100 text-green-700'
        : 'bg-red-100 text-red-600'
    }`}>
      {online ? (
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75"/>
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500"/>
        </span>
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-red-500"/>
      )}
      {online ? 'Online' : 'Offline'}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════
// STAT CARD (top row)
// ═══════════════════════════════════════════════════════════════════
function StatCard({ icon, label, value, sub, accent }) {
  return (
    <div className={`bg-white rounded-2xl border p-4 space-y-1 shadow-sm ${
      accent ? 'border-green-200' : 'border-gray-100'
    }`}>
      <div className="flex items-center justify-between">
        <span className="text-2xl">{icon}</span>
        {sub && <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">{sub}</span>}
      </div>
      <p className="text-2xl font-bold text-gray-900 leading-tight">{value ?? '—'}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// GATEWAY CARD
// ═══════════════════════════════════════════════════════════════════
function GatewayCard({ gw }) {
  const online = gw.status === 'online';
  return (
    <div className={`flex-shrink-0 w-56 rounded-2xl border p-4 space-y-3 transition-all duration-300 ${
      online
        ? 'bg-white border-green-200 shadow-md shadow-green-50'
        : 'bg-red-50 border-red-200'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm text-gray-900 truncate">{gw.name}</p>
          <p className="text-xs font-mono text-gray-400 truncate">{gw.device_id}</p>
        </div>
        <StatusPill status={gw.status}/>
      </div>

      {/* Info rows */}
      <div className="space-y-1 text-xs">
        <div className="flex justify-between text-gray-500">
          <span>IP</span>
          <span className="font-mono font-medium text-gray-700">{gw.ip || '—'}</span>
        </div>
        <div className="flex justify-between text-gray-500">
          <span>Firmware</span>
          <span className="font-mono font-medium text-gray-700">v{gw.firmware_version || '—'}</span>
        </div>
        <div className="flex justify-between text-gray-500">
          <span>Last seen</span>
          <span className={`font-medium ${online ? 'text-green-600' : 'text-red-500'}`}>
            {timeAgo(gw.last_heartbeat)}
          </span>
        </div>
      </div>

      {/* Bottom accent */}
      <div className={`h-1 rounded-full ${
        online ? 'bg-gradient-to-r from-green-400 to-emerald-500' : 'bg-red-300'
      }`}/>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// NODE CARD (summary)
// ═══════════════════════════════════════════════════════════════════
function NodeCard({ node, live, onClick }) {
  const d      = live || {};
  const soil   = d.soil_moisture_pct ?? null;
  const temp   = d.temperature_c     ?? null;
  const hum    = d.humidity_pct      ?? null;
  const bat    = d.battery_pct       ?? node.battery_pct;
  const rssi   = d.rssi              ?? null;
  const ri     = rssiInfo(rssi);
  const online = node.status === 'online';
  const sl     = soilLabel(soil);

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-2xl border p-4 space-y-4 transition-all duration-200
        hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 cursor-pointer group ${
        online
          ? 'bg-white border-green-200 shadow-sm shadow-green-50'
          : 'bg-red-50 border-red-200'
      }`}>

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-gray-900 truncate group-hover:text-green-700 transition-colors">
            {node.name}
          </p>
          <p className="text-xs font-mono text-gray-400 mt-0.5">{node.device_id}</p>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <StatusPill status={node.status}/>
          <span className={`text-xs ${online ? 'text-green-500' : 'text-red-400'}`}>
            {timeAgo(node.last_seen)}
          </span>
        </div>
      </div>

      {/* Soil moisture */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500 font-medium">🌱 Soil moisture</span>
          <div className="flex items-center gap-1.5">
            <span className={`font-semibold ${sl.color}`}>{sl.text}</span>
            <span className="font-bold text-gray-800">{soil != null ? `${soil}%` : '—'}</span>
          </div>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full bg-gradient-to-r transition-all duration-700 ${soilGradient(soil)}`}
            style={{ width: `${soil ?? 0}%` }}
          />
        </div>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-4 gap-1.5">
        {/* Temp */}
        <div className="col-span-1 bg-gray-50 rounded-xl p-2 text-center">
          <p className="text-xs text-gray-400">Temp</p>
          <p className={`text-sm font-bold leading-tight mt-0.5 ${
            temp > 35 ? 'text-red-500' : temp > 28 ? 'text-orange-500' : 'text-gray-800'
          }`}>{temp != null ? `${temp.toFixed(1)}°` : '—'}</p>
        </div>
        {/* Humidity */}
        <div className="col-span-1 bg-gray-50 rounded-xl p-2 text-center">
          <p className="text-xs text-gray-400">Hum</p>
          <p className="text-sm font-bold text-blue-600 leading-tight mt-0.5">
            {hum != null ? `${Math.round(hum)}%` : '—'}
          </p>
        </div>
        {/* Battery */}
        <div className="col-span-1 bg-gray-50 rounded-xl p-2 text-center">
          <p className="text-xs text-gray-400">Bat</p>
          <p className={`text-sm font-bold leading-tight mt-0.5 ${batColor(bat)}`}>
            {bat != null ? `${bat}%` : '—'}
          </p>
        </div>
        {/* RSSI */}
        <div className="col-span-1 bg-gray-50 rounded-xl p-2 text-center">
          <p className="text-xs text-gray-400">RSSI</p>
          <p className={`text-xs font-bold leading-tight mt-0.5 flex items-center justify-center gap-0.5 ${ri.color}`}>
            <RssiBars bars={ri.bars}/>
          </p>
        </div>
      </div>

      {/* Footer chips */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1.5">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            node.valve_state === 'open'
              ? 'bg-blue-100 text-blue-700'
              : 'bg-gray-100 text-gray-500'
          }`}>
            {node.valve_state === 'open' ? '🔓 Open' : '🔒 Closed'}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            node.pump_state === 'on'
              ? 'bg-orange-100 text-orange-700'
              : 'bg-gray-100 text-gray-500'
          }`}>
            {node.pump_state === 'on' ? '⚡ On' : '● Off'}
          </span>
        </div>
        <span className="text-xs text-gray-300 group-hover:text-green-500 transition-colors">
          View details →
        </span>
      </div>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════
// NODE DETAIL DRAWER
// ═══════════════════════════════════════════════════════════════════
const CHART_METRICS = [
  { key: 'Soil', color: '#16a34a', label: 'Soil (%)' },
  { key: 'Temp', color: '#dc2626', label: 'Temp (°C)' },
  { key: 'Hum',  color: '#2563eb', label: 'Hum (%)' },
];

function NodeDrawer({ node, live, onClose, onCommand }) {
  const [history,  setHistory]  = useState([]);
  const [loadHist, setLoadHist] = useState(true);
  const [cmdBusy,  setCmdBusy]  = useState(null);
  const [cmdOk,    setCmdOk]    = useState(null);
  const [activeMetrics, setActiveMetrics] = useState(['Soil','Temp','Hum']);
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setLoadHist(true);
    api.get(`/nodes/${node._id}/history?interval=minute`)
      .then(r => {
        const rows = (r.data.data?.history || []).map(h => ({
          t:    new Date(h.bucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          Soil: h.avg_soil_moisture != null ? Math.round(h.avg_soil_moisture) : null,
          Temp: h.avg_temperature   != null ? parseFloat(h.avg_temperature.toFixed(1)) : null,
          Hum:  h.avg_humidity      != null ? Math.round(h.avg_humidity) : null,
          Bat:  h.avg_battery       != null ? Math.round(h.avg_battery)  : null,
        }));
        setHistory(rows);
      })
      .catch(() => setHistory([]))
      .finally(() => setLoadHist(false));
  }, [node._id]);

  const d      = live || {};
  const soil   = d.soil_moisture_pct ?? null;
  const temp   = d.temperature_c     ?? null;
  const hum    = d.humidity_pct      ?? null;
  const bat    = d.battery_pct       ?? node.battery_pct;
  const rssi   = d.rssi              ?? null;
  const ri     = rssiInfo(rssi);
  const sl     = soilLabel(soil);
  const online = node.status === 'online';

  const cmd = async (action) => {
    setCmdBusy(action);
    try {
      await onCommand(node, action);
      setCmdOk(action);
      setTimeout(() => setCmdOk(null), 2000);
    } catch { /* ignore */ }
    finally { setCmdBusy(null); }
  };

  const toggleMetric = (k) =>
    setActiveMetrics(prev =>
      prev.includes(k) ? prev.filter(m => m !== k) : [...prev, k]
    );

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-white shadow-2xl
                      flex flex-col overflow-hidden">

        {/* ── Drawer header ── */}
        <div className={`px-6 py-5 border-b flex items-start justify-between gap-4 ${
          online ? 'bg-gradient-to-r from-green-600 to-emerald-600' : 'bg-gradient-to-r from-red-600 to-red-700'
        }`}>
          <div className="text-white">
            <div className="flex items-center gap-2 mb-1">
              <StatusPill status={node.status} size="lg"/>
            </div>
            <h2 className="text-xl font-bold">{node.name}</h2>
            <p className="text-xs font-mono opacity-75 mt-0.5">{node.device_id}</p>
          </div>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white hover:bg-white/20 rounded-xl
                       w-9 h-9 flex items-center justify-center text-xl transition-colors flex-shrink-0">
            ×
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto">

          {/* Live metrics grid */}
          <div className="p-5 space-y-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
              Live readings
            </p>
            <div className="grid grid-cols-3 gap-3">

              {/* Soil — big card */}
              <div className="col-span-3 rounded-2xl overflow-hidden border border-gray-100 shadow-sm">
                <div className="px-4 pt-4 pb-2">
                  <div className="flex items-end justify-between mb-2">
                    <div>
                      <p className="text-xs text-gray-400 font-medium">Soil moisture</p>
                      <p className={`text-3xl font-black ${sl.color}`}>
                        {soil != null ? `${soil}%` : '—'}
                      </p>
                    </div>
                    <span className={`text-sm font-semibold px-3 py-1 rounded-full ${
                      soil < 20 ? 'bg-red-100 text-red-600' :
                      soil < 40 ? 'bg-yellow-100 text-yellow-700' :
                      soil < 70 ? 'bg-green-100 text-green-700' :
                                  'bg-blue-100 text-blue-700'
                    }`}>{sl.text}</span>
                  </div>
                  <div className="h-3 bg-gray-100 rounded-full overflow-hidden mb-1">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r transition-all duration-700 ${soilGradient(soil)}`}
                      style={{ width: `${soil ?? 0}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-gray-300">
                    <span>0% Dry</span>
                    <span>100% Wet</span>
                  </div>
                </div>
              </div>

              {/* Temp */}
              <div className="bg-gradient-to-br from-orange-50 to-red-50 border border-orange-100 rounded-2xl p-3 text-center">
                <p className="text-xs text-gray-400 mb-1">🌡️ Temp</p>
                <p className={`text-2xl font-black ${
                  temp > 35 ? 'text-red-600' : temp > 28 ? 'text-orange-500' : 'text-gray-800'
                }`}>{temp != null ? `${temp.toFixed(1)}°` : '—'}</p>
                <p className="text-xs text-gray-400">Celsius</p>
              </div>

              {/* Humidity */}
              <div className="bg-gradient-to-br from-blue-50 to-sky-50 border border-blue-100 rounded-2xl p-3 text-center">
                <p className="text-xs text-gray-400 mb-1">💧 Humidity</p>
                <p className="text-2xl font-black text-blue-600">
                  {hum != null ? `${Math.round(hum)}%` : '—'}
                </p>
                <p className="text-xs text-gray-400">Relative</p>
              </div>

              {/* Battery */}
              <div className={`border rounded-2xl p-3 text-center ${
                bat < 15 ? 'bg-gradient-to-br from-red-50 to-red-100 border-red-200' :
                bat < 30 ? 'bg-gradient-to-br from-yellow-50 to-orange-50 border-yellow-200' :
                           'bg-gradient-to-br from-green-50 to-emerald-50 border-green-100'
              }`}>
                <p className="text-xs text-gray-400 mb-1">{batIcon(bat)} Battery</p>
                <p className={`text-2xl font-black ${batColor(bat)}`}>
                  {bat != null ? `${bat}%` : '—'}
                </p>
                <p className="text-xs text-gray-400">{bat < 30 ? 'Low!' : 'OK'}</p>
              </div>

              {/* RSSI */}
              <div className="col-span-2 bg-gray-50 border border-gray-100 rounded-2xl p-3 flex items-center gap-3">
                <div className={`text-3xl ${ri.color}`}>
                  <RssiBars bars={ri.bars}/>
                </div>
                <div>
                  <p className="text-xs text-gray-400">LoRa signal</p>
                  <p className={`text-lg font-black ${ri.color}`}>{ri.label}</p>
                  <p className="text-xs text-gray-400">
                    {ri.bars === 4 ? 'Excellent' : ri.bars === 3 ? 'Good' :
                     ri.bars === 2 ? 'Fair' : ri.bars === 1 ? 'Weak' : '—'}
                  </p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-xs text-gray-400">Last seen</p>
                  <p className={`text-sm font-semibold ${online ? 'text-green-600' : 'text-red-500'}`}>
                    {timeAgo(node.last_seen)}
                  </p>
                </div>
              </div>

            </div>
          </div>

          {/* Controls */}
          <div className="px-5 pb-5 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Controls</p>
            <div className="grid grid-cols-2 gap-3">
              {/* Valve */}
              <button
                onClick={() => cmd(node.valve_state === 'open' ? 'valve/close' : 'valve/open')}
                disabled={!!cmdBusy}
                className={`flex flex-col items-center gap-2 py-4 rounded-2xl border-2 font-semibold
                           text-sm transition-all active:scale-95 disabled:opacity-60 ${
                  cmdOk?.startsWith('valve') ? 'border-green-400 bg-green-50 text-green-700' :
                  node.valve_state === 'open'
                    ? 'border-blue-400 bg-blue-500 text-white hover:bg-blue-600'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50'
                }`}>
                <span className="text-2xl">
                  {cmdBusy?.startsWith('valve') ? '⏳' :
                   cmdOk?.startsWith('valve')   ? '✅' :
                   node.valve_state === 'open'  ? '🔓' : '🔒'}
                </span>
                {node.valve_state === 'open' ? 'Close valve' : 'Open valve'}
              </button>

              {/* Pump */}
              <button
                onClick={() => cmd(node.pump_state === 'on' ? 'pump/stop' : 'pump/start')}
                disabled={!!cmdBusy}
                className={`flex flex-col items-center gap-2 py-4 rounded-2xl border-2 font-semibold
                           text-sm transition-all active:scale-95 disabled:opacity-60 ${
                  cmdOk?.startsWith('pump') ? 'border-green-400 bg-green-50 text-green-700' :
                  node.pump_state === 'on'
                    ? 'border-orange-400 bg-orange-500 text-white hover:bg-orange-600'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-orange-300 hover:bg-orange-50'
                }`}>
                <span className="text-2xl">
                  {cmdBusy?.startsWith('pump') ? '⏳' :
                   cmdOk?.startsWith('pump')   ? '✅' :
                   node.pump_state === 'on'    ? '⏹️' : '▶️'}
                </span>
                {node.pump_state === 'on' ? 'Stop pump' : 'Start pump'}
              </button>
            </div>
          </div>

          {/* History chart */}
          <div className="px-5 pb-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
                24 h history
              </p>
              {/* Metric toggles */}
              <div className="flex gap-1.5">
                {CHART_METRICS.map(m => (
                  <button key={m.key}
                    onClick={() => toggleMetric(m.key)}
                    className={`text-xs px-2 py-0.5 rounded-full border transition-all ${
                      activeMetrics.includes(m.key)
                        ? 'text-white border-transparent'
                        : 'bg-white text-gray-400 border-gray-200'
                    }`}
                    style={activeMetrics.includes(m.key) ? { background: m.color, borderColor: m.color } : {}}>
                    {m.key}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-gray-50 rounded-2xl p-3 border border-gray-100">
              {loadHist ? (
                <div className="h-44 flex items-center justify-center text-gray-400 text-sm">
                  <div className="text-center">
                    <div className="text-2xl mb-1 animate-pulse">📊</div>
                    Loading chart…
                  </div>
                </div>
              ) : history.length === 0 ? (
                <div className="h-44 flex items-center justify-center text-gray-300 text-sm
                                border-2 border-dashed border-gray-200 rounded-xl">
                  <div className="text-center">
                    <div className="text-3xl mb-1">📈</div>
                    No data yet — send telemetry first
                  </div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={history}>
                    <defs>
                      {CHART_METRICS.map(m => (
                        <linearGradient key={m.key} id={`grad${m.key}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={m.color} stopOpacity={0.15}/>
                          <stop offset="95%" stopColor={m.color} stopOpacity={0}/>
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                    <XAxis dataKey="t" tick={{ fontSize: 9 }} interval="preserveStartEnd"/>
                    <YAxis tick={{ fontSize: 9 }} width={28}/>
                    <Tooltip
                      contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb' }}
                      labelStyle={{ fontWeight: 600 }}
                    />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }}/>
                    {CHART_METRICS.filter(m => activeMetrics.includes(m.key)).map(m => (
                      <Area
                        key={m.key}
                        type="monotone"
                        dataKey={m.key}
                        stroke={m.color}
                        strokeWidth={2}
                        fill={`url(#grad${m.key})`}
                        dot={false}
                        connectNulls
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Device info */}
          <div className="px-5 pb-8 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
              Device info
            </p>
            <div className="rounded-2xl border border-gray-100 overflow-hidden divide-y divide-gray-50">
              {[
                ['Device ID',      node.device_id,                  true],
                ['Firmware',       `v${node.firmware_version || '0.0.0'}`, false],
                ['Gateway',        node.gateway?.name || '—',       false],
                ['Valve state',    node.valve_state,                false],
                ['Pump state',     node.pump_state,                 false],
                ['Report every',   `${node.report_interval_sec}s`,  false],
              ].map(([k, v, mono]) => (
                <div key={k} className="flex items-center justify-between px-4 py-3 bg-white">
                  <span className="text-sm text-gray-400">{k}</span>
                  <span className={`text-sm font-semibold text-gray-800 ${mono ? 'font-mono' : ''}`}>
                    {v}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════
export default function FarmDetailPage() {
  const { id }  = useParams();
  const nav     = useNavigate();
  const token   = useAuthStore(s => s.token);

  const [farm,     setFarm]     = useState(null);
  const [gateways, setGateways] = useState([]);
  const [nodes,    setNodes]    = useState([]);
  const [liveData, setLiveData] = useState({});
  const [selected, setSelected] = useState(null);
  const [filter,   setFilter]   = useState('all');
  const [search,   setSearch]   = useState('');
  const [, setTick] = useState(0);
  const socketRef  = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    const [fRes, gRes, nRes] = await Promise.all([
      api.get(`/farms/${id}`),
      api.get(`/farms/${id}/gateways`),
      api.get(`/farms/${id}/nodes`),
    ]);
    setFarm(fRes.data.data.farm);
    setGateways(gRes.data.data.gateways || []);
    setNodes(nRes.data.data.nodes       || []);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Socket
  useEffect(() => {
    if (!token || !id) return;
    const socket = io(import.meta.env.VITE_API_URL || undefined, {
      auth: { token }, transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('join:farm', id));

    socket.on('sensor:data', d => {
      setLiveData(prev => ({ ...prev, [d.deviceId]: d }));
      setNodes(prev => prev.map(n =>
        n.device_id === d.deviceId
          ? { ...n, status: 'online', last_seen: new Date(), battery_pct: d.battery_pct }
          : n
      ));
      setSelected(prev => prev?.device_id === d.deviceId
        ? { ...prev, status: 'online', last_seen: new Date() } : prev);
    });

    socket.on('node:status', d => {
      const on = d.online ?? (d.status === 'online');
      setNodes(prev => prev.map(n =>
        n.device_id === d.device_id
          ? { ...n, status: on ? 'online' : 'offline',
              last_seen:   on ? new Date() : n.last_seen,
              valve_state: d.valve ?? n.valve_state,
              pump_state:  d.pump  ?? n.pump_state }
          : n
      ));
      setSelected(prev => prev?.device_id === d.device_id
        ? { ...prev, status: on ? 'online' : 'offline',
            valve_state: d.valve ?? prev.valve_state,
            pump_state:  d.pump  ?? prev.pump_state } : prev);
    });

    socket.on('gateway:status', d =>
      setGateways(prev => prev.map(g =>
        g.device_id === d.device_id ? { ...g, ...d } : g
      ))
    );

    return () => { socket.emit('leave:farm', id); socket.disconnect(); };
  }, [token, id]);

  const handleCommand = async (node, action) => {
    await api.post(`/nodes/${node._id}/${action}`);
  };

  // Filtered nodes
  const visible = nodes
    .filter(n => filter === 'all' || n.status === filter)
    .filter(n => !search ||
      n.name.toLowerCase().includes(search.toLowerCase()) ||
      n.device_id.toLowerCase().includes(search.toLowerCase())
    );

  if (!farm) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center text-gray-400 space-y-2">
        <div className="text-5xl animate-pulse">🌱</div>
        <p className="text-sm">Loading farm…</p>
      </div>
    </div>
  );

  const onlineNodes    = nodes.filter(n => n.status === 'online').length;
  const offlineNodes   = nodes.filter(n => n.status === 'offline').length;
  const onlineGWs      = gateways.filter(g => g.status === 'online').length;

  const avgSoil = (() => {
    const v = nodes.map(n => liveData[n.device_id]?.soil_moisture_pct).filter(x => x != null);
    return v.length ? Math.round(v.reduce((a,b)=>a+b,0)/v.length) : null;
  })();
  const avgTemp = (() => {
    const v = nodes.map(n => liveData[n.device_id]?.temperature_c).filter(x => x != null);
    return v.length ? (v.reduce((a,b)=>a+b,0)/v.length).toFixed(1) : null;
  })();

  return (
    <div className="space-y-6 pb-10">

      {/* ── Breadcrumb ── */}
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <button onClick={() => nav('/farms')}
          className="hover:text-green-700 transition-colors font-medium">
          ← Farms
        </button>
        <span>/</span>
        <span className="text-gray-700 font-semibold">{farm.name}</span>
      </div>

      {/* ── Hero header ── */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br
                      from-green-600 via-emerald-600 to-teal-600 p-6 text-white shadow-lg shadow-green-200">
        {/* decorative circles */}
        <div className="absolute -top-8 -right-8 w-40 h-40 bg-white/10 rounded-full"/>
        <div className="absolute -bottom-12 right-24 w-56 h-56 bg-white/5 rounded-full"/>

        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-green-200 text-sm font-medium mb-1">Farm overview</p>
            <h1 className="text-3xl font-black">{farm.name}</h1>
            <p className="text-green-100 text-sm mt-1">
              {farm.location?.address || farm.location?.country || 'No location set'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              ['🌾', farm.crop_type    || '—'],
              ['📐', farm.size_ha ? `${farm.size_ha} ha` : '—'],
              ['⚙️', farm.irrigation_mode || '—'],
              ['🕐', farm.timezone    || 'UTC'],
            ].map(([ic, vl]) => (
              <div key={vl} className="bg-white/20 backdrop-blur-sm rounded-xl px-3 py-1.5 text-sm font-medium">
                {ic} {vl}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Stats row ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon="🔌" label="Nodes online"
          value={`${onlineNodes} / ${nodes.length}`}
          sub={offlineNodes > 0 ? `${offlineNodes} offline` : 'All good'}
          accent={onlineNodes > 0}/>
        <StatCard icon="📡" label="Gateways"
          value={`${onlineGWs} / ${gateways.length}`}
          accent={onlineGWs > 0}/>
        <StatCard icon="🌱" label="Avg soil moisture"
          value={avgSoil != null ? `${avgSoil}%` : '—'}
          sub={soilLabel(avgSoil).text}/>
        <StatCard icon="🌡️" label="Avg temperature"
          value={avgTemp != null ? `${avgTemp}°C` : '—'}/>
      </div>

      {/* ── Gateways ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">
            Gateways
            <span className="ml-2 text-sm text-gray-400 font-normal">{gateways.length} registered</span>
          </h2>
          {onlineGWs < gateways.length && (
            <span className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200
                             px-3 py-1 rounded-full animate-pulse">
              ⚠️ {gateways.length - onlineGWs} gateway{gateways.length - onlineGWs > 1 ? 's' : ''} offline
            </span>
          )}
        </div>
        {gateways.length === 0 ? (
          <div className="text-sm text-gray-400 text-center py-8 border-2 border-dashed border-gray-200 rounded-2xl">
            No gateways registered for this farm.
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
            {gateways.map(gw => <GatewayCard key={gw._id} gw={gw}/>)}
          </div>
        )}
      </div>

      {/* ── Nodes ── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-gray-800">
            Nodes
            <span className="ml-2 text-sm text-gray-400 font-normal">{nodes.length} registered</span>
          </h2>
          {offlineNodes > 0 && (
            <span className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200
                             px-3 py-1 rounded-full">
              🔴 {offlineNodes} node{offlineNodes > 1 ? 's' : ''} offline
            </span>
          )}
        </div>

        {/* Filter + search */}
        {nodes.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
              {[
                ['all', `All (${nodes.length})`],
                ['online', `🟢 Online (${onlineNodes})`],
                ['offline', `🔴 Offline (${offlineNodes})`],
              ].map(([f, label]) => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                    filter === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search nodes…"
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm flex-1 min-w-40
                         focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
        )}

        {nodes.length === 0 ? (
          <div className="text-center py-16 text-gray-400 border-2 border-dashed border-gray-200 rounded-2xl">
            <div className="text-5xl mb-3">📡</div>
            <p className="font-medium text-gray-700">No nodes yet</p>
            <p className="text-sm mt-1">Register your first ESP32 node to start monitoring</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <p>No nodes match your filter.</p>
            <button onClick={() => { setFilter('all'); setSearch(''); }}
              className="text-sm text-green-600 mt-2 hover:underline">Clear filters</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {visible.map(node => (
              <NodeCard
                key={node._id}
                node={node}
                live={liveData[node.device_id]}
                onClick={() => setSelected(node)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Node drawer ── */}
      {selected && (
        <NodeDrawer
          node={nodes.find(n => n._id === selected._id) || selected}
          live={liveData[selected.device_id]}
          onClose={() => setSelected(null)}
          onCommand={handleCommand}
        />
      )}
    </div>
  );
}

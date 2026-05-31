import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useSocket } from '../hooks/useSocket';

const EMPTY = { name: '', device_id: '', firmware_version: '0.0.0', tls_enabled: false };

function timeAgo(date) {
  if (!date) return '—';
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 5)    return 'just now';
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return new Date(date).toLocaleTimeString();
}
function uptimeLabel(s) {
  if (s == null) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
function rssiInfo(r) {
  if (r == null || r === 0) return { label: '—', quality: '—', color: 'text-gray-400', bars: 0 };
  if (r >= -50) return { label: `${r} dBm`, quality: 'Excellent', color: 'text-green-600',  bars: 4 };
  if (r >= -65) return { label: `${r} dBm`, quality: 'Good',      color: 'text-green-500',  bars: 3 };
  if (r >= -75) return { label: `${r} dBm`, quality: 'Fair',      color: 'text-yellow-500', bars: 2 };
  return               { label: `${r} dBm`, quality: 'Weak',      color: 'text-red-500',    bars: 1 };
}

function StatusPill({ status }) {
  const on = status === 'online';
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
      on ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
    }`}>
      {on ? (
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75"/>
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500"/>
        </span>
      ) : <span className="h-1.5 w-1.5 rounded-full bg-red-500"/>}
      {on ? 'Online' : 'Offline'}
    </span>
  );
}

function SignalBars({ bars }) {
  return (
    <span className="inline-flex items-end gap-0.5 h-4">
      {[1,2,3,4].map(i => (
        <span key={i} className={`inline-block w-1.5 rounded-sm transition-all ${
          i <= bars ? 'bg-current' : 'bg-current opacity-20'
        }`} style={{ height: `${i * 25}%` }}/>
      ))}
    </span>
  );
}

// ── Gateway card ──────────────────────────────────────────────────
function GatewayCard({ gw, onFarmClick }) {
  const online  = gw.status === 'online';
  const ri      = rssiInfo(gw.rssi);

  return (
    <div className={`rounded-3xl border overflow-hidden transition-all duration-300 shadow-sm
                     hover:shadow-lg hover:-translate-y-0.5 group ${
      online ? 'border-green-200 bg-white' : 'border-red-200 bg-red-50'
    }`}>

      {/* Gradient top bar */}
      <div className={`h-1.5 ${
        online ? 'bg-gradient-to-r from-green-400 to-emerald-500'
               : 'bg-gradient-to-r from-red-400 to-red-500'
      }`}/>

      <div className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-2xl">📡</span>
              <p className="font-bold text-gray-900 truncate">{gw.name}</p>
            </div>
            <p className="text-xs font-mono text-gray-400 mt-0.5 ml-8">{gw.device_id}</p>
          </div>
          <StatusPill status={gw.status}/>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2">
          {/* IP */}
          <div className="bg-gray-50 rounded-2xl p-3">
            <p className="text-xs text-gray-400 mb-1">🌐 IP Address</p>
            <p className="text-sm font-mono font-semibold text-gray-800 truncate">{gw.ip || '—'}</p>
          </div>
          {/* Firmware */}
          <div className="bg-gray-50 rounded-2xl p-3">
            <p className="text-xs text-gray-400 mb-1">⚙️ Firmware</p>
            <p className="text-sm font-mono font-semibold text-gray-800">v{gw.firmware_version || '—'}</p>
          </div>
          {/* WiFi signal */}
          <div className={`rounded-2xl p-3 ${ri.bars === 0 ? 'bg-gray-50' : ri.bars >= 3 ? 'bg-green-50' : ri.bars === 2 ? 'bg-yellow-50' : 'bg-red-50'}`}>
            <p className="text-xs text-gray-400 mb-1">📶 WiFi signal</p>
            <div className={`flex items-center gap-1.5 ${ri.color}`}>
              <SignalBars bars={ri.bars}/>
              <span className="text-sm font-semibold">{ri.quality}</span>
            </div>
            <p className={`text-xs font-mono mt-0.5 ${ri.color}`}>{ri.label}</p>
          </div>
          {/* Uptime */}
          <div className="bg-gray-50 rounded-2xl p-3">
            <p className="text-xs text-gray-400 mb-1">⏱️ Uptime</p>
            <p className="text-sm font-semibold text-gray-800">{uptimeLabel(gw.uptime_s)}</p>
          </div>
        </div>

        {/* TLS badge */}
        {gw.tls_enabled && (
          <div className="flex items-center gap-1.5 text-xs text-blue-700 bg-blue-50 rounded-xl px-3 py-1.5 w-fit">
            🔒 TLS enabled
          </div>
        )}

        {/* Footer */}
        <div className={`flex items-center justify-between text-xs pt-3 border-t ${
          online ? 'border-green-100' : 'border-red-100'
        }`}>
          <div className="flex items-center gap-1.5 text-gray-400">
            <span>💓 Last heartbeat</span>
          </div>
          <span className={`font-semibold ${online ? 'text-green-600' : 'text-red-500'}`}>
            {timeAgo(gw.last_heartbeat)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Register modal ─────────────────────────────────────────────────
function RegisterModal({ farmId, farmName, onClose, onSaved }) {
  const [form,   setForm]   = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const inp = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500';

  const submit = async () => {
    if (!form.name.trim())      return setError('Name is required.');
    if (!form.device_id.trim()) return setError('Device ID is required.');
    setSaving(true); setError('');
    try {
      await api.post(`/farms/${farmId}/gateways`, form);
      onSaved();
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to register gateway.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="bg-gradient-to-r from-indigo-600 to-blue-600 px-6 py-5 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold">Register Gateway</h2>
              <p className="text-blue-100 text-sm mt-0.5">{farmName}</p>
            </div>
            <button onClick={onClose}
              className="text-white/70 hover:text-white hover:bg-white/20 rounded-xl w-9 h-9
                         flex items-center justify-center text-xl transition-colors">
              ×
            </button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Gateway name <span className="text-red-400">*</span></label>
            <input value={form.name} onChange={e => set('name', e.target.value)}
              className={inp} placeholder="e.g. Main Gateway"/>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Device ID <span className="text-red-400">*</span></label>
            <input value={form.device_id} onChange={e => set('device_id', e.target.value)}
              className={`${inp} font-mono`} placeholder="e.g. gate-433"/>
            <p className="text-xs text-gray-400">
              Must match <code className="bg-gray-100 px-1 rounded">DEVICE_ID</code> in your ESP32 firmware exactly.
            </p>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Firmware version</label>
            <input value={form.firmware_version} onChange={e => set('firmware_version', e.target.value)}
              className={`${inp} font-mono`} placeholder="1.0.0"/>
          </div>
          <label className="flex items-center gap-3 cursor-pointer bg-gray-50 rounded-xl px-4 py-3">
            <input type="checkbox" checked={form.tls_enabled}
              onChange={e => set('tls_enabled', e.target.checked)}
              className="w-4 h-4 accent-green-600"/>
            <div>
              <p className="text-sm font-medium text-gray-700">TLS / SSL enabled</p>
              <p className="text-xs text-gray-400">Encrypt MQTT connection</p>
            </div>
          </label>
          {error && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 pb-6 flex gap-3">
          <button onClick={onClose}
            className="flex-1 border border-gray-200 text-gray-600 text-sm py-2.5 rounded-xl hover:bg-gray-50 transition">
            Cancel
          </button>
          <button onClick={submit} disabled={saving}
            className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-xl transition">
            {saving ? 'Registering…' : '✓ Register gateway'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────
export default function GatewaysPage() {
  const [farms,     setFarms]     = useState([]);
  const [gateways,  setGateways]  = useState([]);
  const [farmId,    setFarmId]    = useState('');
  const [loading,   setLoading]   = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [, setTick] = useState(0);
  const nav = useNavigate();

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    api.get('/farms').then(r => {
      const list = r.data.data.farms || [];
      setFarms(list);
      if (list.length === 1) setFarmId(list[0]._id);
    });
  }, []);

  const fetchGateways = (fid) => {
    if (!fid) return setGateways([]);
    setLoading(true);
    api.get(`/farms/${fid}/gateways`)
      .then(r => setGateways(r.data.data.gateways || []))
      .finally(() => setLoading(false));
  };
  useEffect(() => { fetchGateways(farmId); }, [farmId]);

  useSocket(farmId, {
    'gateway:status': (d) => {
      setGateways(prev => prev.map(gw =>
        gw.device_id === d.device_id
          ? { ...gw, status: d.status, ip: d.ip ?? gw.ip,
              rssi: d.rssi ?? gw.rssi, uptime_s: d.uptime_s ?? gw.uptime_s,
              last_heartbeat: d.ts ?? gw.last_heartbeat }
          : gw
      ));
    },
  });

  const online  = gateways.filter(g => g.status === 'online').length;
  const offline = gateways.filter(g => g.status === 'offline').length;
  const selectedFarm = farms.find(f => f._id === farmId);

  return (
    <div className="space-y-6">

      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br
                      from-indigo-600 via-blue-600 to-cyan-600 p-6 text-white shadow-lg shadow-blue-200">
        <div className="absolute -top-8 -right-8 w-40 h-40 bg-white/10 rounded-full"/>
        <div className="absolute -bottom-12 right-24 w-56 h-56 bg-white/5 rounded-full"/>
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-blue-200 text-sm">Network</p>
            <h1 className="text-3xl font-black mt-1">Gateways</h1>
            {farmId && gateways.length > 0 && (
              <p className="text-blue-100 text-sm mt-1">
                {online} online · {offline > 0 ? <span className="text-red-300">{offline} offline</span> : '0 offline'} · {gateways.length} total
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <select value={farmId} onChange={e => setFarmId(e.target.value)}
              className="bg-white/20 backdrop-blur-sm text-white text-sm border border-white/30
                         rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-white/50">
              <option value="" className="text-gray-800">Select farm…</option>
              {farms.map(f => <option key={f._id} value={f._id} className="text-gray-800">{f.name}</option>)}
            </select>
            {farmId && (
              <button onClick={() => setShowModal(true)}
                className="flex items-center gap-2 bg-white text-indigo-700 font-bold text-sm
                           px-4 py-2 rounded-xl hover:bg-blue-50 transition shadow-lg shadow-blue-900/20">
                <span>+</span> Add
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      {farmId && gateways.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: '📡', label: 'Total',   value: gateways.length, color: 'text-gray-800' },
            { icon: '🟢', label: 'Online',  value: online,          color: 'text-green-700' },
            { icon: '🔴', label: 'Offline', value: offline,         color: offline > 0 ? 'text-red-600' : 'text-gray-400' },
          ].map(s => (
            <div key={s.label} className="bg-white border border-gray-100 rounded-2xl px-4 py-3 shadow-sm">
              <p className="text-xs text-gray-400">{s.icon} {s.label}</p>
              <p className={`text-2xl font-black mt-0.5 ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Offline warning */}
      {offline > 0 && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
          <span className="text-xl">🚨</span>
          <p className="text-sm font-semibold text-red-700">
            {offline} gateway{offline > 1 ? 's' : ''} offline — check power and network connection
          </p>
        </div>
      )}

      {/* Empty states */}
      {!farmId && (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">📡</div>
          <p className="text-lg font-bold text-gray-700">Select a farm</p>
          <p className="text-sm text-gray-400 mt-1">Choose a farm above to view its gateways</p>
        </div>
      )}

      {farmId && loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1,2].map(i => <div key={i} className="h-56 bg-gray-100 rounded-3xl animate-pulse"/>)}
        </div>
      )}

      {farmId && !loading && gateways.length === 0 && (
        <div className="text-center py-20 border-2 border-dashed border-gray-200 rounded-3xl">
          <div className="text-6xl mb-4">📡</div>
          <p className="text-lg font-bold text-gray-700">No gateways yet</p>
          <p className="text-sm text-gray-400 mt-1 mb-4">Register your ESP32 gateway to start</p>
          <button onClick={() => setShowModal(true)}
            className="bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-2.5 rounded-2xl transition">
            + Register gateway
          </button>
        </div>
      )}

      {/* Grid */}
      {!loading && gateways.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {gateways.map(gw => <GatewayCard key={gw._id} gw={gw}/>)}
        </div>
      )}

      {showModal && farmId && (
        <RegisterModal
          farmId={farmId}
          farmName={selectedFarm?.name}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); fetchGateways(farmId); }}
        />
      )}
    </div>
  );
}

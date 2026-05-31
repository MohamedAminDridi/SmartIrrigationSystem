import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import api from '../services/api';
import { useAuthStore } from '../store/authStore';

// ── Helpers ───────────────────────────────────────────────────────
function timeAgo(date) {
  if (!date) return '—';
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 5)    return 'just now';
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return new Date(date).toLocaleTimeString();
}
function soilGrad(p) {
  if (p == null) return 'from-gray-200 to-gray-300';
  if (p < 20)   return 'from-red-400 to-red-500';
  if (p < 40)   return 'from-yellow-400 to-orange-400';
  if (p < 70)   return 'from-green-400 to-green-600';
  return 'from-blue-400 to-blue-600';
}
function soilText(p) {
  if (p == null) return { t: 'No data', c: 'text-gray-400' };
  if (p < 20)   return { t: 'Very dry', c: 'text-red-500' };
  if (p < 40)   return { t: 'Dry',      c: 'text-yellow-600' };
  if (p < 70)   return { t: 'Good',     c: 'text-green-600' };
  return               { t: 'Wet',      c: 'text-blue-600' };
}
function batColor(p) {
  if (p == null) return 'text-gray-400';
  if (p > 60)   return 'text-green-600';
  if (p > 30)   return 'text-yellow-500';
  return 'text-red-500';
}
function batIcon(p) {
  if (p == null || p > 60) return '🔋';
  if (p > 30) return '🪫';
  return '⚠️';
}
function rssiInfo(r) {
  if (!r) return { label: '—', color: 'text-gray-400', bars: 0 };
  if (r >= -50) return { label: `${r} dBm`, color: 'text-green-600',  bars: 4 };
  if (r >= -65) return { label: `${r} dBm`, color: 'text-green-500',  bars: 3 };
  if (r >= -75) return { label: `${r} dBm`, color: 'text-yellow-500', bars: 2 };
  return               { label: `${r} dBm`, color: 'text-red-500',    bars: 1 };
}
function RssiBars({ bars }) {
  return (
    <span className="inline-flex items-end gap-px h-3">
      {[1,2,3,4].map(i => (
        <span key={i} className={`inline-block w-1 rounded-sm ${
          i <= bars ? 'bg-current' : 'bg-current opacity-20'
        }`} style={{ height: `${i * 25}%` }}/>
      ))}
    </span>
  );
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

// ── Node card ─────────────────────────────────────────────────────
function NodeCard({ node, live, onAction, cmdState }) {
  const d      = live || {};
  const soil   = d.soil_moisture_pct ?? null;
  const temp   = d.temperature_c     ?? null;
  const hum    = d.humidity_pct      ?? null;
  const bat    = d.battery_pct       ?? node.battery_pct;
  const rssi   = d.rssi              ?? null;
  const ri     = rssiInfo(rssi);
  const sl     = soilText(soil);
  const online = node.status === 'online';
  const cs     = cmdState;

  return (
    <div className={`relative rounded-3xl border overflow-hidden transition-all duration-300
                     shadow-sm hover:shadow-lg ${
      online ? 'bg-white border-green-200' : 'bg-red-50 border-red-200'
    }`}>
      {/* Command overlay */}
      {cs && (
        <div className={`absolute inset-0 z-10 flex items-center justify-center rounded-3xl
                         backdrop-blur-sm ${
          cs === 'loading' ? 'bg-white/70' :
          cs === 'ok'      ? 'bg-green-50/90' : 'bg-red-50/90'
        }`}>
          <span className="text-4xl">
            {cs === 'loading' ? '⏳' : cs === 'ok' ? '✅' : '❌'}
          </span>
        </div>
      )}

      {/* Top accent bar */}
      <div className={`h-1 ${
        online ? 'bg-gradient-to-r from-green-400 to-emerald-500'
               : 'bg-gradient-to-r from-red-400 to-red-500'
      }`}/>

      <div className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-bold text-gray-900 truncate">{node.name}</p>
            <p className="text-xs font-mono text-gray-400 mt-0.5">{node.device_id}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <StatusPill status={node.status}/>
            <span className={`text-xs ${online ? 'text-green-500' : 'text-red-400'}`}>
              {timeAgo(node.last_seen)}
            </span>
          </div>
        </div>

        {/* Soil bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-gray-500 font-medium">🌱 Soil moisture</span>
            <div className="flex items-center gap-1.5">
              <span className={`font-semibold ${sl.c}`}>{sl.t}</span>
              <span className="font-bold text-gray-800">{soil != null ? `${soil}%` : '—'}</span>
            </div>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full bg-gradient-to-r transition-all duration-700 ${soilGrad(soil)}`}
                 style={{ width: `${soil ?? 0}%` }}/>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-4 gap-1.5 text-xs">
          <div className="bg-gray-50 rounded-xl p-2 text-center">
            <p className="text-gray-400">Temp</p>
            <p className={`font-bold mt-0.5 ${temp > 35 ? 'text-red-500' : temp > 28 ? 'text-orange-500' : 'text-gray-800'}`}>
              {temp != null ? `${temp.toFixed(1)}°` : '—'}
            </p>
          </div>
          <div className="bg-gray-50 rounded-xl p-2 text-center">
            <p className="text-gray-400">Hum</p>
            <p className="font-bold text-blue-600 mt-0.5">{hum != null ? `${Math.round(hum)}%` : '—'}</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-2 text-center">
            <p className="text-gray-400">Bat</p>
            <p className={`font-bold mt-0.5 ${batColor(bat)}`}>{bat != null ? `${bat}%` : '—'}</p>
          </div>
          <div className={`bg-gray-50 rounded-xl p-2 text-center ${ri.color}`}>
            <p className="text-gray-400">RSSI</p>
            <div className="flex justify-center mt-1"><RssiBars bars={ri.bars}/></div>
          </div>
        </div>

        {/* Valve + pump controls */}
        <div className="flex gap-2">
          <button
            onClick={() => onAction(node, node.valve_state === 'open' ? 'valve/close' : 'valve/open')}
            className={`flex-1 text-xs font-semibold py-2.5 rounded-2xl border-2 transition-all active:scale-95 ${
              node.valve_state === 'open'
                ? 'bg-blue-500 border-blue-500 text-white hover:bg-blue-600'
                : 'bg-white border-gray-200 text-gray-700 hover:border-blue-300 hover:bg-blue-50'
            }`}>
            {node.valve_state === 'open' ? '🔓 Close valve' : '🔒 Open valve'}
          </button>
          <button
            onClick={() => onAction(node, node.pump_state === 'on' ? 'pump/stop' : 'pump/start')}
            className={`flex-1 text-xs font-semibold py-2.5 rounded-2xl border-2 transition-all active:scale-95 ${
              node.pump_state === 'on'
                ? 'bg-orange-500 border-orange-500 text-white hover:bg-orange-600'
                : 'bg-white border-gray-200 text-gray-700 hover:border-orange-300 hover:bg-orange-50'
            }`}>
            {node.pump_state === 'on' ? '⏹ Stop pump' : '▶ Start pump'}
          </button>
        </div>

        {/* Footer */}
        <div className={`flex justify-between text-xs text-gray-400 pt-2 border-t ${
          online ? 'border-green-50' : 'border-red-100'
        }`}>
          <span>📡 {node.gateway?.name || '—'}</span>
          <span className="font-mono">v{node.firmware_version || '—'}</span>
        </div>
      </div>
    </div>
  );
}

// ── Add node modal ─────────────────────────────────────────────────
const EMPTY_FORM = { farm_id:'', gateway_id:'', name:'', device_id:'', firmware_version:'' };

function AddNodeModal({ farms, defaultFarmId, onClose, onSaved }) {
  const [form,      setForm]      = useState({ ...EMPTY_FORM, farm_id: defaultFarmId || '' });
  const [gateways,  setGateways]  = useState([]);
  const [gwLoading, setGwLoading] = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const [step,      setStep]      = useState(1);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const inp = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500';

  useEffect(() => {
    setGateways([]); set('gateway_id', '');
    if (!form.farm_id) return;
    setGwLoading(true);
    api.get(`/farms/${form.farm_id}/gateways`)
      .then(r => setGateways(r.data.data.gateways || []))
      .catch(() => setGateways([]))
      .finally(() => setGwLoading(false));
  }, [form.farm_id]);

  const submit = async () => {
    setSaving(true); setError('');
    try {
      await api.post(`/farms/${form.farm_id}/nodes`, {
        gateway: form.gateway_id, name: form.name.trim(),
        device_id: form.device_id.trim(),
        firmware_version: form.firmware_version.trim() || undefined,
      });
      onSaved(form.farm_id);
    } catch (e) {
      setError(e?.response?.data?.message || 'Failed to create node.');
      setSaving(false);
    }
  };

  const steps = ['Farm & Gateway', 'Node identity', 'Confirm'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-green-600 to-emerald-600 px-6 py-5 text-white">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold">Register Node</h2>
            <button onClick={onClose}
              className="text-white/70 hover:text-white hover:bg-white/20 rounded-xl w-9 h-9
                         flex items-center justify-center text-xl transition-colors">×</button>
          </div>
          {/* Steps */}
          <div className="flex items-center gap-2">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center gap-2 flex-1">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                  i+1 < step  ? 'bg-white text-green-700' :
                  i+1 === step? 'bg-white/30 text-white ring-2 ring-white' :
                                'bg-white/10 text-white/50'
                }`}>{i+1 < step ? '✓' : i+1}</div>
                <span className={`text-xs flex-1 hidden sm:block ${i+1 === step ? 'text-white' : 'text-white/50'}`}>{s}</span>
                {i < steps.length-1 && <div className={`h-px flex-1 ${i+1 < step ? 'bg-white/60' : 'bg-white/20'}`}/>}
              </div>
            ))}
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          {step === 1 && (<>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Farm <span className="text-red-400">*</span></label>
              <select value={form.farm_id} onChange={e => set('farm_id', e.target.value)} className={inp}>
                <option value="">Select farm…</option>
                {farms.map(f => <option key={f._id} value={f._id}>{f.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Gateway <span className="text-red-400">*</span></label>
              <select value={form.gateway_id} onChange={e => set('gateway_id', e.target.value)}
                disabled={!form.farm_id || gwLoading} className={`${inp} disabled:opacity-50`}>
                <option value="">
                  {!form.farm_id ? 'Select farm first…' : gwLoading ? 'Loading…' :
                   gateways.length === 0 ? 'No gateways' : 'Select gateway…'}
                </option>
                {gateways.map(g => <option key={g._id} value={g._id}>{g.name} — {g.device_id}</option>)}
              </select>
            </div>
          </>)}

          {step === 2 && (<>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Node name <span className="text-red-400">*</span></label>
              <input value={form.name} onChange={e => set('name', e.target.value)}
                className={inp} placeholder="e.g. Field Row 3 – Node A"/>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Device ID <span className="text-red-400">*</span></label>
              <input value={form.device_id} onChange={e => set('device_id', e.target.value)}
                className={`${inp} font-mono`} placeholder="e.g. node-1-433"/>
              <p className="text-xs text-gray-400">
                Must match <code className="bg-gray-100 px-1 rounded">NODE_ID</code> in your ESP32 firmware exactly.
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Firmware <span className="text-gray-400 font-normal">(optional)</span></label>
              <input value={form.firmware_version} onChange={e => set('firmware_version', e.target.value)}
                className={`${inp} font-mono`} placeholder="1.0.0"/>
            </div>
          </>)}

          {step === 3 && (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">Review before registering:</p>
              {[
                ['Farm',     farms.find(f => f._id === form.farm_id)?.name],
                ['Gateway',  gateways.find(g => g._id === form.gateway_id)?.name],
                ['Name',     form.name],
                ['Device ID',form.device_id],
                ['Firmware', form.firmware_version || '0.0.0'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between bg-gray-50 rounded-xl px-4 py-2.5">
                  <span className="text-sm text-gray-500">{k}</span>
                  <span className="text-sm font-semibold text-gray-900 font-mono">{v || '—'}</span>
                </div>
              ))}
              <div className="bg-blue-50 rounded-xl px-4 py-3 text-xs text-blue-700">
                The node will appear <strong>offline</strong> until the ESP32 sends its first LoRa packet.
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>
          )}
        </div>

        <div className="px-6 pb-6 flex gap-3">
          {step > 1 && (
            <button onClick={() => { setStep(s => s-1); setError(''); }}
              className="flex-1 border border-gray-200 text-gray-600 text-sm py-2.5 rounded-xl hover:bg-gray-50 transition">
              ← Back
            </button>
          )}
          {step < 3 ? (
            <button onClick={() => {
              if (step === 1 && (!form.farm_id || !form.gateway_id)) return setError('Select farm and gateway.');
              if (step === 2 && (!form.name.trim() || !form.device_id.trim())) return setError('Name and Device ID required.');
              setError(''); setStep(s => s+1);
            }}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold py-2.5 rounded-xl transition">
              Continue →
            </button>
          ) : (
            <button onClick={submit} disabled={saving}
              className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-xl transition">
              {saving ? 'Registering…' : '✓ Register node'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────
export default function NodesPage() {
  const [farms,     setFarms]     = useState([]);
  const [nodes,     setNodes]     = useState([]);
  const [farmId,    setFarmId]    = useState('');
  const [showModal, setShowModal] = useState(false);
  const [liveData,  setLiveData]  = useState({});
  const [filter,    setFilter]    = useState('all');
  const [search,    setSearch]    = useState('');
  const [cmdState,  setCmdState]  = useState({});
  const [, setTick] = useState(0);
  const token  = useAuthStore(s => s.token);
  const socket = useRef(null);
  const nav    = useNavigate();

  useEffect(() => {
    const id = setInterval(() => setTick(t => t+1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    api.get('/farms').then(r => {
      const list = r.data.data.farms || [];
      setFarms(list);
      if (list.length === 1) setFarmId(list[0]._id);
    });
  }, []);

  const loadNodes = useCallback((fid) => {
    if (!fid) return setNodes([]);
    api.get(`/farms/${fid}/nodes`).then(r => setNodes(r.data.data.nodes || []));
  }, []);

  useEffect(() => { loadNodes(farmId); }, [farmId, loadNodes]);

  useEffect(() => {
    if (!token || !farmId) return;
    const s = io(import.meta.env.VITE_API_URL || undefined, {
      auth: { token }, transports: ['websocket','polling'],
    });
    socket.current = s;
    s.on('connect', () => s.emit('join:farm', farmId));
    s.on('sensor:data', d => {
      setLiveData(prev => ({ ...prev, [d.deviceId]: d }));
      setNodes(prev => prev.map(n =>
        n.device_id === d.deviceId
          ? { ...n, status:'online', last_seen: new Date(), battery_pct: d.battery_pct } : n
      ));
    });
    s.on('node:status', d => {
      const on = d.online ?? (d.status === 'online');
      setNodes(prev => prev.map(n =>
        n.device_id === d.device_id
          ? { ...n, status: on?'online':'offline', last_seen: on?new Date():n.last_seen,
              valve_state: d.valve??n.valve_state, pump_state: d.pump??n.pump_state } : n
      ));
    });
    return () => { s.emit('leave:farm', farmId); s.disconnect(); };
  }, [token, farmId]);

  const handleAction = async (node, action) => {
    setCmdState(s => ({ ...s, [node._id]: 'loading' }));
    try {
      await api.post(`/nodes/${node._id}/${action}`);
      setCmdState(s => ({ ...s, [node._id]: 'ok' }));
      setTimeout(() => setCmdState(s => ({ ...s, [node._id]: null })), 2000);
    } catch {
      setCmdState(s => ({ ...s, [node._id]: 'err' }));
      setTimeout(() => setCmdState(s => ({ ...s, [node._id]: null })), 3000);
    }
  };

  const visible = nodes
    .filter(n => filter === 'all' || n.status === filter)
    .filter(n => !search || n.name.toLowerCase().includes(search.toLowerCase()) ||
                             n.device_id.toLowerCase().includes(search.toLowerCase()));

  const online  = nodes.filter(n => n.status === 'online').length;
  const offline = nodes.filter(n => n.status === 'offline').length;

  return (
    <div className="space-y-6">

      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br
                      from-green-600 via-emerald-600 to-teal-600 p-6 text-white shadow-lg shadow-green-200">
        <div className="absolute -top-8 -right-8 w-40 h-40 bg-white/10 rounded-full"/>
        <div className="absolute -bottom-12 right-24 w-56 h-56 bg-white/5 rounded-full"/>
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-green-200 text-sm">Sensor network</p>
            <h1 className="text-3xl font-black mt-1">Nodes</h1>
            {farmId && nodes.length > 0 && (
              <p className="text-green-100 text-sm mt-1">
                {online} online · {offline > 0 ? `${offline} offline` : 'all online'} · {nodes.length} total
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <select value={farmId} onChange={e => { setFarmId(e.target.value); setLiveData({}); }}
              className="bg-white/20 backdrop-blur-sm text-white text-sm border border-white/30
                         rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-white/50">
              <option value="" className="text-gray-800">Select farm…</option>
              {farms.map(f => <option key={f._id} value={f._id} className="text-gray-800">{f.name}</option>)}
            </select>
            <button onClick={() => setShowModal(true)}
              className="flex items-center gap-2 bg-white text-green-700 font-bold text-sm
                         px-4 py-2 rounded-xl hover:bg-green-50 transition shadow-lg shadow-green-900/20">
              <span>+</span> Add node
            </button>
          </div>
        </div>
      </div>

      {/* Stats + offline warning */}
      {farmId && nodes.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon:'🔌', label:'Total',   value: nodes.length, color:'text-gray-800' },
              { icon:'🟢', label:'Online',  value: online,       color:'text-green-700' },
              { icon:'🔴', label:'Offline', value: offline,      color: offline > 0 ? 'text-red-600':'text-gray-400' },
            ].map(s => (
              <div key={s.label} className="bg-white border border-gray-100 rounded-2xl px-4 py-3 shadow-sm">
                <p className="text-xs text-gray-400">{s.icon} {s.label}</p>
                <p className={`text-2xl font-black mt-0.5 ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
          {offline > 0 && (
            <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
              <span className="text-xl">🚨</span>
              <p className="text-sm font-semibold text-red-700">
                {offline} node{offline > 1 ? 's' : ''} offline — check LoRa connection and power
              </p>
            </div>
          )}
        </>
      )}

      {/* Filter + Search */}
      {farmId && nodes.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
            {[
              ['all',     `All (${nodes.length})`],
              ['online',  `🟢 Online (${online})`],
              ['offline', `🔴 Offline (${offline})`],
            ].map(([f, label]) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                  filter === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>{label}</button>
            ))}
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or device ID…"
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm flex-1 min-w-48
                       focus:outline-none focus:ring-2 focus:ring-green-500"/>
        </div>
      )}

      {/* Empty states */}
      {!farmId && (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">🔌</div>
          <p className="text-lg font-bold text-gray-700">Select a farm</p>
          <p className="text-sm text-gray-400 mt-1">Choose a farm to view its sensor nodes</p>
        </div>
      )}
      {farmId && nodes.length === 0 && (
        <div className="text-center py-20 border-2 border-dashed border-gray-200 rounded-3xl">
          <div className="text-6xl mb-4">📡</div>
          <p className="text-lg font-bold text-gray-700">No nodes yet</p>
          <p className="text-sm text-gray-400 mt-1 mb-4">Register your first ESP32 node to start monitoring</p>
          <button onClick={() => setShowModal(true)}
            className="bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-2.5 rounded-2xl transition">
            + Add first node
          </button>
        </div>
      )}
      {visible.length === 0 && nodes.length > 0 && (
        <div className="text-center py-10 text-gray-400">
          <p>No nodes match your filter.</p>
          <button onClick={() => { setFilter('all'); setSearch(''); }}
            className="text-sm text-green-600 mt-2 hover:underline">Clear filters</button>
        </div>
      )}

      {/* Grid */}
      {visible.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible.map(node => (
            <NodeCard
              key={node._id}
              node={node}
              live={liveData[node.device_id]}
              onAction={handleAction}
              cmdState={cmdState[node._id]}
            />
          ))}
        </div>
      )}

      {showModal && (
        <AddNodeModal
          farms={farms}
          defaultFarmId={farmId}
          onClose={() => setShowModal(false)}
          onSaved={(fid) => {
            setShowModal(false);
            if (fid !== farmId) setFarmId(fid);
            else loadNodes(fid);
          }}
        />
      )}
    </div>
  );
}

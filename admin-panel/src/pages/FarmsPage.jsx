import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

const MODES  = ['manual', 'auto', 'scheduled'];
const EMPTY  = {
  name: '', crop_type: '', size_ha: '', irrigation_mode: 'manual', timezone: 'UTC',
  location: { address: '', country: '', lat: '', lng: '' },
};

const CROP_ICONS = {
  tomatoes:'🍅', wheat:'🌾', corn:'🌽', rice:'🌾', cotton:'🌿',
  vegetables:'🥦', fruits:'🍊', default:'🌱',
};
function cropIcon(c) {
  if (!c) return '🌱';
  const k = Object.keys(CROP_ICONS).find(k => c.toLowerCase().includes(k));
  return CROP_ICONS[k] || CROP_ICONS.default;
}

const GRADIENTS = [
  'from-green-500 to-emerald-600',
  'from-teal-500 to-cyan-600',
  'from-blue-500 to-indigo-600',
  'from-violet-500 to-purple-600',
  'from-orange-500 to-amber-600',
  'from-rose-500 to-pink-600',
];

// ── Farm card ─────────────────────────────────────────────────────
function FarmCard({ farm, idx, onClick }) {
  const gradient = GRADIENTS[idx % GRADIENTS.length];
  return (
    <button onClick={onClick}
      className="group w-full text-left bg-white rounded-3xl border border-gray-100 shadow-sm
                 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 overflow-hidden">

      {/* Gradient header */}
      <div className={`relative bg-gradient-to-br ${gradient} p-5 text-white overflow-hidden`}>
        <div className="absolute -top-6 -right-6 w-24 h-24 bg-white/10 rounded-full"/>
        <div className="absolute -bottom-10 right-10 w-32 h-32 bg-white/5 rounded-full"/>
        <div className="relative flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-white/70 text-xs font-medium mb-1">Farm</p>
            <h3 className="text-xl font-black truncate">{farm.name}</h3>
            <p className="text-white/70 text-xs mt-1 truncate">
              {farm.location?.address || farm.location?.country || 'No location'}
            </p>
          </div>
          <span className="text-4xl flex-shrink-0 mt-1">{cropIcon(farm.crop_type)}</span>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            ['🌾', farm.crop_type || '—',                     'Crop'],
            ['📐', farm.size_ha ? `${farm.size_ha} ha` : '—', 'Size'],
            ['⚙️', farm.irrigation_mode || '—',               'Mode'],
          ].map(([ic, val, label]) => (
            <div key={label} className="bg-gray-50 rounded-xl py-2 px-1">
              <p className="text-base">{ic}</p>
              <p className="text-xs font-semibold text-gray-800 truncate mt-0.5">{val}</p>
              <p className="text-xs text-gray-400">{label}</p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-gray-400 pt-2
                        border-t border-gray-50">
          <span className={`font-medium px-2 py-0.5 rounded-full ${
            farm.isActive
              ? 'bg-green-100 text-green-700'
              : 'bg-gray-100 text-gray-500'
          }`}>
            {farm.isActive ? '● Active' : '○ Inactive'}
          </span>
          <span className="group-hover:text-green-600 transition-colors font-medium">
            View farm →
          </span>
        </div>
      </div>
    </button>
  );
}

// ── New Farm Modal ────────────────────────────────────────────────
function NewFarmModal({ onClose, onSaved }) {
  const [form,    setForm]    = useState(EMPTY);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [step,    setStep]    = useState(1);

  const set    = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setLoc = (k, v) => setForm(f => ({ ...f, location: { ...f.location, [k]: v } }));

  const submit = async () => {
    setSaving(true); setError('');
    try {
      await api.post('/farms', {
        ...form,
        size_ha:  form.size_ha  ? parseFloat(form.size_ha)  : 0,
        location: {
          address: form.location.address,
          country: form.location.country,
          lat: form.location.lat ? parseFloat(form.location.lat) : undefined,
          lng: form.location.lng ? parseFloat(form.location.lng) : undefined,
        },
      });
      onSaved();
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to create farm.');
      setSaving(false);
    }
  };

  const input = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 transition-shadow';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">

        {/* Modal header */}
        <div className="bg-gradient-to-r from-green-600 to-emerald-600 px-6 py-5 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold">New Farm</h2>
              <p className="text-green-100 text-sm">Step {step} of 2</p>
            </div>
            <button onClick={onClose}
              className="text-white/70 hover:text-white hover:bg-white/20 rounded-xl w-9 h-9
                         flex items-center justify-center text-xl transition-colors">
              ×
            </button>
          </div>
          {/* Progress bar */}
          <div className="mt-3 h-1.5 bg-white/20 rounded-full overflow-hidden">
            <div className="h-full bg-white rounded-full transition-all duration-500"
                 style={{ width: `${(step / 2) * 100}%` }}/>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          {step === 1 && (
            <>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Farm name <span className="text-red-400">*</span></label>
                <input value={form.name} onChange={e => set('name', e.target.value)}
                  className={input} placeholder="e.g. North Field Farm"/>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Crop type</label>
                  <input value={form.crop_type} onChange={e => set('crop_type', e.target.value)}
                    className={input} placeholder="e.g. tomatoes"/>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Size (ha)</label>
                  <input type="number" min="0" step="0.1" value={form.size_ha}
                    onChange={e => set('size_ha', e.target.value)}
                    className={input} placeholder="0"/>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Mode</label>
                  <select value={form.irrigation_mode} onChange={e => set('irrigation_mode', e.target.value)}
                    className={input}>
                    {MODES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Timezone</label>
                  <input value={form.timezone} onChange={e => set('timezone', e.target.value)}
                    className={input} placeholder="UTC"/>
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Address</label>
                <input value={form.location.address} onChange={e => setLoc('address', e.target.value)}
                  className={input} placeholder="e.g. Tunis, Tunisia"/>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Country</label>
                  <input value={form.location.country} onChange={e => setLoc('country', e.target.value)}
                    className={input} placeholder="TN" maxLength={2}/>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Latitude</label>
                  <input type="number" step="any" value={form.location.lat}
                    onChange={e => setLoc('lat', e.target.value)}
                    className={input} placeholder="36.8"/>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Longitude</label>
                  <input type="number" step="any" value={form.location.lng}
                    onChange={e => setLoc('lng', e.target.value)}
                    className={input} placeholder="10.1"/>
                </div>
              </div>
              {/* Preview card */}
              <div className={`rounded-2xl bg-gradient-to-br ${GRADIENTS[0]} p-4 text-white`}>
                <p className="text-white/70 text-xs mb-1">Preview</p>
                <p className="text-lg font-black">{form.name || 'Farm name'}</p>
                <p className="text-white/70 text-xs mt-0.5">
                  {form.location.address || 'No address'} · {form.crop_type || 'No crop'} · {form.size_ha || 0} ha
                </p>
              </div>
            </>
          )}

          {error && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 pb-6 flex gap-3">
          {step > 1 && (
            <button onClick={() => setStep(s => s - 1)}
              className="flex-1 border border-gray-200 text-gray-600 text-sm py-2.5 rounded-xl hover:bg-gray-50 transition">
              ← Back
            </button>
          )}
          {step < 2 ? (
            <button
              onClick={() => {
                if (!form.name.trim()) return setError('Farm name is required.');
                setError(''); setStep(2);
              }}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold py-2.5 rounded-xl transition">
              Continue →
            </button>
          ) : (
            <button onClick={submit} disabled={saving}
              className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-xl transition">
              {saving ? 'Creating…' : '✓ Create farm'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────
export default function FarmsPage() {
  const [farms,     setFarms]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [search,    setSearch]    = useState('');
  const nav = useNavigate();

  const load = () => {
    setLoading(true);
    api.get('/farms')
      .then(r => setFarms(r.data.data.farms || []))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const visible = farms.filter(f =>
    !search ||
    f.name.toLowerCase().includes(search.toLowerCase()) ||
    f.crop_type?.toLowerCase().includes(search.toLowerCase())
  );

  const activeCount = farms.filter(f => f.isActive).length;

  return (
    <div className="space-y-6">

      {/* Hero header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br
                      from-green-600 via-emerald-600 to-teal-700 p-6 text-white shadow-lg shadow-green-200">
        <div className="absolute -top-8 -right-8 w-40 h-40 bg-white/10 rounded-full"/>
        <div className="absolute -bottom-12 right-24 w-56 h-56 bg-white/5 rounded-full"/>
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-green-200 text-sm">Smart Irrigation</p>
            <h1 className="text-3xl font-black mt-1">My Farms</h1>
            <p className="text-green-100 text-sm mt-1">
              {farms.length} farm{farms.length !== 1 ? 's' : ''} · {activeCount} active
            </p>
          </div>
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-white text-green-700 font-bold text-sm
                       px-5 py-2.5 rounded-2xl hover:bg-green-50 transition shadow-lg shadow-green-900/20">
            <span className="text-lg">+</span> New farm
          </button>
        </div>
      </div>

      {/* Search */}
      {farms.length > 0 && (
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍  Search farms by name or crop…"
          className="w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm
                     focus:outline-none focus:ring-2 focus:ring-green-500 bg-white shadow-sm"/>
      )}

      {/* States */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1,2,3].map(i => (
            <div key={i} className="h-48 bg-gray-100 rounded-3xl animate-pulse"/>
          ))}
        </div>
      )}

      {!loading && farms.length === 0 && (
        <div className="text-center py-24 space-y-4">
          <div className="text-7xl">🌱</div>
          <p className="text-xl font-bold text-gray-700">No farms yet</p>
          <p className="text-gray-400">Create your first farm to start monitoring your irrigation</p>
          <button onClick={() => setShowModal(true)}
            className="bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-3 rounded-2xl transition shadow-lg shadow-green-200">
            + Create first farm
          </button>
        </div>
      )}

      {!loading && visible.length === 0 && farms.length > 0 && (
        <div className="text-center py-12 text-gray-400">
          <p>No farms match "<span className="font-medium text-gray-600">{search}</span>"</p>
          <button onClick={() => setSearch('')}
            className="text-sm text-green-600 mt-2 hover:underline">Clear search</button>
        </div>
      )}

      {!loading && visible.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible.map((f, i) => (
            <FarmCard key={f._id} farm={f} idx={i} onClick={() => nav(`/farms/${f._id}`)}/>
          ))}
        </div>
      )}

      {showModal && (
        <NewFarmModal
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(); }}
        />
      )}
    </div>
  );
}

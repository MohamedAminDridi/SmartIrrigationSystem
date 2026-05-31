import { useEffect, useState, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import api from '../services/api';
import { useAuthStore } from '../store/authStore';

// ── Helpers ───────────────────────────────────────────────────────
function fmtSize(b) {
  if (!b) return '—';
  if (b < 1024)      return `${b} B`;
  if (b < 1048576)   return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(2)} MB`;
}
function timeAgo(date) {
  if (!date) return '—';
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(date).toLocaleDateString();
}
function semverGt(a, b) {
  if (!a || !b) return false;
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}
function semverEq(a, b) {
  if (!a || !b) return false;
  return a.replace(/^v/, '') === b.replace(/^v/, '');
}

// ── Upload modal ──────────────────────────────────────────────────
function UploadModal({ onClose, onUploaded }) {
  const [version, setVersion] = useState('');
  const [notes,   setNotes]   = useState('');
  const [stable,  setStable]  = useState(false);
  const [file,    setFile]    = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const fileRef = useRef();

  const submit = async () => {
    if (!file)           return setError('Select a firmware file (.bin / .hex / .elf).');
    if (!version.trim()) return setError('Version is required (e.g. 1.2.3).');
    setSaving(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file',    file);
      fd.append('version', version.trim());
      fd.append('notes',   notes.trim());
      if (stable) fd.append('is_stable', 'true');
      await api.post('/ota/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onUploaded();
    } catch (e) {
      setError(e.response?.data?.message || 'Upload failed.');
      setSaving(false);
    }
  };

  const inp = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-5 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold">Upload Firmware</h2>
              <p className="text-indigo-200 text-sm mt-0.5">Max 2 MB · .bin / .hex / .elf</p>
            </div>
            <button onClick={onClose}
              className="text-white/70 hover:text-white hover:bg-white/20 rounded-xl w-9 h-9
                         flex items-center justify-center text-xl transition-colors">×</button>
          </div>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-colors ${
              file ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'
            }`}>
            <input ref={fileRef} type="file" accept=".bin,.hex,.elf"
              className="hidden" onChange={e => setFile(e.target.files[0] || null)}/>
            {file ? (
              <>
                <p className="text-2xl mb-1">📦</p>
                <p className="text-sm font-semibold text-indigo-700">{file.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{fmtSize(file.size)}</p>
              </>
            ) : (
              <>
                <p className="text-2xl mb-1">☁️</p>
                <p className="text-sm font-medium text-gray-600">Click to select firmware file</p>
                <p className="text-xs text-gray-400 mt-0.5">.bin · .hex · .elf — max 2 MB</p>
              </>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Version <span className="text-red-400">*</span></label>
            <input value={version} onChange={e => setVersion(e.target.value)}
              className={inp} placeholder="e.g. 1.2.3"/>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Release notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              className={`${inp} resize-none`} placeholder="What changed in this version…"/>
          </div>
          <label className="flex items-center gap-3 cursor-pointer bg-gray-50 rounded-xl px-4 py-3">
            <input type="checkbox" checked={stable} onChange={e => setStable(e.target.checked)}
              className="w-4 h-4 accent-indigo-600"/>
            <div>
              <p className="text-sm font-medium text-gray-700">Mark as stable</p>
              <p className="text-xs text-gray-400">Recommended for production</p>
            </div>
          </label>
          {error && <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>}
        </div>
        <div className="px-6 pb-6 flex gap-3">
          <button onClick={onClose}
            className="flex-1 border border-gray-200 text-gray-600 text-sm py-2.5 rounded-xl hover:bg-gray-50 transition">
            Cancel
          </button>
          <button onClick={submit} disabled={saving}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-xl transition">
            {saving ? 'Uploading…' : '⬆ Upload firmware'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Flash modal — works for both nodes (LoRa) and gateways (WiFi) ─
function FlashModal({ device, deviceType, farmName, firmware, onClose }) {
  const [selectedFw, setSelectedFw] = useState(null);
  const [busy,       setBusy]       = useState(false);
  const [result,     setResult]     = useState(null);
  const [error,      setError]      = useState('');

  const isGateway = deviceType === 'gateway';

  const deploy = async () => {
    if (!selectedFw) return setError('Select a firmware version.');
    setBusy(true); setError('');
    try {
      const endpoint = isGateway
        ? `/ota/deploy-gateway/${device._id}`
        : `/ota/deploy/${device._id}`;
      await api.post(endpoint, { firmware_id: selectedFw._id });
      setResult(selectedFw.version);
    } catch (e) {
      setError(e.response?.data?.message || 'Deploy failed.');
    } finally {
      setBusy(false);
    }
  };

  const headerGrad = isGateway
    ? 'from-violet-600 to-purple-700'
    : 'from-blue-600 to-indigo-600';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">

        <div className={`bg-gradient-to-r ${headerGrad} px-6 py-5 text-white`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <p className={`text-xs font-medium ${isGateway ? 'text-purple-200' : 'text-blue-200'}`}>{farmName}</p>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  isGateway ? 'bg-purple-500/40 text-purple-100' : 'bg-blue-500/40 text-blue-100'
                }`}>
                  {isGateway ? '📶 WiFi OTA' : '📡 LoRa FUOTA'}
                </span>
              </div>
              <h2 className="text-lg font-bold">{device.name}</h2>
              <p className={`text-xs font-mono mt-0.5 ${isGateway ? 'text-purple-200' : 'text-blue-200'}`}>{device.device_id}</p>
            </div>
            <button onClick={onClose}
              className="text-white/70 hover:text-white hover:bg-white/20 rounded-xl w-9 h-9
                         flex items-center justify-center text-xl transition-colors">×</button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className={`text-xs ${isGateway ? 'text-purple-200' : 'text-blue-200'}`}>Current firmware:</span>
            <span className="text-xs font-mono font-bold bg-white/20 px-2 py-0.5 rounded-full">
              v{device.firmware_version || '?'}
            </span>
            <span className={`w-1.5 h-1.5 rounded-full ${device.status === 'online' ? 'bg-green-400' : 'bg-red-400'}`}/>
            <span className={`text-xs ${isGateway ? 'text-purple-200' : 'text-blue-200'}`}>{device.status}</span>
          </div>
        </div>

        <div className="px-6 py-5">
          {result ? (
            <div className="text-center py-6">
              <div className="text-5xl mb-3">{isGateway ? '📶' : '📡'}</div>
              <p className="text-base font-bold text-gray-800">OTA command sent!</p>
              <p className="text-sm text-gray-500 mt-1">
                Firmware <span className="font-mono font-semibold text-indigo-600">v{result}</span> will be
                flashed to <strong>{device.name}</strong>.
              </p>
              {isGateway ? (
                <div className="mt-4 bg-purple-50 border border-purple-200 rounded-xl px-4 py-3 text-xs text-purple-700 text-left">
                  <p className="font-semibold mb-1">⏱ What happens next:</p>
                  <ul className="space-y-0.5 list-disc list-inside">
                    <li>Gateway receives the MQTT command</li>
                    <li>Gateway downloads the .bin from the server via WiFi</li>
                    <li>Gateway flashes and reboots automatically (~1-2 min)</li>
                    <li>This page updates automatically when it comes back online</li>
                  </ul>
                </div>
              ) : (
                <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-700 text-left">
                  <p className="font-semibold mb-1">⏱ What happens next:</p>
                  <ul className="space-y-0.5 list-disc list-inside">
                    <li>Gateway downloads the .bin file (~few seconds)</li>
                    <li>Gateway sends it to the node in 200-byte LoRa chunks</li>
                    <li>Node flashes and reboots (~15–25 min total)</li>
                    <li>This page updates automatically when it comes back online</li>
                  </ul>
                </div>
              )}
              <button onClick={onClose}
                className="mt-4 bg-indigo-600 text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-indigo-700 transition">
                Close
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm font-semibold text-gray-700 mb-3">Select firmware to flash:</p>

              {firmware.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <p className="text-3xl mb-2">📦</p>
                  <p className="text-sm">No firmware uploaded yet</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {firmware.map(fw => {
                    const isCurrent  = semverEq(fw.version, device.firmware_version);
                    const isNewer    = semverGt(fw.version, device.firmware_version);
                    const isSelected = selectedFw?._id === fw._id;
                    return (
                      <button key={fw._id} onClick={() => setSelectedFw(fw)}
                        className={`w-full text-left rounded-2xl border-2 px-4 py-3 transition-all ${
                          isSelected
                            ? 'border-indigo-500 bg-indigo-50'
                            : 'border-gray-100 bg-white hover:border-indigo-200 hover:bg-gray-50'
                        }`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                              isSelected ? 'border-indigo-500' : 'border-gray-300'
                            }`}>
                              {isSelected && <div className="w-2 h-2 rounded-full bg-indigo-500"/>}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono font-bold text-sm text-gray-900">v{fw.version}</span>
                                {fw.is_stable && <span className="text-xs bg-green-100 text-green-700 font-semibold px-1.5 py-0.5 rounded-full">✓ Stable</span>}
                                {isCurrent   && <span className="text-xs bg-gray-100 text-gray-500 font-medium px-1.5 py-0.5 rounded-full">Current</span>}
                                {isNewer && !isCurrent && <span className="text-xs bg-blue-100 text-blue-700 font-semibold px-1.5 py-0.5 rounded-full">↑ Newer</span>}
                                {!isNewer && !isCurrent && <span className="text-xs bg-amber-100 text-amber-700 font-medium px-1.5 py-0.5 rounded-full">↓ Older</span>}
                              </div>
                              {fw.notes && <p className="text-xs text-gray-400 truncate mt-0.5">{fw.notes}</p>}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-xs text-gray-400">{fmtSize(fw.size_bytes)}</p>
                            <p className="text-xs text-gray-400">{timeAgo(fw.createdAt)}</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {device.status !== 'online' && (
                <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5 text-xs text-red-700">
                  <span>⚠️</span>
                  <span>{isGateway
                    ? 'Gateway is offline — it won\'t receive the OTA command until it reconnects to MQTT.'
                    : 'Node is offline — it won\'t receive the LoRa FUOTA until the gateway can reach it.'}</span>
                </div>
              )}
              {selectedFw && semverEq(selectedFw.version, device.firmware_version) && (
                <div className="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5 text-xs text-amber-700">
                  <span>⚠️</span>
                  <span>This is the same version already running. The device will still reflash.</span>
                </div>
              )}
              {error && <div className="mt-3 bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>}

              <div className="flex gap-3 mt-4">
                <button onClick={onClose}
                  className="flex-1 border border-gray-200 text-gray-600 text-sm py-2.5 rounded-xl hover:bg-gray-50 transition">
                  Cancel
                </button>
                <button onClick={deploy} disabled={busy || !selectedFw}
                  className={`flex-1 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-xl
                              transition flex items-center justify-center gap-2 ${
                    isGateway ? 'bg-violet-600 hover:bg-violet-700' : 'bg-blue-600 hover:bg-blue-700'
                  }`}>
                  {busy ? 'Sending…' : <>{isGateway ? '📶' : '🚀'} Flash v{selectedFw?.version ?? '?'}</>}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Device row ────────────────────────────────────────────────────
function DeviceRow({ device, deviceType, farmName, farmGrad, firmware, latestVersion }) {
  const [showModal, setShowModal] = useState(false);
  const isGateway   = deviceType === 'gateway';
  const current     = device.firmware_version;
  const needsUpdate = current && latestVersion && semverGt(latestVersion, current);
  const upToDate    = current && latestVersion && semverEq(current, latestVersion);

  return (
    <>
      <div className={`flex items-center gap-3 px-5 py-4 hover:bg-gray-50 transition-colors ${
        needsUpdate ? 'bg-amber-50/50' : ''
      }`}>
        <div className={`flex-shrink-0 w-2.5 h-2.5 rounded-full ${
          device.status === 'online' ? 'bg-green-500' : 'bg-red-500'
        }`}/>
        <div className={`flex-shrink-0 w-1 h-10 rounded-full bg-gradient-to-b ${farmGrad}`}/>
        <span className={`flex-shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${
          isGateway ? 'bg-violet-100 text-violet-700' : 'bg-cyan-100 text-cyan-700'
        }`}>
          {isGateway ? '📶 WiFi' : '📡 LoRa'}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{device.name}</p>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            <span className="text-xs font-mono text-gray-400">{device.device_id}</span>
            <span className="text-gray-200">·</span>
            <span className="text-xs text-gray-400">{farmName}</span>
          </div>
        </div>
        <div className="text-right flex-shrink-0 min-w-[90px]">
          <p className={`text-sm font-mono font-bold ${
            needsUpdate ? 'text-amber-600' : upToDate ? 'text-green-700' : 'text-gray-500'
          }`}>
            v{current || '?'}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {upToDate ? '✓ Up to date' : needsUpdate ? `→ v${latestVersion}` : !current ? 'Unknown' : ''}
          </p>
        </div>
        <div className="flex-shrink-0">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
            device.status === 'online' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
          }`}>
            {device.status === 'online' ? '● Online' : '○ Offline'}
          </span>
        </div>
        <button onClick={() => setShowModal(true)} disabled={firmware.length === 0}
          className={`flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl
                     border-2 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
            needsUpdate
              ? isGateway
                ? 'bg-violet-600 border-violet-600 text-white hover:bg-violet-700'
                : 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700'
              : isGateway
                ? 'border-gray-200 text-gray-600 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700'
                : 'border-gray-200 text-gray-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700'
          }`}>
          {isGateway ? '📶' : '🚀'} Flash
        </button>
      </div>
      {showModal && (
        <FlashModal device={device} deviceType={deviceType} farmName={farmName}
          firmware={firmware} onClose={() => setShowModal(false)}/>
      )}
    </>
  );
}

// ── Firmware card ─────────────────────────────────────────────────
function FirmwareCard({ fw, latestVersion, onMarkStable, onDelete }) {
  const isLatest    = fw.version === latestVersion;
  const downloadUrl = `${import.meta.env.VITE_API_URL || ''}/api/ota/download/${fw._id}`;
  return (
    <div className={`bg-white rounded-3xl border overflow-hidden shadow-sm hover:shadow-md transition-all ${
      fw.is_stable ? 'border-green-200' : 'border-gray-100'
    }`}>
      <div className={`h-1 ${fw.is_stable
        ? 'bg-gradient-to-r from-green-400 to-emerald-500'
        : 'bg-gradient-to-r from-indigo-400 to-violet-500'
      }`}/>
      <div className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xl font-black text-gray-900 font-mono">v{fw.version}</span>
              {fw.is_stable && <span className="text-xs bg-green-100 text-green-700 font-semibold px-2 py-0.5 rounded-full">✓ Stable</span>}
              {!fw.is_stable && <span className="text-xs bg-amber-100 text-amber-700 font-semibold px-2 py-0.5 rounded-full">Beta</span>}
              {isLatest && <span className="text-xs bg-indigo-100 text-indigo-700 font-semibold px-2 py-0.5 rounded-full">Latest</span>}
            </div>
            <p className="text-xs font-mono text-gray-400 mt-0.5">{fw.filename}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-xs text-gray-400">{timeAgo(fw.createdAt)}</p>
            <p className="text-xs font-medium text-gray-600 mt-0.5">{fmtSize(fw.size_bytes)}</p>
          </div>
        </div>
        {fw.notes && <p className="text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2 leading-relaxed">{fw.notes}</p>}
        {fw.checksum && (
          <div className="bg-gray-50 rounded-xl px-3 py-2">
            <p className="text-xs text-gray-400 mb-0.5">MD5</p>
            <p className="text-xs font-mono text-gray-600 break-all">{fw.checksum}</p>
          </div>
        )}
        {fw.uploaded_by && <p className="text-xs text-gray-400">By <span className="font-medium text-gray-600">{fw.uploaded_by.name}</span></p>}
        <div className="flex gap-2 pt-1 border-t border-gray-50">
          <a href={downloadUrl} download={fw.filename}
            className="flex items-center justify-center gap-1.5 px-3 py-2 border border-gray-200
                       text-xs font-medium text-gray-600 rounded-xl hover:bg-gray-50 transition flex-1">
            ⬇ Download
          </a>
          {!fw.is_stable && (
            <button onClick={() => onMarkStable(fw._id)}
              className="px-3 py-2 border border-green-200 text-xs font-medium text-green-700 rounded-xl hover:bg-green-50 transition">
              ✓ Stable
            </button>
          )}
          <button onClick={() => onDelete(fw._id)}
            className="px-3 py-2 border border-red-100 text-xs font-medium text-red-500 rounded-xl hover:bg-red-50 transition">
            🗑
          </button>
        </div>
      </div>
    </div>
  );
}

const FARM_GRADS = [
  'from-green-500 to-emerald-600',
  'from-teal-500 to-cyan-600',
  'from-blue-500 to-indigo-600',
  'from-violet-500 to-purple-600',
  'from-orange-500 to-amber-600',
  'from-rose-500 to-pink-600',
];

// ── Main page ─────────────────────────────────────────────────────
export default function OtaPage() {
  const token = useAuthStore(s => s.token);

  const [tab,        setTab]        = useState('devices');
  const [firmware,   setFirmware]   = useState([]);
  const [farmsData,  setFarmsData]  = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [toast,      setToast]      = useState('');
  const [liveOk,     setLiveOk]     = useState(false); // socket connected

  const socketRef    = useRef(null);
  const fwPollRef    = useRef(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 4000); };

  // ── Load firmware list ─────────────────────────────────────────
  const loadFirmware = useCallback(() =>
    api.get('/ota/firmware')
      .then(r => setFirmware(r.data.data.firmware || []))
      .catch(() => {}),
  []);

  // ── Initial data load ──────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const [fwRes, farmsRes] = await Promise.all([
          api.get('/ota/firmware'),
          api.get('/farms'),
        ]);
        setFirmware(fwRes.data.data.firmware || []);
        const farmList = farmsRes.data.data.farms || [];
        if (farmList.length > 0) {
          const [nodeResults, gwResults] = await Promise.all([
            Promise.all(farmList.map(f =>
              api.get(`/farms/${f._id}/nodes`).then(r => r.data.data.nodes || []).catch(() => [])
            )),
            Promise.all(farmList.map(f =>
              api.get(`/farms/${f._id}/gateways`).then(r => r.data.data.gateways || []).catch(() => [])
            )),
          ]);
          setFarmsData(farmList.map((farm, i) => ({
            farm,
            nodes:    nodeResults[i],
            gateways: gwResults[i],
          })));
        }
      } finally {
        setLoading(false);
      }
    }
    load();

    // Poll firmware list every 60 s (catches new uploads from another session)
    fwPollRef.current = setInterval(loadFirmware, 60_000);
    return () => clearInterval(fwPollRef.current);
  }, []);

  // ── Socket — live device updates ──────────────────────────────
  useEffect(() => {
    if (!farmsData.length || !token) return;

    const farmIds = farmsData.map(fd => fd.farm._id);

    const socket = io(import.meta.env.VITE_API_URL || undefined, {
      auth:       { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay:    2000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setLiveOk(true);
      farmIds.forEach(id => socket.emit('join:farm', id));
    });
    socket.on('disconnect', () => setLiveOk(false));
    socket.on('connect_error', () => setLiveOk(false));

    // Gateway heartbeat → update status + firmware version in-place
    socket.on('gateway:status', (data) => {
      setFarmsData(prev => prev.map(fd => ({
        ...fd,
        gateways: (fd.gateways || []).map(gw =>
          gw.device_id === data.device_id
            ? {
                ...gw,
                status: data.status ?? gw.status,
                ...(data.fw ? { firmware_version: data.fw } : {}),
              }
            : gw
        ),
      })));
    });

    // Node alive → update status + firmware version in-place
    socket.on('node:status', (data) => {
      setFarmsData(prev => prev.map(fd => ({
        ...fd,
        nodes: fd.nodes.map(n =>
          n.device_id === (data.device_id ?? data.nodeId) || n.device_id === data.nodeId
            ? {
                ...n,
                status: data.status ?? n.status,
                ...(data.fw ? { firmware_version: data.fw } : {}),
              }
            : n
        ),
      })));
    });

    return () => {
      farmIds.forEach(id => socket.emit('leave:farm', id));
      socket.disconnect();
      socketRef.current = null;
      setLiveOk(false);
    };
  }, [farmsData.length, token]);

  // ── Firmware actions ──────────────────────────────────────────
  const handleDelete = async (id) => {
    if (!confirm('Delete this firmware? This cannot be undone.')) return;
    await api.delete(`/ota/firmware/${id}`).catch(() => {});
    loadFirmware();
    showToast('Firmware deleted.');
  };
  const handleMarkStable = async (id) => {
    await api.patch(`/ota/firmware/${id}/stable`).catch(() => {});
    loadFirmware();
    showToast('Marked as stable.');
  };

  // ── Derived counts ────────────────────────────────────────────
  const latestVersion = firmware[0]?.version ?? null;
  const allNodes      = farmsData.flatMap(fd => fd.nodes);
  const allGateways   = farmsData.flatMap(fd => fd.gateways || []);
  const allDevices    = [...allGateways, ...allNodes];
  const outdated      = allDevices.filter(d => d.firmware_version && semverGt(latestVersion, d.firmware_version)).length;
  const stableCount   = firmware.filter(f => f.is_stable).length;
  const hasAnyDevices = allDevices.length > 0;

  return (
    <div className="space-y-6 pb-8">

      {/* ── Hero ── */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br
                      from-indigo-600 via-violet-600 to-purple-700 p-6 text-white shadow-lg shadow-indigo-200">
        <div className="absolute -top-8 -right-8 w-40 h-40 bg-white/10 rounded-full"/>
        <div className="absolute -bottom-12 right-24 w-56 h-56 bg-white/5 rounded-full"/>
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-indigo-200 text-sm">Firmware management</p>
              {/* Live indicator */}
              <span className={`flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                liveOk
                  ? 'bg-green-500/30 text-green-200'
                  : 'bg-white/10 text-white/50'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${liveOk ? 'bg-green-400 animate-pulse' : 'bg-white/30'}`}/>
                {liveOk ? 'Live' : 'Connecting…'}
              </span>
            </div>
            <h1 className="text-3xl font-black">OTA Updates</h1>
            <p className="text-indigo-100 text-sm mt-1">
              {firmware.length} release{firmware.length !== 1 ? 's' : ''}
              {stableCount > 0 ? ` · ${stableCount} stable` : ''}
              {outdated > 0 ? ` · ${outdated} outdated` : ''}
              {allGateways.length > 0 ? ` · ${allGateways.length} gateway${allGateways.length !== 1 ? 's' : ''}` : ''}
              {allNodes.length > 0 ? ` · ${allNodes.length} node${allNodes.length !== 1 ? 's' : ''}` : ''}
            </p>
          </div>
          <button onClick={() => setShowUpload(true)}
            className="flex items-center gap-2 bg-white text-indigo-700 font-bold text-sm
                       px-5 py-2.5 rounded-2xl hover:bg-indigo-50 transition shadow-lg shadow-indigo-900/20">
            ⬆ Upload firmware
          </button>
        </div>
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div className="bg-green-50 border border-green-200 rounded-2xl px-5 py-3 text-sm text-green-700 font-medium">
          ✓ {toast}
        </div>
      )}

      {/* ── Outdated warning ── */}
      {outdated > 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
          <span className="text-xl">⚠️</span>
          <p className="text-sm font-semibold text-amber-700">
            {outdated} device{outdated > 1 ? 's are' : ' is'} running outdated firmware
            — click <strong>Flash</strong> to update
          </p>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="flex gap-1 bg-gray-100 rounded-2xl p-1 w-fit">
        {[
          ['devices',  `🔌 Devices (${allDevices.length})`],
          ['firmware', `📦 Firmware (${firmware.length})`],
        ].map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2 text-sm font-semibold rounded-xl transition ${
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>{label}</button>
        ))}
      </div>

      {/* ════════════════════════════════════════
          DEVICES TAB
      ════════════════════════════════════════ */}
      {tab === 'devices' && (
        <>
          {loading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => <div key={i} className="h-16 bg-gray-100 rounded-2xl animate-pulse"/>)}
            </div>
          ) : !hasAnyDevices ? (
            <div className="text-center py-20 border-2 border-dashed border-gray-200 rounded-3xl">
              <div className="text-6xl mb-4">🔌</div>
              <p className="text-lg font-bold text-gray-700">No devices registered</p>
              <p className="text-sm text-gray-400 mt-1">Register gateways and nodes first</p>
            </div>
          ) : (
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100
                              flex items-center justify-between">
                <div className="grid grid-cols-[auto_auto_1fr_120px_100px_80px] gap-3
                                text-xs font-semibold text-gray-400 uppercase tracking-wider flex-1">
                  <span/><span/>
                  <span>Device</span>
                  <span className="text-right">Firmware</span>
                  <span className="text-center">Status</span>
                  <span/>
                </div>
              </div>

              {farmsData.map((fd, fi) => {
                const hasDevices = fd.nodes.length > 0 || (fd.gateways || []).length > 0;
                if (!hasDevices) return null;
                return (
                  <div key={fd.farm._id}>
                    <div className="px-5 py-2 flex items-center gap-2" style={{ background: 'rgba(0,0,0,0.02)' }}>
                      <div className={`w-2 h-2 rounded-full bg-gradient-to-br ${FARM_GRADS[fi % FARM_GRADS.length]}`}/>
                      <span className="text-xs font-semibold text-gray-500">{fd.farm.name}</span>
                      {(fd.gateways || []).length > 0 && (
                        <span className="text-xs text-gray-400">· {fd.gateways.length} gateway{fd.gateways.length !== 1 ? 's' : ''}</span>
                      )}
                      {fd.nodes.length > 0 && (
                        <span className="text-xs text-gray-400">· {fd.nodes.length} node{fd.nodes.length !== 1 ? 's' : ''}</span>
                      )}
                    </div>
                    <div className="divide-y divide-gray-50">
                      {(fd.gateways || []).map(gw => (
                        <DeviceRow key={gw._id} device={gw} deviceType="gateway"
                          farmName={fd.farm.name} farmGrad={FARM_GRADS[fi % FARM_GRADS.length]}
                          firmware={firmware} latestVersion={latestVersion}/>
                      ))}
                      {fd.nodes.map(node => (
                        <DeviceRow key={node._id} device={node} deviceType="node"
                          farmName={fd.farm.name} farmGrad={FARM_GRADS[fi % FARM_GRADS.length]}
                          firmware={firmware} latestVersion={latestVersion}/>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* How it works */}
          {!loading && hasAnyDevices && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-violet-50 border border-violet-100 rounded-3xl p-5 space-y-3">
                <p className="text-sm font-bold text-violet-900">📶 Gateway — WiFi OTA</p>
                <div className="space-y-2">
                  {['Click Flash → select firmware version','Server sends OTA command via MQTT',
                    'Gateway downloads .bin directly via WiFi','Gateway flashes + reboots (~1-2 min)'].map((text, n) => (
                    <div key={n} className="flex items-start gap-2">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-violet-200 text-violet-700
                                       text-xs font-bold flex items-center justify-center mt-0.5">{n+1}</span>
                      <p className="text-xs text-violet-700">{text}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-cyan-50 border border-cyan-100 rounded-3xl p-5 space-y-3">
                <p className="text-sm font-bold text-cyan-900">📡 Node — LoRa FUOTA</p>
                <div className="space-y-2">
                  {['Click Flash → select firmware version','Gateway downloads .bin via WiFi',
                    'Gateway sends 200-byte chunks over LoRa','Node flashes OTA partition + reboots (~15-25 min)'].map((text, n) => (
                    <div key={n} className="flex items-start gap-2">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-cyan-200 text-cyan-700
                                       text-xs font-bold flex items-center justify-center mt-0.5">{n+1}</span>
                      <p className="text-xs text-cyan-700">{text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ════════════════════════════════════════
          FIRMWARE TAB
      ════════════════════════════════════════ */}
      {tab === 'firmware' && (
        <>
          {firmware.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { icon: '📦', label: 'Total releases',  value: firmware.length,   color: 'text-gray-900' },
                { icon: '✅', label: 'Stable',          value: stableCount,       color: 'text-green-700' },
                { icon: '⚡', label: 'Latest version',  value: latestVersion ? `v${latestVersion}` : '—', color: 'text-indigo-700' },
              ].map(s => (
                <div key={s.label} className="bg-white border border-gray-100 rounded-2xl px-4 py-3 shadow-sm">
                  <p className="text-xs text-gray-400">{s.icon} {s.label}</p>
                  <p className={`text-xl font-black mt-0.5 font-mono ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
          )}

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {[1,2,3].map(i => <div key={i} className="h-56 bg-gray-100 rounded-3xl animate-pulse"/>)}
            </div>
          ) : firmware.length === 0 ? (
            <div className="text-center py-24 border-2 border-dashed border-gray-200 rounded-3xl">
              <div className="text-7xl mb-4">📦</div>
              <p className="text-xl font-bold text-gray-700">No firmware uploaded yet</p>
              <p className="text-sm text-gray-400 mt-1 mb-5">Upload your first .bin file to get started</p>
              <button onClick={() => setShowUpload(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold
                           px-6 py-3 rounded-2xl transition shadow-lg shadow-indigo-200">
                ⬆ Upload firmware
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {firmware.map(fw => (
                <FirmwareCard key={fw._id} fw={fw} latestVersion={latestVersion}
                  onMarkStable={handleMarkStable} onDelete={handleDelete}/>
              ))}
            </div>
          )}
        </>
      )}

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onUploaded={() => {
            setShowUpload(false);
            loadFirmware();
            showToast('Firmware uploaded successfully!');
          }}
        />
      )}
    </div>
  );
}

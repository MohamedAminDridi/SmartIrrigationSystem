import { create } from 'zustand';

// Holds the live state of every device in the currently-viewed farm, keyed by
// device_id. Telemetry patches land here (NOT in React state) so the 3D Canvas
// can read values via useFrame without re-rendering the whole component tree.
//
// `positions` is kept here too so a single dragged marker (and its link) can
// re-render in isolation while the rest of the scene stays still.
export const useTwinStore = create((set) => ({
  byId: {},          // { [device_id]: { ...device, soil, temp, hum, bat, status, valve, pump, zone, lastUpdate } }
  positions: {},     // { [device_id]: [x, 0, z] }  ground-plane layout
  custom: {},        // { [device_id]: { size, rot, color, label } }  per-plot customization
  zones: {},         // { [zoneName]: color }  irrigation-zone tints
  selectedId: null,  // device_id of the clicked node, or null
  weather: null,     // live Open-Meteo conditions for this farm (or null)
  weatherLocked: false, // true while a manual demo override is active (ignores live)
  // Master feature switches for the 3D twin (toggled from the settings gear).
  // Deeply-nested components (crops/energy inside nodes) read these directly.
  features: {
    weather: true, crops: true, pipes: true, energy: true,
    labels: true, signal: false,   // signal = Electromagnetic / Signal Spectrum mode
  },
  live: false,       // socket connected?
  editMode: false,   // layout-edit (drag) mode on?
  dragging: false,   // a marker is currently being dragged

  // view / UX
  layers:  { links: true, labels: true, grid: true },  // toggled visibility
  colorBy: 'status', // 'status' | 'zone'  — what drives the plot fill colour
  topDown: false,    // orthographic top-down "map" view
  focus:   null,     // fly-to request { key, ts }  (ts retriggers same-key flights)

  // playback (24h replay) — frames: [{ ts, byId: { [deviceId]: { soil, temp, hum, bat } } }]
  playback: { active: false, playing: false, idx: 0, frames: [], from: null, interval: 'hour' },

  // Replace the whole device map (called once per farm load).
  seed: (devices) => set(() => {
    const byId = {};
    devices.forEach((d) => { byId[d.device_id] = d; });
    return { byId, selectedId: null };
  }),

  // Merge a partial update into one device. No-op if we don't know that device.
  apply: (deviceId, patch) => set((s) => {
    const prev = s.byId[deviceId];
    if (!prev) return {};
    return { byId: { ...s.byId, [deviceId]: { ...prev, ...patch, lastUpdate: Date.now() } } };
  }),

  setPositions: (map)       => set({ positions: map }),
  setPosition:  (key, pos)  => set((s) => ({ positions: { ...s.positions, [key]: pos } })),

  // Per-plot customization (size / rotation / color tint / crop label).
  setCustomMap: (map)        => set({ custom: map }),
  setCustom:    (key, patch) => set((s) => ({ custom: { ...s.custom, [key]: { ...s.custom[key], ...patch } } })),

  // Irrigation zones.
  setZones: (map) => set({ zones: map }),

  // view / UX setters
  toggleLayer: (name) => set((s) => ({ layers: { ...s.layers, [name]: !s.layers[name] } })),
  setColorBy:  (v)    => set({ colorBy: v }),
  setTopDown:  (v)    => set({ topDown: v }),
  requestFocus:(key)  => set({ focus: { key, ts: Date.now() } }),

  // playback
  setPlayback: (patch) => set((s) => ({ playback: { ...s.playback, ...patch } })),

  setWeather:       (w) => set({ weather: w }),
  setWeatherLocked: (v) => set({ weatherLocked: v }),
  setFeature:    (k, v) => set((s) => ({ features: { ...s.features, [k]: v } })),
  toggleFeature: (k)    => set((s) => ({ features: { ...s.features, [k]: !s.features[k] } })),
  select:      (deviceId) => set({ selectedId: deviceId }),
  setLive:     (v)        => set({ live: v }),
  setEditMode: (v)        => set({ editMode: v, dragging: false }),
  setDragging: (v)        => set({ dragging: v }),
  reset:       ()         => set({
    byId: {}, positions: {}, custom: {}, zones: {}, selectedId: null,
    editMode: false, dragging: false, focus: null,
    playback: { active: false, playing: false, idx: 0, frames: [], from: null, interval: 'hour' },
  }),
}));

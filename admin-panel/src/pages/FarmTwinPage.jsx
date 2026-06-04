import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
// Deep imports instead of the `@react-three/drei` barrel: the barrel transitively
// pulls @mediapipe/tasks-vision + hls.js, which crash Vite's dep optimizer (the
// drei entry chunk fails to write -> 504 "Outdated Optimize Dep"). These
// submodules only need three-stdlib/meshline, so they pre-bundle cleanly.
import { OrbitControls } from '@react-three/drei/core/OrbitControls';
import { Grid } from '@react-three/drei/core/Grid';
import { Line } from '@react-three/drei/core/Line';
import { Stars } from '@react-three/drei/core/Stars';
import { Sparkles } from '@react-three/drei/core/Sparkles';
import { Cloud, Clouds } from '@react-three/drei/core/Cloud';
import { Html } from '@react-three/drei/web/Html';
import * as THREE from 'three';
import api from '../services/api';
import { useTwinStore } from '../store/twinStore';
import { useTwinTelemetry } from '../hooks/useTwinTelemetry';

/* ------------------------------------------------------------------ helpers */
const GW_PALETTE = ['#2563eb', '#16a34a', '#db2777', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#4f46e5'];
const GW_SPACING  = 22;    // distance between gateway clusters
const DEFAULT_SIZE = 4;    // default field-plot side length (metres)
const MIN_SIZE = 3;
const MAX_SIZE = 10;
const GROUND   = 160;      // ground plane side
const EXTENT   = 70;       // drag clamp (keeps plots on the ground plane)
const PLOT_COLORS = ['#22c55e', '#84cc16', '#eab308', '#f59e0b', '#10b981', '#14b8a6', '#a16207', '#65a30d'];
const STALE_MS = 10 * 60 * 1000;  // no data in 10 min => "stale"
const LOW_BAT  = -20;              // battery % alert threshold

const isNum = (v) => typeof v === 'number' && !Number.isNaN(v);
const clampXZ = (v) => Math.max(-EXTENT, Math.min(EXTENT, v));
const clampSize = (v) => Math.max(MIN_SIZE, Math.min(MAX_SIZE, Number(v) || DEFAULT_SIZE));
const keyOf = (d) => d.device_id || d._id;

// Default layout: each gateway sits at the head of its own cluster; its nodes
// daisy-chain away from it in a compact snake so every node is adjacent to the
// one it relays through (node0→gateway, node1→node0, …). Nodes whose gateway
// isn't in this farm go into an "unassigned" grid off to the side.
function computeClusterLayout(nodes, gateways, nodeGw) {
  const positions = {};
  const gwKeys = gateways.map(keyOf);
  const groups = {}; gwKeys.forEach((k) => { groups[k] = []; });
  const orphans = [];

  nodes.forEach((n) => {
    const nk = keyOf(n);
    const gk = nodeGw[nk];
    if (gk && groups[gk]) groups[gk].push(nk);
    else orphans.push(nk);
  });

  const clusters = gwKeys.length + (orphans.length ? 1 : 0);
  const centreX = (i) => (i - (clusters - 1) / 2) * GW_SPACING;
  const STEP = DEFAULT_SIZE + 2;   // gap so neighbouring square plots don't touch
  const PER_ROW = 3;               // snake width (keeps a cluster inside its slot)

  gateways.forEach((g, gi) => {
    const gk = keyOf(g);
    const cx = centreX(gi);
    positions[gk] = [cx, 0, 0];
    // Snake (boustrophedon): nodes march away from the gateway and reverse each
    // row, so consecutive chain members are always neighbours.
    groups[gk].forEach((nk, i) => {
      const row = Math.floor(i / PER_ROW);
      let col = i % PER_ROW;
      if (row % 2 === 1) col = PER_ROW - 1 - col;
      positions[nk] = [cx + (col - (PER_ROW - 1) / 2) * STEP, 0, (row + 1) * STEP];
    });
  });

  if (orphans.length) {
    const cx = centreX(gwKeys.length);
    const cols = Math.ceil(Math.sqrt(orphans.length));
    orphans.forEach((nk, ni) => {
      const c = ni % cols, rrow = Math.floor(ni / cols);
      positions[nk] = [cx + (c - (cols - 1) / 2) * (DEFAULT_SIZE + 2), 0, (rrow - (cols - 1) / 2) * (DEFAULT_SIZE + 2)];
    });
  }
  return positions;
}

// Relay chain per gateway: node0 -> gateway, then each subsequent node hops
// through the previous one (multi-hop LoRa). Members keep their name-sorted
// order from the API, so the chain matches "node 1, node 2, node 3, …".
function buildChainLinks(nodes, nodeGw, gwColor) {
  const groups = {};
  nodes.forEach((n) => {
    const gk = nodeGw[n.device_id];
    if (!gk || !gwColor[gk]) return;
    (groups[gk] = groups[gk] || []).push(n.device_id);
  });
  const links = [];
  Object.entries(groups).forEach(([gk, members]) => {
    members.forEach((nk, i) => {
      links.push({ fromKey: i === 0 ? gk : members[i - 1], toKey: nk, gwKey: gk });
    });
  });
  return links;
}

// What's wrong with a device right now (drives halos + the alert list).
function computeNodeAlerts(d) {
  if (!d) return [];
  const out = [];
  const status = d.status || 'unknown';
  const bat    = d.bat ?? d.battery_pct;
  const valve  = d.valve ?? d.valve_state;
  const lastTs = d.lastUpdate || (d.last_seen ? +new Date(d.last_seen) : null);
  if (status === 'offline') out.push({ kind: 'offline', label: 'Offline' });
  if (bat != null && bat < LOW_BAT) out.push({ kind: 'battery', label: `Battery ${Math.round(bat)}%` });
  if (status !== 'offline' && lastTs && Date.now() - lastTs > STALE_MS) out.push({ kind: 'stale', label: 'Stale data' });
  if (valve === 'open' && status === 'offline') out.push({ kind: 'valve', label: 'Valve stuck open' });
  return out;
}

/* -------------------------------------------------------------------- colors */
const C_DRY = new THREE.Color('#a9774a');
const C_WET = new THREE.Color('#2f9e44');
const C_OFF = new THREE.Color('#6b7280');
function soilTarget(out, soil, status) {
  if (status === 'offline') { out.copy(C_OFF); return out; }
  const t = Math.max(0, Math.min(1, (Number(soil) || 0) / 100));
  out.copy(C_DRY).lerp(C_WET, t);
  return out;
}
// field-plot fill by status (green = online, red = offline, grey = unknown)
const P_ONLINE  = new THREE.Color('#22c55e');
const P_OFFLINE = new THREE.Color('#ef4444');
const P_UNKNOWN = new THREE.Color('#9ca3af');
function plotTarget(out, status, customColor) {
  if (customColor) { out.set(customColor); return out; }
  if (status === 'online') out.copy(P_ONLINE);
  else if (status === 'offline') out.copy(P_OFFLINE);
  else out.copy(P_UNKNOWN);
  return out;
}
const statusColor = (s) => (s === 'online' ? '#22c55e' : s === 'offline' ? '#ef4444' : '#9ca3af');

/* ---------------------------------------------------- day/night + crops */
// Sky / sun / moonlight colours, blended by sun elevation (−1 night … +1 noon).
const SKY_DAY   = new THREE.Color('#bcd4ea');
const SKY_NIGHT = new THREE.Color('#0a1530');
const SKY_DUSK  = new THREE.Color('#f0a062');
const SUN_NOON  = new THREE.Color('#fff6e8');
const SUN_LOW   = new THREE.Color('#ff9d5c');
const SUN_MOON  = new THREE.Color('#9db4e8');
const CROP_DRY  = new THREE.Color('#c2a64a');

// Crop species you can place on a plot (chosen in the Customize panel). Each
// renders a plant shape; `leaf` = healthy colour, `fruit` adds fruit dots,
// `icon` is the picker thumbnail, `cat` groups it for the search/filter.
const CROP_TYPES = {
  grass:      { name: 'Grass',       icon: '🌿', cat: 'Other',      shape: 'cone',   leaf: '#6a8f3a' },
  // Vegetables
  tomato:     { name: 'Tomato',      icon: '🍅', cat: 'Vegetables', shape: 'bush',   leaf: '#3f8f3a', fruit: '#e23b3b' },
  pepper:     { name: 'Pepper',      icon: '🌶️', cat: 'Vegetables', shape: 'pepper', leaf: '#3f8f3a', fruit: '#e0a21f' },
  eggplant:   { name: 'Eggplant',    icon: '🍆', cat: 'Vegetables', shape: 'bush',   leaf: '#3f8f3a', fruit: '#7c3aed' },
  cucumber:   { name: 'Cucumber',    icon: '🥒', cat: 'Vegetables', shape: 'bush',   leaf: '#3f8f3a', fruit: '#4a9a3a' },
  potato:     { name: 'Potato',      icon: '🥔', cat: 'Vegetables', shape: 'bush',   leaf: '#4f7d3a' },
  carrot:     { name: 'Carrot',      icon: '🥕', cat: 'Vegetables', shape: 'leafy',  leaf: '#5fae3a' },
  onion:      { name: 'Onion',       icon: '🧅', cat: 'Vegetables', shape: 'leafy',  leaf: '#8fae5a' },
  // Leafy greens
  lettuce:    { name: 'Lettuce',     icon: '🥬', cat: 'Greens',     shape: 'leafy',  leaf: '#7cc24a' },
  cabbage:    { name: 'Cabbage',     icon: '🥬', cat: 'Greens',     shape: 'leafy',  leaf: '#6fb04a' },
  // Grains / field
  wheat:      { name: 'Wheat',       icon: '🌾', cat: 'Grains',     shape: 'stalk',  leaf: '#d9b44a' },
  corn:       { name: 'Corn',        icon: '🌽', cat: 'Grains',     shape: 'stalk',  leaf: '#9fcf4a', fruit: '#f4c430' },
  rice:       { name: 'Rice',        icon: '🌾', cat: 'Grains',     shape: 'stalk',  leaf: '#8fc04a' },
  sunflower:  { name: 'Sunflower',   icon: '🌻', cat: 'Grains',     shape: 'stalk',  leaf: '#5fae3a', fruit: '#f4c430' },
  // Fruits & berries
  strawberry: { name: 'Strawberry',  icon: '🍓', cat: 'Fruits',     shape: 'bush',   leaf: '#4a9a3a', fruit: '#e23b3b' },
  grapes:     { name: 'Grapevine',   icon: '🍇', cat: 'Fruits',     shape: 'bush',   leaf: '#4a8f3a', fruit: '#7c3aed' },
  // Trees
  apple:      { name: 'Apple tree',  icon: '🍎', cat: 'Trees',      shape: 'tree',   leaf: '#2f7d3a', fruit: '#e23b3b' },
  orange:     { name: 'Orange tree', icon: '🍊', cat: 'Trees',      shape: 'tree',   leaf: '#2f7d3a', fruit: '#f59e0b' },
  lemon:      { name: 'Lemon tree',  icon: '🍋', cat: 'Trees',      shape: 'tree',   leaf: '#3f8f3a', fruit: '#e9d24a' },
  olive:      { name: 'Olive tree',  icon: '🫒', cat: 'Trees',      shape: 'tree',   leaf: '#5f7d4a', fruit: '#5a6e2a' },
  fruit:      { name: 'Fruit tree',  icon: '🌳', cat: 'Trees',      shape: 'tree',   leaf: '#2f7d3a', fruit: '#e8632b' },
};
const CROP_KEYS = Object.keys(CROP_TYPES);

// Underground irrigation pipes (gateway → pump → plots).
const PIPE_Y = 0.06;   // height of the buried pipe network
const PIPE_R = 0.085;  // pipe radius
const PIPE_UP = new THREE.Vector3(0, 1, 0);

// Shared per-frame environment, written by SkyAndSun + WeatherSystem and read
// by every component that reacts to nightfall/weather — no React re-renders.
//   night: 0 (full day) … 1 (deep night)    sun: −1 … +1 (elevation)
//   cloud: 0…1 overcast   wet: 0…1 ground wetness   windX/windZ: drift vector
//   digital: 0 (physical world) … 1 (digital/cyber layer) — eased transition
const ENV = { night: 0, sun: 1, cloud: 0, wet: 0, windX: 0.4, windZ: 0.2, windSpeed: 0.1, digital: 0 };

// The intelligence layers of the digital world (each has an accent + identity).
const LAYER_THEME = {
  overview: { color: '#38e0ff', name: 'Overview',    icon: '🌐', tag: 'ALL SYSTEMS' },
  ai:       { color: '#a855f7', name: 'AI Brain',    icon: '🧠', tag: 'AI REASONING' },
  water:    { color: '#22d3ee', name: 'Water',       icon: '🌊', tag: 'WATER INTELLIGENCE' },
  comms:    { color: '#22e0ff', name: 'Comms',       icon: '📡', tag: 'LoRa NETWORK' },
  climate:  { color: '#34d399', name: 'Climate',     icon: '🌫️', tag: 'ATMOSPHERE FLOW' },
  predict:  { color: '#f472b6', name: 'Prediction',  icon: '🔮', tag: '+48H FORECAST' },
  bio:      { color: '#84cc16', name: 'Biology',     icon: '🌱', tag: 'ROOT NETWORK' },
  energy:   { color: '#fbbf24', name: 'Energy',      icon: '⚡', tag: 'POWER FLOW' },
};
const LAYER_KEYS = Object.keys(LAYER_THEME);
const NEON_BLUE = '#38e0ff';
const NEON_CYAN = '#22d3ee';
const SOLAR_YEL = '#ffd54a';

// Radial-gradient sprite texture used to fake neon glow / bloom (built once).
function makeGlowTexture() {
  if (typeof document === 'undefined') return null;
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(cv);
}
const GLOW_TEX = makeGlowTexture();

// Starfield that only shows after dusk (visibility toggled, no re-render).
function NightSky() {
  const ref = useRef();
  useFrame(() => { if (ref.current) ref.current.visible = ENV.night > 0.18; });
  return (
    <group ref={ref} visible={false}>
      <Stars radius={140} depth={60} count={1600} factor={4.5} saturation={0} fade speed={0.6} />
    </group>
  );
}

/* --------------------------------------------------------------- ground */
// Procedural soil/grass texture (mottled patches) + a fine noise bump, built
// once on a canvas so there are no external texture files to ship.
function makeGroundTexture() {
  if (typeof document === 'undefined') return null;
  const s = 1024;
  const cv = document.createElement('canvas'); cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  // tilled-farmland soil: warm earth base, plough furrows, grass + dirt patches
  ctx.fillStyle = '#6f7d44'; ctx.fillRect(0, 0, s, s);
  // soft large-scale colour variation
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * s, y = Math.random() * s, r = 30 + Math.random() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const c = Math.random() < 0.5 ? '120,140,72' : '92,76,52';
    g.addColorStop(0, `rgba(${c},${0.06 + Math.random() * 0.1})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // plough furrow rows (subtle horizontal banding) for a worked-field look
  const rows = 26;
  for (let i = 0; i < rows; i++) {
    const y = (i / rows) * s + (Math.random() - 0.5) * 3;
    ctx.strokeStyle = i % 2 ? 'rgba(60,70,38,0.18)' : 'rgba(150,140,98,0.12)';
    ctx.lineWidth = 2 + Math.random() * 2;
    ctx.beginPath();
    for (let x = 0; x <= s; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.05) * 1.6);
    ctx.stroke();
  }
  // grass tufts + dirt clods speckle
  for (let i = 0; i < 2800; i++) {
    const x = Math.random() * s, y = Math.random() * s, r = 1.5 + Math.random() * 7;
    const g = Math.random();
    ctx.fillStyle = g < 0.45 ? `rgba(116,142,72,${0.12 + Math.random() * 0.3})`   // grass
                  : g < 0.72 ? `rgba(58,74,38,${0.10 + Math.random() * 0.28})`    // dark soil
                  :            `rgba(150,132,92,${0.08 + Math.random() * 0.24})`; // dry clods
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(48, 48); t.anisotropy = 16;
  return t;
}
function makeBumpTexture() {
  if (typeof document === 'undefined') return null;
  const s = 512;
  const cv = document.createElement('canvas'); cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(s, s);
  for (let i = 0; i < s * s; i++) {
    const v = 90 + Math.random() * 110;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(180, 180);
  return t;
}
const GROUND_TEX  = makeGroundTexture();
const GROUND_BUMP = makeBumpTexture();
const GROUND_SIZE  = 600;   // huge so the edge sits far out at the horizon (no visible void)
const GROUND_THICK = 6;     // solid slab depth so the sides read as earth, not a floating sheet

// Textured ground that turns darker & glossy as it gets wet (ENV.wet).
function Ground() {
  const matRef = useRef();
  const base = useMemo(() => new THREE.Color('#7e9150'), []);
  const wet  = useMemo(() => new THREE.Color('#4f5d36'), []);
  const tmp  = useMemo(() => new THREE.Color(), []);
  useFrame((_, dt) => {
    const m = matRef.current; if (!m) return;
    const k = Math.min(1, dt * 2);
    tmp.copy(base).lerp(wet, ENV.wet);
    m.color.lerp(tmp, k);
    m.roughness = THREE.MathUtils.lerp(m.roughness, 1 - ENV.wet * 0.6, k);
    m.metalness = THREE.MathUtils.lerp(m.metalness, ENV.wet * 0.3, k);
    // self-illuminate the textured ground at night so it stays clearly visible
    m.emissiveIntensity = THREE.MathUtils.lerp(m.emissiveIntensity, 0.1 + ENV.night * 0.7, k);
    // in the digital layer the terrain turns semi-transparent (reveal underground).
    // Reality keeps transparent=false so it renders exactly as before.
    const wantT = ENV.digital > 0.02;
    if (m.transparent !== wantT) { m.transparent = wantT; m.needsUpdate = true; }
    m.opacity = THREE.MathUtils.lerp(m.opacity, 1 - ENV.digital * 0.68, k);
    m.depthWrite = ENV.digital < 0.35;
  });
  // A thick slab (box) instead of a flat plane: top sits at y=0, the body gives
  // it solid earth sides so you never see the void at the edges.
  return (
    <mesh position={[0, -GROUND_THICK / 2, 0]} receiveShadow>
      <boxGeometry args={[GROUND_SIZE, GROUND_THICK, GROUND_SIZE]} />
      <meshStandardMaterial ref={matRef} map={GROUND_TEX} bumpMap={GROUND_BUMP} bumpScale={0.4}
        roughnessMap={GROUND_BUMP} emissiveMap={GROUND_TEX} emissive="#9aa86a" emissiveIntensity={0.1}
        color="#7e9150" roughness={0.95} metalness={0} />
    </mesh>
  );
}

/* ------------------------------------------------------- live weather */
// Consumes the farm's live Open-Meteo conditions (store.weather, fed by
// Socket.IO) and renders the atmosphere: drifting volumetric clouds (density =
// cloud cover), falling rain (rate = precipitation, slanted by wind), fog that
// thickens with rain/fog, and lightning flashes during thunderstorms. It also
// publishes cloud/wet/wind into ENV so the sun dims under cloud and crops know
// the wind. Values ease toward targets so weather changes are smooth.
function WeatherSystem() {
  const weather = useTwinStore((s) => s.weather);
  const { scene } = useThree();
  const wRef = useRef(weather);
  wRef.current = weather;

  const st        = useRef({ cloud: 0.15, rain: 0, snow: 0, mist: 0, flash: 0, nextBolt: 4 });
  const rainRef   = useRef();
  const snowRef   = useRef();
  const cloudsRef = useRef();
  const flashRef  = useRef();
  const boltMat   = useRef();
  const mistRef   = useRef();

  // ── rain as slanted streaks (LineSegments — 2 verts per drop) ──
  const RAIN = 1400;
  const rainHeads = useMemo(() => {
    const a = new Float32Array(RAIN * 3);
    for (let i = 0; i < RAIN; i++) { a[i*3]=(Math.random()*2-1)*60; a[i*3+1]=Math.random()*26; a[i*3+2]=(Math.random()*2-1)*60; }
    return a;
  }, []);
  const rainGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAIN * 2 * 3), 3));
    return g;
  }, []);

  // ── snow as slowly drifting points ──
  const SNOW = 1100;
  const snowGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(SNOW * 3);
    for (let i = 0; i < SNOW; i++) { pos[i*3]=(Math.random()*2-1)*60; pos[i*3+1]=Math.random()*26; pos[i*3+2]=(Math.random()*2-1)*60; }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  const snowPh = useMemo(() => Array.from({ length: SNOW }, () => Math.random() * Math.PI * 2), []);

  // ── lightning bolt (jagged polyline rebuilt on each strike) ──
  const BOLT = 18;
  const boltGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BOLT * 3), 3));
    return g;
  }, []);
  const strike = () => {
    const arr = boltGeo.attributes.position.array;
    const z = (Math.random() * 2 - 1) * 30;
    let cx = (Math.random() * 2 - 1) * 30;
    for (let i = 0; i < BOLT; i++) {
      const t = i / (BOLT - 1);
      cx += (Math.random() * 2 - 1) * 1.6;
      arr[i*3] = cx; arr[i*3+1] = 22 - t * 22; arr[i*3+2] = z + (Math.random()*2-1)*1.2;
    }
    boltGeo.attributes.position.needsUpdate = true;
  };

  // ── low ground mist (shared sprite material) ──
  const mistMat = useMemo(() => new THREE.SpriteMaterial({ map: GLOW_TEX, color: '#c4ccd6', transparent: true, opacity: 0, depthWrite: false }), []);
  const mistSeeds = useMemo(() => Array.from({ length: 7 }, () => [(Math.random()*2-1)*40, 1.2 + Math.random()*1.5, (Math.random()*2-1)*40]), []);

  // ── cloud layout + colour (rebuilt on overcast/condition change) ──
  const cover  = weather?.cloudCover ?? 15;
  const cond0  = weather?.condition || 'clear';
  const bucket = Math.max(0, Math.round((cover / 100) * 9));
  const cloudColor = (cond0 === 'thunderstorm' || cond0 === 'rain') ? '#7c8593'
                   : cond0 === 'cloudy' ? '#b4bcc8' : '#dde3ec';
  const cloudOpacity = 0.4 + Math.min(1, cover / 100) * 0.5;
  const cloudSeeds = useMemo(() => Array.from({ length: bucket }, () => ({
    pos: [(Math.random()*2-1)*34, 15 + Math.random()*5, (Math.random()*2-1)*34],
  })), [bucket]);

  useFrame((_, dt) => {
    const w = wRef.current;
    const cond = w?.condition || 'clear';
    const storm = cond === 'thunderstorm';
    const isSnow = cond === 'snow';
    const precip = w?.rain ?? w?.precipitation ?? 0;
    const tCloud = Math.max(0, Math.min(1, (w?.cloudCover ?? 15) / 100));
    const tRain  = isSnow ? 0 : Math.min(1, Math.max(0, precip / 4) + (storm ? 0.5 : 0));
    const tSnow  = isSnow ? Math.min(1, Math.max(0.3, precip / 3)) : 0;
    const tMist  = Math.max(cond === 'fog' ? 1 : 0, tRain * 0.3);
    const s = st.current, ke = Math.min(1, dt * 0.5);
    s.cloud += (tCloud - s.cloud) * ke;
    s.rain  += (tRain  - s.rain)  * ke;
    s.snow  += (tSnow  - s.snow)  * ke;
    s.mist  += (tMist  - s.mist)  * ke;

    // wind with gusts
    const now  = performance.now() * 0.001;
    const gust = 1 + 0.35 * Math.sin(now * 0.6) + 0.18 * Math.sin(now * 1.7 + 1);
    const dir  = ((w?.windDirection ?? 90) * Math.PI) / 180;
    const spd  = Math.max(0.1, Math.min(1.3, (w?.windSpeed ?? 6) / 32)) * gust;
    ENV.cloud = s.cloud; ENV.windSpeed = spd;
    ENV.windX = Math.sin(dir) * (0.4 + spd * 3.5);
    ENV.windZ = Math.cos(dir) * (0.4 + spd * 3.5);
    ENV.wet = Math.max(0, Math.min(1, ENV.wet + ((s.rain > 0.05 || s.snow > 0.05) ? dt * 0.12 : -dt * 0.04)));

    // fog density
    if (scene.fog) {
      const fogAmt = Math.max(s.cloud * 0.25, s.rain * 0.85, s.mist * 0.9);
      scene.fog.near = THREE.MathUtils.lerp(scene.fog.near, 70 - fogAmt * 56, Math.min(1, dt * 1.5));
      scene.fog.far  = THREE.MathUtils.lerp(scene.fog.far, 145 - fogAmt * 98, Math.min(1, dt * 1.5));
    }

    // rain streaks
    if (rainRef.current) {
      const vis = s.rain > 0.02; rainRef.current.visible = vis;
      if (vis) {
        const fallSpeed = 16 + s.rain * 34;
        const vy = -fallSpeed, vlen = Math.hypot(ENV.windX, vy, ENV.windZ) || 1;
        const ux = ENV.windX / vlen, uy = vy / vlen, uz = ENV.windZ / vlen;
        const L = 0.6 + s.rain * 1.0;
        const pos = rainGeo.attributes.position.array;
        const wx = ENV.windX * dt, wz = ENV.windZ * dt, fall = fallSpeed * dt;
        for (let i = 0; i < RAIN; i++) {
          rainHeads[i*3] += wx; rainHeads[i*3+1] -= fall; rainHeads[i*3+2] += wz;
          if (rainHeads[i*3+1] < 0) { rainHeads[i*3+1]=26; rainHeads[i*3]=(Math.random()*2-1)*60; rainHeads[i*3+2]=(Math.random()*2-1)*60; }
          const hx = rainHeads[i*3], hy = rainHeads[i*3+1], hz = rainHeads[i*3+2];
          pos[i*6]=hx; pos[i*6+1]=hy; pos[i*6+2]=hz;
          pos[i*6+3]=hx-ux*L; pos[i*6+4]=hy-uy*L; pos[i*6+5]=hz-uz*L;
        }
        rainGeo.attributes.position.needsUpdate = true;
        rainRef.current.material.opacity = 0.25 + s.rain * 0.5;
      }
    }

    // snow drift
    if (snowRef.current) {
      const vis = s.snow > 0.02; snowRef.current.visible = vis;
      if (vis) {
        const arr = snowGeo.attributes.position.array;
        const fall = (1.5 + s.snow * 3) * dt;
        for (let i = 0; i < SNOW; i++) {
          arr[i*3+1] -= fall;
          arr[i*3]   += (Math.sin(now * 0.8 + snowPh[i]) * 0.5 + ENV.windX * 0.3) * dt;
          arr[i*3+2] += (Math.cos(now * 0.7 + snowPh[i]) * 0.5 + ENV.windZ * 0.3) * dt;
          if (arr[i*3+1] < 0) { arr[i*3+1]=26; arr[i*3]=(Math.random()*2-1)*60; arr[i*3+2]=(Math.random()*2-1)*60; }
        }
        snowGeo.attributes.position.needsUpdate = true;
        snowRef.current.material.opacity = 0.5 + s.snow * 0.45;
      }
    }

    // clouds drift
    if (cloudsRef.current) {
      cloudsRef.current.visible = s.cloud > 0.05;
      const p = cloudsRef.current.position;
      p.x += ENV.windX * dt * 0.12; p.z += ENV.windZ * dt * 0.12;
      if (p.x > 45) p.x = -45; else if (p.x < -45) p.x = 45;
      if (p.z > 45) p.z = -45; else if (p.z < -45) p.z = 45;
    }

    // ground mist
    if (mistRef.current) {
      mistMat.opacity = THREE.MathUtils.lerp(mistMat.opacity, s.mist * 0.22, Math.min(1, dt * 2));
      mistRef.current.visible = s.mist > 0.03;
      const p = mistRef.current.position;
      p.x += ENV.windX * dt * 0.05; if (p.x > 40) p.x = -40; else if (p.x < -40) p.x = 40;
    }

    // lightning: jagged bolt + sky flash
    if (flashRef.current) {
      if (storm) { s.nextBolt -= dt; if (s.nextBolt <= 0) { s.flash = 1; strike(); s.nextBolt = 2.5 + Math.random() * 6; } }
      s.flash = Math.max(0, s.flash - dt * 3.2);
      flashRef.current.intensity = s.flash * 2.8;
      if (boltMat.current) boltMat.current.opacity = s.flash > 0.5 ? (s.flash - 0.5) * 2 : 0;
    }
  });

  return (
    <>
      <ambientLight ref={flashRef} intensity={0} color="#e6ecff" />
      <group ref={cloudsRef}>
        <Clouds key={`${bucket}-${cloudColor}`} material={THREE.MeshLambertMaterial} limit={300}>
          {cloudSeeds.map((c, i) => (
            <Cloud key={i} seed={i} position={c.pos} bounds={[9, 2, 7]} volume={6}
                   segments={18} opacity={cloudOpacity} color={cloudColor} speed={0.15} growth={3} />
          ))}
        </Clouds>
      </group>
      <lineSegments ref={rainRef} geometry={rainGeo} visible={false}>
        <lineBasicMaterial color="#bcdcff" transparent opacity={0.5} depthWrite={false} />
      </lineSegments>
      <points ref={snowRef} geometry={snowGeo} visible={false}>
        <pointsMaterial size={0.16} color="#ffffff" transparent opacity={0.85} depthWrite={false} sizeAttenuation />
      </points>
      <line geometry={boltGeo} frustumCulled={false}>
        <lineBasicMaterial ref={boltMat} color="#dbe8ff" transparent opacity={0} depthWrite={false} />
      </line>
      <group ref={mistRef} visible={false}>
        {mistSeeds.map((p, i) => (<sprite key={i} position={p} scale={[16, 7, 1]} material={mistMat} />))}
      </group>
    </>
  );
}

// Current hour-of-day (0..24) from the clock control. Pure → shared by the
// scene lighting and the HUD time readout.
function hourFromClock(c, nowMs) {
  if (!c || !c.enabled) return 12;                 // cycle off → static noon
  if (c.mode === 'manual') return c.manualHour;    // scrubbed by the slider
  if (c.mode === 'demo') {                          // fast-forward preview
    const elapsedH = ((nowMs - c.startMs) / 3600000) * c.speed;
    return (((c.hour0 + elapsedH) % 24) + 24) % 24;
  }
  const d = new Date(nowMs);                        // live local time
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}
// Sun height: 0 at 06:00 / 18:00, +1 at noon, −1 at midnight.
const sunElevation = (h) => Math.sin(((h - 6) / 12) * Math.PI);

/* ----------------------------------------- planetary pulse (moon + seasons) */
// Moon phase 0..1 (0/1 = new, 0.5 = full) from a known new-moon epoch.
function moonPhase(ms) {
  const SYNODIC = 29.530588853;                  // days
  const ref = Date.UTC(2000, 0, 6, 18, 14) / 86400000;  // 2000-01-06 new moon, in days
  const days = ms / 86400000 - ref;
  return (((days % SYNODIC) + SYNODIC) % SYNODIC) / SYNODIC;
}
const moonIllum = (p) => (1 - Math.cos(p * 2 * Math.PI)) / 2;   // 0 new … 1 full
const MOON_NAMES = ['New', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 'Full', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];
const MOON_ICONS = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
const moonIndex = (p) => Math.round(p * 8) % 8;
// Meteorological season from month + hemisphere (lat sign).
const SEASONS = {
  spring: { name: 'Spring', icon: '🌸', tint: '#bfe6a0' },
  summer: { name: 'Summer', icon: '☀️', tint: '#fff0c0' },
  autumn: { name: 'Autumn', icon: '🍂', tint: '#f0c890' },
  winter: { name: 'Winter', icon: '❄️', tint: '#cfe0ff' },
};
function seasonOf(date, lat) {
  const n = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'][date.getMonth()];
  if ((lat ?? 40) >= 0) return n;
  return { winter: 'summer', summer: 'winter', spring: 'autumn', autumn: 'spring' }[n];   // southern hemisphere
}

// A real moon disc with the correct illuminated crescent/gibbous for `phase`
// (0/1 new … 0.5 full), drawn once on a canvas with subtle craters.
function makeMoonTexture(phase) {
  if (typeof document === 'undefined') return null;
  const S = 256, cx = S / 2, cy = S / 2, R = S * 0.46;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#13151f'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();   // earthshine dark side
  const cosP = Math.cos(2 * Math.PI * phase);
  const waxing = phase < 0.5;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#e9edf6';                              // lit region: limb arc + terminator ellipse
  ctx.beginPath();
  const N = 60;
  for (let i = 0; i <= N; i++) { const th = -Math.PI / 2 + (i / N) * Math.PI; const c = waxing ? Math.cos(th) : -Math.cos(th); ctx.lineTo(cx + R * c, cy + R * Math.sin(th)); }
  for (let i = N; i >= 0; i--) { const th = -Math.PI / 2 + (i / N) * Math.PI; const c = (waxing ? Math.cos(th) : -Math.cos(th)) * cosP; ctx.lineTo(cx + R * c, cy + R * Math.sin(th)); }
  ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 0.12; ctx.fillStyle = '#7d8596';      // craters
  [[0.32, 0.36, 0.12], [0.6, 0.56, 0.15], [0.46, 0.7, 0.1], [0.68, 0.32, 0.08], [0.52, 0.5, 0.18]]
    .forEach(([fx, fy, fr]) => { ctx.beginPath(); ctx.arc(cx + (fx - 0.5) * 2 * R, cy + (fy - 0.5) * 2 * R, fr * R, 0, Math.PI * 2); ctx.fill(); });
  ctx.restore();
  const t = new THREE.CanvasTexture(cv); t.anisotropy = 8; return t;
}
const MOON_TEX = makeMoonTexture(moonPhase(Date.now()));

// Soft hot sun disc (radial gradient) reused at several scales for a bloom-like sun.
function makeSunTexture() {
  if (typeof document === 'undefined') return null;
  const S = 128, c = S / 2;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(255,255,250,1)');
  g.addColorStop(0.35, 'rgba(255,242,205,0.95)');
  g.addColorStop(0.6, 'rgba(255,205,130,0.45)');
  g.addColorStop(1, 'rgba(255,185,95,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(cv);
}
const SUN_TEX = makeSunTexture();

// square loop (closed) of given half-extent at a given height
const squareLoop = (h, y) => [[-h, y, -h], [h, y, -h], [h, y, h], [-h, y, h], [-h, y, -h]];

const SPRAY = 18;  // droplets per active sprinkler

/* --------------------------------------------------------------- crops */
// One plant's meshes by crop shape. Pure (no hooks) — reused for every plant.
// Materials are shared & recoloured live, so we just pick geometry here.
function plantMeshes(shape, leafMat, stemMat, barkMat, fruitMat) {
  switch (shape) {
    case 'bush': {  // tomato — staked vine, layered foliage, hanging fruit
      const fruit = [[0.11, 0.2, 0.05], [-0.09, 0.27, -0.06], [0.04, 0.16, -0.1], [-0.05, 0.33, 0.08]];
      return (<>
        <mesh material={barkMat} position={[0.01, 0.3, -0.02]}><cylinderGeometry args={[0.008, 0.01, 0.6, 4]} /></mesh>{/* stake */}
        <mesh material={stemMat} position={[0, 0.09, 0]}><cylinderGeometry args={[0.02, 0.028, 0.18, 5]} /></mesh>
        <mesh material={leafMat} position={[0, 0.26, 0]}><icosahedronGeometry args={[0.17, 0]} /></mesh>
        <mesh material={leafMat} position={[0.08, 0.16, 0.06]}><icosahedronGeometry args={[0.1, 0]} /></mesh>
        <mesh material={leafMat} position={[-0.08, 0.18, -0.05]}><icosahedronGeometry args={[0.09, 0]} /></mesh>
        {fruit.map((p, i) => (
          <mesh key={i} material={fruitMat} position={p}><sphereGeometry args={[0.045, 7, 7]} /></mesh>
        ))}
      </>);
    }
    case 'pepper': {  // pepper — bush with elongated hanging fruit
      const fruit = [[0.1, 0.16, 0.04], [-0.08, 0.2, -0.05], [0.02, 0.13, -0.08]];
      return (<>
        <mesh material={stemMat} position={[0, 0.1, 0]}><cylinderGeometry args={[0.022, 0.03, 0.2, 5]} /></mesh>
        <mesh material={leafMat} position={[0, 0.27, 0]}><icosahedronGeometry args={[0.16, 0]} /></mesh>
        <mesh material={leafMat} position={[0.07, 0.18, -0.05]}><icosahedronGeometry args={[0.1, 0]} /></mesh>
        {fruit.map((p, i) => (
          <mesh key={i} material={fruitMat} position={p} scale={[0.55, 1.3, 0.55]}><sphereGeometry args={[0.05, 7, 7]} /></mesh>
        ))}
      </>);
    }
    case 'leafy':  // lettuce — layered ruffled rosette
      return (<>
        <mesh material={leafMat} position={[0, 0.07, 0]} scale={[1, 0.45, 1]}><sphereGeometry args={[0.2, 9, 9]} /></mesh>
        <mesh material={leafMat} position={[0.08, 0.11, 0.06]} rotation={[0.3, 0, 0.2]} scale={[1, 0.5, 1]}><sphereGeometry args={[0.12, 8, 8]} /></mesh>
        <mesh material={leafMat} position={[-0.09, 0.1, -0.05]} rotation={[-0.2, 0, -0.3]} scale={[1, 0.5, 1]}><sphereGeometry args={[0.11, 8, 8]} /></mesh>
        <mesh material={leafMat} position={[0.02, 0.16, -0.07]} scale={[1, 0.55, 1]}><sphereGeometry args={[0.09, 8, 8]} /></mesh>
      </>);
    case 'stalk': {  // wheat — dense cluster of stalks with golden heads
      const xs = [-0.05, -0.02, 0.01, 0.04, 0.07];
      return (<>
        {xs.map((x, i) => (
          <group key={i} position={[x, 0, (i % 2 ? 0.02 : -0.02)]}>
            <mesh material={leafMat} position={[0, 0.3, 0]}><cylinderGeometry args={[0.008, 0.011, 0.6, 4]} /></mesh>
            <mesh material={leafMat} position={[0, 0.66, 0]} scale={[1, 1.6, 1]}><coneGeometry args={[0.035, 0.14, 5]} /></mesh>
          </group>
        ))}
      </>);
    }
    case 'tree':   // fruit tree — tapered trunk, layered canopy, fruit
      return (<>
        <mesh material={barkMat} position={[0, 0.24, 0]}><cylinderGeometry args={[0.035, 0.065, 0.48, 6]} /></mesh>
        <mesh material={leafMat} position={[0, 0.56, 0]}><icosahedronGeometry args={[0.25, 1]} /></mesh>
        <mesh material={leafMat} position={[0.13, 0.5, 0.05]}><icosahedronGeometry args={[0.15, 1]} /></mesh>
        <mesh material={leafMat} position={[-0.12, 0.52, -0.06]}><icosahedronGeometry args={[0.14, 1]} /></mesh>
        {[[0.18, 0.5, 0.08], [-0.14, 0.58, -0.1], [0.05, 0.4, 0.16], [-0.05, 0.66, 0.05]].map((p, i) => (
          <mesh key={i} material={fruitMat} position={p}><sphereGeometry args={[0.05, 7, 7]} /></mesh>
        ))}
      </>);
    default:       // grass tuft — fan of blades
      return (<>
        {[-0.12, -0.05, 0.02, 0.09, 0.05].map((x, i) => (
          <mesh key={i} material={leafMat} position={[x, 0.18, (i % 2 ? 0.05 : -0.04)]} rotation={[0, 0, (x) * 0.8]}>
            <coneGeometry args={[0.03, 0.36, 4]} />
          </mesh>
        ))}
      </>);
  }
}

// A small field of plants on each plot. The species is set per-plot in the
// Customize panel; height + colour track live soil moisture (lush green & tall
// when wet, short/yellow-brown & wilting when dry).
function CropField({ deviceId, size, half, crop }) {
  const def = CROP_TYPES[crop] || CROP_TYPES.grass;
  const groupRef = useRef();
  const leafMat  = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.85 }), []);
  const stemMat  = useMemo(() => new THREE.MeshStandardMaterial({ color: '#5c7a2f', roughness: 0.9 }), []);
  const barkMat  = useMemo(() => new THREE.MeshStandardMaterial({ color: '#6b4a2b', roughness: 0.9 }), []);
  const fruitMat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.45 }), []);
  const wetCol   = useMemo(() => new THREE.Color(def.leaf), [def.leaf]);
  const target   = useMemo(() => new THREE.Color(), []);
  useEffect(() => { fruitMat.color.set(def.fruit || '#e23b3b'); }, [fruitMat, def.fruit]);
  useEffect(() => () => { leafMat.dispose(); stemMat.dispose(); barkMat.dispose(); fruitMat.dispose(); },
    [leafMat, stemMat, barkMat, fruitMat]);

  // jittered layout that keeps the centre (sensor disc/pole) clear
  const plants = useMemo(() => {
    const n = Math.max(4, Math.min(14, Math.round(size * 1.4)));
    const out = [];
    let guard = 0;
    while (out.length < n && guard++ < n * 8) {
      const x = (Math.random() * 2 - 1) * (half - 0.4);
      const z = (Math.random() * 2 - 1) * (half - 0.4);
      if (Math.hypot(x, z) < Math.min(0.95, half * 0.55)) continue;
      out.push({ x, z, ph: Math.random() * Math.PI * 2, s: 0.85 + Math.random() * 0.4 });
    }
    return out;
  }, [size, half]);

  useFrame((_, dt) => {
    const g = groupRef.current;
    if (!g) return;
    const d = useTwinStore.getState().byId[deviceId] || {};
    const soil = Number(d.soil ?? d.soil_moisture_pct);
    const health = Number.isFinite(soil) ? Math.max(0, Math.min(1, soil / 100)) : 0.4;
    target.copy(CROP_DRY).lerp(wetCol, health);
    if (d.status === 'offline') target.lerp(C_OFF, 0.5);
    target.multiplyScalar(1 - ENV.wet * 0.18);          // foliage darkens in the rain
    leafMat.color.lerp(target, Math.min(1, dt * 3));
    // self-illuminate the plants at night so the crops stay visible
    const ni = ENV.night * 0.5;
    leafMat.emissive.copy(leafMat.color);  leafMat.emissiveIntensity = ni;
    stemMat.emissive.copy(stemMat.color);  stemMat.emissiveIntensity = ni;
    barkMat.emissive.copy(barkMat.color);  barkMat.emissiveIntensity = ni;
    fruitMat.emissive.copy(fruitMat.color); fruitMat.emissiveIntensity = ni * 1.1;
    const grow = 0.4 + health * 1.0;     // taller when healthy
    const wilt = (1 - health) * 0.5;     // lean over when parched
    const t = performance.now() * 0.001;
    g.children.forEach((c, i) => {
      const p = plants[i];
      if (!p) return;
      c.scale.set(p.s, p.s * grow, p.s);
      c.rotation.z = Math.sin(t * 0.8 + p.ph) * 0.06 + wilt;   // breeze sway + wilt
    });
  });

  return (
    <group ref={groupRef} position={[0, 0.18, 0]}>
      {plants.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          {plantMeshes(def.shape, leafMat, stemMat, barkMat, fruitMat)}
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------ solar / energy */
// Per-node off-grid power: a solar panel, an animated energy line that flows
// (panel → battery) while the sun is up, a battery bar that fills/greens while
// charging, and a consumption line that flows (battery → valve) while watering.
// Spark particles fizz at the panel during production.
function NodeEnergy({ deviceId, half }) {
  const prodRef  = useRef();   // production flow line (solar → battery)
  const consRef  = useRef();   // consumption flow line (battery → valve)
  const battRef  = useRef();   // battery fill mesh
  const panelRef = useRef();   // panel material (glows when producing/at night)
  const sparkRef = useRef();   // spark cloud (visible only while producing)
  const c = Math.max(0.9, half - 0.5);
  const panelPos = [c, 0, -c];     // a back corner of the plot
  const battPos  = [0.2, 1.4, 0];  // beside the sensor head

  useFrame((_, dt) => {
    const d = useTwinStore.getState().byId[deviceId] || {};
    const prod = Math.max(0, ENV.sun);          // solar production 0..1 (by sun height)
    const bat  = Math.max(0, Math.min(100, Number(d.bat ?? d.battery_pct ?? 0)));
    const load = (d.pump ?? d.pump_state) === 'on' || (d.valve ?? d.valve_state) === 'open';
    // prefer the real INA219 charging flag; fall back to the solar estimate
    const charging = (d.charging ?? d.battery_charging) ?? (prod > 0.05 && bat < 99);

    if (prodRef.current) {
      const m = prodRef.current.material;
      if (prod > 0) m.dashOffset -= dt * (1.5 + prod * 2);
      m.opacity = THREE.MathUtils.lerp(m.opacity, prod > 0.04 ? 0.45 + prod * 0.45 : 0.05, Math.min(1, dt * 4));
    }
    if (consRef.current) {
      const m = consRef.current.material;
      if (load) m.dashOffset -= dt * 2.6;
      m.opacity = THREE.MathUtils.lerp(m.opacity, load ? 0.85 : 0.04, Math.min(1, dt * 4));
    }
    if (battRef.current) {
      const f = Math.max(0.04, bat / 100);
      battRef.current.scale.y = f;
      battRef.current.position.y = -0.09 + f * 0.09;     // grow up from the cell floor
      const col = charging ? '#22c55e' : bat < 20 ? '#ef4444' : '#eab308';
      battRef.current.material.color.set(col);
      battRef.current.material.emissive.set(col);
      battRef.current.material.emissiveIntensity = 0.25 + ENV.night * 0.9 + (charging ? 0.4 : 0);
    }
    if (panelRef.current) panelRef.current.emissiveIntensity = prod * 0.3 + ENV.night * 0.2;
    if (sparkRef.current) sparkRef.current.visible = prod > 0.15;
  });

  return (
    <>
      {/* solar panel on a post */}
      <group position={panelPos}>
        <mesh position={[0, 0.32, 0]} castShadow><cylinderGeometry args={[0.03, 0.03, 0.64, 6]} /><meshStandardMaterial color="#64748b" metalness={0.4} roughness={0.6} /></mesh>
        <mesh position={[0, 0.6, 0]} rotation={[-0.5, 0, 0]} castShadow>
          <boxGeometry args={[0.66, 0.025, 0.44]} />
          <meshStandardMaterial ref={panelRef} color="#13335f" emissive={NEON_BLUE} emissiveIntensity={0} metalness={0.7} roughness={0.25} />
        </mesh>
        <group ref={sparkRef} position={[0, 0.7, 0]} visible={false}>
          <Sparkles count={7} scale={[0.6, 0.4, 0.5]} size={2.4} speed={0.5} noise={1.5} color={SOLAR_YEL} />
        </group>
      </group>

      {/* battery cell beside the head */}
      <group position={battPos}>
        <mesh position={[0, 0.02, 0]}><boxGeometry args={[0.12, 0.24, 0.07]} /><meshStandardMaterial color="#0f172a" transparent opacity={0.45} /></mesh>
        <mesh ref={battRef} position={[0, -0.09, 0.012]}><boxGeometry args={[0.08, 0.2, 0.05]} /><meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.3} /></mesh>
      </group>

      {/* animated energy lines */}
      <Line ref={prodRef} points={[[panelPos[0], 0.6, panelPos[2]], [battPos[0], battPos[1] + 0.08, battPos[2]]]}
        color={SOLAR_YEL} lineWidth={2.1} dashed dashSize={0.24} gapSize={0.18} transparent opacity={0.05} depthWrite={false} />
      <Line ref={consRef} points={[[battPos[0], battPos[1] - 0.06, battPos[2]], [0, 0.25, 0]]}
        color={NEON_CYAN} lineWidth={2.1} dashed dashSize={0.2} gapSize={0.16} transparent opacity={0.04} depthWrite={false} />
    </>
  );
}

/* -------------------------------------------------------------- node marker */
// Each node is a big square field plot ("terrain"). Plot colour = status (or a
// custom tint); a status-coloured border always shows online/offline at a
// glance. Furrow stripes give it a tilled-field look. When a valve/pump is live
// it sprays water; when something's wrong a red halo pulses underneath.
function NodeMarker({ deviceId, gwColor, selected, editMode, onSelect, onBeginDrag }) {
  const dev  = useTwinStore((s) => s.byId[deviceId]) || {};
  const pos  = useTwinStore((s) => s.positions[deviceId]) || [0, 0, 0];
  const cust = useTwinStore((s) => s.custom[deviceId]) || {};
  const feat = useTwinStore((s) => s.features);
  const energyLayer = useTwinStore((s) => s.digital && s.digitalLayer === 'energy');
  const plotRef  = useRef();
  const discRef  = useRef();
  const ringRef  = useRef();
  const orbRef   = useRef();
  const ledRef   = useRef();
  const alertRef = useRef();
  const sprayRef = useRef();
  const [hovered, setHovered] = useState(false);
  const target = useMemo(() => new THREE.Color(), []);

  const size = clampSize(cust.size ?? DEFAULT_SIZE);
  const rot  = cust.rot ?? 0;
  const customColor = cust.color || null;
  const label = cust.label || '';
  const half = size / 2;

  // particle buffer + per-droplet seeds (fixed for the life of the marker)
  const sprayGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPRAY * 3), 3));
    return g;
  }, []);
  const spraySeeds = useMemo(() => Array.from({ length: SPRAY }, () => ({
    ang: Math.random() * Math.PI * 2,
    r:   0.2 + Math.random() * 0.5,
    ph:  Math.random(),
    sp:  0.6 + Math.random() * 0.7,
  })), []);

  // furrow rows (tilled-field stripes), recomputed only when size changes
  const furrows = useMemo(() => {
    const n = Math.max(3, Math.round(size / 0.7));
    const span = size * 0.9;
    const rows = [];
    for (let i = 0; i < n; i++) rows.push(-span / 2 + (i / (n - 1)) * span);
    return { len: span, rows };
  }, [size]);
  const statusBorder = useMemo(() => squareLoop(half * 0.99, 0.2), [half]);
  const selBorder    = useMemo(() => squareLoop(half + 0.25, 0.23), [half]);

  useFrame((_, dt) => {
    const S = useTwinStore.getState();
    const d = S.byId[deviceId] || dev;
    const now = performance.now();
    const status    = d.status;
    const valveOpen = (d.valve ?? d.valve_state) === 'open';
    const pumpOn    = (d.pump ?? d.pump_state) === 'on';
    const watering  = valveOpen || pumpOn;   // valve open auto-starts the pump

    // self-illuminate plots + soil disc at night so they don't go dark
    const nightLit = ENV.night * 0.6;
    if (plotRef.current) {
      plotTarget(target, status, customColor);
      const m = plotRef.current.material;
      m.color.lerp(target, Math.min(1, dt * 4));
      m.emissive.copy(m.color); m.emissiveIntensity = nightLit;
    }
    if (discRef.current) {
      soilTarget(target, d.soil ?? d.soil_moisture_pct, status);
      const m = discRef.current.material;
      m.color.lerp(target, Math.min(1, dt * 4));
      m.emissive.copy(m.color); m.emissiveIntensity = nightLit;
    }
    if (ringRef.current) {
      ringRef.current.visible = valveOpen;
      if (valveOpen) {
        const p = 1 + Math.sin(now * 0.004) * 0.12;
        ringRef.current.scale.set(p, p, p);
        ringRef.current.material.opacity = 0.35 + Math.sin(now * 0.004) * 0.18;
      }
    }
    // water spray (valve open OR pump on) — a little fountain of droplets
    if (sprayRef.current) {
      sprayRef.current.visible = watering;
      if (watering) {
        const arr = sprayGeo.attributes.position.array;
        const t = now * 0.001;
        for (let i = 0; i < SPRAY; i++) {
          const s = spraySeeds[i];
          const u = (s.ph + t * s.sp) % 1;          // 0..1 flight progress
          const reach = s.r * (0.5 + half);
          arr[i * 3]     = Math.cos(s.ang) * reach * u;
          arr[i * 3 + 1] = 0.25 + 1.2 * u * (1 - u) * 4;   // parabolic arc
          arr[i * 3 + 2] = Math.sin(s.ang) * reach * u;
        }
        sprayGeo.attributes.position.needsUpdate = true;
      }
    }
    // red alert halo
    if (alertRef.current) {
      const has = computeNodeAlerts(d).length > 0;
      alertRef.current.visible = has;
      if (has) {
        const p = 1 + Math.sin(now * 0.005) * 0.06;
        alertRef.current.scale.set(p, p, p);
        alertRef.current.material.opacity = 0.45 + Math.sin(now * 0.005) * 0.25;
      }
    }
    if (orbRef.current) {
      const low = (d.bat ?? d.battery_pct ?? 100) < LOW_BAT;
      orbRef.current.material.emissiveIntensity = (low ? 0.4 + Math.abs(Math.sin(now * 0.006)) : 0.9) + ENV.night * 1.4;
    }
    // neon LED glow — ramps up after dark (cyberpunk night mode)
    if (ledRef.current) {
      const online = status === 'online';
      const pulse = 0.75 + Math.sin(now * 0.005) * 0.25;
      ledRef.current.material.opacity = ENV.night * (online ? 0.95 : 0.22) * pulse;
      ledRef.current.material.color.set(statusColor(status));
      const sc = 0.7 + ENV.night * 0.6;
      ledRef.current.scale.set(sc, sc, sc);
    }
  });

  const orbColor   = statusColor(dev.status);
  const borderCol  = statusColor(dev.status);
  const showSel    = selected || hovered;
  const cornerCol  = gwColor || '#94a3b8';
  const discR      = Math.min(0.85, half * 0.5);
  const vr         = Math.min(1.15, half * 0.72);

  return (
    <group
      position={pos}
      rotation={[0, THREE.MathUtils.degToRad(rot), 0]}
      onClick={(e) => { e.stopPropagation(); onSelect(deviceId); }}
      onPointerDown={(e) => { if (editMode) { e.stopPropagation(); onBeginDrag(deviceId); } }}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = editMode ? 'grab' : 'pointer'; }}
      onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto'; }}
    >
      {/* the field plot (terrain square) */}
      <mesh ref={plotRef} position={[0, 0.08, 0]} receiveShadow castShadow>
        <boxGeometry args={[size, 0.16, size]} />
        <meshStandardMaterial color="#9ca3af" roughness={0.95} metalness={0} />
      </mesh>

      {/* tilled furrow stripes */}
      <group position={[0, 0.165, 0]}>
        {furrows.rows.map((z, i) => (
          <mesh key={i} position={[0, 0, z]}>
            <boxGeometry args={[furrows.len, 0.02, 0.05]} />
            <meshStandardMaterial color="#000000" transparent opacity={0.12} />
          </mesh>
        ))}
      </group>

      {/* crops — grow/wilt with soil moisture */}
      {feat.crops && <CropField deviceId={deviceId} size={size} half={half} crop={cust.crop} />}

      {/* status border (green online / red offline) */}
      <Line points={statusBorder} color={borderCol} lineWidth={2.4} />

      {/* selection / hover highlight */}
      {showSel && <Line points={selBorder} color="#f59e0b" lineWidth={2.4} />}

      {/* pulsing red alert halo (under the plot) */}
      <mesh ref={alertRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.22, 0]} visible={false}>
        <ringGeometry args={[half + 0.35, half + 0.62, 48]} />
        <meshBasicMaterial color="#ef4444" transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>

      {/* corner posts in the owning gateway's colour */}
      {[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz], i) => (
        <mesh key={i} position={[sx * (half - 0.14), 0.34, sz * (half - 0.14)]} castShadow>
          <boxGeometry args={[0.16, 0.55, 0.16]} />
          <meshStandardMaterial color={cornerCol} />
        </mesh>
      ))}

      {/* centre soil-moisture disc */}
      <mesh ref={discRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.18, 0]}>
        <circleGeometry args={[discR, 40]} />
        <meshStandardMaterial color="#a9774a" roughness={0.9} />
      </mesh>

      {/* valve "watering" ring */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.2, 0]} visible={false}>
        <ringGeometry args={[vr, vr + 0.22, 48]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.45} side={THREE.DoubleSide} />
      </mesh>

      {/* water spray particles */}
      <points ref={sprayRef} geometry={sprayGeo} position={[0, 0.2, 0]} visible={false}>
        <pointsMaterial size={0.14} color="#7dd3fc" transparent opacity={0.9} depthWrite={false} sizeAttenuation />
      </points>

      {/* sensor pole + head */}
      <mesh position={[0, 0.78, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 1.2, 12]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.3} roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.4, 0]} castShadow>
        <boxGeometry args={[0.34, 0.18, 0.22]} />
        <meshStandardMaterial color="#475569" />
      </mesh>

      {/* status orb */}
      <mesh ref={orbRef} position={[0, 1.68, 0]}>
        <sphereGeometry args={[0.15, 18, 18]} />
        <meshStandardMaterial color={orbColor} emissive={orbColor} emissiveIntensity={0.9} />
      </mesh>

      {/* neon LED glow halo (ramps up at night) */}
      <sprite ref={ledRef} position={[0, 1.68, 0]} scale={[0.7, 0.7, 0.7]}>
        <spriteMaterial map={GLOW_TEX} color={orbColor} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>

      {/* off-grid solar power: panel + battery + animated energy flows */}
      {feat.energy && <NodeEnergy deviceId={deviceId} half={half} />}

      {feat.labels && !energyLayer && (() => {
        const bat = dev.bat ?? dev.battery_pct;
        const charging = dev.charging ?? dev.battery_charging;
        return (
          <Html position={[0, 2.1, 0]} center distanceFactor={13} className="pointer-events-none select-none">
            <div className="px-2 py-0.5 rounded-md bg-white/90 shadow text-[11px] leading-tight whitespace-nowrap border border-gray-200">
              <span className="font-semibold text-gray-800">{label || dev.name || deviceId}</span>
              <span className="text-gray-500"> · 💧{dev.soil ?? dev.soil_moisture_pct ?? '—'}%</span>
              <span className={charging ? 'text-amber-500 font-semibold' : 'text-emerald-600 font-medium'}>
                {' · '}{charging ? '⚡' : '🔋'}{bat ?? '—'}%{charging ? ' charging' : ''}
              </span>
            </div>
          </Html>
        );
      })()}
    </group>
  );
}

/* ---- live pump badge (React component so it can subscribe to the store) ---- */
function PumpStatusBadge({ clusterNodeIds }) {
  const byId = useTwinStore((s) => s.byId);
  const on = clusterNodeIds.some((nid) => {
    const d = byId[nid];
    return (d?.pump ?? d?.pump_state) === 'on';
  });
  return (
    <div style={{
      fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
      padding: '2px 7px', borderRadius: '5px', whiteSpace: 'nowrap',
      background: on ? 'rgba(8,47,73,0.92)' : 'rgba(15,23,42,0.80)',
      color:      on ? '#22d3ee' : '#64748b',
      border:     `1px solid ${on ? 'rgba(14,165,233,0.5)' : 'rgba(71,85,105,0.35)'}`,
      boxShadow:  on ? '0 0 10px rgba(34,211,238,0.35)' : 'none',
      transition: 'all 0.3s ease',
    }}>
      {on ? '⚙ PUMP ● ON' : '⚙ PUMP ○ OFF'}
    </div>
  );
}

/* ----------------------------------------------------------- gateway object */
// clusterNodeIds: device_ids of nodes that relay through this gateway —
// used to determine whether the shared pump should be shown as running.
function GatewayObject({ deviceId, color, editMode, onSelect, onBeginDrag, clusterNodeIds = [] }) {
  const dev = useTwinStore((s) => s.byId[deviceId]) || {};
  const pos = useTwinStore((s) => s.positions[deviceId]) || [0, 0, 0];
  const feat = useTwinStore((s) => s.features);
  const ringRef     = useRef();
  const impRef      = useRef();   // pump impeller (spins when running)
  const pumpLedRef  = useRef();   // status LED on pump motor
  const pumpBodyRef = useRef();   // pump volute — glows when running
  const bodyRef     = useRef();   // gateway enclosure material — neon glow at night
  const glowRef     = useRef();   // additive neon halo sprite
  const [hovered, setHovered] = useState(false);

  useFrame((_, dt) => {
    // ── gateway signal ring ────────────────────────────────────────
    if (ringRef.current) {
      const online = useTwinStore.getState().byId[deviceId]?.status === 'online';
      ringRef.current.visible = online;
      if (online) {
        const t = (performance.now() * 0.0009) % 1;
        const s = 0.5 + t * 4.5;
        ringRef.current.scale.set(s, s, s);
        ringRef.current.material.opacity = 0.5 * (1 - t);
      }
    }
    // ── pump — on when ANY cluster node has pump running ──────────
    const byId = useTwinStore.getState().byId;
    const pumpOn = clusterNodeIds.some((nid) => {
      const d = byId[nid];
      return (d?.pump ?? d?.pump_state) === 'on';
    });
    const now = performance.now();
    if (impRef.current) {
      if (pumpOn) impRef.current.rotation.x += dt * 9;
    }
    if (pumpLedRef.current) {
      pumpLedRef.current.material.emissiveIntensity = pumpOn
        ? 0.6 + Math.sin(now * 0.007) * 0.35
        : 0.08;
      pumpLedRef.current.material.color.set(pumpOn ? '#22d3ee' : '#475569');
      pumpLedRef.current.material.emissive.set(pumpOn ? '#22d3ee' : '#000');
    }
    if (pumpBodyRef.current) {
      pumpBodyRef.current.material.emissive.set(pumpOn ? '#0369a1' : '#000');
      pumpBodyRef.current.material.emissiveIntensity = pumpOn ? 0.18 : 0;
    }
    // ── cyberpunk night glow on the gateway enclosure + neon halo ──
    const gOnline = byId[deviceId]?.status === 'online';
    if (bodyRef.current) {
      bodyRef.current.emissiveIntensity = (gOnline ? 0.4 : 0) + (gOnline ? ENV.night * 1.2 : 0);
    }
    if (glowRef.current) {
      glowRef.current.material.opacity = (gOnline ? ENV.night * 0.85 : 0) * (0.8 + Math.sin(now * 0.004) * 0.2);
      const sc = 1.7 + ENV.night * 1.1;
      glowRef.current.scale.set(sc, sc, sc);
    }
  });

  const online = dev.status === 'online';
  return (
    <group
      position={pos}
      onClick={(e) => { e.stopPropagation(); onSelect(deviceId); }}
      onPointerDown={(e) => { if (editMode) { e.stopPropagation(); onBeginDrag(deviceId); } }}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = editMode ? 'grab' : 'pointer'; }}
      onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto'; }}
    >
      {/* coloured pad */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} receiveShadow>
        <circleGeometry args={[2.4, 56]} />
        <meshStandardMaterial color={color} transparent opacity={hovered ? 0.34 : 0.2} />
      </mesh>

      {/* gateway base + enclosure */}
      <mesh position={[0, 0.15, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.6, 0.3, 1.2]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      <mesh position={[0, 0.75, 0]} castShadow>
        <boxGeometry args={[0.7, 0.9, 0.5]} />
        <meshStandardMaterial ref={bodyRef} color={online ? color : '#64748b'} emissive={online ? color : '#000'} emissiveIntensity={online ? 0.4 : 0} />
      </mesh>

      {/* neon enclosure halo (glows after dark) */}
      <sprite ref={glowRef} position={[0, 0.85, 0]} scale={[1.7, 1.7, 1.7]}>
        <spriteMaterial map={GLOW_TEX} color={color} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      {/* antenna */}
      <mesh position={[0, 1.7, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 1.0, 8]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.5} />
      </mesh>
      <mesh position={[0, 2.25, 0]}>
        <sphereGeometry args={[0.08, 12, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1} />
      </mesh>

      {/* signal pulse ring */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} visible={false}>
        <ringGeometry args={[0.9, 1.05, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>

      {/* ── PUMP MODEL (centrifugal pump beside gateway) ──────────── */}
      {/* Positioned at [-2.4, 0, 0] — to the left of the gateway pad */}
      <group position={[-2.4, 0, 0.1]}>
        {/* base plate */}
        <mesh position={[0, 0.05, 0]} receiveShadow>
          <boxGeometry args={[1.5, 0.1, 0.95]} />
          <meshStandardMaterial color="#0f172a" metalness={0.4} roughness={0.8} />
        </mesh>
        {/* pump volute (housing) */}
        <mesh ref={pumpBodyRef} position={[-0.28, 0.42, 0]} castShadow>
          <boxGeometry args={[0.72, 0.6, 0.72]} />
          <meshStandardMaterial color="#1e3a5f" metalness={0.55} roughness={0.38} />
        </mesh>
        {/* volute front face (darker inset) */}
        <mesh position={[-0.28, 0.42, 0.37]}>
          <boxGeometry args={[0.6, 0.48, 0.04]} />
          <meshStandardMaterial color="#0c2340" metalness={0.7} roughness={0.3} />
        </mesh>
        {/* impeller (spins on X axis — shaft goes into motor) */}
        <group ref={impRef} position={[-0.28, 0.42, 0.28]}>
          <mesh><boxGeometry args={[0.04, 0.38, 0.04]} /><meshStandardMaterial color="#38bdf8" /></mesh>
          <mesh><boxGeometry args={[0.38, 0.04, 0.04]} /><meshStandardMaterial color="#38bdf8" /></mesh>
          <mesh rotation={[0, 0, Math.PI / 4]}><boxGeometry args={[0.04, 0.38, 0.04]} /><meshStandardMaterial color="#7dd3fc" /></mesh>
          <mesh rotation={[0, 0, Math.PI / 4]}><boxGeometry args={[0.38, 0.04, 0.04]} /><meshStandardMaterial color="#7dd3fc" /></mesh>
          <mesh>
            <torusGeometry args={[0.19, 0.035, 8, 24]} />
            <meshStandardMaterial color="#0ea5e9" emissive="#0ea5e9" emissiveIntensity={0.25} />
          </mesh>
        </group>
        {/* motor cylinder */}
        <mesh position={[0.4, 0.42, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.24, 0.24, 0.82, 20]} />
          <meshStandardMaterial color="#1d4ed8" metalness={0.55} roughness={0.35} />
        </mesh>
        {/* motor cooling fins */}
        {[0.1, 0.28, 0.46, 0.64].map((x, i) => (
          <mesh key={i} position={[x + 0.01, 0.42, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.28, 0.28, 0.04, 20]} />
            <meshStandardMaterial color="#1e40af" metalness={0.5} roughness={0.4} />
          </mesh>
        ))}
        {/* motor end cap + status LED */}
        <mesh position={[0.84, 0.42, 0]}>
          <cylinderGeometry args={[0.24, 0.24, 0.06, 20]} rotation={[0, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#0f172a" metalness={0.6} />
        </mesh>
        <mesh ref={pumpLedRef} position={[0.88, 0.55, 0]}>
          <sphereGeometry args={[0.07, 10, 10]} />
          <meshStandardMaterial color="#475569" emissive="#000" emissiveIntensity={0.08} />
        </mesh>
        {/* inlet pipe — from bottom of volute going down */}
        <mesh position={[-0.28, 0.13, -0.2]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.085, 0.085, 0.38, 12]} />
          <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.5} />
        </mesh>
        {/* outlet pipe — rises out of top of volute */}
        <mesh position={[-0.05, 0.85, 0]}>
          <cylinderGeometry args={[0.075, 0.075, 0.5, 12]} />
          <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.5} />
        </mesh>
        {/* outlet elbow cap */}
        <mesh position={[-0.05, 1.12, 0]}>
          <sphereGeometry args={[0.085, 10, 10]} />
          <meshStandardMaterial color="#475569" metalness={0.5} />
        </mesh>
        {/* live pump status badge */}
        <Html position={[0, 1.45, 0]} center distanceFactor={13} className="pointer-events-none select-none">
          <PumpStatusBadge clusterNodeIds={clusterNodeIds} />
        </Html>
      </group>

      {feat.labels && (
        <Html position={[0, 2.6, 0]} center distanceFactor={13} className="pointer-events-none select-none">
          <div className="px-2 py-0.5 rounded-md text-white shadow text-[11px] leading-tight whitespace-nowrap" style={{ background: color }}>
            <span className="font-semibold">📡 {dev.name || deviceId}</span>
            <span className="opacity-80"> · {dev.status || 'unknown'}</span>
          </div>
        </Html>
      )}
    </group>
  );
}

/* -------------------------------------------------------------- lora link */
// A single hop in the relay chain. Endpoints are just position keys, so this
// works for gateway->node and node->node hops alike.
function LoraLink({ fromKey, toKey, color }) {
  const a = useTwinStore((s) => s.positions[fromKey]);
  const b = useTwinStore((s) => s.positions[toKey]);
  if (!a || !b) return null;
  return (
    <Line
      points={[[a[0], 0.4, a[2]], [b[0], 0.4, b[2]]]}
      color={color || '#22d3ee'}
      lineWidth={1.2}
      dashed
      dashSize={0.35}
      gapSize={0.22}
      transparent
      opacity={0.5}
    />
  );
}

/* ---------------------------------------------------- cinematic camera */
// Camera director with four modes:
//   intro     — sweeping fly-in from high & far on first load
//   focus     — eased push-in to the selected device (click, non-cinematic)
//   cinematic — interactive auto-orbit: OrbitControls stay live (zoom / drag /
//               pan) while autoRotate spins; the look-at follows a clicked
//               device, else the farm centre
//   idle      — hands control back to the user
function CinematicDirector({ controlsRef, scene, cinematic, editMode }) {
  const { camera } = useThree();
  const selectedId = useTwinStore((s) => s.selectedId);
  const mode = useRef('intro');
  const goal = useRef(null);
  const gTgt = useMemo(() => new THREE.Vector3(), []);
  const C = useMemo(() => new THREE.Vector3(), []);

  // intro fly-in (runs once on mount)
  useEffect(() => {
    camera.position.set(72, 58, 72);
    goal.current = { pos: new THREE.Vector3(24, 20, 26), tgt: new THREE.Vector3(0, 1, 0) };
    mode.current = 'intro';
  }, [camera]);

  // push-in to the clicked device (when NOT in cinematic)
  useEffect(() => {
    if (!selectedId || cinematic || editMode) return;
    const p = useTwinStore.getState().positions[selectedId];
    if (!p) return;
    const tgt = new THREE.Vector3(p[0], 1, p[2]);
    const dir = camera.position.clone().sub(controlsRef.current?.target || tgt);
    if (dir.lengthSq() < 0.001) dir.set(7, 7, 9);
    dir.normalize().multiplyScalar(11);
    goal.current = { pos: tgt.clone().add(dir), tgt };
    mode.current = 'focus';
  }, [selectedId, cinematic, editMode, camera, controlsRef]);

  // farm centroid → C (the default look-at when nothing is selected)
  const centroid = () => {
    const st = useTwinStore.getState();
    const ids = [...(scene.nodeIds || []), ...(scene.gwIds || [])];
    let n = 0; C.set(0, 0, 0);
    ids.forEach((id) => { const p = st.positions[id]; if (p) { C.x += p[0]; C.z += p[2]; n++; } });
    if (n) { C.x /= n; C.z /= n; } C.y = 1;
  };

  useFrame((_, dt) => {
    const c = controlsRef.current;
    if (!c) return;

    if (cinematic && !editMode) {
      // Interactive showcase: OrbitControls stays ENABLED so you can zoom,
      // orbit and pan freely, while autoRotate keeps the camera spinning. The
      // look-at eases onto a clicked device (else the farm centre), so a click
      // makes it auto-orbit that one — without ever locking out your cursor.
      if (mode.current !== 'cinematic') {
        mode.current = 'cinematic';
        c.enabled = true;
        c.autoRotate = true;
        c.autoRotateSpeed = 0.6;
      }
      const st = useTwinStore.getState();
      const selPos = st.selectedId ? st.positions[st.selectedId] : null;
      if (selPos) gTgt.set(selPos[0], 1.2, selPos[2]);
      else { centroid(); gTgt.copy(C); }
      c.target.lerp(gTgt, Math.min(1, dt * 1.2));
      c.update();
      return;
    }
    if (mode.current === 'cinematic') {
      mode.current = 'idle';
      c.autoRotate = false;
    }

    if ((mode.current === 'intro' || mode.current === 'focus') && goal.current) {
      c.enabled = false;
      const k = Math.min(1, dt * (mode.current === 'intro' ? 1.1 : 4));
      camera.position.lerp(goal.current.pos, k);
      c.target.lerp(goal.current.tgt, k);
      c.update();
      const done = camera.position.distanceTo(goal.current.pos) < (mode.current === 'intro' ? 0.6 : 0.1);
      if (done) { goal.current = null; mode.current = 'idle'; c.enabled = true; }
    }
  });
  return null;
}

/* ----------------------------------------------------- underground pipes */
// One buried pipe segment between two points. A transparent casing (cylinder)
// plus a dashed blue centre-line whose dashes scroll to fake water flow. Flow
// only animates while the segment's cluster is irrigating (pump on / valve open).
function FlowPipe({ from, to, clusterNodeIds }) {
  const lineRef = useRef();
  const tubeRef = useRef();
  const { mid, len, quat } = useMemo(() => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const dir = b.clone().sub(a);
    const l = Math.max(0.001, dir.length());
    return {
      mid: a.clone().add(b).multiplyScalar(0.5).toArray(),
      len: l,
      quat: new THREE.Quaternion().setFromUnitVectors(PIPE_UP, dir.normalize()).toArray(),
    };
  }, [from, to]);

  useFrame((_, dt) => {
    if (!lineRef.current) return;
    const byId = useTwinStore.getState().byId;
    const active = clusterNodeIds.some((nid) => {
      const d = byId[nid];
      return (d?.pump ?? d?.pump_state) === 'on' || (d?.valve ?? d?.valve_state) === 'open';
    });
    const m = lineRef.current.material;
    if (active) m.dashOffset -= dt * 1.6;                       // scroll = flow
    // brighter when flowing; at night the idle pipes still softly glow
    m.opacity = THREE.MathUtils.lerp(m.opacity, active ? 0.95 : 0.1 + ENV.night * 0.3, Math.min(1, dt * 4));
    if (tubeRef.current) tubeRef.current.emissiveIntensity = ENV.night * (active ? 0.9 : 0.4) + (active ? 0.5 : 0);
  });

  return (
    <group>
      <mesh position={mid} quaternion={quat}>
        <cylinderGeometry args={[PIPE_R, PIPE_R, len, 12, 1, true]} />
        <meshStandardMaterial ref={tubeRef} color="#9fb6c9" emissive={NEON_BLUE} emissiveIntensity={0} transparent opacity={0.22} roughness={0.15} metalness={0.2} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Line ref={lineRef} points={[from, to]} color={NEON_BLUE} lineWidth={2.4} dashed dashSize={0.4} gapSize={0.24} transparent opacity={0.1} depthWrite={false} />
    </group>
  );
}

// Whole farm pipe network: gateway → its pump → each plot in its cluster.
function PipeNetwork({ scene }) {
  const positions = useTwinStore((s) => s.positions);
  const { gwIds, nodeIds, nodeGw } = scene;
  const pipes = useMemo(() => {
    const out = [];
    gwIds.forEach((gw) => {
      const gp = positions[gw];
      if (!gp) return;
      const cluster = nodeIds.filter((nid) => nodeGw[nid] === gw);
      const pump = [gp[0] - 2.4, PIPE_Y, gp[2] + 0.1];          // pump sits left of the gateway
      out.push({ key: `${gw}-trunk`, from: [gp[0], PIPE_Y, gp[2]], to: pump, cluster });
      cluster.forEach((nid) => {
        const np = positions[nid];
        if (np) out.push({ key: `${gw}->${nid}`, from: pump, to: [np[0], PIPE_Y, np[2]], cluster });
      });
    });
    return out;
  }, [positions, gwIds, nodeIds, nodeGw]);

  return (
    <group>
      {pipes.map((p) => (
        <FlowPipe key={p.key} from={p.from} to={p.to} clusterNodeIds={p.cluster} />
      ))}
    </group>
  );
}

/* ------------------------------------------------ signal spectrum mode */
// "Electromagnetic World View" — a futuristic telecom overlay revealing the
// LoRa RF environment: EM wave halos pulsing from each radio's lamp/antenna,
// a travelling zigzag "sound-wave" signal between lamp→lamp along the relay
// chain, and interference colouring (cyan = strong, magenta = weak) from RSSI.
const RF_STRONG = new THREE.Color('#22e0ff');
const RF_WEAK   = new THREE.Color('#ff2d7e');
const RF_OFF    = new THREE.Color('#ef4444');   // offline node = red / no signal
const RF_DOWN   = new THREE.Color('#fbbf24');   // downlink (gateway → node commands)
const rssiQuality = (r) => (r == null ? 0.6 : Math.max(0, Math.min(1, (r + 110) / 60))); // −110..−50 → 0..1
// Height of the glowing "lamp" (status orb / antenna tip) each signal rides on.
const lampHeight = (key, gwSet) => (gwSet.has(key) ? 2.2 : 1.66);

// EM wave halos emanating from a radio's lamp (rings rise + expand from there).
function RfWaves({ deviceId, baseColor, y = 1.66, maxR = 8, count = 3, interference = false }) {
  const pos  = useTwinStore((s) => s.positions[deviceId]) || [0, 0, 0];
  const refs = useRef([]);
  const fixed = useMemo(() => new THREE.Color(baseColor || '#22e0ff'), [baseColor]);
  const tmp   = useMemo(() => new THREE.Color(), []);
  useFrame(() => {
    const t = performance.now() * 0.001;
    let c = fixed, off = false;
    if (interference) {
      const d = useTwinStore.getState().byId[deviceId] || {};
      off = d.status === 'offline';
      c = off ? RF_OFF : tmp.copy(RF_WEAK).lerp(RF_STRONG, rssiQuality(d.rssi ?? d.lora_rssi));
    }
    for (let i = 0; i < refs.current.length; i++) {
      const g = refs.current[i]; if (!g) continue;
      const p = ((t * 0.4) + i / count) % 1;       // expanding 0..1
      const r = 0.3 + p * maxR;
      g.scale.set(r, r, r);
      g.position.y = p * 1.2;                        // also drift upward off the lamp
      g.children[0].material.opacity = (1 - p) * (off ? 0.22 : 0.5);   // dim when offline
      g.children[0].material.color.copy(c);
    }
  });
  return (
    <group position={[pos[0], y, pos[2]]}>
      {Array.from({ length: count }).map((_, i) => (
        <group key={i} ref={(el) => (refs.current[i] = el)} rotation={[-Math.PI / 2, 0, 0]}>
          <mesh>
            <ringGeometry args={[0.92, 1.0, 64]} />
            <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// Animated zigzag "sound-wave" signal between two radios with visible DATA
// PACKETS riding the wave: cyan/magenta telemetry flowing node→gateway (uplink,
// coloured by RSSI) and amber commands flowing gateway→node (downlink). The
// polyline + the packets share the exact same wave function so packets sit on it.
const WAVE_N = 56;
const WAVE_PACKETS = [
  { dir: -1, phase: 0.00, sp: 0.55 },   // uplink  (node → gateway)
  { dir: -1, phase: 0.34, sp: 0.55 },
  { dir: -1, phase: 0.68, sp: 0.55 },
  { dir:  1, phase: 0.20, sp: 0.38 },   // downlink (gateway → node)
  { dir:  1, phase: 0.70, sp: 0.38 },
];
function SignalWave({ fromKey, toKey, fromY, toY }) {
  const a = useTwinStore((s) => s.positions[fromKey]);
  const b = useTwinStore((s) => s.positions[toKey]);
  const lineRef = useRef();
  const pktRefs = useRef([]);
  const col = useMemo(() => new THREE.Color(), []);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(WAVE_N * 3), 3));
    return g;
  }, []);
  useFrame(() => {
    if (!a || !b || !lineRef.current) return;
    const t = performance.now() * 0.001;
    const d = useTwinStore.getState().byId[toKey] || {};
    const offline = d.status === 'offline';
    const ax = a[0], az = a[2], bx = b[0], bz = b[2];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    const px = -dz / len, pz = dx / len;            // horizontal perpendicular
    const amp = offline ? 0 : Math.min(0.7, len * 0.07);
    const cyc = Math.max(4, Math.round(len * 0.9));
    // shared wave function → both the line and the packets sample this
    const wave = (s, out) => {
      const env = Math.sin(s * Math.PI);
      const ph  = s * Math.PI * 2 * cyc - t * 7;
      const off = Math.sin(ph) * amp * env;
      out[0] = ax + dx * s + px * off;
      out[1] = (fromY + (toY - fromY) * s) + Math.cos(ph) * amp * env * 0.45;
      out[2] = az + dz * s + pz * off;
      return env;
    };
    const arr = geo.attributes.position.array;
    const tmp = [0, 0, 0];
    for (let i = 0; i < WAVE_N; i++) { wave(i / (WAVE_N - 1), tmp); arr[i * 3] = tmp[0]; arr[i * 3 + 1] = tmp[1]; arr[i * 3 + 2] = tmp[2]; }
    geo.attributes.position.needsUpdate = true;
    geo.computeBoundingSphere();
    col.copy(offline ? RF_OFF : (rssiQuality(d.rssi ?? d.lora_rssi) > 0.5 ? RF_STRONG : RF_WEAK));
    lineRef.current.material.color.copy(col);
    lineRef.current.material.opacity = offline ? 0.22 : 0.4 + 0.12 * Math.sin(t * 4);

    // data packets travelling along the wave
    for (let i = 0; i < WAVE_PACKETS.length; i++) {
      const m = pktRefs.current[i]; if (!m) continue;
      if (offline) { m.visible = false; continue; }
      m.visible = true;
      const pk = WAVE_PACKETS[i];
      const u = (t * pk.sp + pk.phase) % 1;
      const s = pk.dir < 0 ? 1 - u : u;              // uplink travels node→gateway
      const env = wave(s, tmp);
      m.position.set(tmp[0], tmp[1], tmp[2]);
      m.material.opacity = env * (pk.dir < 0 ? 0.95 : 0.7);
      m.material.color.copy(pk.dir < 0 ? col : RF_DOWN);
      const sc = pk.dir < 0 ? 0.55 : 0.42; m.scale.set(sc, sc, sc);
    }
  });
  if (!a || !b) return null;
  return (
    <group>
      <line ref={lineRef} geometry={geo} frustumCulled={false}>
        <lineBasicMaterial transparent opacity={0.5} depthWrite={false} blending={THREE.AdditiveBlending} />
      </line>
      {WAVE_PACKETS.map((_, i) => (
        <sprite key={i} ref={(el) => (pktRefs.current[i] = el)} visible={false}>
          <spriteMaterial map={GLOW_TEX} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
      ))}
    </group>
  );
}

// Floating "NO SIGNAL" tag over an offline node in the comms layer.
function NoSignalTag({ deviceId }) {
  const status = useTwinStore((s) => s.byId[deviceId]?.status);
  const pos = useTwinStore((s) => s.positions[deviceId]);
  if (status !== 'offline' || !pos) return null;
  return (
    <Html position={[pos[0], 2.25, pos[2]]} center distanceFactor={14} className="pointer-events-none select-none">
      <div className="px-1.5 py-0.5 rounded bg-red-950/85 text-red-300 text-[9px] font-bold whitespace-nowrap ring-1 ring-red-500/50 animate-pulse">✕ NO SIGNAL</div>
    </Html>
  );
}

function SignalSpectrum({ scene }) {
  const { gwIds, nodeIds, links, gwColor } = scene;
  const gwSet = useMemo(() => new Set(gwIds), [gwIds]);
  return (
    <group>
      {gwIds.map((id) => <RfWaves key={id} deviceId={id} baseColor={gwColor[id]} y={2.2} maxR={3.2} count={4} />)}
      {nodeIds.map((id) => <RfWaves key={id} deviceId={id} y={1.66} maxR={2.2} count={3} interference />)}
      {nodeIds.map((id) => <NoSignalTag key={`ns${id}`} deviceId={id} />)}
      {links.map((l) => (
        <SignalWave key={`${l.fromKey}->${l.toKey}`} fromKey={l.fromKey} toKey={l.toKey}
          fromY={lampHeight(l.fromKey, gwSet)} toY={lampHeight(l.toKey, gwSet)} />
      ))}
    </group>
  );
}

// LAYER · ENERGY — live INA219 readout floating over each node (3D tags):
// battery %, bus voltage, current, and charge direction.
function EnergyTags({ scene }) {
  const byId = useTwinStore((s) => s.byId);
  const positions = useTwinStore((s) => s.positions);
  return (
    <group>
      {scene.nodeIds.map((id) => {
        const p = positions[id]; if (!p) return null;
        const d = byId[id] || {};
        const v   = d.bat_v ?? d.battery_v;
        const ma  = d.bat_ma ?? d.battery_ma;
        const pct = d.bat ?? d.battery_pct;
        const charging = d.charging ?? d.battery_charging;
        return (
          <Html key={id} position={[p[0], 2.0, p[2]]} center distanceFactor={15} className="pointer-events-none select-none">
            <div className="px-2 py-1 rounded-lg bg-slate-900/85 ring-1 ring-amber-400/40 text-[9px] font-mono text-center whitespace-nowrap shadow-lg">
              <div className={charging ? 'text-emerald-300 font-bold' : 'text-amber-300 font-bold'}>
                {charging ? '⚡' : '🔋'} {pct != null ? `${Math.round(pct)}%` : '—'}
              </div>
              <div className="text-slate-300">{v != null ? `${v.toFixed(2)}V` : '—'} · {ma != null ? `${Math.round(ma)}mA` : '—'}</div>
            </div>
          </Html>
        );
      })}
    </group>
  );
}

/* ----------------------------------------------------- day / night sky */
// Drives the sun position, light colour/intensity, sky and fog from the
// current hour-of-day so the farm runs through dawn → noon → dusk → night.
function SkyAndSun({ clock }) {
  const { scene } = useThree();
  const dirRef  = useRef();
  const hemiRef = useRef();
  const ambRef  = useRef();
  const sky = useMemo(() => new THREE.Color(), []);
  const col = useMemo(() => new THREE.Color(), []);
  const hemiSky = useMemo(() => new THREE.Color(), []);
  const hemiGnd = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    const h = hourFromClock(clock, Date.now());
    const e = sunElevation(h);                          // −1..1
    const day = Math.max(0, e);                         // 0 below horizon
    const lowSun = Math.max(0, 1 - Math.abs(e) / 0.3);  // 1 near sunrise/sunset
    // publish to the shared environment so everything else can react to night
    ENV.sun = e;
    ENV.night = Math.max(0, Math.min(1, (0.15 - e) / 0.7));

    const cloudDim = 1 - ENV.cloud * 0.6;               // overcast → softer sun
    const moonFloor = 0.04 + moonIllum(moonPhase(Date.now())) * 0.14;  // brighter nights at full moon
    if (dirRef.current) {
      const az = ((h - 6) / 12) * Math.PI;              // 0 sunrise … π sunset
      dirRef.current.position.set(Math.cos(az) * 45, Math.max(e, -0.3) * 50 + 6, 18);
      dirRef.current.intensity = (moonFloor + day * 1.35) * cloudDim * (1 - ENV.digital * 0.72); // moon floor + sun, dim in digital
      col.copy(SUN_NOON).lerp(SUN_LOW, lowSun);         // warm at the horizon
      if (e < 0) col.lerp(SUN_MOON, Math.min(1, -e * 2)); // cool at night
      dirRef.current.color.copy(col);
    }
    if (hemiRef.current) {
      hemiRef.current.intensity = (0.18 + day * 0.7) * (1 - ENV.cloud * 0.35) * (1 - ENV.digital * 0.6);
      // tint the fill light deep blue/purple at night for the cyberpunk look
      hemiRef.current.color.copy(hemiSky.set('#eaf2ff').lerp(new THREE.Color('#2b2f6b'), ENV.night));
      hemiRef.current.groundColor.copy(hemiGnd.set('#b8c6a8').lerp(new THREE.Color('#0e1330'), ENV.night));
    }
    if (ambRef.current) ambRef.current.intensity = 0.12 + day * 0.28;

    sky.copy(SKY_NIGHT).lerp(SKY_DAY, Math.max(0, Math.min(1, (e + 0.25) / 0.6)));
    sky.lerp(SKY_DUSK, lowSun * 0.55);                  // dawn/dusk glow
    if (ENV.digital > 0.001) sky.lerp(DIGI_DARK, ENV.digital * 0.92);  // cyber void in digital layer
    if (scene.background && scene.background.isColor) scene.background.copy(sky);
    if (scene.fog) scene.fog.color.copy(sky);
  });

  return (
    <>
      <hemisphereLight ref={hemiRef} intensity={0.75} color="#eaf2ff" groundColor="#b8c6a8" />
      <ambientLight ref={ambRef} intensity={0.3} />
      <directionalLight
        ref={dirRef}
        position={[24, 30, 14]} intensity={1.25} castShadow
        shadow-mapSize-width={4096} shadow-mapSize-height={4096}
        shadow-bias={-0.0002} shadow-normalBias={0.025} shadow-radius={4}
        shadow-camera-left={-60} shadow-camera-right={60} shadow-camera-top={60} shadow-camera-bottom={-60}
      />
      <NightSky />
    </>
  );
}

/* ------------------------------- planetary: HQ sun disc + crescent moon */
// A glowing layered sun (bloom-like) that arcs with the clock, and a real-phase
// crescent/gibbous moon rising opposite it and brightening through its cycle.
function PlanetarySky({ clock }) {
  const sunRef = useRef(), sg1 = useRef(), sg2 = useRef();
  const moonRef = useRef(), mGlow = useRef();
  useFrame(() => {
    const h = hourFromClock(clock, Date.now());
    const e = sunElevation(h);
    const az = ((h - 6) / 12) * Math.PI;
    const up = Math.max(0, e);
    const digOk = ENV.digital < 0.5;

    // ── sun: a bright core + two soft additive halos (fakes bloom) ──
    const sunVis = e > -0.06 && digOk;
    const sx = Math.cos(az) * 90, sy = Math.max(e, -0.06) * 82 + 5, sz = 34;
    [sunRef, sg1, sg2].forEach((r) => { if (r.current) { r.current.visible = sunVis; r.current.position.set(sx, sy, sz); } });
    if (sunRef.current) sunRef.current.material.opacity = sunVis ? 1 : 0;
    if (sg1.current) { const s = 16 + (1 - up) * 12; sg1.current.scale.set(s, s, s); sg1.current.material.opacity = 0.45 + up * 0.45; }
    if (sg2.current) { const s = 30 + (1 - up) * 18; sg2.current.scale.set(s, s, s); sg2.current.material.opacity = 0.2 + up * 0.18; }

    // ── moon: phase disc + soft halo, opposite the sun ──
    const mh = h + 12, me = sunElevation(mh), maz = ((mh - 6) / 12) * Math.PI;
    const illum = moonIllum(moonPhase(Date.now()));
    const moonVis = ENV.night > 0.03 && digOk;
    const mx = Math.cos(maz) * 72, my = Math.max(me, -0.12) * 54 + 14, mz = 26;
    if (moonRef.current) { moonRef.current.visible = moonVis; moonRef.current.position.set(mx, my, mz); moonRef.current.material.opacity = Math.min(1, ENV.night * 1.5); }
    if (mGlow.current) { mGlow.current.visible = moonVis; mGlow.current.position.set(mx, my, mz); mGlow.current.material.opacity = ENV.night * (0.1 + illum * 0.32); const s = 11 + illum * 5; mGlow.current.scale.set(s, s, s); }
  });
  return (
    <>
      <sprite ref={sg2}><spriteMaterial map={SUN_TEX} color="#ffcf8a" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} /></sprite>
      <sprite ref={sg1}><spriteMaterial map={SUN_TEX} color="#fff0c8" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} /></sprite>
      <sprite ref={sunRef} scale={[7, 7, 7]}><spriteMaterial map={SUN_TEX} color="#fffaf0" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} /></sprite>
      <sprite ref={mGlow}><spriteMaterial map={GLOW_TEX} color="#cfe0ff" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} /></sprite>
      <sprite ref={moonRef} scale={[8, 8, 8]}><spriteMaterial map={MOON_TEX} transparent opacity={0} depthWrite={false} /></sprite>
    </>
  );
}

/* ============================================ TWO WORLDS — digital layer */
// The master controller: ramps the shared ENV.digital transition (0=physical
// world … 1=digital world), darkens the sky toward a cyber void, and fills the
// air with drifting data particles. Lights/ground/crops elsewhere read ENV.digital.
const DIGI_DARK = new THREE.Color('#06070f');   // cyber-void sky in the digital layer
const DIGI_LAYERS = [
  ['comms',      '📡', 'Comms',      '#22e0ff'],
  ['water',      '🌊', 'Water',      '#38bdf8'],
  ['ai',         '🧠', 'AI Brain',   '#a855f7'],
  ['climate',    '🌫', 'Climate',    '#5eead4'],
  ['energy',     '⚡', 'Energy',     '#ffd54a'],
  ['prediction', '🔮', 'Prediction', '#f472b6'],
  ['biology',    '🌱', 'Biology',    '#84cc16'],
];

function DigitalController({ active }) {
  const sparkRef = useRef();
  useFrame((_, dt) => {
    ENV.digital = THREE.MathUtils.lerp(ENV.digital, active ? 1 : 0, Math.min(1, dt * 1.6));
    if (sparkRef.current) sparkRef.current.visible = ENV.digital > 0.05;
  });
  return (
    <group ref={sparkRef} visible={false}>
      <Sparkles count={140} scale={[130, 34, 130]} position={[0, 13, 0]} size={3} speed={0.3} opacity={0.5} color="#5fd0ff" noise={2} />
    </group>
  );
}

// LAYER · AI BRAIN — a neural web over the farm with a pulsing core + data pulses.
function AiNeural({ scene }) {
  const positions = useTwinStore((s) => s.positions);
  const { nodeIds, gwIds, links } = scene;
  const brainRef = useRef();
  const ringRefs = useRef([]);
  const pulseRefs = useRef([]);
  const AI = '#a855f7';
  const center = useMemo(() => {
    let x = 0, z = 0, n = 0;
    [...nodeIds, ...gwIds].forEach((id) => { const p = positions[id]; if (p) { x += p[0]; z += p[2]; n++; } });
    return n ? [x / n, 6, z / n] : [0, 6, 0];
  }, [positions, nodeIds, gwIds]);
  const edges = useMemo(() => {
    const gwSet = new Set(gwIds), e = [];
    links.forEach((l) => {
      const a = positions[l.fromKey], b = positions[l.toKey];
      if (a && b) e.push({ a: [a[0], gwSet.has(l.fromKey) ? 2.2 : 1.66, a[2]], b: [b[0], gwSet.has(l.toKey) ? 2.2 : 1.66, b[2]] });
    });
    gwIds.forEach((id) => { const p = positions[id]; if (p) e.push({ a: center, b: [p[0], 2.25, p[2]], brain: true }); });
    return e;
  }, [positions, links, gwIds, center]);
  useFrame((_, dt) => {
    const t = performance.now() * 0.001, vis = ENV.digital > 0.05, d = ENV.digital;
    if (brainRef.current) {
      brainRef.current.visible = vis;
      const s = 1 + Math.sin(t * 2) * 0.12;
      brainRef.current.scale.set(s, s, s);
      brainRef.current.rotation.y += dt * 0.4;
      brainRef.current.material.emissiveIntensity = (0.6 + Math.sin(t * 3) * 0.3) * d;
    }
    ringRefs.current.forEach((m, i) => { if (!m) return; const p = ((t * 0.3) + i / 3) % 1; const r = 1 + p * 8; m.scale.set(r, r, r); m.material.opacity = (1 - p) * 0.4 * d; });
    pulseRefs.current.forEach((m, i) => {
      const e = edges[i]; if (!m || !e) { if (m) m.visible = false; return; }
      m.visible = vis;
      const tt = ((t * 0.4) + i * 0.13) % 1;
      m.position.set(e.a[0] + (e.b[0] - e.a[0]) * tt, e.a[1] + (e.b[1] - e.a[1]) * tt, e.a[2] + (e.b[2] - e.a[2]) * tt);
      m.material.opacity = Math.sin(tt * Math.PI) * 0.9 * d;
    });
  });
  return (
    <group>
      {edges.map((e, i) => <Line key={i} points={[e.a, e.b]} color={e.brain ? '#c084fc' : AI} lineWidth={e.brain ? 1.6 : 1.1} transparent opacity={0.35} depthWrite={false} />)}
      {edges.map((e, i) => (
        <sprite key={`p${i}`} ref={(el) => (pulseRefs.current[i] = el)} scale={[0.5, 0.5, 0.5]}>
          <spriteMaterial map={GLOW_TEX} color={AI} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
      ))}
      <mesh ref={brainRef} position={center} visible={false}>
        <icosahedronGeometry args={[0.9, 1]} />
        <meshStandardMaterial color={AI} emissive={AI} emissiveIntensity={0.7} wireframe transparent opacity={0.85} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(el) => (ringRefs.current[i] = el)} position={center} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.92, 1, 48]} />
          <meshBasicMaterial color={AI} transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
      <Html position={[center[0], center[1] + 1.5, center[2]]} center distanceFactor={16} className="pointer-events-none select-none">
        <div className="px-2 py-0.5 rounded-md bg-purple-950/80 text-purple-200 text-[10px] font-semibold whitespace-nowrap ring-1 ring-purple-400/40">🧠 AI · analysing drought risk</div>
      </Html>
    </group>
  );
}

// LAYER · BIOLOGY — glowing root systems below each plant (seen through ground).
function RootSystem({ pos }) {
  const branches = useMemo(() => {
    const out = [], main = [];
    for (let i = 0; i < 6; i++) main.push([(Math.random() * 2 - 1) * 0.1 * i, -i * 0.28, (Math.random() * 2 - 1) * 0.1 * i]);
    out.push(main);
    for (let b = 0; b < 4; b++) {
      const start = 1 + Math.floor(Math.random() * 3), br = [main[start]];
      for (let i = 1; i < 4; i++) { const prev = br[i - 1]; br.push([prev[0] + (Math.random() * 2 - 1) * 0.35, prev[1] - 0.3, prev[2] + (Math.random() * 2 - 1) * 0.35]); }
      out.push(br);
    }
    return out;
  }, []);
  return (
    <group position={[pos[0], 0.1, pos[2]]}>
      {branches.map((b, i) => <Line key={i} points={b} color="#9bd64a" lineWidth={i === 0 ? 2 : 1.1} transparent opacity={0.7} depthWrite={false} />)}
    </group>
  );
}
function Roots({ scene }) {
  const positions = useTwinStore((s) => s.positions);
  const grpRef = useRef();
  useFrame(() => { if (grpRef.current) grpRef.current.visible = ENV.digital > 0.1; });
  return (
    <group ref={grpRef} visible={false}>
      {scene.nodeIds.map((id) => { const p = positions[id]; return p ? <RootSystem key={id} pos={p} /> : null; })}
    </group>
  );
}

// LAYER · PREDICTION — translucent "+48h" ghost crop + drought-risk ring per plot.
function PredictionGhosts({ scene }) {
  const positions = useTwinStore((s) => s.positions);
  const byId = useTwinStore((s) => s.byId);
  const grpRef = useRef();
  const refs = useRef([]);
  useFrame(() => {
    const t = performance.now() * 0.001;
    if (grpRef.current) grpRef.current.visible = ENV.digital > 0.1;
    refs.current.forEach((m, i) => { if (m) m.material.opacity = (0.22 + 0.12 * Math.sin(t * 2 + i)) * ENV.digital; });
  });
  return (
    <group ref={grpRef} visible={false}>
      {scene.nodeIds.map((id, i) => {
        const p = positions[id]; if (!p) return null;
        const d = byId[id] || {};
        const soil = Number(d.soil ?? d.soil_moisture_pct);
        const risk = Number.isFinite(soil) ? Math.max(0, Math.min(1, (40 - soil) / 40)) : 0.3;
        const col = risk > 0.5 ? '#f87171' : '#f472b6';
        return (
          <group key={id} position={[p[0], 0, p[2]]}>
            <mesh ref={(el) => (refs.current[i] = el)} position={[0, 1.4, 0]}>
              <coneGeometry args={[0.5, 1.8, 8]} />
              <meshBasicMaterial color={col} transparent opacity={0.25} depthWrite={false} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.3, 0]}>
              <ringGeometry args={[1.3, 1.5, 40]} />
              <meshBasicMaterial color={col} transparent opacity={0.4} side={THREE.DoubleSide} depthWrite={false} />
            </mesh>
            <Html position={[0, 2.7, 0]} center distanceFactor={15} className="pointer-events-none select-none">
              <div className="px-1.5 py-0.5 rounded bg-pink-950/80 text-pink-200 text-[9px] font-semibold whitespace-nowrap ring-1 ring-pink-400/40">+48H · {risk > 0.5 ? 'drought risk' : 'stable'}</div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

/* ----------------------------------------------------------------- 3D scene */
function Scene({ scene, editMode, onSelect, onCommit, clock, cinematic }) {
  const { nodeIds, gwIds, links, gwColor } = scene;
  const selectedId  = useTwinStore((s) => s.selectedId);
  const digital      = useTwinStore((s) => s.digital);
  const digitalLayer = useTwinStore((s) => s.digitalLayer);
  const setPosition = useTwinStore((s) => s.setPosition);
  const setDragging = useTwinStore((s) => s.setDragging);
  const feat        = useTwinStore((s) => s.features);

  const { camera, gl, raycaster } = useThree();
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hit   = useMemo(() => new THREE.Vector3(), []);
  const dragKey = useRef(null);
  const controlsRef = useRef();

  // Drag = raycast the pointer onto the y=0 plane and write the position.
  useEffect(() => {
    if (!editMode) return;
    const el = gl.domElement;
    const onMove = (ev) => {
      if (!dragKey.current) return;
      const rect = el.getBoundingClientRect();
      const nx = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera({ x: nx, y: ny }, camera);
      if (raycaster.ray.intersectPlane(plane, hit)) {
        setPosition(dragKey.current, [clampXZ(hit.x), 0, clampXZ(hit.z)]);
      }
    };
    const onUp = () => {
      if (dragKey.current) {
        const k = dragKey.current;
        dragKey.current = null;
        setDragging(false);
        if (controlsRef.current) controlsRef.current.enabled = true;
        onCommit(k);
      }
    };
    el.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { el.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [editMode, gl, camera, raycaster, plane, hit, setPosition, setDragging, onCommit]);

  // Disable camera controls imperatively the instant a drag starts (avoids a
  // one-frame fight with OrbitControls on the shared pointerdown event).
  const beginDrag = useCallback((key) => {
    dragKey.current = key;
    setDragging(true);
    if (controlsRef.current) controlsRef.current.enabled = false;
  }, [setDragging]);

  return (
    <>
      <color attach="background" args={['#dfeaf2']} />
      <SkyAndSun clock={clock} />
      <PlanetarySky clock={clock} />
      <DigitalController active={digital} />
      {feat.weather && (!digital || digitalLayer === 'climate') && <WeatherSystem />}

      {feat.ground && <Ground />}
      <Grid position={[0, 0.01, 0]} infiniteGrid cellSize={1} sectionSize={5} fadeDistance={95} fadeStrength={1.6} cellColor="#bcc6b2" sectionColor="#9aa888" />

      {(feat.pipes || (digital && digitalLayer === 'water')) && <PipeNetwork scene={scene} />}
      {digital && digitalLayer === 'comms' && <SignalSpectrum scene={scene} />}
      {digital && digitalLayer === 'ai'         && <AiNeural scene={scene} />}
      {digital && digitalLayer === 'biology'    && <Roots scene={scene} />}
      {digital && digitalLayer === 'prediction' && <PredictionGhosts scene={scene} />}
      {digital && digitalLayer === 'energy' && <EnergyTags scene={scene} />}

      <CinematicDirector controlsRef={controlsRef} scene={scene} cinematic={cinematic} editMode={editMode} />

      {links.map((l) => (
        <LoraLink key={`${l.fromKey}->${l.toKey}`} fromKey={l.fromKey} toKey={l.toKey} color={gwColor[l.gwKey]} />
      ))}

      {nodeIds.map((id) => (
        <NodeMarker
          key={id} deviceId={id} gwColor={gwColor[scene.nodeGw[id]]}
          selected={selectedId === id} editMode={editMode}
          onSelect={onSelect} onBeginDrag={beginDrag}
        />
      ))}

      {gwIds.map((id) => (
        <GatewayObject
          key={id} deviceId={id} color={gwColor[id]} editMode={editMode}
          onSelect={onSelect} onBeginDrag={beginDrag}
          clusterNodeIds={nodeIds.filter((nid) => scene.nodeGw[nid] === id)}
        />
      ))}

      <OrbitControls ref={controlsRef} enableDamping target={[0, 1, 0]} maxPolarAngle={Math.PI / 2.2} minDistance={8} maxDistance={100} />
    </>
  );
}

/* ------------------------------------------------------------- detail panel */
function fmtAge(ts) {
  if (!ts) return '—';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
// minutes → "3d 11h" / "2h 15m" / "45m"
function fmtMin(m) {
  if (m == null || m <= 0) return null;
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = Math.round(m % 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${mm}m`;
  return `${mm}m`;
}

function Metric({ icon, label, value, accent }) {
  return (
    <div className="rounded-xl bg-slate-50/80 border border-slate-100 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
        <span className="text-xs leading-none">{icon}</span>{label}
      </div>
      <div className={`mt-0.5 text-sm font-semibold tabular-nums ${accent || 'text-slate-800'}`}>{value}</div>
    </div>
  );
}

// Tiny inline SVG trend line for the detail panel.
function Sparkline({ data, color, w = 70, h = 22 }) {
  const vals = (data || []).filter((v) => v != null && !Number.isNaN(v));
  if (vals.length < 2) return <div className="h-[22px] flex items-center text-[9px] text-slate-300">—</div>;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (((v == null ? min : v) - min) / span) * (h - 3) - 1.5;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={w} height={h} className="block">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function DetailPanel({ canControl, onValve, onClose }) {
  const sel = useTwinStore((s) => (s.selectedId ? s.byId[s.selectedId] : null));
  const [asking, setAsking] = useState(false);
  const [pct, setPct] = useState(100);
  const [hist, setHist] = useState(null);
  const [cached, setCached] = useState(false);
  const nodeId = sel?._id;
  useEffect(() => {
    if (!nodeId) { setHist(null); setCached(false); return; }
    let cancelled = false;
    const key = `twin_hist_${nodeId}`;
    // show the last saved 24h immediately (survives a lost connection)
    try { const c = localStorage.getItem(key); if (c && !cancelled) { setHist(JSON.parse(c).history || []); setCached(true); } } catch { /* ignore */ }
    api.get(`/nodes/${nodeId}/history`)
      .then((r) => {
        if (cancelled) return;
        const h = r.data?.data?.history || [];
        if (h.length) {
          setHist(h); setCached(false);
          try { localStorage.setItem(key, JSON.stringify({ history: h, ts: Date.now() })); } catch { /* quota */ }
        }
      })
      .catch(() => { /* keep the cached trend */ });
    return () => { cancelled = true; };
  }, [nodeId]);
  if (!sel) return null;
  const status    = sel.status || 'unknown';
  const valveOpen = (sel.valve ?? sel.valve_state) === 'open';
  const valvePct  = sel.valve_pct;
  const pumpOn    = (sel.pump ?? sel.pump_state) === 'on';
  const dot = status === 'online' ? 'bg-emerald-500' : status === 'offline' ? 'bg-rose-500' : 'bg-slate-400';
  const pill = status === 'online'
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
    : status === 'offline' ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-slate-100 text-slate-500 ring-slate-200';
  const v = (x, suffix = '') => (x === null || x === undefined || x === '' ? '—' : `${x}${suffix}`);
  const charging = sel.charging ?? sel.battery_charging;
  const batV = sel.bat_v ?? sel.battery_v;
  const batMa = sel.bat_ma ?? sel.battery_ma;
  const timeTxt = fmtMin(sel.time_min ?? sel.battery_time_min);

  return (
    <div className="absolute bottom-4 right-4 z-10 w-72 rounded-2xl bg-white/85 backdrop-blur-xl shadow-2xl ring-1 ring-black/5 overflow-hidden animate-[fadeIn_.18s_ease-out]">
      {/* header */}
      <div className="px-4 pt-3.5 pb-3 bg-gradient-to-br from-slate-50 to-white border-b border-slate-100">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-slate-800 truncate">{sel.name || sel.device_id}</div>
            <div className="text-[11px] text-slate-400 font-mono truncate">{sel.device_id}</div>
          </div>
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full ring-1 ${pill}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />{status}
          </span>
          {onClose && (
            <button onClick={onClose} className="text-slate-300 hover:text-slate-600 text-lg leading-none -mt-0.5">×</button>
          )}
        </div>
      </div>

      {/* metrics */}
      <div className="p-3 grid grid-cols-2 gap-2">
        <Metric icon="💧" label="Soil" value={v(sel.soil ?? sel.soil_moisture_pct, '%')} accent="text-sky-700" />
        <Metric icon="🌡" label="Temp" value={v(sel.temp, ' °C')} accent="text-orange-600" />
        <Metric icon="💦" label="Humidity" value={v(sel.hum, '%')} accent="text-cyan-700" />
        <Metric icon={charging ? '⚡' : '🔋'} label={charging ? 'Charging' : 'Battery'}
          value={`${v(sel.bat ?? sel.battery_pct, '%')}${batV != null ? ` · ${batV}V` : ''}`}
          accent={charging ? 'text-amber-600' : 'text-emerald-700'} />
      </div>

      {/* battery detail: current + time remaining */}
      {(batMa != null || timeTxt) && (
        <div className="px-3 -mt-1 pb-2 flex items-center justify-between text-[11px]">
          <span className="text-slate-400 tabular-nums">{batMa != null ? `${Math.round(batMa)} mA` : ''}</span>
          {timeTxt && (
            <span className={`font-semibold ${charging ? 'text-amber-600' : 'text-emerald-600'}`}>
              {charging ? `⚡ ${timeTxt} to full` : `🔋 ${timeTxt} left`}
            </span>
          )}
        </div>
      )}

      {/* 24h trend sparklines */}
      {hist && hist.length > 1 && (
        <div className="px-3 pb-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1 flex items-center gap-1.5">
            Last 24h trend {cached && <span className="text-[8px] text-amber-500 normal-case tracking-normal">· cached (offline)</span>}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[['Soil', 'avg_soil_moisture', '#0ea5e9'], ['Temp', 'avg_temperature', '#f97316'], ['Batt', 'avg_battery', '#10b981']].map(([label, key, col]) => (
              <div key={key} className="rounded-xl bg-slate-50/80 border border-slate-100 px-2 py-1.5">
                <div className="text-[9px] text-slate-400 mb-0.5">{label}</div>
                <Sparkline data={hist.map((b) => b[key])} color={col} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* status row */}
      <div className="px-3 pb-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-slate-50/80 border border-slate-100 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Valve</div>
          <div className={`text-xs font-semibold ${valveOpen ? 'text-sky-600' : 'text-slate-500'}`}>
            {valveOpen ? (valvePct != null ? `Open ${valvePct}%` : 'Open') : 'Closed'}
          </div>
        </div>
        <div className="rounded-xl bg-slate-50/80 border border-slate-100 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Pump</div>
          <div className={`text-xs font-semibold ${pumpOn ? 'text-sky-600' : 'text-slate-500'}`}>{pumpOn ? 'On' : 'Off'}</div>
        </div>
        <div className="rounded-xl bg-slate-50/80 border border-slate-100 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Seen</div>
          <div className="text-xs font-semibold text-slate-600">{fmtAge(sel.lastUpdate)}</div>
        </div>
      </div>

      {canControl && (
        <div className="px-3 pb-3">
          {valveOpen ? (
            <button
              onClick={() => onValve(false)}
              className="w-full inline-flex items-center justify-center gap-2 text-sm font-semibold px-3 py-2.5 rounded-xl text-white shadow-lg transition-all active:scale-[.98] bg-gradient-to-r from-slate-600 to-slate-700 hover:from-slate-700 hover:to-slate-800 shadow-slate-500/20"
            >
              ■ Close valve · stop pump
            </button>
          ) : asking ? (
            <div className="rounded-xl bg-sky-50/70 border border-sky-100 p-3 animate-[fadeIn_.15s_ease-out]">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">Open how much?</span>
                <button onClick={() => setAsking(false)} className="text-slate-300 hover:text-slate-600 text-base leading-none">×</button>
              </div>
              <div className="text-center mb-1">
                <span className="text-3xl font-bold tabular-nums text-sky-700">{pct}</span>
                <span className="text-sm font-semibold text-sky-500">%</span>
                <span className="ml-2 text-[11px] text-slate-400">≈ {Math.round((pct / 100) * 90)}° servo</span>
              </div>
              <input
                type="range" min={0} max={100} step={5} value={pct}
                onChange={(e) => setPct(parseInt(e.target.value, 10))}
                className="w-full accent-sky-500 mb-2"
              />
              <div className="flex gap-1.5 mb-2.5">
                {[25, 50, 75, 100].map((p) => (
                  <button
                    key={p}
                    onClick={() => setPct(p)}
                    className={`flex-1 text-[11px] font-semibold py-1 rounded-lg border transition-colors ${
                      pct === p ? 'bg-sky-500 text-white border-sky-500' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                  >
                    {p}%
                  </button>
                ))}
              </div>
              <button
                onClick={() => { onValve(true, pct); setAsking(false); }}
                disabled={pct === 0}
                className="w-full inline-flex items-center justify-center gap-2 text-sm font-semibold px-3 py-2.5 rounded-xl text-white shadow-lg transition-all active:scale-[.98] bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-600 hover:to-cyan-600 shadow-sky-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                💧 Open valve to {pct}% · start pump
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setPct(100); setAsking(true); }}
              className="w-full inline-flex items-center justify-center gap-2 text-sm font-semibold px-3 py-2.5 rounded-xl text-white shadow-lg transition-all active:scale-[.98] bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-600 hover:to-cyan-600 shadow-sky-500/30"
            >
              💧 Open valve · start pump
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- customize panel */
// Edit-mode panel for the selected node's field plot. Live-updates the store
// (instant 3D preview) and debounces a save to the server.
function CustomizePanel({ deviceId, onSave, onClose }) {
  const dev  = useTwinStore((s) => s.byId[deviceId]) || {};
  const cust = useTwinStore((s) => s.custom[deviceId]) || {};
  const setCustom = useTwinStore((s) => s.setCustom);
  const tRef = useRef();

  const size  = clampSize(cust.size ?? DEFAULT_SIZE);
  const rot   = cust.rot ?? 0;
  const color = cust.color || null;
  const label = cust.label || '';
  const crop  = cust.crop || 'grass';
  const [cropSearch, setCropSearch] = useState('');

  const queueSave = useCallback(() => {
    clearTimeout(tRef.current);
    tRef.current = setTimeout(() => onSave(deviceId), 500);
  }, [deviceId, onSave]);
  const update = useCallback((patch) => { setCustom(deviceId, patch); queueSave(); }, [deviceId, setCustom, queueSave]);
  useEffect(() => () => clearTimeout(tRef.current), []);

  return (
    <div className="absolute bottom-4 right-4 z-10 w-72 rounded-2xl bg-white/85 backdrop-blur-xl shadow-2xl ring-1 ring-black/5 max-h-[82vh] overflow-auto animate-[fadeIn_.18s_ease-out]">
      <div className="px-4 pt-3.5 pb-3 flex items-center justify-between bg-gradient-to-br from-amber-50 to-white border-b border-amber-100 sticky top-0">
        <div className="min-w-0">
          <div className="font-semibold text-slate-800 leading-tight flex items-center gap-1.5">✎ Customize plot</div>
          <div className="text-[11px] text-slate-400 font-mono truncate">{dev.name || deviceId}</div>
        </div>
        <button onClick={onClose} className="text-slate-300 hover:text-slate-600 text-lg leading-none px-1">×</button>
      </div>

      <div className="p-4">
        {/* crop / label */}
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Crop / label</label>
        <input
          type="text" value={label} placeholder={dev.name || 'e.g. Tomatoes'}
          onChange={(e) => update({ label: e.target.value })}
          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm mb-4 bg-white/70 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-300"
        />

        {/* crop type — searchable visual picker (pick the plant by its picture) */}
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Crop type</label>
          <span className="text-[10px] text-emerald-600 font-semibold">{CROP_TYPES[crop]?.icon} {CROP_TYPES[crop]?.name}</span>
        </div>
        <input
          value={cropSearch} onChange={(e) => setCropSearch(e.target.value)} placeholder="🔍 Search crops (e.g. tomato, trees, grains)…"
          className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs mb-2 bg-white/70 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-300"
        />
        <div className="grid grid-cols-4 gap-1.5 mb-4 max-h-44 overflow-auto pr-0.5">
          {CROP_KEYS.filter((k) => {
            const c = CROP_TYPES[k], q = cropSearch.trim().toLowerCase();
            return !q || c.name.toLowerCase().includes(q) || c.cat.toLowerCase().includes(q);
          }).map((k) => {
            const c = CROP_TYPES[k];
            return (
              <button key={k} onClick={() => update({ crop: k })} title={`${c.name} · ${c.cat}`}
                className={`flex flex-col items-center gap-0.5 py-1.5 rounded-lg border transition-all ${
                  crop === k ? 'bg-emerald-500 text-white border-emerald-500 shadow' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-emerald-200'}`}>
                <span className="text-lg leading-none">{c.icon}</span>
                <span className="text-[8px] font-semibold leading-tight text-center truncate w-full px-0.5">{c.name}</span>
              </button>
            );
          })}
        </div>

        {/* size */}
        <div className="flex justify-between items-center mb-1">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Size</label>
          <span className="text-[11px] font-medium text-slate-500 tabular-nums">{size.toFixed(1)} m</span>
        </div>
        <input
          type="range" min={MIN_SIZE} max={MAX_SIZE} step={0.5} value={size}
          onChange={(e) => update({ size: clampSize(parseFloat(e.target.value)) })}
          className="w-full mb-4 accent-amber-500"
        />

        {/* rotation */}
        <div className="flex justify-between items-center mb-1">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Rotation</label>
          <span className="text-[11px] font-medium text-slate-500 tabular-nums">{Math.round(rot)}°</span>
        </div>
        <input
          type="range" min={0} max={90} step={1} value={rot}
          onChange={(e) => update({ rot: parseInt(e.target.value, 10) })}
          className="w-full mb-4 accent-amber-500"
        />

        {/* colour */}
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Colour</label>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => update({ color: null })}
            className={`px-2.5 h-7 rounded-lg text-[11px] font-medium border transition-colors ${!color ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            title="Use status colour (green/red)"
          >
            Auto
          </button>
          {PLOT_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => update({ color: c })}
              className={`w-7 h-7 rounded-lg border-2 transition-transform ${color === c ? 'border-slate-800 scale-110 shadow-md' : 'border-white shadow hover:scale-105'}`}
              style={{ background: c }}
              title={c}
            />
          ))}
        </div>
        <p className="text-[10px] text-slate-400 mt-3 leading-relaxed">“Auto” colours the plot by status — green online, red offline. Changes save automatically.</p>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- HUD: alert panel */
function AlertsPanel({ alerts, onJump }) {
  if (!alerts.length) return null;
  return (
    <div className="absolute top-16 right-3 z-10 w-60 rounded-2xl bg-white/85 backdrop-blur-xl shadow-2xl ring-1 ring-black/5 overflow-hidden max-h-[44vh] flex flex-col">
      <div className="px-3.5 py-2.5 flex items-center gap-2 bg-gradient-to-r from-rose-50 to-white border-b border-rose-100">
        <span className="text-rose-500">⚠</span>
        <span className="font-semibold text-rose-700 text-sm">Alerts</span>
        <span className="ml-auto text-[11px] font-bold bg-rose-500 text-white px-1.5 py-0.5 rounded-full">{alerts.length}</span>
      </div>
      <ul className="p-2 space-y-1.5 overflow-auto">
        {alerts.map((a) => (
          <li key={a.key}>
            <button onClick={() => onJump(a.key)} className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-rose-50 border border-transparent hover:border-rose-100 transition-colors group">
              <div className="font-medium text-slate-800 truncate flex items-center gap-1">
                <span className="text-rose-400 group-hover:translate-x-0.5 transition-transform">→</span>{a.name}
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
                {a.alerts.map((x) => (
                  <span key={x.kind} className="px-1.5 py-0.5 rounded-md bg-rose-100 text-rose-700 text-[10px] font-medium">{x.label}</span>
                ))}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ----------------------------------------------------- HUD: live weather */
const WX_ICON = {
  clear: '☀️', partly_cloudy: '⛅', cloudy: '☁️', fog: '🌫️',
  drizzle: '🌦️', rain: '🌧️', snow: '❄️', thunderstorm: '⛈️',
};
const WX_LABEL = {
  clear: 'Clear', partly_cloudy: 'Partly cloudy', cloudy: 'Cloudy', fog: 'Fog',
  drizzle: 'Drizzle', rain: 'Rain', snow: 'Snow', thunderstorm: 'Storm',
};
function fmtClock(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
// Bottom-centre live-conditions bar, fed by the farm's real GPS weather.
function WeatherPanel() {
  const w = useTwinStore((s) => s.weather);
  if (!w) return null;
  const n = (v, suffix = '') => (v == null ? '—' : `${Math.round(v)}${suffix}`);
  const Item = ({ icon, value, label }) => (
    <div className="flex flex-col items-center px-2.5">
      <span className="text-[13px] leading-none">{icon}</span>
      <span className="text-xs font-semibold text-white tabular-nums mt-0.5">{value}</span>
      <span className="text-[9px] uppercase tracking-wide text-white/55">{label}</span>
    </div>
  );
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-stretch divide-x divide-white/10 rounded-2xl bg-slate-900/80 backdrop-blur-xl shadow-xl ring-1 ring-white/10 px-1.5 py-2">
      <div className="flex flex-col items-center px-3 justify-center">
        <span className="text-lg leading-none">{WX_ICON[w.condition] || '🌡️'}</span>
        <span className="text-[10px] font-semibold text-white/90 mt-0.5 whitespace-nowrap">{WX_LABEL[w.condition] || w.condition}</span>
      </div>
      <Item icon="🌡️" value={n(w.temperature, '°')} label="Temp" />
      <Item icon="💧" value={n(w.humidity, '%')} label="Humid" />
      <Item icon="🌧️" value={`${(w.rain ?? w.precipitation ?? 0).toFixed(1)}`} label="Rain mm" />
      <Item icon="☁️" value={n(w.cloudCover, '%')} label="Cloud" />
      <Item icon="🌬️" value={n(w.windSpeed)} label="km/h" />
      <Item icon="🌅" value={fmtClock(w.sunrise)} label="Rise" />
      <Item icon="🌇" value={fmtClock(w.sunset)} label="Set" />
    </div>
  );
}

/* -------------------------------------------------- HUD: weather demo */
// Preset numeric profiles per condition (cloud %, rain mm/h, wind km/h).
const WX_PRESETS = {
  clear:         { cloudCover: 5,   rain: 0,   windSpeed: 6 },
  partly_cloudy: { cloudCover: 45,  rain: 0,   windSpeed: 10 },
  cloudy:        { cloudCover: 90,  rain: 0,   windSpeed: 12 },
  fog:           { cloudCover: 80,  rain: 0,   windSpeed: 3 },
  rain:          { cloudCover: 95,  rain: 3.0, windSpeed: 18 },
  thunderstorm:  { cloudCover: 100, rain: 5.0, windSpeed: 30 },
  snow:          { cloudCover: 95,  rain: 2.0, windSpeed: 14 },
};
// Build a weather object shaped exactly like the live Open-Meteo payload so the
// 3D WeatherSystem treats a demo override identically to real data.
function buildDemoWeather(condition, over = {}) {
  const p = WX_PRESETS[condition] || WX_PRESETS.clear;
  const sr = new Date(); sr.setHours(6, 30, 0, 0);
  const ss = new Date(); ss.setHours(19, 30, 0, 0);
  return {
    condition, cloudCover: p.cloudCover, rain: p.rain, precipitation: p.rain,
    windSpeed: p.windSpeed, windDirection: 90, temperature: 22, apparentTemperature: 22,
    humidity: 60, isDay: true, sunrise: sr.toISOString(), sunset: ss.toISOString(),
    timezone: 'demo', weatherCode: -1, demo: true, fetchedAt: Date.now(), ...over,
  };
}

// Toggleable panel: force any condition + fine-tune cloud/rain/wind, or release
// back to live data. Locks the store so live updates don't overwrite the demo.
function WeatherDemoPanel({ farmId, onClose }) {
  const weather   = useTwinStore((s) => s.weather);
  const locked    = useTwinStore((s) => s.weatherLocked);
  const setWeather = useTwinStore((s) => s.setWeather);
  const setLocked  = useTwinStore((s) => s.setWeatherLocked);
  const cur = locked && weather ? weather : null;

  const setCond = (c) => { setLocked(true); setWeather(buildDemoWeather(c)); };
  const patch   = (p) => {
    const base = cur || buildDemoWeather('clear');
    setLocked(true);
    setWeather({ ...base, ...p, precipitation: p.rain ?? base.rain, demo: true, fetchedAt: Date.now() });
  };
  const goLive = () => {
    setLocked(false);
    if (farmId) api.get(`/weather/${farmId}/live`)
      .then((r) => { const w = r.data?.data?.weather; if (w) setWeather(w); }).catch(() => {});
  };

  const conds = ['clear', 'partly_cloudy', 'cloudy', 'fog', 'rain', 'thunderstorm', 'snow'];
  const Slider = ({ label, val, min, max, step, unit, on }) => (
    <div className="mb-2">
      <div className="flex justify-between text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">
        <span>{label}</span><span className="tabular-nums text-slate-500">{val}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={val}
        onChange={(e) => on(parseFloat(e.target.value))} className="w-full accent-sky-500" />
    </div>
  );

  return (
    <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 w-72 rounded-2xl bg-white/90 backdrop-blur-xl shadow-2xl ring-1 ring-black/5 p-3.5 animate-[fadeIn_.18s_ease-out]">
      <div className="flex items-center justify-between mb-2.5">
        <span className="font-semibold text-slate-700 text-sm flex items-center gap-1.5">🌦️ Weather demo</span>
        <div className="flex items-center gap-1.5">
          <button onClick={goLive}
            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ${
              locked ? 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50' : 'bg-emerald-50 text-emerald-700 ring-emerald-200'}`}>
            {locked ? '📡 Go live' : '● Live'}
          </button>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-600 text-lg leading-none">×</button>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1.5 mb-3">
        {conds.map((c) => (
          <button key={c} onClick={() => setCond(c)}
            className={`flex flex-col items-center gap-0.5 py-1.5 rounded-lg border text-[9px] font-medium transition-colors ${
              cur?.condition === c ? 'bg-sky-500 text-white border-sky-500' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
            <span className="text-sm leading-none">{WX_ICON[c]}</span>{WX_LABEL[c]}
          </button>
        ))}
      </div>
      <Slider label="Cloud cover" val={Math.round(cur?.cloudCover ?? 15)} min={0} max={100} step={5} unit="%" on={(v) => patch({ cloudCover: v })} />
      <Slider label="Rain" val={+(cur?.rain ?? 0).toFixed(1)} min={0} max={8} step={0.5} unit=" mm" on={(v) => patch({ rain: v })} />
      <Slider label="Wind" val={Math.round(cur?.windSpeed ?? 6)} min={0} max={45} step={1} unit=" km/h" on={(v) => patch({ windSpeed: v })} />
      <p className="text-[10px] text-slate-400 leading-relaxed mt-1">Tip: pick <b>Storm</b> for lightning, then open the day/night <b>Demo ▶</b> to watch it at night.</p>
    </div>
  );
}

/* ------------------------------------------------ HUD: LoRa health */
// Packet loss from gaps in the telemetry seq window (distinct seqs / span).
function packetLoss(seqs) {
  if (!seqs || seqs.length < 4) return null;
  const min = seqs[0], max = seqs[seqs.length - 1];
  const span = max - min + 1;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - new Set(seqs).size / span));
}
// Telecom-style readout: LoRa band + per-node link quality (RSSI bar), live
// packet-loss %, and weak-link warnings (low RSSI or high loss).
function SpectrumPanel({ nodeIds }) {
  const byId = useTwinStore((s) => s.byId);
  const linkStats = useTwinStore((s) => s.linkStats);
  return (
    <div className="absolute top-1/2 right-3 -translate-y-1/2 z-10 w-72 rounded-2xl bg-slate-900/85 backdrop-blur-xl shadow-2xl ring-1 ring-cyan-400/30 p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-cyan-300 font-bold text-xs tracking-[0.15em]">📡 LoRa HEALTH</span>
        <span className="text-[10px] font-mono text-cyan-400/70">433.0 MHz</span>
      </div>
      <div className="flex items-center justify-between text-[9px] font-mono text-slate-400 mb-2">
        <span>SF7 · BW125 · CR4/5</span><span>RSSI · LOSS</span>
      </div>
      <div className="space-y-1.5 max-h-56 overflow-auto">
        {nodeIds.length === 0 && <div className="text-[10px] text-slate-500">No nodes on this farm</div>}
        {nodeIds.map((id) => {
          const d = byId[id] || {};
          const rssi = d.rssi ?? d.lora_rssi;
          const q = rssiQuality(rssi);
          const loss = packetLoss(linkStats[id]?.seqs);
          const weak = (rssi != null && rssi < -95) || (loss != null && loss > 0.15);
          return (
            <div key={id} className="flex items-center gap-2">
              <span className="text-[10px] text-slate-300 truncate w-16" title={d.name || id}>{d.name || id}</span>
              {weak && <span className="text-[9px]" title="weak link">⚠️</span>}
              <div className="flex-1 h-1.5 rounded-full bg-slate-700/60 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.round(q * 100)}%`, background: q > 0.5 ? '#22e0ff' : '#ff2d7e' }} />
              </div>
              <span className="text-[9px] font-mono text-slate-400 w-10 text-right">{rssi == null ? '—' : `${Math.round(rssi)}`}</span>
              <span className={`text-[9px] font-mono w-9 text-right ${loss != null && loss > 0.15 ? 'text-rose-400' : 'text-slate-400'}`}>
                {loss == null ? '—' : `${Math.round(loss * 100)}%`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------ HUD: energy grid */
// Full INA219 readout per node + farm power total — shown in the Energy layer.
function EnergyHUD({ nodeIds }) {
  const byId = useTwinStore((s) => s.byId);
  let totalW = 0;
  const rows = nodeIds.map((id) => {
    const d = byId[id] || {};
    const v = d.bat_v ?? d.battery_v;
    const ma = d.bat_ma ?? d.battery_ma;
    const pct = d.bat ?? d.battery_pct;
    const charging = d.charging ?? d.battery_charging;
    const w = (v != null && ma != null) ? Math.abs(v * ma) / 1000 : null;   // V·A → W
    if (w != null) totalW += w;
    return { id, name: d.name || id, v, ma, pct, charging, w, time: fmtMin(d.time_min) };
  });
  return (
    <div className="absolute top-1/2 right-3 -translate-y-1/2 z-10 w-72 rounded-2xl bg-slate-900/85 backdrop-blur-xl shadow-2xl ring-1 ring-amber-400/30 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-amber-300 font-bold text-xs tracking-[0.15em]">⚡ ENERGY GRID</span>
        <span className="text-[10px] font-mono text-amber-400/80">{totalW.toFixed(2)} W total</span>
      </div>
      <div className="space-y-2 max-h-72 overflow-auto">
        {rows.length === 0 && <div className="text-[10px] text-slate-500">No nodes on this farm</div>}
        {rows.map((r) => (
          <div key={r.id} className="rounded-lg bg-white/5 p-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-slate-200 font-semibold truncate">{r.name}</span>
              <span className={`text-[9px] font-bold ${r.charging ? 'text-emerald-400' : 'text-amber-300'}`}>{r.charging ? '⚡ charging' : '🔋 discharging'}</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-700/60 overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, r.pct ?? 0))}%`, background: r.charging ? '#34d399' : (r.pct > 30 ? '#fbbf24' : '#f87171') }} />
            </div>
            <div className="flex justify-between mt-1 text-[9px] font-mono text-slate-400">
              <span>{r.pct != null ? `${Math.round(r.pct)}%` : '—'}</span>
              <span>{r.v != null ? `${r.v.toFixed(2)}V` : '—'}</span>
              <span>{r.ma != null ? `${Math.round(r.ma)}mA` : '—'}</span>
              <span className="text-amber-300/80">{r.w != null ? `${r.w.toFixed(2)}W` : '—'}</span>
            </div>
            {r.time && (
              <div className={`text-[9px] mt-0.5 text-right ${r.charging ? 'text-emerald-400' : 'text-amber-300'}`}>
                {r.charging ? `⚡ ${r.time} to full` : `🔋 ${r.time} left`}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="text-[9px] text-slate-500 mt-2">Live INA219 · voltage · current · power · charge state</div>
    </div>
  );
}

/* ------------------------------------------------ HUD: feature settings */
const FEATURE_LIST = [
  ['weather', '🌦️ Weather & sky'],
  ['ground',  '🟫 Ground'],
  ['crops',   '🌱 Crops'],
  ['pipes',   '🚰 Pipes & flow'],
  ['energy',  '⚡ Solar / energy'],
  ['labels',  '🏷️ Labels'],
];
// Gear panel: show/hide every 3D feature on the page.
function SettingsPanel({ onClose }) {
  const features      = useTwinStore((s) => s.features);
  const setFeature    = useTwinStore((s) => s.setFeature);
  const toggleFeature = useTwinStore((s) => s.toggleFeature);
  const allOn = (v) => FEATURE_LIST.forEach(([k]) => setFeature(k, v));
  return (
    <div className="absolute top-16 right-3 z-20 w-60 rounded-2xl bg-white/90 backdrop-blur-xl shadow-2xl ring-1 ring-black/5 p-3.5 animate-[fadeIn_.18s_ease-out]">
      <div className="flex items-center justify-between mb-2.5">
        <span className="font-semibold text-slate-700 text-sm flex items-center gap-1.5">⚙ Scene features</span>
        <button onClick={onClose} className="text-slate-300 hover:text-slate-600 text-lg leading-none">×</button>
      </div>
      <div className="space-y-0.5">
        {FEATURE_LIST.map(([k, label]) => (
          <button key={k} onClick={() => toggleFeature(k)}
            className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-slate-50 transition-colors">
            <span className="text-[12px] text-slate-700">{label}</span>
            <span className={`relative inline-block w-9 h-5 rounded-full transition-colors ${features[k] ? 'bg-emerald-500' : 'bg-slate-300'}`}>
              <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all" style={{ left: features[k] ? 18 : 2 }} />
            </span>
          </button>
        ))}
      </div>
      <div className="flex gap-1.5 mt-2.5">
        <button onClick={() => allOn(true)}  className="flex-1 text-[11px] font-semibold py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200">Show all</button>
        <button onClick={() => allOn(false)} className="flex-1 text-[11px] font-semibold py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200">Hide all</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------ HUD: planetary pulse */
// Live moon phase + season + sunrise — the farm's planetary synchronisation.
function PlanetaryPanel() {
  const weather = useTwinStore((s) => s.weather);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 60000); return () => clearInterval(t); }, []);
  const now = new Date();
  const mi = moonIndex(moonPhase(now.getTime()));
  const seas = SEASONS[seasonOf(now, weather?.lat)];
  const rise = weather?.sunrise ? new Date(weather.sunrise).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
  return (
    <div className="absolute top-3 right-3 z-10 rounded-2xl bg-slate-900/70 backdrop-blur-xl ring-1 ring-white/10 px-3 py-1.5 text-white shadow-xl flex items-center gap-3">
      <div className="flex flex-col items-center" title={`Moon · ${MOON_NAMES[mi]}`}>
        <span className="text-lg leading-none">{MOON_ICONS[mi]}</span>
        <span className="text-[8px] text-white/55 mt-0.5 whitespace-nowrap">{MOON_NAMES[mi]}</span>
      </div>
      <div className="w-px h-7 bg-white/15" />
      <div className="flex flex-col items-center" title="Season">
        <span className="text-base leading-none">{seas.icon}</span>
        <span className="text-[8px] text-white/55 mt-0.5">{seas.name}</span>
      </div>
      <div className="w-px h-7 bg-white/15" />
      <div className="flex flex-col items-center" title="Local sunrise">
        <span className="text-base leading-none">🌅</span>
        <span className="text-[8px] text-white/55 mt-0.5 tabular-nums">{rise}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------ HUD: OTA manager */
// Lists every device + its firmware version and lets you push an OTA build.
// Uses the existing endpoints: GET /ota/firmware, POST /ota/deploy(-gateway)/:id.
function OtaPanel({ scene, meta, onClose, toast }) {
  const byId = useTwinStore((s) => s.byId);
  const [fw, setFw] = useState([]);
  const [pick, setPick] = useState({});
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    api.get('/ota/firmware').then((r) => setFw(r.data?.data?.firmware || [])).catch(() => setFw([]));
  }, []);
  const devices = [
    ...scene.gwIds.map((id) => ({ id, type: 'gateway' })),
    ...scene.nodeIds.map((id) => ({ id, type: 'node' })),
  ];
  const deploy = (dev) => {
    const m = meta[dev.id];
    const firmware_id = pick[dev.id] || fw[0]?._id;
    if (!m || !firmware_id) return;
    setBusy(dev.id);
    const url = dev.type === 'gateway' ? `/ota/deploy-gateway/${m._id}` : `/ota/deploy/${m._id}`;
    api.post(url, { firmware_id })
      .then(() => toast(`OTA sent to ${byId[dev.id]?.name || dev.id}`))
      .catch((e) => toast(`OTA failed: ${e.response?.data?.message || e.message}`, 3000))
      .finally(() => setBusy(null));
  };
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[30rem] max-w-[92%] max-h-[82vh] overflow-auto rounded-2xl bg-white shadow-2xl ring-1 ring-black/10 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <span className="font-semibold text-slate-800 flex items-center gap-1.5">⬆ OTA firmware manager</span>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        {fw.length === 0 && <div className="text-xs text-amber-600 bg-amber-50 rounded-lg px-2.5 py-1.5 mb-2">No firmware uploaded yet — upload one via <span className="font-mono">POST /api/ota/upload</span>.</div>}
        <div className="space-y-1.5">
          {devices.map((dev) => {
            const d = byId[dev.id] || {};
            const cur = d.firmware_version || d.fw || '—';
            return (
              <div key={dev.id} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/70 px-2.5 py-2">
                <span className="text-base">{dev.type === 'gateway' ? '📡' : '🌱'}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-slate-700 truncate">{d.name || dev.id}</div>
                  <div className="text-[10px] text-slate-400">running fw {cur}</div>
                </div>
                <select value={pick[dev.id] || ''} onChange={(e) => setPick((s) => ({ ...s, [dev.id]: e.target.value }))}
                  className="text-[11px] border border-slate-200 rounded-lg px-1.5 py-1 bg-white max-w-[7rem]">
                  <option value="">latest…</option>
                  {fw.map((f) => <option key={f._id} value={f._id}>v{f.version}</option>)}
                </select>
                <button disabled={busy === dev.id || fw.length === 0} onClick={() => deploy(dev)}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-40">
                  {busy === dev.id ? '…' : 'Deploy'}
                </button>
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-slate-400 mt-3 leading-relaxed">Deploy publishes the OTA command over MQTT; the gateway flashes itself via WiFi, or streams the binary to a node over LoRa.</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------ HUD: schedules */
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Weekly irrigation schedule editor: per-zone/node watering windows + a 7-day
// preview. Backed by /farms/:id/schedules; a backend cron fires them.
function SchedulePanel({ farmId, scene, meta, onClose, toast }) {
  const byId = useTwinStore((s) => s.byId);
  const blank = { name: 'Watering', target: 'farm', node: '', zone: '', days: [1, 3, 5], startTime: '06:00', durationMin: 15, valvePercent: 100 };
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(blank);
  const nodes = scene.nodeIds.map((id) => ({ id, _id: meta[id]?._id, name: byId[id]?.name || id }));
  const zones = Array.from(new Set(scene.nodeIds.map((id) => byId[id]?.zone).filter(Boolean)));

  const load = () => {
    setLoading(true);
    api.get(`/farms/${farmId}/schedules`).then((r) => setList(r.data?.data?.schedules || [])).catch(() => setList([])).finally(() => setLoading(false));
  };
  useEffect(load, [farmId]);

  const toggleDay = (d) => setForm((f) => ({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d].sort() }));
  const add = () => {
    if (!form.days.length) { toast('Pick at least one day', 2500); return; }
    if (form.target === 'node' && !form.node) { toast('Pick a node', 2500); return; }
    if (form.target === 'zone' && !form.zone) { toast('Pick a zone', 2500); return; }
    const body = {
      name: form.name, days: form.days, startTime: form.startTime,
      durationMin: +form.durationMin, valvePercent: +form.valvePercent,
      node: form.target === 'node' ? form.node : null,
      zone: form.target === 'zone' ? form.zone : null,
    };
    api.post(`/farms/${farmId}/schedules`, body)
      .then(() => { setForm(blank); load(); toast('Schedule added'); })
      .catch((e) => toast(`Failed: ${e.response?.data?.message || e.message}`, 3000));
  };
  const del = (id) => api.delete(`/schedules/${id}`).then(load).catch(() => {});
  const toggle = (s) => api.patch(`/schedules/${s._id}`, { enabled: !s.enabled }).then(load).catch(() => {});
  const tLabel = (s) => (s.node ? `Node ${s.node.device_id || s.node.name || ''}` : s.zone ? `Zone ${s.zone}` : 'Whole farm');

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[34rem] max-w-[95%] max-h-[88vh] overflow-auto rounded-2xl bg-white shadow-2xl ring-1 ring-black/10 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <span className="font-semibold text-slate-800 flex items-center gap-1.5">🗓 Irrigation schedules</span>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        {/* weekly preview */}
        <div className="grid grid-cols-7 gap-1 mb-3">
          {DOW.map((d, i) => (
            <div key={i} className="rounded-lg bg-slate-50 border border-slate-100 p-1 min-h-[46px]">
              <div className="text-[9px] text-center text-slate-400 mb-0.5">{d}</div>
              {list.filter((s) => s.enabled && s.days.includes(i)).map((s) => (
                <div key={s._id} className="text-[8px] rounded bg-sky-500/15 text-sky-700 px-1 py-0.5 mb-0.5 truncate text-center" title={`${s.name} · ${s.startTime} · ${s.durationMin}m`}>{s.startTime}</div>
              ))}
            </div>
          ))}
        </div>

        {/* existing schedules */}
        {loading ? <div className="text-xs text-slate-400 mb-2">Loading…</div>
          : list.length === 0 ? <div className="text-xs text-slate-400 mb-2">No schedules yet — add one below.</div>
            : (
              <div className="space-y-1.5 mb-3">
                {list.map((s) => (
                  <div key={s._id} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/70 px-2.5 py-2">
                    <button onClick={() => toggle(s)} className={`relative w-9 h-5 rounded-full shrink-0 ${s.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                      <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow" style={{ left: s.enabled ? 18 : 2 }} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-slate-700 truncate">{s.name} · {s.startTime} · {s.durationMin}m · {s.valvePercent}%</div>
                      <div className="text-[10px] text-slate-400 truncate">{tLabel(s)} · {s.days.map((d) => DOW[d]).join(' ')}</div>
                    </div>
                    <button onClick={() => del(s._id)} title="Delete" className="text-slate-300 hover:text-rose-500 text-sm shrink-0">🗑</button>
                  </div>
                ))}
              </div>
            )}

        {/* add form */}
        <div className="rounded-xl border border-slate-200 p-3 space-y-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">New schedule</div>
          <div className="flex gap-2">
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Name"
              className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
            <select value={form.target} onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))}
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white">
              <option value="farm">Whole farm</option>
              <option value="zone" disabled={zones.length === 0}>Zone</option>
              <option value="node">Node</option>
            </select>
            {form.target === 'zone' && (
              <select value={form.zone} onChange={(e) => setForm((f) => ({ ...f, zone: e.target.value }))} className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white">
                <option value="">zone…</option>{zones.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            )}
            {form.target === 'node' && (
              <select value={form.node} onChange={(e) => setForm((f) => ({ ...f, node: e.target.value }))} className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white max-w-[8rem]">
                <option value="">node…</option>{nodes.map((n) => <option key={n.id} value={n._id}>{n.name}</option>)}
              </select>
            )}
          </div>
          <div className="flex gap-1">
            {DOW.map((d, i) => (
              <button key={i} onClick={() => toggleDay(i)}
                className={`flex-1 text-[11px] font-semibold py-1 rounded-lg border ${form.days.includes(i) ? 'bg-sky-500 text-white border-sky-500' : 'bg-white text-slate-500 border-slate-200'}`}>{d[0]}</button>
            ))}
          </div>
          <div className="flex gap-2 items-center">
            <label className="text-[11px] text-slate-500">Start <input type="time" value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} className="border border-slate-200 rounded-lg px-2 py-1 text-sm ml-1" /></label>
            <label className="text-[11px] text-slate-500">Min <input type="number" min={1} max={1440} value={form.durationMin} onChange={(e) => setForm((f) => ({ ...f, durationMin: e.target.value }))} className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-sm ml-1" /></label>
            <label className="text-[11px] text-slate-500">% <input type="number" min={1} max={100} value={form.valvePercent} onChange={(e) => setForm((f) => ({ ...f, valvePercent: e.target.value }))} className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-sm ml-1" /></label>
          </div>
          <button onClick={add} className="w-full text-sm font-semibold py-2 rounded-xl bg-sky-500 text-white hover:bg-sky-600">+ Add schedule</button>
        </div>
        <p className="text-[10px] text-slate-400 mt-2">A backend cron opens the valve(s) at the start time on the chosen days and closes them after the duration (server local time).</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------ HUD: digital layer rail */
// Vertical "dimension selector" shown in the digital world — pick which hidden
// system to reveal. (DIGI_LAYERS is defined later but resolved at render time.)
function DigitalLayerBar() {
  const digital  = useTwinStore((s) => s.digital);
  const layer    = useTwinStore((s) => s.digitalLayer);
  const setLayer = useTwinStore((s) => s.setDigitalLayer);
  if (!digital) return null;
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex gap-1.5 rounded-2xl bg-slate-950/80 backdrop-blur-xl ring-1 ring-cyan-400/25 px-2 py-1.5 shadow-2xl">
      {DIGI_LAYERS.map(([k, icon, label, color]) => (
        <button key={k} onClick={() => setLayer(k)} title={label}
          className="flex flex-col items-center w-14 px-1 py-1.5 rounded-lg transition-all"
          style={{ background: layer === k ? color + '22' : 'transparent', boxShadow: layer === k ? `0 0 14px ${color}55` : 'none' }}>
          <span className="text-lg leading-none" style={{ filter: layer === k ? 'none' : 'grayscale(0.55) opacity(0.7)' }}>{icon}</span>
          <span className="text-[9px] font-semibold mt-0.5" style={{ color: layer === k ? color : '#94a3b8' }}>{label}</span>
        </button>
      ))}
    </div>
  );
}

// Cinematic dimensional-shift flash + title when crossing between worlds.
function DigitalOverlay({ digital }) {
  const [show, setShow] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }   // skip initial mount
    setShow(true);
    const t = setTimeout(() => setShow(false), 1400);
    return () => clearTimeout(t);
  }, [digital]);
  if (!show) return null;
  return (
    <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center" style={{ animation: 'digiFlash 1.4s ease-out forwards' }}>
      <div className="text-center" style={{ animation: 'digiText 1.4s ease-out forwards' }}>
        <div className="text-2xl font-bold tracking-[0.3em]" style={{ color: digital ? '#5fd0ff' : '#86efac' }}>
          {digital ? 'ENTERING DIGITAL LAYER' : 'RETURNING TO REALITY'}
        </div>
        <div className="text-xs tracking-[0.25em] mt-1.5 text-white/55">
          {digital ? 'the invisible becomes visible' : 'the physical farm'}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------- HUD: time control */
// Bottom-left clock: shows the simulated time and lets you scrub the hour,
// jump back to live local time, or fast-forward a full day (demo).
function TimeControl({ clock, setClock }) {
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const h  = hourFromClock(clock, Date.now());
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  const icon = h < 5 || h >= 20 ? '🌙' : h < 7 ? '🌅' : h >= 18 ? '🌇' : '☀️';
  const btn = (active) => `flex-1 text-[11px] font-semibold py-1 rounded-lg border transition-colors ${
    active ? 'bg-sky-500 text-white border-sky-500' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`;
  return (
    <div className="absolute bottom-4 left-3 z-10 w-56 rounded-2xl bg-white/85 backdrop-blur-xl shadow-xl ring-1 ring-black/5 px-3.5 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-slate-700 tabular-nums flex items-center gap-1.5">
          {icon} {String(hh).padStart(2, '0')}:{String(mm).padStart(2, '0')}
        </span>
        <button
          onClick={() => setClock((c) => ({ ...c, enabled: !c.enabled }))}
          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 transition-colors ${
            clock.enabled ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-slate-100 text-slate-400 ring-slate-200'}`}
        >
          {clock.enabled ? 'Day/Night' : 'Off'}
        </button>
      </div>
      <input
        type="range" min={0} max={24} step={0.25} value={h}
        onChange={(e) => setClock((c) => ({ ...c, enabled: true, mode: 'manual', manualHour: parseFloat(e.target.value) }))}
        disabled={!clock.enabled}
        className="w-full accent-amber-500 mb-2 disabled:opacity-40"
      />
      <div className="flex gap-1.5">
        <button onClick={() => setClock((c) => ({ ...c, enabled: true, mode: 'live' }))} className={btn(clock.enabled && clock.mode === 'live')}>Live</button>
        <button
          onClick={() => setClock((c) => ({ ...c, enabled: true, mode: 'demo', hour0: hourFromClock(c, Date.now()), startMs: Date.now(), speed: 600 }))}
          className={btn(clock.enabled && clock.mode === 'demo')}
        >
          Demo ▶
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------ header: tool button */
// Compact square icon button used across the header toolbars. One accent colour
// when active; otherwise a quiet ghost button — keeps the header monochrome.
const TB_ON = {
  emerald: 'bg-emerald-500 text-white ring-emerald-400/60',
  sky:     'bg-sky-500 text-white ring-sky-400/60',
  cyan:    'bg-cyan-400 text-cyan-950 ring-cyan-300/60',
  fuchsia: 'bg-fuchsia-500 text-white ring-fuchsia-400/60',
  amber:   'bg-amber-400 text-amber-950 ring-amber-300/60',
};
function ToolButton({ active, onClick, title, accent = 'emerald', children }) {
  return (
    <button onClick={onClick} title={title}
      className={`grid place-items-center h-9 w-9 rounded-lg text-[15px] transition-all active:scale-90 ring-1 ${
        active ? `${TB_ON[accent]} shadow` : 'text-slate-300 ring-transparent hover:bg-white/10 hover:text-white'}`}>
      {children}
    </button>
  );
}

/* ------------------------------------------------ header: alerts bell */
// Notification bell with a live count; opens a dropdown of active alerts.
// Clicking an alert flies the camera to that device and selects it.
function AlertsBell({ alerts, onJump }) {
  const [open, setOpen] = useState(false);
  const n = alerts.length;
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} title="Alerts"
        className={`relative grid place-items-center h-9 w-9 rounded-lg ring-1 transition-all active:scale-90 ${
          n ? 'text-rose-200 ring-rose-400/40 hover:bg-rose-500/20' : 'text-slate-300 ring-transparent hover:bg-white/10'}`}>
        <span className="text-[15px]">🔔</span>
        {n > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 grid place-items-center rounded-full bg-rose-500 text-white text-[9px] font-bold ring-2 ring-slate-900">{n}</span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-64 z-30 rounded-xl bg-white shadow-2xl ring-1 ring-black/10 overflow-hidden animate-[fadeIn_.15s_ease-out]">
            <div className="px-3 py-2 bg-rose-50 border-b border-rose-100 flex items-center justify-between">
              <span className="text-xs font-semibold text-rose-700">⚠ Alerts</span>
              <span className="text-[10px] text-rose-500">{n} active</span>
            </div>
            {n === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-slate-400">All systems healthy ✓</div>
            ) : (
              <ul className="max-h-72 overflow-auto py-1">
                {alerts.map((a) => (
                  <li key={a.key}>
                    <button onClick={() => { onJump(a.key); setOpen(false); }}
                      className="w-full text-left px-3 py-2 hover:bg-rose-50 transition-colors group">
                      <div className="font-medium text-slate-800 text-sm truncate flex items-center gap-1">
                        <span className="text-rose-400 group-hover:translate-x-0.5 transition-transform">→</span>{a.name}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1 pl-4">
                        {a.alerts.map((x) => (
                          <span key={x.kind} className="px-1.5 py-0.5 rounded-md bg-rose-100 text-rose-700 text-[10px] font-medium">{x.label}</span>
                        ))}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- page */
export default function FarmTwinPage() {
  const [farms, setFarms]     = useState([]);
  const [farmId, setFarmId]   = useState(null);
  const [scene, setScene]     = useState({ nodeIds: [], gwIds: [], links: [], gwColor: {}, nodeGw: {} });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [saveMsg, setSaveMsg] = useState(null);
  const [alerts, setAlerts]   = useState([]);
  // Day/night clock: follows real local time by default ('live'); 'manual'
  // freezes at a scrubbed hour; 'demo' fast-forwards a full day (~2.4 min).
  const [clock, setClock]     = useState({ enabled: true, mode: 'live', manualHour: 12, hour0: 12, startMs: 0, speed: 600 });
  const [cinematic, setCinematic] = useState(false);  // auto fly-over / orbit mode
  const [wxDemo, setWxDemo] = useState(false);         // weather demo panel open?
  const [showSettings, setShowSettings] = useState(false);
  const [showOta, setShowOta] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const digital        = useTwinStore((s) => s.digital);
  const setDigital     = useTwinStore((s) => s.setDigital);
  const digitalLayer   = useTwinStore((s) => s.digitalLayer);
  const setDigitalLayer = useTwinStore((s) => s.setDigitalLayer);
  const [isFs, setIsFs] = useState(false);             // fullscreen active?
  const pageRef = useRef(null);
  const features      = useTwinStore((s) => s.features);
  const toggleFeature = useTwinStore((s) => s.toggleFeature);

  // Fullscreen the whole twin (header controls + viewport stay usable).
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else pageRef.current?.requestFullscreen?.();
  }, []);
  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const seed         = useTwinStore((s) => s.seed);
  const setPositions = useTwinStore((s) => s.setPositions);
  const setCustomMap = useTwinStore((s) => s.setCustomMap);
  const setWeather   = useTwinStore((s) => s.setWeather);
  const select       = useTwinStore((s) => s.select);
  const apply        = useTwinStore((s) => s.apply);
  const selectedId   = useTwinStore((s) => s.selectedId);
  const live         = useTwinStore((s) => s.live);
  const editMode     = useTwinStore((s) => s.editMode);
  const setEditMode  = useTwinStore((s) => s.setEditMode);

  const metaRef = useRef({}); // device_id -> { type: 'node'|'gateway', _id }

  useTwinTelemetry(farmId);

  // Seed live weather on farm change (REST), then Socket.IO 'weather:update'
  // (handled in useTwinTelemetry) keeps it fresh every ~15 min.
  useEffect(() => {
    if (!farmId) return;
    if (useTwinStore.getState().weatherLocked) return;   // demo override active — leave it
    let cancelled = false;
    setWeather(null);
    api.get(`/weather/${farmId}/live`)
      .then((r) => { if (!cancelled) { const w = r.data?.data?.weather; if (w) setWeather(w); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [farmId, setWeather]);

  useEffect(() => {
    api.get('/farms')
      .then((r) => {
        const list = r.data?.data?.farms || [];
        setFarms(list);
        if (list.length) setFarmId(list[0]._id);
      })
      .catch((e) => setError(e.response?.data?.message || e.message));
  }, []);

  const loadFarm = useCallback((id) => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([api.get(`/farms/${id}/nodes`), api.get(`/farms/${id}/gateways`)])
      .then(([nRes, gRes]) => {
        if (cancelled) return;
        const nodes = (nRes.data?.data?.nodes || []).map((n) => ({ ...n, device_id: keyOf(n) }));
        const gws   = (gRes.data?.data?.gateways || []).map((g) => ({ ...g, device_id: keyOf(g) }));

        const gwColor = {};
        gws.forEach((g, i) => { gwColor[g.device_id] = GW_PALETTE[i % GW_PALETTE.length]; });

        const nodeGw = {};
        nodes.forEach((n) => { nodeGw[n.device_id] = n.gateway ? (n.gateway.device_id || n.gateway._id) : null; });

        // default cluster layout, then overlay any saved server positions
        const positions = computeClusterLayout(nodes, gws, nodeGw);
        gws.forEach((g)   => { if (g.twin && isNum(g.twin.x) && isNum(g.twin.z)) positions[g.device_id] = [g.twin.x, 0, g.twin.z]; });
        nodes.forEach((n) => { if (n.twin && isNum(n.twin.x) && isNum(n.twin.z)) positions[n.device_id] = [n.twin.x, 0, n.twin.z]; });

        // per-plot customization, restored from each node's saved twin
        const custom = {};
        nodes.forEach((n) => {
          const t = n.twin || {};
          custom[n.device_id] = {
            size:  isNum(t.size) ? clampSize(t.size) : DEFAULT_SIZE,
            rot:   isNum(t.rot)  ? t.rot : 0,
            color: t.color || null,
            label: t.label || '',
            crop:  t.crop || null,
          };
        });

        const meta = {};
        nodes.forEach((n) => { meta[n.device_id] = { type: 'node', _id: n._id }; });
        gws.forEach((g)   => { meta[g.device_id] = { type: 'gateway', _id: g._id }; });
        metaRef.current = meta;

        const links = buildChainLinks(nodes, nodeGw, gwColor);

        seed([...nodes, ...gws]);
        setPositions(positions);
        setCustomMap(custom);
        setScene({ nodeIds: nodes.map((n) => n.device_id), gwIds: gws.map((g) => g.device_id), links, gwColor, nodeGw });
      })
      .catch((e) => { if (!cancelled) setError(e.response?.data?.message || e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [seed, setPositions, setCustomMap]);

  useEffect(() => { if (farmId) return loadFarm(farmId); }, [farmId, loadFarm]);

  const toast = useCallback((msg, ms = 1500) => { setSaveMsg(msg); setTimeout(() => setSaveMsg(null), ms); }, []);

  // Persist one device's full twin (position + plot customization) to the
  // server. findByIdAndUpdate REPLACES the twin subdoc, so we always send the
  // complete object. Gateways only carry x/z.
  const commitTwin = useCallback((key) => {
    const meta = metaRef.current[key];
    if (!meta) return;
    const st = useTwinStore.getState();
    const pos = st.positions[key];
    if (!pos) return;
    let body;
    if (meta.type === 'gateway') {
      body = { twin: { x: +pos[0].toFixed(2), z: +pos[2].toFixed(2) } };
    } else {
      const c = st.custom[key] || {};
      body = { twin: {
        x: +pos[0].toFixed(2),
        z: +pos[2].toFixed(2),
        size: +clampSize(c.size ?? DEFAULT_SIZE).toFixed(2),
        rot: Math.round(c.rot ?? 0),
        color: c.color || null,
        label: c.label || '',
        crop: c.crop || null,
      } };
    }
    const url = meta.type === 'gateway' ? `/farms/${farmId}/gateways/${meta._id}` : `/farms/${farmId}/nodes/${meta._id}`;
    api.put(url, body)
      .then(() => toast('Saved'))
      .catch((e) => toast(`Save failed: ${e.response?.data?.message || e.message}`, 3000));
  }, [farmId, toast]);

  // Open/close the selected node's valve + servo (0–100% → 0–90°).
  // Smart pump logic: opening always starts the pump (firmware is idempotent —
  // it ignores pump_start if already running). Closing ONLY stops the pump when
  // no other node in the farm still has a valve open — this prevents the shared
  // pump from being cut while other sections are still irrigating.
  const setValve = useCallback((open, percent = 100) => {
    const id = selectedId;
    const meta = id ? metaRef.current[id] : null;
    if (!meta || meta.type !== 'node') return;
    const pct = Math.max(0, Math.min(100, Math.round(percent)));
    apply(id, open ? { valve: 'open', valve_pct: pct, pump: 'on' } : { valve: 'closed', valve_pct: 0, pump: 'off' });

    // Send valve command (percent in body → forwarded as MQTT payload to device)
    api.post(`/nodes/${meta._id}/${open ? 'valve/open' : 'valve/close'}`, open ? { percent: pct } : {})
      .catch((e) => toast(`Valve failed: ${e.response?.data?.message || e.message}`, 3000));

    if (open) {
      // Firmware is idempotent: if pump relay is already ON it won't re-trigger
      api.post(`/nodes/${meta._id}/pump/start`)
        .then(() => toast(`Valve opened ${pct}% · pump started`))
        .catch((e) => toast(`Pump failed: ${e.response?.data?.message || e.message}`, 3000));
    } else {
      // Check if any other node still has an open valve before killing the pump
      const byId = useTwinStore.getState().byId;
      const otherNodes = Object.keys(metaRef.current).filter((k) => metaRef.current[k].type === 'node' && k !== id);
      const anyOpen = otherNodes.some((nid) => (byId[nid]?.valve ?? byId[nid]?.valve_state) === 'open');
      if (anyOpen) {
        toast('Valve closed · pump still running (other sections open)', 2500);
      } else {
        api.post(`/nodes/${meta._id}/pump/stop`)
          .then(() => toast('Valve closed · pump stopped'))
          .catch((e) => toast(`Pump failed: ${e.response?.data?.message || e.message}`, 3000));
      }
    }
  }, [selectedId, apply, toast]);

  // Reset this farm's layout + customization back to defaults (and clear server twins).
  const resetLayout = useCallback(() => {
    const { nodeIds, gwIds, nodeGw } = scene;
    const nodes = nodeIds.map((id) => ({ device_id: id, gateway: nodeGw[id] ? { device_id: nodeGw[id] } : null }));
    const gws = gwIds.map((id) => ({ device_id: id }));
    const positions = computeClusterLayout(nodes, gws, nodeGw);
    const custom = {};
    nodeIds.forEach((id) => { custom[id] = { size: DEFAULT_SIZE, rot: 0, color: null, label: '', crop: null }; });
    setPositions(positions);
    setCustomMap(custom);
    [...nodeIds, ...gwIds].forEach((key) => {
      const meta = metaRef.current[key];
      if (!meta) return;
      const url = meta.type === 'gateway' ? `/farms/${farmId}/gateways/${meta._id}` : `/farms/${farmId}/nodes/${meta._id}`;
      api.put(url, { twin: null }).catch(() => {});
    });
    toast('Layout reset');
  }, [scene, farmId, setPositions, setCustomMap, toast]);

  // Recompute the alert list every 4 s from live store state (throttled so
  // telemetry doesn't thrash React).
  useEffect(() => {
    const ids = scene.nodeIds;
    if (!ids.length) { setAlerts([]); return; }
    const scan = () => {
      const byId = useTwinStore.getState().byId;
      const out = [];
      ids.forEach((id) => {
        const d = byId[id];
        const a = computeNodeAlerts(d);
        if (a.length) out.push({ key: id, name: d?.name || id, alerts: a });
      });
      setAlerts(out);
    };
    scan();
    const t = setInterval(scan, 4000);
    return () => clearInterval(t);
  }, [scene.nodeIds]);

  const hasDevices = scene.nodeIds.length || scene.gwIds.length;
  const selMeta = selectedId ? metaRef.current[selectedId] : null;
  const showCustomize = editMode && selMeta?.type === 'node';

  const onlineCount = scene.nodeIds.filter((id) => useTwinStore.getState().byId[id]?.status === 'online').length;

  return (
    <div ref={pageRef} className={`space-y-5 ${isFs ? 'bg-gradient-to-b from-slate-100 to-slate-200 p-4 overflow-auto h-screen' : ''}`}>
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
        @keyframes digiFlash{0%{background:rgba(5,7,18,0.85)}100%{background:rgba(5,7,18,0)}}
        @keyframes digiText{0%{opacity:0;transform:scale(.9)}22%{opacity:1;transform:scale(1)}80%{opacity:1}100%{opacity:0}}`}</style>

      {/* ---------------------------------------------------------- header */}
      <header className="relative overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-white/10 shadow-xl">
        {/* thin accent line */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/70 to-transparent" />
        <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
          {/* identity */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="grid place-items-center h-10 w-10 rounded-xl bg-emerald-500/15 ring-1 ring-emerald-400/30 text-xl shrink-0">🌾</div>
            <div className="min-w-0">
              <h1 className="text-[15px] font-bold text-white tracking-tight leading-none">3D Digital Twin</h1>
              <p className="text-[11px] text-slate-400 mt-1 truncate">Field plots relay in a chain back to their gateway · click any plot to control it</p>
            </div>
          </div>

          {/* farm selector */}
          <div className="relative">
            <select
              value={farmId || ''}
              onChange={(e) => { setFarmId(e.target.value); select(null); setEditMode(false); }}
              className="appearance-none cursor-pointer rounded-lg bg-white/5 hover:bg-white/10 ring-1 ring-white/10 text-white text-sm font-medium pl-3 pr-8 py-2 transition-colors focus:outline-none [&>option]:text-slate-800"
            >
              {farms.length === 0 && <option value="">No farms</option>}
              {farms.map((f) => <option key={f._id} value={f._id}>{f.name}</option>)}
            </select>
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-white/60 text-xs">▾</span>
          </div>

          <div className="flex-1" />

          {/* live status + alerts bell */}
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg ring-1 ${
            live ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30' : 'bg-white/5 text-slate-400 ring-white/10'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
            {live ? 'Live' : 'Offline'}
          </span>
          <AlertsBell alerts={alerts} onJump={(k) => { setCinematic(false); select(k); }} />

          {/* primary action */}
          <button
            onClick={() => setDigital(!digital)}
            className={`text-sm font-semibold px-3 py-2 rounded-lg ring-1 transition-all active:scale-95 ${
              digital ? 'bg-cyan-400 text-cyan-950 ring-cyan-300' : 'bg-white/5 text-white ring-white/15 hover:bg-white/10'}`}
          >
            {digital ? '🌍 Reality' : '🌌 Digital layer'}
          </button>

          {/* scene toolbars (grouped, monochrome with single accent when active) */}
          <div className="flex items-center gap-1 rounded-xl bg-white/5 ring-1 ring-white/10 p-1">
            <ToolButton active={wxDemo} accent="sky" onClick={() => setWxDemo((v) => !v)} title="Weather">🌦️</ToolButton>
            <ToolButton active={digital && digitalLayer === 'comms'} accent="cyan" onClick={() => (digital && digitalLayer === 'comms') ? setDigital(false) : setDigitalLayer('comms')} title="Signal spectrum (Comms layer)">📡</ToolButton>
            <ToolButton active={cinematic} accent="fuchsia" onClick={() => { setCinematic((v) => !v); select(null); if (!cinematic) setEditMode(false); }} title="Cinematic">🎬</ToolButton>
          </div>
          <div className="flex items-center gap-1 rounded-xl bg-white/5 ring-1 ring-white/10 p-1">
            <ToolButton onClick={() => setShowSchedule(true)} title="Irrigation schedules">🗓</ToolButton>
            <ToolButton onClick={() => setShowOta(true)} title="OTA firmware manager">⬆</ToolButton>
            <ToolButton active={showSettings} onClick={() => setShowSettings((v) => !v)} title="Scene features">⚙️</ToolButton>
            <ToolButton onClick={toggleFullscreen} title={isFs ? 'Exit fullscreen' : 'Fullscreen'}>{isFs ? '🡼' : '⛶'}</ToolButton>
          </div>
          <div className="flex items-center gap-1 rounded-xl bg-white/5 ring-1 ring-white/10 p-1">
            <ToolButton active={editMode} accent="amber" onClick={() => { setEditMode(!editMode); select(null); setCinematic(false); }} title={editMode ? 'Done editing' : 'Edit layout'}>✎</ToolButton>
            {editMode && <ToolButton onClick={resetLayout} title="Reset layout">↺</ToolButton>}
          </div>
        </div>

        {/* stats strip */}
        {hasDevices && (
          <div className="px-4 pb-2.5 -mt-0.5 flex flex-wrap gap-2 text-[11px] font-medium">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1 text-slate-300 ring-1 ring-white/10">
              <span className={onlineCount === scene.nodeIds.length ? 'text-emerald-400' : 'text-amber-400'}>●</span>
              {onlineCount}/{scene.nodeIds.length} nodes online
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1 text-slate-300 ring-1 ring-white/10">📡 {scene.gwIds.length} gateway{scene.gwIds.length === 1 ? '' : 's'}</span>
            {editMode && <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400/15 px-2.5 py-1 text-amber-300 ring-1 ring-amber-400/25">✎ Edit mode · drag plots, click to customize</span>}
          </div>
        )}
      </header>

      {/* ------------------------------------------------------ 3D viewport */}
      <div className={`relative ${isFs ? 'h-[88vh]' : 'h-[76vh]'} min-h-[520px] rounded-2xl overflow-hidden ring-1 ring-black/10 shadow-2xl bg-gradient-to-b from-[#e7eff6] to-[#dbe6ef]`}>
        {error && (
          <div className="absolute inset-0 z-30 flex items-center justify-center text-sm text-rose-600 bg-white/70 backdrop-blur">{error}</div>
        )}
        {!error && !hasDevices && !loading && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 text-slate-500">
            <span className="text-4xl">🌱</span>
            <span className="text-sm">No nodes or gateways in this farm yet.</span>
          </div>
        )}
        {loading && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 inline-flex items-center gap-2 text-xs font-medium text-slate-600 bg-white/85 backdrop-blur px-3 py-1.5 rounded-full shadow ring-1 ring-black/5">
            <span className="w-3 h-3 rounded-full border-2 border-slate-300 border-t-emerald-500 animate-spin" /> Loading farm…
          </div>
        )}

        <Canvas
          shadows={{ type: THREE.PCFSoftShadowMap }}
          dpr={[1, 2]}
          gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.06 }}
          camera={{ position: [24, 20, 26], fov: 42, near: 0.5, far: 2000 }}
          onPointerMissed={() => select(null)}
        >
          <Scene scene={scene} editMode={editMode} onSelect={select} onCommit={commitTwin} clock={clock} cinematic={cinematic} />
        </Canvas>

        {/* edit-mode hint */}
        {editMode && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-1.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-semibold px-3.5 py-2 rounded-full shadow-lg shadow-amber-500/30">
            ✎ Drag to move · click a plot to customize · saves automatically
          </div>
        )}
        {/* save toast */}
        {saveMsg && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 bg-slate-900/90 text-white text-xs font-medium px-3.5 py-2 rounded-xl shadow-xl backdrop-blur animate-[fadeIn_.18s_ease-out]">{saveMsg}</div>
        )}

        {!editMode && <PlanetaryPanel />}

        <TimeControl clock={clock} setClock={setClock} />
        {features.weather && <WeatherPanel />}
        {digital && digitalLayer === 'comms' && <SpectrumPanel nodeIds={scene.nodeIds} />}
        {digital && digitalLayer === 'energy' && <EnergyHUD nodeIds={scene.nodeIds} />}
        {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
        {showOta && <OtaPanel scene={scene} meta={metaRef.current} onClose={() => setShowOta(false)} toast={toast} />}
        {showSchedule && farmId && <SchedulePanel farmId={farmId} scene={scene} meta={metaRef.current} onClose={() => setShowSchedule(false)} toast={toast} />}
        <DigitalLayerBar />
        <DigitalOverlay digital={digital} />
        {wxDemo && <WeatherDemoPanel farmId={farmId} onClose={() => setWxDemo(false)} />}

        {showCustomize && <CustomizePanel deviceId={selectedId} onSave={commitTwin} onClose={() => select(null)} />}
        {!editMode && <DetailPanel key={selectedId} canControl={selMeta?.type === 'node'} onValve={setValve} onClose={() => select(null)} />}
      </div>
    </div>
  );
}

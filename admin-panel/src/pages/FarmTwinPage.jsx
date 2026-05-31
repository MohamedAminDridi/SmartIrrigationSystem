import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
// Deep imports instead of the `@react-three/drei` barrel: the barrel transitively
// pulls @mediapipe/tasks-vision + hls.js, which crash Vite's dep optimizer (the
// drei entry chunk fails to write -> 504 "Outdated Optimize Dep"). These
// submodules only need three-stdlib/meshline, so they pre-bundle cleanly.
import { OrbitControls } from '@react-three/drei/core/OrbitControls';
import { Grid } from '@react-three/drei/core/Grid';
import { Line } from '@react-three/drei/core/Line';
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

// square loop (closed) of given half-extent at a given height
const squareLoop = (h, y) => [[-h, y, -h], [h, y, -h], [h, y, h], [-h, y, h], [-h, y, -h]];

const SPRAY = 18;  // droplets per active sprinkler

/* -------------------------------------------------------------- node marker */
// Each node is a big square field plot ("terrain"). Plot colour = status (or a
// custom tint); a status-coloured border always shows online/offline at a
// glance. Furrow stripes give it a tilled-field look. When a valve/pump is live
// it sprays water; when something's wrong a red halo pulses underneath.
function NodeMarker({ deviceId, gwColor, selected, editMode, onSelect, onBeginDrag }) {
  const dev  = useTwinStore((s) => s.byId[deviceId]) || {};
  const pos  = useTwinStore((s) => s.positions[deviceId]) || [0, 0, 0];
  const cust = useTwinStore((s) => s.custom[deviceId]) || {};
  const plotRef  = useRef();
  const discRef  = useRef();
  const ringRef  = useRef();
  const orbRef   = useRef();
  const alertRef = useRef();
  const sprayRef = useRef();
  const pumpRef  = useRef();
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

    if (plotRef.current) {
      plotTarget(target, status, customColor);
      plotRef.current.material.color.lerp(target, Math.min(1, dt * 4));
    }
    if (discRef.current) {
      soilTarget(target, d.soil ?? d.soil_moisture_pct, status);
      discRef.current.material.color.lerp(target, Math.min(1, dt * 4));
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
    // pump impeller spins whenever watering (valve open implies pump running)
    if (pumpRef.current) {
      pumpRef.current.visible = watering;
      if (watering) pumpRef.current.rotation.y += dt * 6;
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
      orbRef.current.material.emissiveIntensity = low ? 0.4 + Math.abs(Math.sin(now * 0.006)) : 0.9;
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

      {/* pump impeller (spins while running) */}
      <group ref={pumpRef} position={[half * 0.55, 0.42, half * 0.55]} visible={false}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.18, 0.05, 8, 20]} />
          <meshStandardMaterial color="#0284c7" />
        </mesh>
        <mesh><boxGeometry args={[0.36, 0.05, 0.06]} /><meshStandardMaterial color="#0ea5e9" /></mesh>
        <mesh><boxGeometry args={[0.06, 0.05, 0.36]} /><meshStandardMaterial color="#0ea5e9" /></mesh>
      </group>

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

      <Html position={[0, 2.1, 0]} center distanceFactor={13} className="pointer-events-none select-none">
        <div className="px-2 py-0.5 rounded-md bg-white/90 shadow text-[11px] leading-tight whitespace-nowrap border border-gray-200">
          <span className="font-semibold text-gray-800">{label || dev.name || deviceId}</span>
          <span className="text-gray-500"> · {dev.soil ?? dev.soil_moisture_pct ?? '—'}%</span>
        </div>
      </Html>
    </group>
  );
}

/* ----------------------------------------------------------- gateway object */
function GatewayObject({ deviceId, color, editMode, onSelect, onBeginDrag }) {
  const dev = useTwinStore((s) => s.byId[deviceId]) || {};
  const pos = useTwinStore((s) => s.positions[deviceId]) || [0, 0, 0];
  const ringRef = useRef();
  const [hovered, setHovered] = useState(false);

  useFrame(() => {
    if (ringRef.current) {
      const online = dev.status === 'online';
      ringRef.current.visible = online;
      if (online) {
        const t = (performance.now() * 0.0009) % 1;
        const s = 0.5 + t * 4.5;
        ringRef.current.scale.set(s, s, s);
        ringRef.current.material.opacity = 0.5 * (1 - t);
      }
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
      {/* coloured pad marking this gateway's cluster */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} receiveShadow>
        <circleGeometry args={[2.4, 56]} />
        <meshStandardMaterial color={color} transparent opacity={hovered ? 0.34 : 0.2} />
      </mesh>

      <mesh position={[0, 0.15, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.6, 0.3, 1.2]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      <mesh position={[0, 0.75, 0]} castShadow>
        <boxGeometry args={[0.7, 0.9, 0.5]} />
        <meshStandardMaterial color={online ? color : '#64748b'} emissive={online ? color : '#000'} emissiveIntensity={online ? 0.4 : 0} />
      </mesh>
      <mesh position={[0, 1.7, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 1.0, 8]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.5} />
      </mesh>
      <mesh position={[0, 2.25, 0]}>
        <sphereGeometry args={[0.08, 12, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1} />
      </mesh>

      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} visible={false}>
        <ringGeometry args={[0.9, 1.05, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>

      <Html position={[0, 2.6, 0]} center distanceFactor={13} className="pointer-events-none select-none">
        <div className="px-2 py-0.5 rounded-md text-white shadow text-[11px] leading-tight whitespace-nowrap" style={{ background: color }}>
          <span className="font-semibold">📡 {dev.name || deviceId}</span>
          <span className="opacity-80"> · {dev.status || 'unknown'}</span>
        </div>
      </Html>
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

/* ---------------------------------------------------- camera focus on click */
// Smoothly flies the camera so the selected device fills the view. Selecting a
// node/gateway sets a goal (orbit target = the device, camera = a pulled-back
// offset from it); useFrame eases both there, then releases control back to the
// user. Re-selecting nothing leaves the camera where it is.
function CameraFocus({ controlsRef }) {
  const { camera } = useThree();
  const selectedId = useTwinStore((s) => s.selectedId);
  const goal = useRef(null);

  useEffect(() => {
    if (!selectedId || useTwinStore.getState().editMode) return;
    const p = useTwinStore.getState().positions[selectedId];
    if (!p) return;
    const target = new THREE.Vector3(p[0], 1, p[2]);
    // keep the camera's current viewing angle, just pull it in close to target
    const dir = camera.position.clone().sub(controlsRef.current?.target || target);
    if (dir.lengthSq() < 0.001) dir.set(7, 7, 9);
    dir.normalize().multiplyScalar(11);
    goal.current = { target, pos: target.clone().add(dir) };
  }, [selectedId, camera]);

  useFrame((_, dt) => {
    const c = controlsRef.current;
    if (!goal.current || !c) return;
    const k = Math.min(1, dt * 4);
    camera.position.lerp(goal.current.pos, k);
    c.target.lerp(goal.current.target, k);
    c.update();
    if (camera.position.distanceTo(goal.current.pos) < 0.08) goal.current = null;
  });
  return null;
}

/* ----------------------------------------------------------------- 3D scene */
function Scene({ scene, editMode, onSelect, onCommit }) {
  const { nodeIds, gwIds, links, gwColor } = scene;
  const selectedId  = useTwinStore((s) => s.selectedId);
  const setPosition = useTwinStore((s) => s.setPosition);
  const setDragging = useTwinStore((s) => s.setDragging);

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
      <fog attach="fog" args={['#dfeaf2', 70, 145]} />
      <hemisphereLight intensity={0.75} color="#eaf2ff" groundColor="#b8c6a8" />
      <ambientLight intensity={0.3} />
      <directionalLight
        position={[24, 30, 14]} intensity={1.25} castShadow
        shadow-mapSize-width={2048} shadow-mapSize-height={2048}
        shadow-bias={-0.0004}
        shadow-camera-left={-50} shadow-camera-right={50} shadow-camera-top={50} shadow-camera-bottom={-50}
      />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[GROUND, GROUND]} />
        <meshStandardMaterial color="#cdd8be" roughness={1} />
      </mesh>
      <Grid position={[0, 0.01, 0]} infiniteGrid cellSize={1} sectionSize={5} fadeDistance={95} fadeStrength={1.6} cellColor="#bcc6b2" sectionColor="#9aa888" />

      <CameraFocus controlsRef={controlsRef} />

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
        <GatewayObject key={id} deviceId={id} color={gwColor[id]} editMode={editMode} onSelect={onSelect} onBeginDrag={beginDrag} />
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

function DetailPanel({ canControl, onValve, onClose }) {
  const sel = useTwinStore((s) => (s.selectedId ? s.byId[s.selectedId] : null));
  if (!sel) return null;
  const status    = sel.status || 'unknown';
  const valveOpen = (sel.valve ?? sel.valve_state) === 'open';
  const pumpOn    = (sel.pump ?? sel.pump_state) === 'on';
  const dot = status === 'online' ? 'bg-emerald-500' : status === 'offline' ? 'bg-rose-500' : 'bg-slate-400';
  const pill = status === 'online'
    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
    : status === 'offline' ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-slate-100 text-slate-500 ring-slate-200';
  const v = (x, suffix = '') => (x === null || x === undefined || x === '' ? '—' : `${x}${suffix}`);

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
        <Metric icon="🔋" label="Battery" value={v(sel.bat ?? sel.battery_pct, '%')} accent="text-emerald-700" />
      </div>

      {/* status row */}
      <div className="px-3 pb-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-slate-50/80 border border-slate-100 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Valve</div>
          <div className={`text-xs font-semibold ${valveOpen ? 'text-sky-600' : 'text-slate-500'}`}>{valveOpen ? 'Open' : 'Closed'}</div>
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
          <button
            onClick={() => onValve(!valveOpen)}
            className={`w-full inline-flex items-center justify-center gap-2 text-sm font-semibold px-3 py-2.5 rounded-xl text-white shadow-lg transition-all active:scale-[.98] ${
              valveOpen
                ? 'bg-gradient-to-r from-slate-600 to-slate-700 hover:from-slate-700 hover:to-slate-800 shadow-slate-500/20'
                : 'bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-600 hover:to-cyan-600 shadow-sky-500/30'}`}
          >
            {valveOpen ? '■ Close valve · stop pump' : '💧 Open valve · start pump'}
          </button>
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
    <div className="absolute top-3 right-3 z-10 w-60 rounded-2xl bg-white/85 backdrop-blur-xl shadow-2xl ring-1 ring-black/5 overflow-hidden max-h-[44vh] flex flex-col">
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

/* -------------------------------------------------------------------- page */
export default function FarmTwinPage() {
  const [farms, setFarms]     = useState([]);
  const [farmId, setFarmId]   = useState(null);
  const [scene, setScene]     = useState({ nodeIds: [], gwIds: [], links: [], gwColor: {}, nodeGw: {} });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [saveMsg, setSaveMsg] = useState(null);
  const [alerts, setAlerts]   = useState([]);

  const seed         = useTwinStore((s) => s.seed);
  const setPositions = useTwinStore((s) => s.setPositions);
  const setCustomMap = useTwinStore((s) => s.setCustomMap);
  const select       = useTwinStore((s) => s.select);
  const apply        = useTwinStore((s) => s.apply);
  const selectedId   = useTwinStore((s) => s.selectedId);
  const live         = useTwinStore((s) => s.live);
  const editMode     = useTwinStore((s) => s.editMode);
  const setEditMode  = useTwinStore((s) => s.setEditMode);

  const metaRef = useRef({}); // device_id -> { type: 'node'|'gateway', _id }

  useTwinTelemetry(farmId);

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
      } };
    }
    const url = meta.type === 'gateway' ? `/farms/${farmId}/gateways/${meta._id}` : `/farms/${farmId}/nodes/${meta._id}`;
    api.put(url, body)
      .then(() => toast('Saved'))
      .catch((e) => toast(`Save failed: ${e.response?.data?.message || e.message}`, 3000));
  }, [farmId, toast]);

  // Open/close the selected node's valve. Opening a valve auto-starts the pump
  // (and closing stops it). We patch the store optimistically so the 3D plot
  // reacts instantly, then fire both commands; the device's MQTT status echo
  // reconciles the real state later.
  const setValve = useCallback((open) => {
    const id = selectedId;
    const meta = id ? metaRef.current[id] : null;
    if (!meta || meta.type !== 'node') return;
    apply(id, open ? { valve: 'open', pump: 'on' } : { valve: 'closed', pump: 'off' });
    api.post(`/nodes/${meta._id}/${open ? 'valve/open' : 'valve/close'}`)
      .catch((e) => toast(`Valve failed: ${e.response?.data?.message || e.message}`, 3000));
    api.post(`/nodes/${meta._id}/${open ? 'pump/start' : 'pump/stop'}`)
      .then(() => toast(open ? 'Valve opened · pump started' : 'Valve closed · pump stopped'))
      .catch((e) => toast(`Pump failed: ${e.response?.data?.message || e.message}`, 3000));
  }, [selectedId, apply, toast]);

  // Reset this farm's layout + customization back to defaults (and clear server twins).
  const resetLayout = useCallback(() => {
    const { nodeIds, gwIds, nodeGw } = scene;
    const nodes = nodeIds.map((id) => ({ device_id: id, gateway: nodeGw[id] ? { device_id: nodeGw[id] } : null }));
    const gws = gwIds.map((id) => ({ device_id: id }));
    const positions = computeClusterLayout(nodes, gws, nodeGw);
    const custom = {};
    nodeIds.forEach((id) => { custom[id] = { size: DEFAULT_SIZE, rot: 0, color: null, label: '' }; });
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
    <div className="space-y-5">
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}`}</style>

      {/* ---------------------------------------------------------- header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-700 px-5 py-4 shadow-lg">
        <div className="absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -left-10 -bottom-12 h-40 w-40 rounded-full bg-emerald-300/20 blur-2xl" />
        <div className="relative flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="grid place-items-center h-11 w-11 rounded-xl bg-white/15 backdrop-blur ring-1 ring-white/25 text-2xl shadow-inner">🌾</div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">3D Digital Twin</h1>
              <p className="text-sm text-emerald-50/90">Field plots relay in a chain back to their gateway. Click any plot to zoom in &amp; control it.</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <select
                value={farmId || ''}
                onChange={(e) => { setFarmId(e.target.value); select(null); setEditMode(false); }}
                className="appearance-none cursor-pointer rounded-xl bg-white/15 hover:bg-white/25 backdrop-blur ring-1 ring-white/25 text-white text-sm font-medium pl-3 pr-8 py-2 transition-colors focus:outline-none [&>option]:text-slate-800"
              >
                {farms.length === 0 && <option value="">No farms</option>}
                {farms.map((f) => <option key={f._id} value={f._id}>{f.name}</option>)}
              </select>
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-white/80 text-xs">▾</span>
            </div>
            <button
              onClick={() => { setEditMode(!editMode); select(null); }}
              className={`text-sm font-semibold px-3.5 py-2 rounded-xl ring-1 transition-all active:scale-95 ${
                editMode ? 'bg-amber-400 text-amber-950 ring-amber-300 shadow-lg shadow-amber-900/20' : 'bg-white/15 hover:bg-white/25 text-white ring-white/25 backdrop-blur'}`}
            >
              {editMode ? '✓ Done editing' : '✎ Edit layout'}
            </button>
            {editMode && (
              <button onClick={resetLayout} className="text-sm font-semibold px-3.5 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white ring-1 ring-white/25 backdrop-blur transition-all active:scale-95">
                ↺ Reset
              </button>
            )}
            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl ring-1 backdrop-blur ${
              live ? 'bg-emerald-400/20 text-white ring-emerald-200/40' : 'bg-white/10 text-white/70 ring-white/20'}`}>
              <span className={`w-2 h-2 rounded-full ${live ? 'bg-emerald-300 animate-pulse shadow-[0_0_8px] shadow-emerald-300' : 'bg-white/50'}`} />
              {live ? 'Live' : 'Offline'}
            </span>
          </div>
        </div>

        {/* mini stats strip */}
        {hasDevices && (
          <div className="relative mt-3.5 flex flex-wrap gap-2 text-[11px] font-medium">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/12 backdrop-blur px-2.5 py-1 text-white ring-1 ring-white/15">
              <span className="text-emerald-200">●</span> {onlineCount}/{scene.nodeIds.length} nodes online
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/12 backdrop-blur px-2.5 py-1 text-white ring-1 ring-white/15">
              📡 {scene.gwIds.length} gateway{scene.gwIds.length === 1 ? '' : 's'}
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded-lg backdrop-blur px-2.5 py-1 ring-1 ${alerts.length ? 'bg-rose-400/25 text-white ring-rose-200/40' : 'bg-white/12 text-white ring-white/15'}`}>
              ⚠ {alerts.length} alert{alerts.length === 1 ? '' : 's'}
            </span>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------ 3D viewport */}
      <div className="relative h-[76vh] min-h-[520px] rounded-2xl overflow-hidden ring-1 ring-black/10 shadow-2xl bg-gradient-to-b from-[#e7eff6] to-[#dbe6ef]">
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

        <Canvas shadows dpr={[1, 2]} camera={{ position: [24, 20, 26], fov: 42 }} onPointerMissed={() => select(null)}>
          <Scene scene={scene} editMode={editMode} onSelect={select} onCommit={commitTwin} />
        </Canvas>

        {/* legend */}
        <div className="absolute top-3 left-3 z-10 rounded-2xl bg-white/85 backdrop-blur-xl shadow-xl ring-1 ring-black/5 px-3.5 py-3 text-[11px] space-y-1.5">
          <div className="font-semibold text-slate-700 mb-1.5 text-[10px] uppercase tracking-wider">Legend</div>
          <div className="flex items-center gap-2 text-slate-600"><span className="w-3 h-3 rounded" style={{ background: '#22c55e' }} /> Online plot</div>
          <div className="flex items-center gap-2 text-slate-600"><span className="w-3 h-3 rounded" style={{ background: '#ef4444' }} /> Offline plot</div>
          <div className="flex items-center gap-2 text-slate-600"><span className="w-3 h-3 rounded-full" style={{ background: '#38bdf8' }} /> Watering</div>
          <div className="flex items-center gap-2 text-slate-600"><span className="w-3 h-3 rounded-full ring-2 ring-rose-500" /> Alert</div>
          <div className="pt-1.5 mt-1 border-t border-slate-200/70 text-slate-400">Dashed = relay chain · posts = gateway</div>
        </div>

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

        {!editMode && <AlertsPanel alerts={alerts} onJump={select} />}

        {showCustomize && <CustomizePanel deviceId={selectedId} onSave={commitTwin} onClose={() => select(null)} />}
        {!editMode && <DetailPanel canControl={selMeta?.type === 'node'} onValve={setValve} onClose={() => select(null)} />}
      </div>
    </div>
  );
}

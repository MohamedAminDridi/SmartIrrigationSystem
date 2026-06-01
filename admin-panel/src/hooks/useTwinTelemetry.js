import { useMemo } from 'react';
import { useSocket } from './useSocket';
import { useTwinStore } from '../store/twinStore';

// Subscribes to the same realtime events the dashboard uses and funnels them
// into the twin store keyed by device_id. Reuses the shared useSocket hook
// (auth, room join/leave, reconnection) so there's a single socket convention.
export function useTwinTelemetry(farmId) {
  const apply = useTwinStore((s) => s.apply);

  const handlers = useMemo(() => ({
    'sensor:data': (d) => apply(d.deviceId, {
      soil:   d.soil_moisture_pct,
      temp:   d.temperature_c,
      hum:    d.humidity_pct,
      bat:    d.battery_pct,
      rssi:   d.rssi,
      status: 'online',
      // Telemetry handler now co-emits valve/pump when present in the packet
      ...(d.valve_state != null || d.valve != null
        ? { valve: d.valve_state ?? d.valve, valve_pct: d.valve_pct ?? null }
        : {}),
      ...(d.pump_state != null || d.pump != null
        ? { pump: d.pump_state ?? d.pump }
        : {}),
    }),
    'node:status': (d) => apply(d.device_id ?? d.deviceId, {
      status: d.status,
      valve:  d.valve ?? d.valve_state,
      pump:   d.pump  ?? d.pump_state,
      ...(d.valve_pct != null ? { valve_pct: d.valve_pct } : {}),
      ...(d.fw ? { firmware_version: d.fw } : {}),
    }),
    'gateway:status': (d) => apply(d.device_id, {
      status:   d.status,
      rssi:     d.rssi,
      uptime_s: d.uptime_s,
      ...(d.fw ? { firmware_version: d.fw } : {}),
    }),
    connect:    () => useTwinStore.getState().setLive(true),
    disconnect: () => useTwinStore.getState().setLive(false),
  }), [apply]);

  return useSocket(farmId, handlers);
}

/**
 * API client — typed functions for every backend endpoint.
 * All requests go through the Vite proxy (/api -> localhost:8000).
 */

const BASE = '/api/v1';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = sessionStorage.getItem('access_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}${path}`, {
    headers,
    ...options,
  });
  if (!res.ok) {
    if (res.status === 401) {
      // Token expired or invalid — clear and redirect to login
      sessionStorage.removeItem('access_token');
      window.location.reload();
    }
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `API error: ${res.status}`);
  }
  return res.json();
}

// --- Types ---

export interface System {
  id: string;
  group_id: string;
  name: string;
  description: string | null;
  system_type: 'fixed' | 'transport';
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  sensor_count: number;
  gateway_count: number;
  active_alert_count: number;
}

export interface SystemSummary {
  system_id: string;
  system_name: string;
  system_type: 'fixed' | 'transport';
  sensor_count: number;
  gateway_count: number;
  active_alerts: number;
  sensors_reporting: number;
  worst_temperature: number | null;
  worst_sensor_name: string | null;
  last_reading_at: string | null;
}

export interface Device {
  id: string;
  system_id: string;
  dev_eui: string;
  device_type: 'gateway' | 'sensor';
  manufacturer: string | null;
  model: string | null;
  name: string;
  description: string | null;
  firmware_version: string | null;
  last_seen_at: string | null;
  battery_level: number | null;
  signal_rssi: number | null;
  signal_snr: number | null;
  is_active: boolean;
  created_at: string;
  latest_temperature: number | null;
  latest_humidity: number | null;
}

export interface Reading {
  time: string;
  device_id: string;
  temperature: number | null;
  humidity: number | null;
  battery_voltage: number | null;
  latitude: number | null;
  longitude: number | null;
  rssi: number | null;
  snr: number | null;
}

export interface ReadingAggregate {
  bucket: string;
  device_id: string;
  avg_temperature: number | null;
  min_temperature: number | null;
  max_temperature: number | null;
  avg_humidity: number | null;
  min_humidity: number | null;
  max_humidity: number | null;
  reading_count: number;
}

export interface AlertEvent {
  id: string;
  alert_rule_id: string;
  device_id: string;
  triggered_at: string;
  resolved_at: string | null;
  trigger_value: number | null;
  peak_value: number | null;
  notified_channels: string[] | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  acknowledge_note: string | null;
  rule_name: string | null;
  device_name: string | null;
  system_name: string | null;
}

export interface AlertRule {
  id: string;
  system_id: string;
  device_id: string | null;
  name: string;
  description: string | null;
  rule_type: 'threshold' | 'duration' | 'rate_of_change' | 'connectivity' | 'battery';
  metric: 'temperature' | 'humidity' | 'battery_voltage';
  operator: 'gt' | 'gte' | 'lt' | 'lte';
  threshold_value: number;
  duration_seconds: number;
  notify_channels: string[];
  escalation_minutes: number | null;
  is_active: boolean;
  created_at: string;
}

export interface AlertRuleCreate {
  system_id: string;
  device_id?: string | null;
  name: string;
  description?: string | null;
  rule_type: AlertRule['rule_type'];
  metric: AlertRule['metric'];
  operator: AlertRule['operator'];
  threshold_value: number;
  duration_seconds?: number;
  silence_seconds?: number | null;
  notify_channels?: string[];
  escalation_minutes?: number | null;
}

export interface AlertRuleUpdate {
  name?: string;
  description?: string | null;
  threshold_value?: number;
  duration_seconds?: number;
  notify_channels?: string[];
  escalation_minutes?: number | null;
  is_active?: boolean;
}

// --- API Functions ---

export const api = {
  // Systems
  getSystems: () => request<System[]>('/systems'),
  getSystemSummary: () => request<SystemSummary[]>('/systems/summary'),
  getSystem: (id: string) => request<System>(`/systems/${id}`),

  // Devices
  getDevices: (params?: { system_id?: string; device_type?: string }) => {
    const qs = new URLSearchParams();
    if (params?.system_id) qs.set('system_id', params.system_id);
    if (params?.device_type) qs.set('device_type', params.device_type);
    const query = qs.toString();
    return request<Device[]>(`/devices${query ? `?${query}` : ''}`);
  },
  getDevice: (id: string) => request<Device>(`/devices/${id}`),

  // Readings
  getDeviceReadings: (deviceId: string, params?: { start?: string; end?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.start) qs.set('start', params.start);
    if (params?.end) qs.set('end', params.end);
    if (params?.limit) qs.set('limit', String(params.limit));
    const query = qs.toString();
    return request<Reading[]>(`/readings/device/${deviceId}${query ? `?${query}` : ''}`);
  },
  getDeviceHourly: (deviceId: string, params?: { start?: string; end?: string }) => {
    const qs = new URLSearchParams();
    if (params?.start) qs.set('start', params.start);
    if (params?.end) qs.set('end', params.end);
    const query = qs.toString();
    return request<ReadingAggregate[]>(`/readings/device/${deviceId}/hourly${query ? `?${query}` : ''}`);
  },
  getSystemLatest: (systemId: string) => request<Reading[]>(`/readings/system/${systemId}/latest`),

  // Alerts
  getAlertRules: (systemId?: string) => {
    const qs = systemId ? `?system_id=${systemId}` : '';
    return request<AlertRule[]>(`/alerts/rules${qs}`);
  },
  createAlertRule: (data: AlertRuleCreate) =>
    request<AlertRule>('/alerts/rules', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateAlertRule: (id: string, data: AlertRuleUpdate) =>
    request<AlertRule>(`/alerts/rules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteAlertRule: (id: string) =>
    request<void>(`/alerts/rules/${id}`, { method: 'DELETE' }),
  getAlertEvents: (params?: { system_id?: string; active_only?: boolean; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.system_id) qs.set('system_id', params.system_id);
    if (params?.active_only) qs.set('active_only', 'true');
    if (params?.limit) qs.set('limit', String(params.limit));
    const query = qs.toString();
    return request<AlertEvent[]>(`/alerts/events${query ? `?${query}` : ''}`);
  },
  acknowledgeAlert: (eventId: string, note?: string) =>
    request(`/alerts/events/${eventId}/acknowledge`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),
};

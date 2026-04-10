import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Battery, Radio, Wifi, WifiOff, Thermometer, Droplets } from 'lucide-react';
import { subHours, subDays, startOfDay, endOfDay, format } from 'date-fns';
import { api } from '../api/client';
import { TemperatureChart } from '../components/system/TemperatureChart';
import { formatTemp, formatHumidity, formatBattery, formatTimeAgo, formatTimestamp } from '../utils/format';

// ── Time range config ────────────────────────────────────────────────────────

type PresetKey = '1h' | '6h' | '24h' | '7d' | '30d' | 'custom';

interface Preset {
  label: string;
  hours?: number;
  days?: number;
  useAggregate: boolean;
  xAxisFormat: string;
}

const PRESETS: Record<Exclude<PresetKey, 'custom'>, Preset> = {
  '1h':  { label: '1h',  hours: 1,    useAggregate: false, xAxisFormat: 'HH:mm'      },
  '6h':  { label: '6h',  hours: 6,    useAggregate: false, xAxisFormat: 'HH:mm'      },
  '24h': { label: '24h', hours: 24,   useAggregate: false, xAxisFormat: 'HH:mm'      },
  '7d':  { label: '7d',  days: 7,     useAggregate: true,  xAxisFormat: 'MMM d HH:00' },
  '30d': { label: '30d', days: 30,    useAggregate: true,  xAxisFormat: 'MMM d'       },
};

function computeRange(preset: PresetKey, customStart: string, customEnd: string, useAggForCustom: boolean) {
  const now = new Date();
  if (preset === 'custom') {
    const start = customStart ? new Date(customStart) : subDays(now, 1);
    const end   = customEnd   ? new Date(customEnd)   : now;
    return { start, end, useAggregate: useAggForCustom, xAxisFormat: 'MMM d HH:mm' };
  }
  const p = PRESETS[preset];
  const start = p.hours ? subHours(now, p.hours) : subDays(now, p.days!);
  return { start, end: now, useAggregate: p.useAggregate, xAxisFormat: p.xAxisFormat };
}

// ── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="metric-label mb-1">{label}</div>
      <div className="text-xl font-mono font-semibold text-white">{value}</div>
      {sub && <div className="text-xs text-cold-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function SensorDetailPage() {
  const { systemId, deviceId } = useParams<{ systemId: string; deviceId: string }>();

  const [preset, setPreset]           = useState<PresetKey>('24h');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd]     = useState('');
  const [useAggForCustom, setUseAggForCustom] = useState(false);
  const [showThresholds, setShowThresholds]   = useState(false);

  const range = useMemo(
    () => computeRange(preset, customStart, customEnd, useAggForCustom),
    [preset, customStart, customEnd, useAggForCustom],
  );

  const startIso = range.start.toISOString();
  const endIso   = range.end.toISOString();

  // Device metadata
  const { data: device, isLoading: deviceLoading } = useQuery({
    queryKey: ['device', deviceId],
    queryFn: () => api.getDevice(deviceId!),
    enabled: !!deviceId,
  });

  // System (for breadcrumb)
  const { data: system } = useQuery({
    queryKey: ['system', systemId],
    queryFn: () => api.getSystem(systemId!),
    enabled: !!systemId,
  });

  // Alert rules for thresholds
  const { data: alertRules } = useQuery({
    queryKey: ['alertRules', systemId],
    queryFn: () => api.getAlertRules(systemId),
    enabled: !!systemId,
  });

  // Raw readings (short windows)
  const { data: rawReadings, isFetching: rawFetching } = useQuery({
    queryKey: ['readings', deviceId, startIso, endIso],
    queryFn: () => api.getDeviceReadings(deviceId!, { start: startIso, end: endIso, limit: 2000 }),
    enabled: !!deviceId && !range.useAggregate,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  // Hourly aggregates (long windows)
  const { data: aggReadings, isFetching: aggFetching } = useQuery({
    queryKey: ['readingsHourly', deviceId, startIso, endIso],
    queryFn: () => api.getDeviceHourly(deviceId!, { start: startIso, end: endIso }),
    enabled: !!deviceId && range.useAggregate,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const isFetching = rawFetching || aggFetching;

  // Compute thresholds from alert rules for this sensor
  const thresholds = useMemo(() => {
    if (!alertRules || !deviceId) return {};
    function resolve(operators: string[], pick: (vals: number[]) => number) {
      const rules = alertRules!.filter(
        r => operators.includes(r.operator) && r.metric === 'temperature'
          && (r.device_id === deviceId || r.device_id === null)
      );
      if (!rules.length) return undefined;
      const specific = rules.filter(r => r.device_id === deviceId);
      const pool = specific.length ? specific : rules;
      return pick(pool.map(r => r.threshold_value));
    }
    return {
      high: resolve(['gt', 'gte'], vals => Math.max(...vals)),
      low:  resolve(['lt', 'lte'], vals => Math.min(...vals)),
    };
  }, [alertRules, deviceId]);

  // Stats derived from raw readings
  const stats = useMemo(() => {
    const data = range.useAggregate ? null : rawReadings;
    if (!data?.length) return null;
    const temps = data.map(r => r.temperature).filter((t): t is number => t != null);
    if (!temps.length) return null;
    return {
      min: Math.min(...temps),
      max: Math.max(...temps),
      avg: temps.reduce((a, b) => a + b, 0) / temps.length,
      count: data.length,
    };
  }, [rawReadings, range.useAggregate]);

  const aggStats = useMemo(() => {
    if (!range.useAggregate || !aggReadings?.length) return null;
    const mins = aggReadings.map(r => r.min_temperature).filter((t): t is number => t != null);
    const maxs = aggReadings.map(r => r.max_temperature).filter((t): t is number => t != null);
    const avgs = aggReadings.map(r => r.avg_temperature).filter((t): t is number => t != null);
    if (!avgs.length) return null;
    return {
      min: Math.min(...mins),
      max: Math.max(...maxs),
      avg: avgs.reduce((a, b) => a + b, 0) / avgs.length,
      count: aggReadings.reduce((a, r) => a + r.reading_count, 0),
    };
  }, [aggReadings, range.useAggregate]);

  const displayStats = range.useAggregate ? aggStats : stats;

  const isOnline = device?.last_seen_at
    ? (Date.now() - new Date(device.last_seen_at).getTime()) < 15 * 60 * 1000
    : false;

  if (deviceLoading) {
    return <div className="flex items-center justify-center h-64 text-cold-400">Loading…</div>;
  }
  if (!device) {
    return <div className="card p-8 text-center text-alert-critical">Sensor not found</div>;
  }

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-cold-400 mb-6">
        <Link to="/" className="hover:text-white transition-colors">Dashboard</Link>
        <span>/</span>
        <Link to={`/system/${systemId}`} className="hover:text-white transition-colors">
          {system?.name ?? 'System'}
        </Link>
        <span>/</span>
        <span className="text-cold-200">{device.name}</span>
      </nav>

      {/* Header */}
      <div className="card p-6 mb-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              {isOnline ? (
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-alert-ok opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-alert-ok" />
                </span>
              ) : (
                <span className="inline-flex rounded-full h-2.5 w-2.5 bg-cold-600" />
              )}
              <h2 className="text-2xl font-semibold text-white">{device.name}</h2>
            </div>
            {device.description && (
              <p className="text-cold-300/70 text-sm mb-2">{device.description}</p>
            )}
            <div className="flex items-center gap-4 text-xs text-cold-400 font-mono">
              <span>{device.dev_eui.toUpperCase()}</span>
              {device.manufacturer && <span>{device.manufacturer} {device.model}</span>}
              {device.firmware_version && <span>fw {device.firmware_version}</span>}
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-right">
              <div className="metric-label flex items-center gap-1 justify-end"><Thermometer className="w-3 h-3" /> Now</div>
              <div className="text-2xl font-mono font-semibold text-white">{formatTemp(device.latest_temperature)}</div>
            </div>
            <div className="text-right">
              <div className="metric-label flex items-center gap-1 justify-end"><Droplets className="w-3 h-3" /> Humidity</div>
              <div className="text-2xl font-mono font-semibold text-cold-200">{formatHumidity(device.latest_humidity)}</div>
            </div>
            <div className="text-right">
              <div className="metric-label flex items-center gap-1 justify-end">
                {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />} Last seen
              </div>
              <div className="text-sm text-cold-200">{formatTimeAgo(device.last_seen_at)}</div>
            </div>
            <div className="text-right">
              <div className="metric-label flex items-center gap-1 justify-end"><Battery className="w-3 h-3" /> Battery</div>
              <div className="text-sm font-mono text-cold-200">{formatBattery(device.battery_level)}</div>
            </div>
            <div className="text-right">
              <div className="metric-label flex items-center gap-1 justify-end"><Radio className="w-3 h-3" /> RSSI</div>
              <div className="text-sm font-mono text-cold-200">
                {device.signal_rssi != null ? `${device.signal_rssi} dBm` : '—'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Time range controls */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="flex items-center gap-1 bg-cold-900 border border-cold-700/40 rounded-lg p-1">
          {(Object.keys(PRESETS) as Exclude<PresetKey, 'custom'>[]).map(key => (
            <button
              key={key}
              onClick={() => setPreset(key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                preset === key
                  ? 'bg-cold-600 text-white'
                  : 'text-cold-400 hover:text-white hover:bg-cold-700/50'
              }`}
            >
              {PRESETS[key].label}
            </button>
          ))}
          <button
            onClick={() => setPreset('custom')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              preset === 'custom'
                ? 'bg-cold-600 text-white'
                : 'text-cold-400 hover:text-white hover:bg-cold-700/50'
            }`}
          >
            Custom
          </button>
        </div>

        {preset === 'custom' && (
          <>
            <div className="flex items-center gap-2">
              <label className="text-xs text-cold-400">From</label>
              <input
                type="datetime-local"
                value={customStart}
                onChange={e => setCustomStart(e.target.value)}
                className="form-input text-sm py-1.5"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-cold-400">To</label>
              <input
                type="datetime-local"
                value={customEnd}
                onChange={e => setCustomEnd(e.target.value)}
                className="form-input text-sm py-1.5"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-cold-300 cursor-pointer">
              <input
                type="checkbox"
                checked={useAggForCustom}
                onChange={e => setUseAggForCustom(e.target.checked)}
                className="rounded border-cold-600"
              />
              Hourly aggregates
            </label>
          </>
        )}

        <label className="flex items-center gap-2 text-sm text-cold-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showThresholds}
            onChange={e => setShowThresholds(e.target.checked)}
            className="rounded border-cold-600"
          />
          Show thresholds
        </label>

        <div className="ml-auto flex items-center gap-2 text-xs text-cold-400">
          {isFetching && <span className="w-1.5 h-1.5 rounded-full bg-cold-400 animate-pulse" />}
          <span>
            {format(range.start, 'MMM d, HH:mm')} – {format(range.end, 'MMM d, HH:mm')}
          </span>
          {range.useAggregate && (
            <span className="text-cold-500">(hourly avg)</span>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="card p-5 mb-6">
        <h3 className="text-sm font-medium text-cold-200 mb-4">Temperature</h3>
        {range.useAggregate ? (
          <TemperatureChart
            mode="aggregate"
            readings={aggReadings ?? []}
            thresholdHigh={showThresholds ? thresholds.high : undefined}
            thresholdLow={showThresholds ? thresholds.low : undefined}
            height={320}
            xAxisFormat={range.xAxisFormat}
          />
        ) : (
          <TemperatureChart
            mode="raw"
            readings={rawReadings ?? []}
            thresholdHigh={showThresholds ? thresholds.high : undefined}
            thresholdLow={showThresholds ? thresholds.low : undefined}
            height={320}
            xAxisFormat={range.xAxisFormat}
          />
        )}
      </div>

      {/* Stats for the selected window */}
      {displayStats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard label="Min temp" value={formatTemp(displayStats.min)} />
          <StatCard label="Max temp" value={formatTemp(displayStats.max)} />
          <StatCard label="Avg temp" value={formatTemp(displayStats.avg)} />
          <StatCard
            label="Readings"
            value={displayStats.count.toLocaleString()}
            sub={range.useAggregate ? 'across hourly buckets' : 'raw readings'}
          />
        </div>
      )}

      {/* Recent readings table — only for raw windows */}
      {!range.useAggregate && rawReadings && rawReadings.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-cold-700/30">
            <h3 className="text-sm font-medium text-cold-200">
              Recent Readings
              <span className="text-cold-500 font-normal ml-2">
                (latest {Math.min(rawReadings.length, 50)} of {rawReadings.length})
              </span>
            </h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-cold-700/30">
                <th className="px-5 py-2.5 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">Time</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">Temperature</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">Humidity</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">Battery V</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">RSSI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cold-700/20">
              {rawReadings.slice(0, 50).map((r, i) => {
                const overHigh = thresholds.high != null && r.temperature != null && r.temperature > thresholds.high;
                const underLow = thresholds.low  != null && r.temperature != null && r.temperature < thresholds.low;
                return (
                  <tr key={i} className={`hover:bg-cold-800/20 ${overHigh || underLow ? 'bg-alert-critical/5' : ''}`}>
                    <td className="px-5 py-2.5 text-cold-300 text-xs font-mono">{formatTimestamp(r.time)}</td>
                    <td className={`px-5 py-2.5 font-mono font-medium ${overHigh ? 'text-alert-critical' : underLow ? 'text-blue-400' : 'text-white'}`}>
                      {formatTemp(r.temperature)}
                    </td>
                    <td className="px-5 py-2.5 font-mono text-cold-200">{formatHumidity(r.humidity)}</td>
                    <td className="px-5 py-2.5 font-mono text-cold-300">
                      {r.battery_voltage != null ? `${r.battery_voltage.toFixed(2)}V` : '—'}
                    </td>
                    <td className="px-5 py-2.5 font-mono text-cold-300">
                      {r.rssi != null ? `${r.rssi} dBm` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6">
        <Link
          to={`/system/${systemId}`}
          className="inline-flex items-center gap-2 text-sm text-cold-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to {system?.name ?? 'system'}
        </Link>
      </div>
    </div>
  );
}

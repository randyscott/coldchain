import { useState } from 'react';
import { ChevronDown, ChevronUp, Wifi, WifiOff, Battery, Radio, Trash2, ExternalLink } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import type { Device } from '../../api/client';
import { api } from '../../api/client';
import { formatTemp, formatHumidity, formatBattery, formatTimeAgo } from '../../utils/format';
import { TemperatureChart } from './TemperatureChart';

interface Props {
  device: Device;
  thresholdHigh?: number;
  thresholdLow?: number;
  onDelete?: () => void;
}

export function SensorRow({ device, thresholdHigh, thresholdLow, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false);

  const isOnline = device.last_seen_at
    ? (Date.now() - new Date(device.last_seen_at).getTime()) < 15 * 60 * 1000
    : false;

  // Fetch readings when expanded
  const { data: readings, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['readings', device.id],
    queryFn: () => api.getDeviceReadings(device.id, { limit: 500 }),
    enabled: expanded,
    refetchInterval: expanded ? 30_000 : false,
  });

  return (
    <div className="card overflow-hidden">
      {/* Sensor header row */}
      <div className="flex items-stretch">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex-1 px-5 py-4 flex items-center gap-4 hover:bg-cold-800/30 transition-colors text-left"
      >
        {/* Online indicator */}
        <div className="flex-shrink-0 flex items-center gap-1.5">
          {isOnline ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-alert-ok opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-alert-ok" />
              </span>
              <Wifi className="w-4 h-4 text-alert-ok" />
            </>
          ) : (
            <>
              <span className="inline-flex rounded-full h-2 w-2 bg-cold-600" />
              <WifiOff className="w-4 h-4 text-cold-500" />
            </>
          )}
        </div>

        {/* Name */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-white truncate">{device.name}</span>
            <Link
              to={`/system/${device.system_id}/sensor/${device.id}`}
              onClick={e => e.stopPropagation()}
              className="text-cold-500 hover:text-cold-200 transition-colors flex-shrink-0"
              title="Open sensor detail"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="text-xs text-cold-400 mt-0.5">
            {device.manufacturer} {device.model} · {device.dev_eui}
          </div>
        </div>

        {/* Current readings */}
        <div className="flex items-center gap-6 flex-shrink-0">
          <div className="text-right">
            <div className="metric-label">Temp</div>
            <div className="text-lg font-mono font-semibold text-white">
              {formatTemp(device.latest_temperature)}
            </div>
          </div>
          <div className="text-right">
            <div className="metric-label">Humidity</div>
            <div className="text-lg font-mono font-semibold text-cold-200">
              {formatHumidity(device.latest_humidity)}
            </div>
          </div>
          <div className="text-right hidden sm:block">
            <div className="metric-label">Battery</div>
            <div className="flex items-center gap-1.5">
              <Battery className="w-4 h-4 text-cold-400" />
              <span className="text-sm font-mono text-cold-200">
                {formatBattery(device.battery_level)}
              </span>
            </div>
          </div>
          <div className="text-right hidden sm:block">
            <div className="metric-label">Signal</div>
            <div className="flex items-center gap-1.5">
              <Radio className="w-4 h-4 text-cold-400" />
              <span className="text-sm font-mono text-cold-200">
                {device.signal_rssi != null ? `${device.signal_rssi} dBm` : '—'}
              </span>
            </div>
          </div>
          <div className="text-right hidden md:block">
            <div className="metric-label">Last seen</div>
            <div className="text-xs text-cold-300">
              {formatTimeAgo(device.last_seen_at)}
            </div>
          </div>
        </div>

        {/* Expand toggle */}
        <div className="flex-shrink-0 ml-2">
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-cold-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-cold-400" />
          )}
        </div>
      </button>
      {onDelete && (
        <button
          onClick={onDelete}
          className="px-3 flex items-center text-cold-600 hover:text-alert-critical hover:bg-cold-800/30 transition-colors border-l border-cold-700/20"
          title="Delete sensor"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
      </div>

      {/* Expanded: temperature chart */}
      {expanded && (
        <div className="px-5 pb-5 border-t border-cold-700/20">
          <div className="flex items-center justify-between mt-4 mb-2">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium text-cold-200">Temperature History</h4>
              {isFetching && (
                <span className="w-1.5 h-1.5 rounded-full bg-cold-400 animate-pulse" />
              )}
            </div>
            {dataUpdatedAt > 0 && (
              <span className="text-xs text-cold-400">
                Updated {format(dataUpdatedAt, 'HH:mm:ss')}
              </span>
            )}
          </div>
          {readings ? (
            <TemperatureChart
              mode="raw"
              readings={readings}
              thresholdHigh={thresholdHigh}
              thresholdLow={thresholdLow}
              height={250}
            />
          ) : (
            <div className="flex items-center justify-center h-48 text-cold-400 text-sm">
              Loading chart...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

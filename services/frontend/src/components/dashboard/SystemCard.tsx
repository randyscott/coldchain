import { Link } from 'react-router-dom';
import { MapPin, Truck, Wifi, AlertTriangle, ChevronRight } from 'lucide-react';
import type { SystemSummary } from '../../api/client';
import { formatTemp, formatTimeAgo, getSystemStatus, getStatusDotClass } from '../../utils/format';

interface Props {
  system: SystemSummary;
}

export function SystemCard({ system }: Props) {
  const status = getSystemStatus(system.active_alerts);
  const dotClass = getStatusDotClass(status);
  const isTransport = system.system_type === 'transport';

  return (
    <Link to={`/system/${system.system_id}`} className="card-hover block p-5 group">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={dotClass} />
          <div>
            <h3 className="font-semibold text-white group-hover:text-cold-200 transition-colors">
              {system.system_name}
            </h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              {isTransport ? (
                <Truck className="w-3.5 h-3.5 text-cold-400" />
              ) : (
                <MapPin className="w-3.5 h-3.5 text-cold-400" />
              )}
              <span className="text-xs text-cold-300/70">
                {isTransport ? 'Transport' : 'Fixed Location'}
              </span>
            </div>
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-cold-600 group-hover:text-cold-400 transition-colors" />
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div>
          <div className="metric-label">Temperature</div>
          <div className={`metric-value ${status === 'critical' ? 'text-alert-critical' : 'text-white'}`}>
            {formatTemp(system.worst_temperature)}
          </div>
        </div>
        <div>
          <div className="metric-label">Sensors</div>
          <div className="metric-value text-white">
            {system.sensors_reporting}
            <span className="text-sm text-cold-400 font-normal">/{system.sensor_count}</span>
          </div>
        </div>
        <div>
          <div className="metric-label">Alerts</div>
          <div className={`metric-value ${system.active_alerts > 0 ? 'text-alert-critical' : 'text-alert-ok'}`}>
            {system.active_alerts}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-cold-700/20">
        <div className="flex items-center gap-1.5 text-xs text-cold-400">
          <Wifi className="w-3.5 h-3.5" />
          {system.gateway_count} gateway{system.gateway_count !== 1 ? 's' : ''}
        </div>
        <div className="text-xs text-cold-400">
          {system.last_reading_at ? (
            <>Updated {formatTimeAgo(system.last_reading_at)}</>
          ) : (
            'No data yet'
          )}
        </div>
      </div>

      {/* Active alert banner */}
      {system.active_alerts > 0 && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-alert-critical/10 border border-alert-critical/20 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-alert-critical flex-shrink-0" />
          <span className="text-xs text-alert-critical font-medium">
            {system.active_alerts} active alert{system.active_alerts !== 1 ? 's' : ''} — requires attention
          </span>
        </div>
      )}
    </Link>
  );
}

import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, MapPin, Truck, AlertTriangle, Clock,
  CheckCircle2, XCircle,
} from 'lucide-react';
import { api } from '../api/client';
import { SensorRow } from '../components/system/SensorRow';
import { formatTimestamp, formatTimeAgo, formatTemp } from '../utils/format';

export function SystemDetailPage() {
  const { systemId } = useParams<{ systemId: string }>();

  const { data: system, isLoading: sysLoading } = useQuery({
    queryKey: ['system', systemId],
    queryFn: () => api.getSystem(systemId!),
    enabled: !!systemId,
  });

  const { data: devices } = useQuery({
    queryKey: ['devices', systemId],
    queryFn: () => api.getDevices({ system_id: systemId }),
    enabled: !!systemId,
    refetchInterval: 15_000,
  });

  const { data: alertEvents } = useQuery({
    queryKey: ['alertEvents', systemId],
    queryFn: () => api.getAlertEvents({ system_id: systemId, limit: 20 }),
    enabled: !!systemId,
    refetchInterval: 15_000,
  });

  const { data: alertRules } = useQuery({
    queryKey: ['alertRules', systemId],
    queryFn: () => api.getAlertRules(systemId),
    enabled: !!systemId,
  });

  if (sysLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-cold-400">
        Loading system...
      </div>
    );
  }

  if (!system) {
    return (
      <div className="card p-8 text-center">
        <p className="text-alert-critical">System not found</p>
        <Link to="/" className="text-cold-400 text-sm mt-2 hover:text-white">
          Return to dashboard
        </Link>
      </div>
    );
  }

  const sensors = devices?.filter((d) => d.device_type === 'sensor') ?? [];
  const gateways = devices?.filter((d) => d.device_type === 'gateway') ?? [];
  const activeAlerts = alertEvents?.filter((e) => !e.resolved_at) ?? [];
  const isTransport = system.system_type === 'transport';

  // Find the highest threshold for chart reference lines
  const highThreshold = alertRules
    ?.filter((r) => r.operator === 'gt' || r.operator === 'gte')
    .reduce((max, r) => Math.max(max, r.threshold_value), -Infinity);

  return (
    <div>
      {/* Breadcrumb */}
      <Link
        to="/"
        className="inline-flex items-center gap-2 text-sm text-cold-400 hover:text-white transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Dashboard
      </Link>

      {/* System header */}
      <div className="card p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              {isTransport ? (
                <Truck className="w-6 h-6 text-cold-400" />
              ) : (
                <MapPin className="w-6 h-6 text-cold-400" />
              )}
              <h2 className="text-2xl font-semibold text-white">{system.name}</h2>
            </div>
            {system.description && (
              <p className="text-cold-300/70 text-sm mb-3">{system.description}</p>
            )}
            {system.address && (
              <p className="text-cold-400 text-xs">{system.address}</p>
            )}
          </div>

          {/* Quick stats */}
          <div className="flex gap-6 text-right">
            <div>
              <div className="metric-label">Sensors</div>
              <div className="text-xl font-semibold text-white font-mono">{sensors.length}</div>
            </div>
            <div>
              <div className="metric-label">Gateways</div>
              <div className="text-xl font-semibold text-white font-mono">{gateways.length}</div>
            </div>
            <div>
              <div className="metric-label">Active Alerts</div>
              <div className={`text-xl font-semibold font-mono ${activeAlerts.length > 0 ? 'text-alert-critical' : 'text-alert-ok'}`}>
                {activeAlerts.length}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Active alerts banner */}
      {activeAlerts.length > 0 && (
        <div className="mb-6 space-y-2">
          {activeAlerts.map((alert) => (
            <div
              key={alert.id}
              className="card px-5 py-3 border-alert-critical/30 bg-alert-critical/5 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-alert-critical flex-shrink-0" />
                <div>
                  <span className="font-medium text-white">{alert.rule_name}</span>
                  <span className="text-cold-300 mx-2">on</span>
                  <span className="text-cold-200">{alert.device_name}</span>
                  {alert.trigger_value != null && (
                    <span className="text-alert-critical ml-2 font-mono text-sm">
                      {formatTemp(alert.trigger_value)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs text-cold-400">
                <div className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {formatTimeAgo(alert.triggered_at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sensors */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold text-white mb-4">Sensors</h3>
        {sensors.length > 0 ? (
          <div className="space-y-3">
            {sensors.map((sensor) => (
              <SensorRow
                key={sensor.id}
                device={sensor}
                thresholdHigh={highThreshold && highThreshold > -Infinity ? highThreshold : undefined}
              />
            ))}
          </div>
        ) : (
          <div className="card p-8 text-center text-cold-400 text-sm">
            No sensors registered for this system.
          </div>
        )}
      </div>

      {/* Recent alert history */}
      <div>
        <h3 className="text-lg font-semibold text-white mb-4">Recent Alert History</h3>
        {alertEvents && alertEvents.length > 0 ? (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cold-700/30">
                  <th className="px-5 py-3 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">Rule</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">Device</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">Value</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">Triggered</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">Resolved</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cold-700/20">
                {alertEvents.map((event) => (
                  <tr key={event.id} className="hover:bg-cold-800/20">
                    <td className="px-5 py-3">
                      {event.resolved_at ? (
                        <CheckCircle2 className="w-4 h-4 text-alert-ok" />
                      ) : (
                        <XCircle className="w-4 h-4 text-alert-critical" />
                      )}
                    </td>
                    <td className="px-5 py-3 text-white">{event.rule_name}</td>
                    <td className="px-5 py-3 text-cold-200">{event.device_name}</td>
                    <td className="px-5 py-3 font-mono text-cold-200">
                      {event.trigger_value != null ? formatTemp(event.trigger_value) : '—'}
                      {event.peak_value != null && event.peak_value !== event.trigger_value && (
                        <span className="text-cold-400 ml-1">
                          (peak: {formatTemp(event.peak_value)})
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-cold-300 text-xs">{formatTimestamp(event.triggered_at)}</td>
                    <td className="px-5 py-3 text-cold-300 text-xs">
                      {event.resolved_at ? formatTimestamp(event.resolved_at) : (
                        <span className="text-alert-critical font-medium">Active</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card p-8 text-center text-cold-400 text-sm">
            No alert events recorded yet.
          </div>
        )}
      </div>
    </div>
  );
}

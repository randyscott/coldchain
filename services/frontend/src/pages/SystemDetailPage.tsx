import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, MapPin, Truck, AlertTriangle, Clock,
  CheckCircle2, XCircle, Pencil, Trash2, Plus, Wifi,
} from 'lucide-react';
import { api } from '../api/client';
import { SensorRow } from '../components/system/SensorRow';
import { SystemModal } from '../components/system/SystemModal';
import { DeviceModal } from '../components/system/DeviceModal';
import { formatTimestamp, formatTimeAgo, formatTemp } from '../utils/format';
import { useAuth } from '../hooks/useAuth';

export function SystemDetailPage() {
  const { systemId } = useParams<{ systemId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [showEditSystem, setShowEditSystem] = useState(false);
  const [showRegisterDevice, setShowRegisterDevice] = useState(false);
  const [confirmDeleteSystem, setConfirmDeleteSystem] = useState(false);
  const [deletingDeviceId, setDeletingDeviceId] = useState<string | null>(null);

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

  const { data: activeAlertEvents } = useQuery({
    queryKey: ['alertEvents', systemId, 'active'],
    queryFn: () => api.getAlertEvents({ system_id: systemId, active_only: true }),
    enabled: !!systemId,
    refetchInterval: 15_000,
  });

  const { data: alertEvents } = useQuery({
    queryKey: ['alertEvents', systemId, 'history'],
    queryFn: () => api.getAlertEvents({ system_id: systemId, limit: 20 }),
    enabled: !!systemId,
    refetchInterval: 15_000,
  });

  const { data: alertRules } = useQuery({
    queryKey: ['alertRules', systemId],
    queryFn: () => api.getAlertRules(systemId),
    enabled: !!systemId,
  });

  const deleteSystemMutation = useMutation({
    mutationFn: () => api.deleteSystem(systemId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['systemSummary'] });
      qc.invalidateQueries({ queryKey: ['systems'] });
      navigate('/');
    },
  });

  const deleteDeviceMutation = useMutation({
    mutationFn: (deviceId: string) => api.deleteDevice(deviceId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devices', systemId] });
      qc.invalidateQueries({ queryKey: ['system', systemId] });
      qc.invalidateQueries({ queryKey: ['systemSummary'] });
      setDeletingDeviceId(null);
    },
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
  const activeAlerts = activeAlertEvents ?? [];
  const isTransport = system.system_type === 'transport';

  // Build per-sensor threshold lookups.
  // A rule applies to a sensor if device-specific (device_id matches) or system-wide (device_id null).
  // Device-specific rules take precedence over system-wide ones.
  function getThresholdsForSensor(sensorId: string): { high?: number; low?: number } {
    if (!alertRules) return {};

    function resolve(operators: string[], pick: (vals: number[]) => number): number | undefined {
      const applicable = alertRules!.filter(
        (r) =>
          operators.includes(r.operator) &&
          r.metric === 'temperature' &&
          (r.device_id === sensorId || r.device_id === null)
      );
      if (applicable.length === 0) return undefined;
      const specific = applicable.filter((r) => r.device_id === sensorId);
      const pool = specific.length > 0 ? specific : applicable;
      return pick(pool.map((r) => r.threshold_value));
    }

    return {
      high: resolve(['gt', 'gte'], (vals) => Math.max(...vals)),
      low:  resolve(['lt', 'lte'], (vals) => Math.min(...vals)),
    };
  }

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
          <div className="flex-1 min-w-0 mr-6">
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

          <div className="flex flex-col items-end gap-4 flex-shrink-0">
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

            {/* Admin actions */}
            {isAdmin && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowEditSystem(true)}
                  className="btn-secondary flex items-center gap-1.5 text-xs py-1.5 px-3"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </button>
                {confirmDeleteSystem ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-cold-400">Delete system?</span>
                    <button
                      onClick={() => deleteSystemMutation.mutate()}
                      disabled={deleteSystemMutation.isPending}
                      className="text-xs text-alert-critical hover:text-red-300 font-medium"
                    >
                      {deleteSystemMutation.isPending ? 'Deleting…' : 'Yes, delete'}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteSystem(false)}
                      className="text-xs text-cold-400 hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteSystem(true)}
                    className="text-cold-500 hover:text-alert-critical transition-colors p-1.5"
                    title="Delete system"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
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
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Sensors</h3>
          {isAdmin && (
            <button
              onClick={() => setShowRegisterDevice(true)}
              className="btn-primary flex items-center gap-2 text-sm py-1.5 px-3"
            >
              <Plus className="w-4 h-4" />
              Register Device
            </button>
          )}
        </div>
        {sensors.length > 0 ? (
          <div className="space-y-3">
            {sensors.map((sensor) => (
              <SensorRow
                key={sensor.id}
                device={sensor}
                thresholdHigh={getThresholdsForSensor(sensor.id).high}
                thresholdLow={getThresholdsForSensor(sensor.id).low}
                onDelete={isAdmin ? () => setDeletingDeviceId(sensor.id) : undefined}
              />
            ))}
          </div>
        ) : (
          <div className="card p-8 text-center text-cold-400 text-sm">
            No sensors registered for this system.
            {isAdmin && (
              <button
                onClick={() => setShowRegisterDevice(true)}
                className="block mx-auto mt-3 text-cold-300 hover:text-white underline"
              >
                Register a sensor
              </button>
            )}
          </div>
        )}
      </div>

      {/* Gateways */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold text-white mb-4">Gateways</h3>
        {gateways.length > 0 ? (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-cold-700/30">
                  <th className="px-5 py-3 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">Name</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">Gateway EUI</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">Last Seen</th>
                  {isAdmin && <th className="px-5 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-cold-700/20">
                {gateways.map(gw => (
                  <tr key={gw.id} className="hover:bg-cold-800/20">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <Wifi className="w-4 h-4 text-cold-400 flex-shrink-0" />
                        <span className="font-medium text-white">{gw.name}</span>
                      </div>
                      {gw.description && <p className="text-xs text-cold-400 mt-0.5 ml-6">{gw.description}</p>}
                    </td>
                    <td className="px-5 py-4 font-mono text-xs text-cold-300">{gw.dev_eui.toUpperCase()}</td>
                    <td className="px-5 py-4 text-xs text-cold-400">{formatTimeAgo(gw.last_seen_at)}</td>
                    {isAdmin && (
                      <td className="px-5 py-4 text-right">
                        {deletingDeviceId === gw.id ? (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-xs text-cold-400">Delete?</span>
                            <button
                              onClick={() => deleteDeviceMutation.mutate(gw.id)}
                              disabled={deleteDeviceMutation.isPending}
                              className="text-xs text-alert-critical hover:text-red-300 font-medium"
                            >
                              {deleteDeviceMutation.isPending ? 'Deleting…' : 'Yes'}
                            </button>
                            <button onClick={() => setDeletingDeviceId(null)} className="text-xs text-cold-400 hover:text-white">No</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeletingDeviceId(gw.id)}
                            className="text-cold-500 hover:text-alert-critical transition-colors"
                            title="Delete gateway"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card p-8 text-center text-cold-400 text-sm">
            No gateways registered for this system.
            {isAdmin && (
              <button
                onClick={() => setShowRegisterDevice(true)}
                className="block mx-auto mt-3 text-cold-300 hover:text-white underline"
              >
                Register a gateway
              </button>
            )}
          </div>
        )}
      </div>

      {/* Sensor delete confirmation */}
      {deletingDeviceId && sensors.find(s => s.id === deletingDeviceId) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDeletingDeviceId(null)} />
          <div className="relative bg-cold-900 border border-cold-700/40 rounded-xl shadow-2xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-semibold text-white mb-2">Delete Sensor?</h3>
            <p className="text-cold-300 text-sm mb-6">
              <span className="font-medium text-white">
                {sensors.find(s => s.id === deletingDeviceId)?.name}
              </span>{' '}
              will be removed from ChirpStack and all historical readings will be preserved.
              Alert rules targeting this sensor will also be deleted.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeletingDeviceId(null)} className="btn-secondary">Cancel</button>
              <button
                onClick={() => deleteDeviceMutation.mutate(deletingDeviceId)}
                disabled={deleteDeviceMutation.isPending}
                className="btn-danger"
              >
                {deleteDeviceMutation.isPending ? 'Deleting…' : 'Delete Sensor'}
              </button>
            </div>
          </div>
        </div>
      )}

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

      {showEditSystem && system && (
        <SystemModal system={system} onClose={() => setShowEditSystem(false)} />
      )}
      {showRegisterDevice && systemId && (
        <DeviceModal systemId={systemId} onClose={() => setShowRegisterDevice(false)} />
      )}
    </div>
  );
}

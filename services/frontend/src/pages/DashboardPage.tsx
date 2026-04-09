import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, Plus, Thermometer, Wifi } from 'lucide-react';
import { format } from 'date-fns';
import { api } from '../api/client';
import { SystemCard } from '../components/dashboard/SystemCard';
import { SystemModal } from '../components/system/SystemModal';
import { useAuth } from '../hooks/useAuth';

export function DashboardPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [showNewSystem, setShowNewSystem] = useState(false);

  const { data: systems, isLoading, error, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['systemSummary'],
    queryFn: api.getSystemSummary,
    refetchInterval: 15_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-cold-400">Loading dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-6 text-center">
        <p className="text-alert-critical">Failed to load dashboard: {(error as Error).message}</p>
        <p className="text-cold-400 text-sm mt-2">
          Is the integration service running at localhost:8000?
        </p>
      </div>
    );
  }

  // Aggregate stats
  const totalSensors = systems?.reduce((sum, s) => sum + s.sensor_count, 0) ?? 0;
  const sensorsOnline = systems?.reduce((sum, s) => sum + s.sensors_reporting, 0) ?? 0;
  const totalAlerts = systems?.reduce((sum, s) => sum + s.active_alerts, 0) ?? 0;
  const totalGateways = systems?.reduce((sum, s) => sum + s.gateway_count, 0) ?? 0;

  return (
    <div>
      {/* Page header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h2 className="text-2xl font-semibold text-white">Dashboard</h2>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-cold-300/70 text-sm">Real-time overview of all monitored systems</p>
            {dataUpdatedAt > 0 && (
              <span className="text-xs text-cold-500 flex items-center gap-1">
                ·
                {isFetching && <span className="w-1.5 h-1.5 rounded-full bg-cold-400 animate-pulse inline-block" />}
                {format(dataUpdatedAt, 'HH:mm:ss')}
              </span>
            )}
          </div>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowNewSystem(true)}
            className="btn-primary flex items-center gap-2 flex-shrink-0"
          >
            <Plus className="w-4 h-4" />
            New System
          </button>
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="card p-4">
          <div className="flex items-center gap-3 mb-2">
            <Thermometer className="w-5 h-5 text-cold-400" />
            <span className="metric-label">Systems</span>
          </div>
          <div className="metric-value text-white">{systems?.length ?? 0}</div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3 mb-2">
            <Wifi className="w-5 h-5 text-cold-400" />
            <span className="metric-label">Sensors Online</span>
          </div>
          <div className="metric-value text-white">
            {sensorsOnline}
            <span className="text-sm text-cold-400 font-normal">/{totalSensors}</span>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3 mb-2">
            <Activity className="w-5 h-5 text-cold-400" />
            <span className="metric-label">Gateways</span>
          </div>
          <div className="metric-value text-white">{totalGateways}</div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3 mb-2">
            <AlertTriangle className={`w-5 h-5 ${totalAlerts > 0 ? 'text-alert-critical' : 'text-cold-400'}`} />
            <span className="metric-label">Active Alerts</span>
          </div>
          <div className={`metric-value ${totalAlerts > 0 ? 'text-alert-critical' : 'text-alert-ok'}`}>
            {totalAlerts}
          </div>
        </div>
      </div>

      {/* System cards */}
      {systems && systems.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {systems.map((system) => (
            <SystemCard key={system.system_id} system={system} />
          ))}
        </div>
      ) : (
        <div className="card p-12 text-center">
          <Thermometer className="w-12 h-12 text-cold-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-cold-200 mb-2">No systems configured</h3>
          <p className="text-cold-400 text-sm mb-6">
            Create a system to get started, then register gateways and sensors.
          </p>
          {isAdmin && (
            <button
              onClick={() => setShowNewSystem(true)}
              className="btn-primary inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Create First System
            </button>
          )}
        </div>
      )}

      {showNewSystem && <SystemModal onClose={() => setShowNewSystem(false)} />}
    </div>
  );
}

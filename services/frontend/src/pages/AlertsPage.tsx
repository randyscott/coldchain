import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { api } from '../api/client';
import { formatTemp, formatTimestamp, formatTimeAgo } from '../utils/format';

export function AlertsPage() {
  const { data: events, isLoading } = useQuery({
    queryKey: ['allAlertEvents'],
    queryFn: () => api.getAlertEvents({ limit: 50 }),
    refetchInterval: 15_000,
  });

  const activeCount = events?.filter((e) => !e.resolved_at).length ?? 0;

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-semibold text-white">Alerts</h2>
        <p className="text-cold-300/70 mt-1 text-sm">
          {activeCount > 0 ? (
            <span className="text-alert-critical font-medium">{activeCount} active alert{activeCount !== 1 ? 's' : ''}</span>
          ) : (
            'All systems operating normally'
          )}
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64 text-cold-400">
          Loading alerts...
        </div>
      ) : events && events.length > 0 ? (
        <div className="space-y-2">
          {events.map((event) => (
            <div
              key={event.id}
              className={`card px-5 py-4 flex items-center justify-between ${
                !event.resolved_at ? 'border-alert-critical/20 bg-alert-critical/5' : ''
              }`}
            >
              <div className="flex items-center gap-4">
                {event.resolved_at ? (
                  <CheckCircle2 className="w-5 h-5 text-alert-ok flex-shrink-0" />
                ) : (
                  <XCircle className="w-5 h-5 text-alert-critical flex-shrink-0" />
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">{event.rule_name}</span>
                    <span className="text-cold-500">·</span>
                    <span className="text-cold-300">{event.device_name}</span>
                    <span className="text-cold-500">·</span>
                    <span className="text-cold-400 text-sm">{event.system_name}</span>
                  </div>
                  <div className="text-xs text-cold-400 mt-1 flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Triggered {formatTimeAgo(event.triggered_at)}
                    </span>
                    {event.trigger_value != null && (
                      <span className="font-mono">
                        Value: {formatTemp(event.trigger_value)}
                      </span>
                    )}
                    {event.peak_value != null && event.peak_value !== event.trigger_value && (
                      <span className="font-mono text-alert-critical">
                        Peak: {formatTemp(event.peak_value)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right text-xs text-cold-400">
                <div>{formatTimestamp(event.triggered_at)}</div>
                {event.resolved_at && (
                  <div className="text-alert-ok mt-0.5">
                    Resolved {formatTimestamp(event.resolved_at)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card p-12 text-center">
          <AlertTriangle className="w-12 h-12 text-cold-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-cold-200 mb-2">No alerts yet</h3>
          <p className="text-cold-400 text-sm">
            Alert events will appear here when sensor readings breach configured thresholds.
          </p>
        </div>
      )}
    </div>
  );
}

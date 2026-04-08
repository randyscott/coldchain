import { formatDistanceToNow, format } from 'date-fns';

export function formatTemp(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${value.toFixed(1)}°C`;
}

export function formatHumidity(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${value.toFixed(0)}%`;
}

export function formatBattery(level: number | null | undefined): string {
  if (level == null) return '—';
  return `${(level * 100).toFixed(0)}%`;
}

export function formatTimeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Never';
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
  } catch {
    return 'Unknown';
  }
}

export function formatTimestamp(dateStr: string): string {
  try {
    return format(new Date(dateStr), 'MMM d, HH:mm:ss');
  } catch {
    return dateStr;
  }
}

export function formatDateShort(dateStr: string): string {
  try {
    return format(new Date(dateStr), 'MMM d, HH:mm');
  } catch {
    return dateStr;
  }
}

export type SystemStatus = 'ok' | 'warning' | 'critical';

export function getSystemStatus(activeAlerts: number): SystemStatus {
  if (activeAlerts > 0) return 'critical';
  return 'ok';
}

export function getStatusColor(status: SystemStatus): string {
  switch (status) {
    case 'ok': return 'text-alert-ok';
    case 'warning': return 'text-alert-warning';
    case 'critical': return 'text-alert-critical';
  }
}

export function getStatusDotClass(status: SystemStatus): string {
  switch (status) {
    case 'ok': return 'status-dot status-ok';
    case 'warning': return 'status-dot status-warning';
    case 'critical': return 'status-dot status-critical';
  }
}

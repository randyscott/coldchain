import { useState } from 'react';
import { X, FileText, FileSpreadsheet, Download, Loader2 } from 'lucide-react';
import { subDays, startOfDay, endOfDay, format } from 'date-fns';
import { api } from '../../api/client';
import type { Device } from '../../api/client';

interface Props {
  systemId: string;
  systemName: string;
  sensors: Device[];
  onClose: () => void;
}

const PRESETS = [
  { label: 'Last 7 days',  days: 7  },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Custom',       days: 0  },
] as const;

function toLocalDatetimeValue(d: Date): string {
  // datetime-local input expects "YYYY-MM-DDTHH:mm"
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportModal({ systemId, systemName, sensors, onClose }: Props) {
  const now   = new Date();
  const [preset, setPreset]       = useState<number>(7);
  const [customStart, setCustomStart] = useState(toLocalDatetimeValue(startOfDay(subDays(now, 7))));
  const [customEnd,   setCustomEnd]   = useState(toLocalDatetimeValue(endOfDay(now)));
  const [format, setFormat]       = useState<'pdf' | 'csv'>('pdf');
  const [deviceId, setDeviceId]   = useState<string>('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  function getRange(): { start: string; end: string } {
    if (preset === 0) {
      return { start: new Date(customStart).toISOString(), end: new Date(customEnd).toISOString() };
    }
    return {
      start: startOfDay(subDays(now, preset)).toISOString(),
      end:   endOfDay(now).toISOString(),
    };
  }

  async function handleDownload() {
    setError(null);
    setLoading(true);
    try {
      const { start, end } = getRange();
      const result = await api.downloadComplianceReport({
        system_id: systemId,
        start,
        end,
        format,
        device_id: deviceId || undefined,
      });
      triggerDownload(result.blob, result.filename);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-cold-900 border border-cold-700/40 rounded-xl shadow-2xl w-full max-w-md">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cold-700/30">
          <div>
            <h3 className="text-lg font-semibold text-white">Export Compliance Report</h3>
            <p className="text-xs text-cold-400 mt-0.5">{systemName}</p>
          </div>
          <button onClick={onClose} className="text-cold-400 hover:text-white transition-colors p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">

          {/* Format */}
          <div>
            <label className="block text-xs font-medium text-cold-400 uppercase tracking-wider mb-2">
              Format
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setFormat('pdf')}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors text-left ${
                  format === 'pdf'
                    ? 'border-cold-500 bg-cold-800 text-white'
                    : 'border-cold-700/40 text-cold-400 hover:border-cold-600 hover:text-cold-200'
                }`}
              >
                <FileText className="w-5 h-5 flex-shrink-0" />
                <div>
                  <div className="text-sm font-medium">PDF</div>
                  <div className="text-xs text-cold-500">Formatted report</div>
                </div>
              </button>
              <button
                onClick={() => setFormat('csv')}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors text-left ${
                  format === 'csv'
                    ? 'border-cold-500 bg-cold-800 text-white'
                    : 'border-cold-700/40 text-cold-400 hover:border-cold-600 hover:text-cold-200'
                }`}
              >
                <FileSpreadsheet className="w-5 h-5 flex-shrink-0" />
                <div>
                  <div className="text-sm font-medium">CSV</div>
                  <div className="text-xs text-cold-500">Hourly data + excursions</div>
                </div>
              </button>
            </div>
          </div>

          {/* Date range */}
          <div>
            <label className="block text-xs font-medium text-cold-400 uppercase tracking-wider mb-2">
              Date Range
            </label>
            <div className="flex gap-2 mb-3 flex-wrap">
              {PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => setPreset(p.days)}
                  className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                    preset === p.days
                      ? 'bg-cold-600 text-white'
                      : 'text-cold-400 hover:text-white hover:bg-cold-700/50 border border-cold-700/40'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {preset === 0 && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-cold-500 mb-1 block">From</label>
                  <input
                    type="datetime-local"
                    value={customStart}
                    onChange={e => setCustomStart(e.target.value)}
                    className="form-input text-sm py-1.5 w-full"
                  />
                </div>
                <div>
                  <label className="text-xs text-cold-500 mb-1 block">To</label>
                  <input
                    type="datetime-local"
                    value={customEnd}
                    onChange={e => setCustomEnd(e.target.value)}
                    className="form-input text-sm py-1.5 w-full"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Sensor filter */}
          {sensors.length > 1 && (
            <div>
              <label className="block text-xs font-medium text-cold-400 uppercase tracking-wider mb-2">
                Sensor
              </label>
              <select
                value={deviceId}
                onChange={e => setDeviceId(e.target.value)}
                className="form-select text-sm w-full"
              >
                <option value="">All sensors</option>
                {sensors.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}

          {error && (
            <p className="text-alert-critical text-sm">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-cold-700/30">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={handleDownload}
            disabled={loading}
            className="btn-primary flex items-center gap-2"
          >
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
              : <><Download className="w-4 h-4" /> Download {format.toUpperCase()}</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

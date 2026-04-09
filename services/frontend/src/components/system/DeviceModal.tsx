import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, type DeviceCreate } from '../../api/client';

interface Props {
  systemId: string;
  onClose: () => void;
}

function isHex(s: string, len: number) {
  return s.length === len && /^[0-9a-fA-F]+$/.test(s);
}

export function DeviceModal({ systemId, onClose }: Props) {
  const qc = useQueryClient();

  const [form, setForm] = useState({
    name:              '',
    dev_eui:           '',
    device_type:       'sensor' as 'sensor' | 'gateway',
    manufacturer:      '',
    model:             '',
    description:       '',
    device_profile_id: '',
    app_eui:           '',
    app_key:           '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: profiles } = useQuery({
    queryKey: ['deviceProfiles'],
    queryFn: api.getDeviceProfiles,
  });

  const mutation = useMutation({
    mutationFn: (data: DeviceCreate) => api.createDevice(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devices', systemId] });
      qc.invalidateQueries({ queryKey: ['system', systemId] });
      qc.invalidateQueries({ queryKey: ['systemSummary'] });
      onClose();
    },
  });

  function field(key: keyof typeof form, value: string) {
    setForm(f => ({ ...f, [key]: value }));
    setErrors(e => { const n = { ...e }; delete n[key]; return n; });
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Required';
    if (!form.dev_eui.trim()) {
      e.dev_eui = 'Required';
    } else if (!isHex(form.dev_eui.trim(), 16)) {
      e.dev_eui = 'Must be exactly 16 hex characters';
    }
    if (form.app_eui && !isHex(form.app_eui.trim(), 16)) {
      e.app_eui = 'Must be exactly 16 hex characters';
    }
    if (form.app_key && !isHex(form.app_key.trim(), 32)) {
      e.app_key = 'Must be exactly 32 hex characters';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const isSensor = form.device_type === 'sensor';
    mutation.mutate({
      system_id:         systemId,
      dev_eui:           form.dev_eui.trim().toLowerCase(),
      device_type:       form.device_type,
      name:              form.name.trim(),
      manufacturer:      form.manufacturer.trim() || null,
      model:             form.model.trim() || null,
      description:       form.description.trim() || null,
      device_profile_id: isSensor && form.device_profile_id ? form.device_profile_id : null,
      app_eui:           isSensor && form.app_eui ? form.app_eui.trim().toLowerCase() : null,
      app_key:           isSensor && form.app_key ? form.app_key.trim().toLowerCase() : null,
    });
  }

  const isSensor = form.device_type === 'sensor';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-cold-900 border border-cold-700/40 rounded-xl shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cold-700/30">
          <h2 className="text-lg font-semibold text-white">Register Device</h2>
          <button onClick={onClose} className="text-cold-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
          {/* Device type */}
          <div>
            <label className="block text-xs font-medium text-cold-300 mb-1">Device Type</label>
            <select
              value={form.device_type}
              onChange={e => field('device_type', e.target.value as 'sensor' | 'gateway')}
              className="form-select w-full"
            >
              <option value="sensor">Sensor</option>
              <option value="gateway">Gateway</option>
            </select>
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-cold-300 mb-1">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => field('name', e.target.value)}
              placeholder="e.g. Walk-in Cooler #1"
              className="form-input w-full"
            />
            {errors.name && <p className="form-error">{errors.name}</p>}
          </div>

          {/* DevEUI */}
          <div>
            <label className="block text-xs font-medium text-cold-300 mb-1">
              DevEUI <span className="text-cold-500">(16 hex characters, no separators)</span>
            </label>
            <input
              type="text"
              value={form.dev_eui}
              onChange={e => field('dev_eui', e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 16))}
              placeholder="A1B2C3D4E5F60001"
              className="form-input w-full font-mono"
              maxLength={16}
            />
            {errors.dev_eui && <p className="form-error">{errors.dev_eui}</p>}
          </div>

          {/* Manufacturer / Model */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-cold-300 mb-1">
                Manufacturer <span className="text-cold-500">(optional)</span>
              </label>
              <input
                type="text"
                value={form.manufacturer}
                onChange={e => field('manufacturer', e.target.value)}
                placeholder="e.g. Ezurio"
                className="form-input w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-cold-300 mb-1">
                Model <span className="text-cold-500">(optional)</span>
              </label>
              <input
                type="text"
                value={form.model}
                onChange={e => field('model', e.target.value)}
                placeholder="e.g. RS2621"
                className="form-input w-full"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-cold-300 mb-1">
              Description <span className="text-cold-500">(optional)</span>
            </label>
            <input
              type="text"
              value={form.description}
              onChange={e => field('description', e.target.value)}
              placeholder="Brief description"
              className="form-input w-full"
            />
          </div>

          {/* Sensor-only: LoRaWAN OTAA fields */}
          {isSensor && (
            <>
              <hr className="border-cold-700/30" />
              <p className="text-xs font-medium text-cold-400 uppercase tracking-wide">LoRaWAN OTAA</p>

              {/* Device profile */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-cold-300">
                    Device Profile <span className="text-cold-500">(optional)</span>
                  </label>
                  <Link
                    to="/profiles"
                    onClick={onClose}
                    className="text-xs text-cold-400 hover:text-cold-200 flex items-center gap-1"
                  >
                    Manage profiles <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
                <select
                  value={form.device_profile_id}
                  onChange={e => field('device_profile_id', e.target.value)}
                  className="form-select w-full"
                >
                  <option value="">— No profile (coldchain DB only) —</option>
                  {profiles?.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.region} · {p.mac_version.replace('LORAWAN_', 'LoRaWAN ')})
                    </option>
                  ))}
                </select>
                {profiles?.length === 0 && (
                  <p className="text-xs text-cold-500 mt-1">
                    No profiles yet.{' '}
                    <Link to="/profiles" onClick={onClose} className="text-cold-300 hover:text-white underline">
                      Create one first
                    </Link>{' '}
                    to register this sensor in ChirpStack.
                  </p>
                )}
              </div>

              {/* AppEUI */}
              <div>
                <label className="block text-xs font-medium text-cold-300 mb-1">
                  AppEUI / JoinEUI <span className="text-cold-500">(optional, 16 hex chars)</span>
                </label>
                <input
                  type="text"
                  value={form.app_eui}
                  onChange={e => field('app_eui', e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 16))}
                  placeholder="0000000000000000"
                  className="form-input w-full font-mono"
                  maxLength={16}
                />
                {errors.app_eui && <p className="form-error">{errors.app_eui}</p>}
              </div>

              {/* AppKey */}
              <div>
                <label className="block text-xs font-medium text-cold-300 mb-1">
                  AppKey <span className="text-cold-500">(optional, 32 hex chars)</span>
                </label>
                <input
                  type="text"
                  value={form.app_key}
                  onChange={e => field('app_key', e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 32))}
                  placeholder="00000000000000000000000000000000"
                  className="form-input w-full font-mono text-sm"
                  maxLength={32}
                />
                {errors.app_key && <p className="form-error">{errors.app_key}</p>}
                <p className="text-xs text-cold-500 mt-1">
                  Leave blank to set keys manually in ChirpStack later.
                </p>
              </div>
            </>
          )}

          {mutation.error && (
            <p className="text-sm text-alert-critical bg-alert-critical/10 border border-alert-critical/20 rounded-lg px-3 py-2">
              {(mutation.error as Error).message}
            </p>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-cold-700/30">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={mutation.isPending} className="btn-primary">
            {mutation.isPending ? 'Registering…' : 'Register Device'}
          </button>
        </div>
      </div>
    </div>
  );
}

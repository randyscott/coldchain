import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, X, Cpu } from 'lucide-react';
import { api, type DeviceProfileCreate } from '../api/client';
import { useAuth } from '../hooks/useAuth';

const REGIONS = [
  { value: 'EU868',   label: 'EU868 (Europe 868 MHz)' },
  { value: 'US915',   label: 'US915 (US 915 MHz)' },
  { value: 'AU915',   label: 'AU915 (Australia 915 MHz)' },
  { value: 'AS923',   label: 'AS923 (Asia 923 MHz)' },
  { value: 'KR920',   label: 'KR920 (Korea 920 MHz)' },
  { value: 'IN865',   label: 'IN865 (India 865 MHz)' },
  { value: 'RU864',   label: 'RU864 (Russia 864 MHz)' },
  { value: 'CN470',   label: 'CN470 (China 470 MHz)' },
  { value: 'ISM2400', label: 'ISM2400 (2.4 GHz)' },
];

const MAC_VERSIONS = [
  { value: 'LORAWAN_1_0_3', label: 'LoRaWAN 1.0.3 (recommended)' },
  { value: 'LORAWAN_1_0_4', label: 'LoRaWAN 1.0.4' },
  { value: 'LORAWAN_1_1_0', label: 'LoRaWAN 1.1.0' },
  { value: 'LORAWAN_1_0_2', label: 'LoRaWAN 1.0.2' },
  { value: 'LORAWAN_1_0_1', label: 'LoRaWAN 1.0.1' },
  { value: 'LORAWAN_1_0_0', label: 'LoRaWAN 1.0.0' },
];

const REG_PARAMS = [
  { value: 'RP002_1_0_3', label: 'RP002-1.0.3 (recommended)' },
  { value: 'RP002_1_0_4', label: 'RP002-1.0.4' },
  { value: 'RP002_1_0_5', label: 'RP002-1.0.5' },
  { value: 'RP002_1_0_2', label: 'RP002-1.0.2' },
  { value: 'RP002_1_0_1', label: 'RP002-1.0.1' },
  { value: 'RP002_1_0_0', label: 'RP002-1.0.0' },
  { value: 'A',            label: 'Revision A' },
  { value: 'B',            label: 'Revision B' },
];

interface ProfileModalProps {
  onClose: () => void;
}

function ProfileModal({ onClose }: ProfileModalProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name:                    '',
    description:             '',
    region:                  'EU868',
    mac_version:             'LORAWAN_1_0_3',
    reg_params_revision:     'RP002_1_0_3',
    supports_otaa:           true,
    supports_class_b:        false,
    supports_class_c:        false,
    uplink_interval:         '3600',
    flush_queue_on_activate: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: (data: DeviceProfileCreate) => api.createDeviceProfile(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deviceProfiles'] });
      onClose();
    },
  });

  function field(key: keyof typeof form, value: string | boolean) {
    setForm(f => ({ ...f, [key]: value }));
    setErrors(e => { const n = { ...e }; delete n[key as string]; return n; });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'Required';
    if (isNaN(Number(form.uplink_interval)) || Number(form.uplink_interval) < 0)
      errs.uplink_interval = 'Must be a non-negative number';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    mutation.mutate({
      name:                    form.name.trim(),
      description:             form.description.trim() || null,
      region:                  form.region,
      mac_version:             form.mac_version,
      reg_params_revision:     form.reg_params_revision,
      supports_otaa:           form.supports_otaa,
      supports_class_b:        form.supports_class_b,
      supports_class_c:        form.supports_class_c,
      uplink_interval:         Number(form.uplink_interval),
      flush_queue_on_activate: form.flush_queue_on_activate,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-cold-900 border border-cold-700/40 rounded-xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-cold-700/30">
          <h2 className="text-lg font-semibold text-white">New Device Profile</h2>
          <button onClick={onClose} className="text-cold-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-cold-300 mb-1">Profile Name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => field('name', e.target.value)}
              placeholder="e.g. Ezurio RS2621 EU868"
              className="form-input w-full"
            />
            {errors.name && <p className="form-error">{errors.name}</p>}
          </div>

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

          <div>
            <label className="block text-xs font-medium text-cold-300 mb-1">Region</label>
            <select value={form.region} onChange={e => field('region', e.target.value)} className="form-select w-full">
              {REGIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-cold-300 mb-1">MAC Version</label>
              <select value={form.mac_version} onChange={e => field('mac_version', e.target.value)} className="form-select w-full">
                {MAC_VERSIONS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-cold-300 mb-1">Regional Parameters</label>
              <select value={form.reg_params_revision} onChange={e => field('reg_params_revision', e.target.value)} className="form-select w-full">
                {REG_PARAMS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-cold-300 mb-1">
              Uplink Interval (seconds)
            </label>
            <input
              type="number"
              min="0"
              step="1"
              value={form.uplink_interval}
              onChange={e => field('uplink_interval', e.target.value)}
              placeholder="3600"
              className="form-input w-full"
            />
            {errors.uplink_interval && <p className="form-error">{errors.uplink_interval}</p>}
          </div>

          <div className="flex flex-wrap gap-5">
            {(
              [
                ['supports_otaa',           'OTAA'],
                ['supports_class_b',        'Class B'],
                ['supports_class_c',        'Class C'],
                ['flush_queue_on_activate', 'Flush queue on activate'],
              ] as [keyof typeof form, string][]
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-cold-200 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={!!form[key]}
                  onChange={e => field(key, e.target.checked)}
                  className="w-4 h-4 rounded border-cold-600 bg-cold-800 accent-cold-400"
                />
                {label}
              </label>
            ))}
          </div>

          {mutation.error && (
            <p className="text-sm text-alert-critical bg-alert-critical/10 border border-alert-critical/20 rounded-lg px-3 py-2">
              {(mutation.error as Error).message}
            </p>
          )}
        </form>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-cold-700/30">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleSubmit} disabled={mutation.isPending} className="btn-primary">
            {mutation.isPending ? 'Creating…' : 'Create Profile'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DeviceProfilesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: profiles, isLoading, error } = useQuery({
    queryKey: ['deviceProfiles'],
    queryFn: api.getDeviceProfiles,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteDeviceProfile(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deviceProfiles'] });
      setDeletingId(null);
    },
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-cold-400">Loading profiles…</div>;
  }

  if (error) {
    return (
      <div className="card p-6 text-center">
        <p className="text-alert-critical">Failed to load device profiles: {(error as Error).message}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-semibold text-white">Device Profiles</h2>
          <p className="text-cold-300/70 text-sm mt-1">
            LoRaWAN device profiles define MAC version, region, and class support.
            Assign a profile when registering a sensor.
          </p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            New Profile
          </button>
        )}
      </div>

      {profiles && profiles.length > 0 ? (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-cold-700/30">
                <th className="px-5 py-3 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">Name</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">Region</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">MAC Version</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">Reg Params</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">Features</th>
                {isAdmin && <th className="px-5 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-cold-700/20">
              {profiles.map(p => (
                <tr key={p.id} className="hover:bg-cold-800/20">
                  <td className="px-5 py-4">
                    <div className="font-medium text-white">{p.name}</div>
                    {p.description && <div className="text-xs text-cold-400 mt-0.5">{p.description}</div>}
                  </td>
                  <td className="px-5 py-4 text-cold-200 font-mono text-xs">{p.region}</td>
                  <td className="px-5 py-4 text-cold-200 text-xs">
                    {p.mac_version.replace('LORAWAN_', 'LoRaWAN ').replace(/_/g, '.')}
                  </td>
                  <td className="px-5 py-4 text-cold-200 text-xs">
                    {p.reg_params_revision.replace('RP002_', 'RP002-').replace(/_/g, '.')}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap gap-1">
                      {p.supports_otaa && (
                        <span className="px-1.5 py-0.5 rounded text-xs bg-cold-700/40 text-cold-300">OTAA</span>
                      )}
                      {p.supports_class_b && (
                        <span className="px-1.5 py-0.5 rounded text-xs bg-cold-700/40 text-cold-300">Class B</span>
                      )}
                      {p.supports_class_c && (
                        <span className="px-1.5 py-0.5 rounded text-xs bg-cold-700/40 text-cold-300">Class C</span>
                      )}
                    </div>
                  </td>
                  {isAdmin && (
                    <td className="px-5 py-4 text-right">
                      {deletingId === p.id ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-cold-400">Delete?</span>
                          <button
                            onClick={() => deleteMutation.mutate(p.id)}
                            disabled={deleteMutation.isPending}
                            className="text-xs text-alert-critical hover:text-red-300 font-medium"
                          >
                            {deleteMutation.isPending ? 'Deleting…' : 'Yes'}
                          </button>
                          <button
                            onClick={() => setDeletingId(null)}
                            className="text-xs text-cold-400 hover:text-white"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeletingId(p.id)}
                          className="text-cold-500 hover:text-alert-critical transition-colors"
                          title="Delete profile"
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
        <div className="card p-12 text-center">
          <Cpu className="w-12 h-12 text-cold-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-cold-200 mb-2">No device profiles yet</h3>
          <p className="text-cold-400 text-sm mb-6">
            Create a profile to define the LoRaWAN parameters for your sensors.
          </p>
          {isAdmin && (
            <button onClick={() => setShowModal(true)} className="btn-primary inline-flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Create First Profile
            </button>
          )}
        </div>
      )}

      {showModal && <ProfileModal onClose={() => setShowModal(false)} />}
    </div>
  );
}

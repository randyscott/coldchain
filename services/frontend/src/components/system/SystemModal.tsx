import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api, type System, type SystemCreate, type SystemUpdate } from '../../api/client';

interface Props {
  system?: System;   // provided = edit mode
  onClose: () => void;
}

const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Anchorage', 'Pacific/Honolulu', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'Europe/Helsinki', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Kolkata', 'Australia/Sydney',
];

export function SystemModal({ system, onClose }: Props) {
  const isEditing = !!system;
  const qc = useQueryClient();

  const [form, setForm] = useState({
    name:        system?.name ?? '',
    description: system?.description ?? '',
    system_type: system?.system_type ?? 'fixed',
    address:     system?.address ?? '',
    latitude:    system?.latitude?.toString() ?? '',
    longitude:   system?.longitude?.toString() ?? '',
    timezone:    system?.timezone ?? 'UTC',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const createMutation = useMutation({
    mutationFn: (data: SystemCreate) => api.createSystem(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['systemSummary'] });
      qc.invalidateQueries({ queryKey: ['systems'] });
      onClose();
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: SystemUpdate) => api.updateSystem(system!.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['systemSummary'] });
      qc.invalidateQueries({ queryKey: ['systems'] });
      qc.invalidateQueries({ queryKey: ['system', system!.id] });
      onClose();
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;
  const mutationError = createMutation.error ?? updateMutation.error;

  function field(key: keyof typeof form, value: string) {
    setForm(f => ({ ...f, [key]: value }));
    setErrors(e => { const n = { ...e }; delete n[key]; return n; });
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Required';
    if (form.latitude && isNaN(Number(form.latitude))) e.latitude = 'Must be a number';
    if (form.longitude && isNaN(Number(form.longitude))) e.longitude = 'Must be a number';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const lat = form.latitude ? Number(form.latitude) : null;
    const lon = form.longitude ? Number(form.longitude) : null;

    if (isEditing) {
      updateMutation.mutate({
        name:        form.name.trim(),
        description: form.description.trim() || null,
        address:     form.address.trim() || null,
        latitude:    lat,
        longitude:   lon,
        timezone:    form.timezone,
      });
    } else {
      createMutation.mutate({
        name:        form.name.trim(),
        description: form.description.trim() || null,
        system_type: form.system_type as 'fixed' | 'transport',
        address:     form.address.trim() || null,
        latitude:    lat,
        longitude:   lon,
        timezone:    form.timezone,
      });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-cold-900 border border-cold-700/40 rounded-xl shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cold-700/30">
          <h2 className="text-lg font-semibold text-white">
            {isEditing ? 'Edit System' : 'New System'}
          </h2>
          <button onClick={onClose} className="text-cold-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-cold-300 mb-1">System Name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => field('name', e.target.value)}
              placeholder="e.g. Main Warehouse"
              className="form-input w-full"
            />
            {errors.name && <p className="form-error">{errors.name}</p>}
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

          {/* System type (locked in edit mode) */}
          <div>
            <label className="block text-xs font-medium text-cold-300 mb-1">System Type</label>
            <select
              value={form.system_type}
              onChange={e => field('system_type', e.target.value)}
              disabled={isEditing}
              className="form-select w-full"
            >
              <option value="fixed">Fixed Location (warehouse, cooler room)</option>
              <option value="transport">Transport (refrigerated truck, van)</option>
            </select>
          </div>

          {/* Address */}
          <div>
            <label className="block text-xs font-medium text-cold-300 mb-1">
              Address <span className="text-cold-500">(optional)</span>
            </label>
            <input
              type="text"
              value={form.address}
              onChange={e => field('address', e.target.value)}
              placeholder="123 Industrial Blvd, Madison, WI"
              className="form-input w-full"
            />
          </div>

          {/* Lat / Lon */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-cold-300 mb-1">
                Latitude <span className="text-cold-500">(optional)</span>
              </label>
              <input
                type="number"
                step="any"
                value={form.latitude}
                onChange={e => field('latitude', e.target.value)}
                placeholder="43.0731"
                className="form-input w-full"
              />
              {errors.latitude && <p className="form-error">{errors.latitude}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-cold-300 mb-1">
                Longitude <span className="text-cold-500">(optional)</span>
              </label>
              <input
                type="number"
                step="any"
                value={form.longitude}
                onChange={e => field('longitude', e.target.value)}
                placeholder="-89.4012"
                className="form-input w-full"
              />
              {errors.longitude && <p className="form-error">{errors.longitude}</p>}
            </div>
          </div>

          {/* Timezone */}
          <div>
            <label className="block text-xs font-medium text-cold-300 mb-1">Timezone</label>
            <select
              value={form.timezone}
              onChange={e => field('timezone', e.target.value)}
              className="form-select w-full"
            >
              {TIMEZONES.map(tz => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>

          {mutationError && (
            <p className="text-sm text-alert-critical bg-alert-critical/10 border border-alert-critical/20 rounded-lg px-3 py-2">
              {(mutationError as Error).message}
            </p>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-cold-700/30">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={isPending} className="btn-primary">
            {isPending ? 'Saving…' : isEditing ? 'Save Changes' : 'Create System'}
          </button>
        </div>
      </div>
    </div>
  );
}

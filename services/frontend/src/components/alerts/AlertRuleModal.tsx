import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api, type AlertRule, type AlertRuleCreate } from '../../api/client';

interface Props {
  systemId?: string;   // pre-select system when opened from a system page
  rule?: AlertRule;    // if provided, we're editing; otherwise creating
  onClose: () => void;
}

const RULE_TYPES = [
  { value: 'threshold', label: 'Threshold' },
  { value: 'duration',  label: 'Duration (sustained breach)' },
  { value: 'connectivity', label: 'Connectivity (sensor offline)' },
  { value: 'battery',   label: 'Battery voltage' },
] as const;

const METRICS = [
  { value: 'temperature',     label: 'Temperature (°C)' },
  { value: 'humidity',        label: 'Humidity (%)' },
  { value: 'battery_voltage', label: 'Battery voltage (V)' },
] as const;

const OPERATORS = [
  { value: 'gt',  label: '> (greater than)' },
  { value: 'gte', label: '≥ (greater than or equal)' },
  { value: 'lt',  label: '< (less than)' },
  { value: 'lte', label: '≤ (less than or equal)' },
] as const;

const NOTIFY_OPTIONS = ['email', 'sms', 'webhook'] as const;

const isConnectivity = (type: string) => type === 'connectivity';

export function AlertRuleModal({ systemId, rule, onClose }: Props) {
  const isEditing = !!rule;
  const qc = useQueryClient();

  // Form state
  const [selectedSystemId, setSelectedSystemId] = useState(
    rule?.system_id ?? systemId ?? ''
  );
  const [form, setForm] = useState({
    device_id:         rule?.device_id ?? '',
    name:              rule?.name ?? '',
    description:       rule?.description ?? '',
    rule_type:         rule?.rule_type ?? 'threshold',
    metric:            rule?.metric ?? 'temperature',
    operator:          rule?.operator ?? 'gt',
    threshold_value:   rule?.threshold_value?.toString() ?? '',
    duration_seconds:  rule?.duration_seconds?.toString() ?? '0',
    silence_seconds:   '',
    escalation_minutes: rule?.escalation_minutes?.toString() ?? '',
    notify_email:      rule?.notify_channels?.includes('email') ?? true,
    notify_sms:        rule?.notify_channels?.includes('sms') ?? false,
    notify_webhook:    rule?.notify_channels?.includes('webhook') ?? false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: systems } = useQuery({
    queryKey: ['systems'],
    queryFn: api.getSystems,
  });

  const { data: devices } = useQuery({
    queryKey: ['devices', selectedSystemId],
    queryFn: () => api.getDevices({ system_id: selectedSystemId, device_type: 'sensor' }),
    enabled: !!selectedSystemId,
  });

  // Auto-populate name when rule type or metric changes (create mode only)
  useEffect(() => {
    if (isEditing) return;
    if (form.name) return;
    const metricLabel = METRICS.find(m => m.value === form.metric)?.label.split(' ')[0] ?? '';
    const typeLabel   = RULE_TYPES.find(t => t.value === form.rule_type)?.label ?? '';
    if (isConnectivity(form.rule_type)) {
      setForm(f => ({ ...f, name: 'Sensor Offline' }));
    } else {
      setForm(f => ({ ...f, name: `${metricLabel} ${typeLabel}` }));
    }
  }, [form.rule_type, form.metric, isEditing]); // eslint-disable-line react-hooks/exhaustive-deps

  const createMutation = useMutation({
    mutationFn: (data: AlertRuleCreate) => api.createAlertRule(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alertRules'] });
      onClose();
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: Parameters<typeof api.updateAlertRule>[1]) =>
      api.updateAlertRule(rule!.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alertRules'] });
      onClose();
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;
  const mutationError = createMutation.error ?? updateMutation.error;

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!selectedSystemId) e.system_id = 'Required';
    if (!form.name.trim()) e.name = 'Required';
    if (!isConnectivity(form.rule_type)) {
      if (form.threshold_value === '') e.threshold_value = 'Required';
      else if (isNaN(Number(form.threshold_value))) e.threshold_value = 'Must be a number';
    }
    if (form.duration_seconds !== '' && isNaN(Number(form.duration_seconds)))
      e.duration_seconds = 'Must be a number';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const notify_channels = NOTIFY_OPTIONS.filter(
      ch => form[`notify_${ch}` as keyof typeof form]
    );

    if (isEditing) {
      updateMutation.mutate({
        name:               form.name.trim(),
        description:        form.description.trim() || null,
        threshold_value:    isConnectivity(form.rule_type) ? undefined : Number(form.threshold_value),
        duration_seconds:   form.duration_seconds ? Number(form.duration_seconds) : undefined,
        notify_channels,
        escalation_minutes: form.escalation_minutes ? Number(form.escalation_minutes) : null,
      });
    } else {
      createMutation.mutate({
        system_id:          selectedSystemId,
        device_id:          form.device_id || null,
        name:               form.name.trim(),
        description:        form.description.trim() || null,
        rule_type:          form.rule_type as AlertRule['rule_type'],
        metric:             form.metric as AlertRule['metric'],
        operator:           form.operator as AlertRule['operator'],
        threshold_value:    isConnectivity(form.rule_type) ? 0 : Number(form.threshold_value),
        duration_seconds:   form.duration_seconds ? Number(form.duration_seconds) : 0,
        silence_seconds:    form.silence_seconds ? Number(form.silence_seconds) : null,
        notify_channels,
        escalation_minutes: form.escalation_minutes ? Number(form.escalation_minutes) : null,
      });
    }
  }

  function field(key: keyof typeof form, value: string) {
    setForm(f => ({ ...f, [key]: value }));
    setErrors(e => { const n = { ...e }; delete n[key]; return n; });
  }

  const connectivity = isConnectivity(form.rule_type);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-cold-900 border border-cold-700/40 rounded-xl shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cold-700/30">
          <h2 className="text-lg font-semibold text-white">
            {isEditing ? 'Edit Alert Rule' : 'New Alert Rule'}
          </h2>
          <button onClick={onClose} className="text-cold-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-5 space-y-4">

          {/* System */}
          <div>
            <label className="block text-xs font-medium text-cold-300 mb-1">System</label>
            <select
              value={selectedSystemId}
              onChange={e => { setSelectedSystemId(e.target.value); field('device_id', ''); }}
              disabled={isEditing}
              className="form-select w-full"
            >
              <option value="">Select a system…</option>
              {systems?.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {errors.system_id && <p className="form-error">{errors.system_id}</p>}
          </div>

          {/* Device (optional) */}
          {!isEditing && (
            <div>
              <label className="block text-xs font-medium text-cold-300 mb-1">
                Device <span className="text-cold-500">(optional — leave blank to apply to all sensors)</span>
              </label>
              <select
                value={form.device_id}
                onChange={e => field('device_id', e.target.value)}
                disabled={!selectedSystemId}
                className="form-select w-full"
              >
                <option value="">All sensors in system</option>
                {devices?.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Rule type */}
          <div>
            <label className="block text-xs font-medium text-cold-300 mb-1">Rule Type</label>
            <select
              value={form.rule_type}
              onChange={e => field('rule_type', e.target.value)}
              disabled={isEditing}
              className="form-select w-full"
            >
              {RULE_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Metric + operator + threshold (hidden for connectivity) */}
          {!connectivity && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-cold-300 mb-1">Metric</label>
                  <select
                    value={form.metric}
                    onChange={e => field('metric', e.target.value)}
                    disabled={isEditing}
                    className="form-select w-full"
                  >
                    {METRICS.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-cold-300 mb-1">Operator</label>
                  <select
                    value={form.operator}
                    onChange={e => field('operator', e.target.value)}
                    disabled={isEditing}
                    className="form-select w-full"
                  >
                    {OPERATORS.map(op => (
                      <option key={op.value} value={op.value}>{op.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-cold-300 mb-1">Threshold Value</label>
                <input
                  type="number"
                  step="any"
                  value={form.threshold_value}
                  onChange={e => field('threshold_value', e.target.value)}
                  placeholder={form.metric === 'temperature' ? 'e.g. 8' : form.metric === 'humidity' ? 'e.g. 85' : 'e.g. 2.5'}
                  className="form-input w-full"
                />
                {errors.threshold_value && <p className="form-error">{errors.threshold_value}</p>}
              </div>
            </>
          )}

          {/* Duration (shown for duration and connectivity rule types) */}
          {(form.rule_type === 'duration' || connectivity) && (
            <div>
              <label className="block text-xs font-medium text-cold-300 mb-1">
                {connectivity ? 'Offline after (seconds without a reading)' : 'Duration (seconds breach must be sustained)'}
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.duration_seconds}
                onChange={e => field('duration_seconds', e.target.value)}
                placeholder="e.g. 1800"
                className="form-input w-full"
              />
              {errors.duration_seconds && <p className="form-error">{errors.duration_seconds}</p>}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-cold-300 mb-1">Rule Name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => field('name', e.target.value)}
              placeholder="e.g. High Temperature Alert"
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
              placeholder="Brief description of this rule"
              className="form-input w-full"
            />
          </div>

          {/* Notify channels */}
          <div>
            <label className="block text-xs font-medium text-cold-300 mb-2">Notify via</label>
            <div className="flex gap-4">
              {NOTIFY_OPTIONS.map(ch => (
                <label key={ch} className="flex items-center gap-2 text-sm text-cold-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!form[`notify_${ch}` as keyof typeof form]}
                    onChange={e => setForm(f => ({ ...f, [`notify_${ch}`]: e.target.checked }))}
                    className="w-4 h-4 rounded border-cold-600 bg-cold-800 accent-cold-400"
                  />
                  {ch.charAt(0).toUpperCase() + ch.slice(1)}
                </label>
              ))}
            </div>
          </div>

          {/* Escalation */}
          <div>
            <label className="block text-xs font-medium text-cold-300 mb-1">
              Escalation <span className="text-cold-500">(minutes before re-notifying — optional)</span>
            </label>
            <input
              type="number"
              min="1"
              step="1"
              value={form.escalation_minutes}
              onChange={e => field('escalation_minutes', e.target.value)}
              placeholder="e.g. 30"
              className="form-input w-full"
            />
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
          <button
            type="submit"
            form="rule-form"
            onClick={handleSubmit}
            disabled={isPending}
            className="btn-primary"
          >
            {isPending ? 'Saving…' : isEditing ? 'Save Changes' : 'Create Rule'}
          </button>
        </div>
      </div>
    </div>
  );
}

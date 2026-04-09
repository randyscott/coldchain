import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, ShieldAlert } from 'lucide-react';
import { api, type AlertRule } from '../api/client';
import { AlertRuleModal } from '../components/alerts/AlertRuleModal';
import { useAuth } from '../hooks/useAuth';

// ─── helpers ────────────────────────────────────────────────────────────────

function ruleConditionLabel(rule: AlertRule): string {
  if (rule.rule_type === 'connectivity') {
    const mins = rule.duration_seconds ? Math.round(rule.duration_seconds / 60) : 30;
    return `No reading for ${mins} min`;
  }
  if (rule.rule_type === 'battery') {
    const opLabel = { gt: '>', gte: '≥', lt: '<', lte: '≤' }[rule.operator];
    return `Battery ${opLabel} ${rule.threshold_value}V`;
  }
  const metric = { temperature: 'Temp', humidity: 'Humidity', battery_voltage: 'Battery' }[rule.metric] ?? rule.metric;
  const opLabel = { gt: '>', gte: '≥', lt: '<', lte: '≤' }[rule.operator];
  const suffix  = { temperature: '°C', humidity: '%', battery_voltage: 'V' }[rule.metric] ?? '';
  const base = `${metric} ${opLabel} ${rule.threshold_value}${suffix}`;
  if (rule.rule_type === 'duration' && rule.duration_seconds > 0) {
    const mins = Math.round(rule.duration_seconds / 60);
    return `${base} for ${mins > 0 ? `${mins}m` : `${rule.duration_seconds}s`}`;
  }
  return base;
}

function ruleTypeLabel(type: string): string {
  return {
    threshold:      'Threshold',
    duration:       'Duration',
    rate_of_change: 'Rate of Change',
    connectivity:   'Connectivity',
    battery:        'Battery',
  }[type] ?? type;
}

// ─── Delete confirmation ─────────────────────────────────────────────────────

function DeleteConfirm({ rule, onConfirm, onCancel, isPending }: {
  rule: AlertRule;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm bg-cold-900 border border-cold-700/40 rounded-xl shadow-2xl p-6">
        <h3 className="text-lg font-semibold text-white mb-2">Delete Rule?</h3>
        <p className="text-sm text-cold-300 mb-1">
          Are you sure you want to delete <span className="text-white font-medium">{rule.name}</span>?
        </p>
        <p className="text-xs text-cold-500 mb-6">This cannot be undone. Any active alerts from this rule will remain in history.</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="btn-secondary">Cancel</button>
          <button onClick={onConfirm} disabled={isPending} className="btn-danger">
            {isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function AlertRulesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canEdit = user?.role === 'admin' || user?.role === 'manager';

  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | undefined>();
  const [deletingRule, setDeletingRule] = useState<AlertRule | undefined>();
  const [filterSystemId, setFilterSystemId] = useState('');

  const { data: rules, isLoading } = useQuery({
    queryKey: ['alertRules', filterSystemId || undefined],
    queryFn: () => api.getAlertRules(filterSystemId || undefined),
    refetchInterval: 30_000,
  });

  const { data: systems } = useQuery({
    queryKey: ['systems'],
    queryFn: api.getSystems,
  });

  const systemNameMap = Object.fromEntries(systems?.map(s => [s.id, s.name]) ?? []);

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.updateAlertRule(id, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alertRules'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteAlertRule(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alertRules'] });
      setDeletingRule(undefined);
    },
  });

  function openCreate() {
    setEditingRule(undefined);
    setModalOpen(true);
  }

  function openEdit(rule: AlertRule) {
    setEditingRule(rule);
    setModalOpen(true);
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <select
            value={filterSystemId}
            onChange={e => setFilterSystemId(e.target.value)}
            className="form-select w-48"
          >
            <option value="">All systems</option>
            {systems?.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {rules && (
            <span className="text-sm text-cold-400">
              {rules.length} rule{rules.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        {canEdit && (
          <button onClick={openCreate} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            New Rule
          </button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48 text-cold-400">Loading rules…</div>
      ) : rules && rules.length > 0 ? (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-cold-700/30">
                <th className="px-5 py-3 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">Name</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">System</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">Type</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">Condition</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">Notify</th>
                {canEdit && (
                  <th className="px-5 py-3 text-right text-xs font-medium text-cold-400 uppercase tracking-wider">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-cold-700/20">
              {rules.map(rule => (
                <tr key={rule.id} className={`hover:bg-cold-800/20 ${!rule.is_active ? 'opacity-50' : ''}`}>
                  <td className="px-5 py-3">
                    {canEdit ? (
                      <button
                        onClick={() => toggleMutation.mutate({ id: rule.id, is_active: !rule.is_active })}
                        title={rule.is_active ? 'Disable rule' : 'Enable rule'}
                        className="text-cold-400 hover:text-white transition-colors"
                      >
                        {rule.is_active
                          ? <ToggleRight className="w-5 h-5 text-alert-ok" />
                          : <ToggleLeft className="w-5 h-5" />
                        }
                      </button>
                    ) : (
                      rule.is_active
                        ? <ToggleRight className="w-5 h-5 text-alert-ok" />
                        : <ToggleLeft className="w-5 h-5 text-cold-600" />
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <div className="font-medium text-white">{rule.name}</div>
                    {rule.description && (
                      <div className="text-xs text-cold-400 mt-0.5">{rule.description}</div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-cold-200">
                    {systemNameMap[rule.system_id] ?? '—'}
                  </td>
                  <td className="px-5 py-3">
                    <span className="px-2 py-0.5 rounded-md bg-cold-800 text-xs text-cold-300 font-medium">
                      {ruleTypeLabel(rule.rule_type)}
                    </span>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-cold-200">
                    {ruleConditionLabel(rule)}
                  </td>
                  <td className="px-5 py-3 text-xs text-cold-400">
                    {rule.notify_channels?.join(', ') || '—'}
                  </td>
                  {canEdit && (
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => openEdit(rule)}
                          title="Edit rule"
                          className="text-cold-400 hover:text-white transition-colors p-1"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeletingRule(rule)}
                          title="Delete rule"
                          className="text-cold-400 hover:text-alert-critical transition-colors p-1"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card p-12 text-center">
          <ShieldAlert className="w-12 h-12 text-cold-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-cold-200 mb-2">No alert rules configured</h3>
          <p className="text-cold-400 text-sm mb-4">
            Alert rules define the conditions that trigger notifications.
          </p>
          {canEdit && (
            <button onClick={openCreate} className="btn-primary inline-flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Create First Rule
            </button>
          )}
        </div>
      )}

      {/* Modals */}
      {modalOpen && (
        <AlertRuleModal
          systemId={filterSystemId || undefined}
          rule={editingRule}
          onClose={() => setModalOpen(false)}
        />
      )}
      {deletingRule && (
        <DeleteConfirm
          rule={deletingRule}
          onConfirm={() => deleteMutation.mutate(deletingRule.id)}
          onCancel={() => setDeletingRule(undefined)}
          isPending={deleteMutation.isPending}
        />
      )}
    </div>
  );
}

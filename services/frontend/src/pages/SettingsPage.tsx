import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings, Pencil, Check, X } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';

function GroupSettings() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [editing, setEditing] = useState(false);
  const [nameValue, setNameValue] = useState('');

  const { data: group, isLoading, error } = useQuery({
    queryKey: ['myGroup'],
    queryFn: api.getMyGroup,
  });

  const mutation = useMutation({
    mutationFn: (name: string) => api.updateMyGroup({ name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['myGroup'] });
      setEditing(false);
    },
  });

  function startEdit() {
    setNameValue(group?.name ?? '');
    setEditing(true);
  }

  function handleSave() {
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === group?.name) { setEditing(false); return; }
    mutation.mutate(trimmed);
  }

  if (isLoading) {
    return <div className="text-cold-400 text-sm">Loading…</div>;
  }

  if (error) {
    return <div className="text-alert-critical text-sm">Failed to load group: {(error as Error).message}</div>;
  }

  return (
    <div className="card p-6 space-y-4">
      <h3 className="text-sm font-semibold text-cold-300 uppercase tracking-wider">Organisation</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
        {/* Name */}
        <div>
          <dt className="text-xs text-cold-500 mb-1">Display name</dt>
          <dd className="flex items-center gap-2">
            {editing ? (
              <>
                <input
                  type="text"
                  value={nameValue}
                  onChange={e => setNameValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false); }}
                  className="form-input text-sm py-1 flex-1"
                  autoFocus
                />
                <button
                  onClick={handleSave}
                  disabled={mutation.isPending}
                  className="p-1.5 text-alert-ok hover:text-green-300 transition-colors"
                  title="Save"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="p-1.5 text-cold-500 hover:text-white transition-colors"
                  title="Cancel"
                >
                  <X className="w-4 h-4" />
                </button>
              </>
            ) : (
              <>
                <span className="text-white font-medium">{group?.name}</span>
                {isAdmin && (
                  <button
                    onClick={startEdit}
                    className="p-1 text-cold-500 hover:text-cold-200 transition-colors"
                    title="Edit name"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </>
            )}
          </dd>
        </div>

        {/* Slug */}
        <div>
          <dt className="text-xs text-cold-500 mb-1">Slug</dt>
          <dd className="text-cold-300 font-mono text-sm">{group?.slug}</dd>
        </div>

        {/* Group ID */}
        <div>
          <dt className="text-xs text-cold-500 mb-1">Group ID</dt>
          <dd className="text-cold-400 font-mono text-xs truncate">{group?.id}</dd>
        </div>

        {/* Created */}
        <div>
          <dt className="text-xs text-cold-500 mb-1">Created</dt>
          <dd className="text-cold-300 text-sm">
            {group?.created_at
              ? new Date(group.created_at).toLocaleDateString(undefined, { dateStyle: 'medium' })
              : '—'}
          </dd>
        </div>
      </div>

      {mutation.isError && (
        <p className="text-alert-critical text-sm">{(mutation.error as Error).message}</p>
      )}
    </div>
  );
}

export function SettingsPage() {
  const { user } = useAuth();

  return (
    <div>
      <div className="flex items-start gap-3 mb-8">
        <Settings className="w-6 h-6 text-cold-400 mt-0.5 flex-shrink-0" />
        <div>
          <h2 className="text-2xl font-semibold text-white">Settings</h2>
          <p className="text-cold-300/70 text-sm mt-1">
            Organisation and account configuration
          </p>
        </div>
      </div>

      <div className="space-y-6 max-w-2xl">
        <GroupSettings />

        {/* Current user info */}
        <div className="card p-6 space-y-4">
          <h3 className="text-sm font-semibold text-cold-300 uppercase tracking-wider">Your account</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
            <div>
              <dt className="text-xs text-cold-500 mb-1">Name</dt>
              <dd className="text-white font-medium">{user?.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-cold-500 mb-1">Role</dt>
              <dd className="text-cold-300 capitalize">{user?.role}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-cold-500 mb-1">Email</dt>
              <dd className="text-cold-300">{user?.email}</dd>
            </div>
          </div>
        </div>

        <p className="text-xs text-cold-500">
          To change your password or email, update them in Keycloak. Changes take effect on your next login.
        </p>
      </div>
    </div>
  );
}

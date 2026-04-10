import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, ShieldCheck, UserX, UserCheck, Pencil, X, Check } from 'lucide-react';
import { api, type TeamUser, type TeamUserUpdate } from '../api/client';
import { useAuth } from '../hooks/useAuth';

const ROLE_META = {
  admin:   { label: 'Admin',   className: 'bg-blue-500/15 text-blue-300 border border-blue-500/25' },
  manager: { label: 'Manager', className: 'bg-amber-500/15 text-amber-300 border border-amber-500/25' },
  viewer:  { label: 'Viewer',  className: 'bg-cold-700/40 text-cold-300 border border-cold-600/30' },
} as const;

function RoleBadge({ role }: { role: TeamUser['role'] }) {
  const meta = ROLE_META[role] ?? ROLE_META.viewer;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${meta.className}`}>
      {meta.label}
    </span>
  );
}

function initials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

interface RowProps {
  member: TeamUser;
  isSelf: boolean;
  isAdmin: boolean;
}

function MemberRow({ member, isSelf, isAdmin }: RowProps) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editRole, setEditRole] = useState<TeamUser['role']>(member.role);
  const [editPhone, setEditPhone] = useState(member.phone ?? '');

  const mutation = useMutation({
    mutationFn: (data: TeamUserUpdate) => api.updateUser(member.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teamUsers'] });
      setEditing(false);
    },
  });

  const toggleActive = useMutation({
    mutationFn: () => api.updateUser(member.id, { is_active: !member.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teamUsers'] }),
  });

  function handleSave() {
    const updates: TeamUserUpdate = {};
    if (editRole !== member.role) updates.role = editRole;
    const newPhone = editPhone.trim() || null;
    if (newPhone !== member.phone) updates.phone = newPhone;
    if (Object.keys(updates).length === 0) { setEditing(false); return; }
    mutation.mutate(updates);
  }

  return (
    <tr className={`hover:bg-cold-800/20 ${!member.is_active ? 'opacity-50' : ''}`}>
      {/* Avatar + name */}
      <td className="px-5 py-4">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0
            ${isSelf ? 'bg-cold-500 text-white' : 'bg-cold-700 text-cold-300'}`}>
            {initials(member.display_name)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-white truncate">{member.display_name}</span>
              {isSelf && <span className="text-xs text-cold-500">(you)</span>}
              {member.is_platform_admin && (
                <ShieldCheck className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" title="Platform admin" />
              )}
            </div>
            <div className="text-xs text-cold-400 truncate">{member.email}</div>
          </div>
        </div>
      </td>

      {/* Role */}
      <td className="px-5 py-4">
        {editing && !isSelf ? (
          <select
            value={editRole}
            onChange={e => setEditRole(e.target.value as TeamUser['role'])}
            className="form-select text-sm py-1"
          >
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="viewer">Viewer</option>
          </select>
        ) : (
          <RoleBadge role={member.role} />
        )}
      </td>

      {/* Phone */}
      <td className="px-5 py-4">
        {editing ? (
          <input
            type="tel"
            value={editPhone}
            onChange={e => setEditPhone(e.target.value)}
            placeholder="+1 555 000 0000"
            className="form-input text-sm py-1 w-40"
          />
        ) : (
          <span className="text-sm text-cold-300">{member.phone ?? <span className="text-cold-600">—</span>}</span>
        )}
      </td>

      {/* Status */}
      <td className="px-5 py-4">
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium
          ${member.is_active ? 'text-alert-ok' : 'text-cold-500'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${member.is_active ? 'bg-alert-ok' : 'bg-cold-600'}`} />
          {member.is_active ? 'Active' : 'Inactive'}
        </span>
      </td>

      {/* Actions */}
      <td className="px-5 py-4 text-right">
        {isAdmin && (
          <div className="flex items-center justify-end gap-1">
            {editing ? (
              <>
                <button
                  onClick={handleSave}
                  disabled={mutation.isPending}
                  className="p-1.5 text-alert-ok hover:text-green-300 transition-colors"
                  title="Save"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  onClick={() => { setEditing(false); setEditRole(member.role); setEditPhone(member.phone ?? ''); }}
                  className="p-1.5 text-cold-500 hover:text-white transition-colors"
                  title="Cancel"
                >
                  <X className="w-4 h-4" />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setEditing(true)}
                  className="p-1.5 text-cold-500 hover:text-cold-200 transition-colors"
                  title="Edit"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                {!isSelf && (
                  <button
                    onClick={() => toggleActive.mutate()}
                    disabled={toggleActive.isPending}
                    className={`p-1.5 transition-colors ${
                      member.is_active
                        ? 'text-cold-500 hover:text-alert-critical'
                        : 'text-cold-500 hover:text-alert-ok'
                    }`}
                    title={member.is_active ? 'Deactivate' : 'Reactivate'}
                  >
                    {member.is_active
                      ? <UserX className="w-4 h-4" />
                      : <UserCheck className="w-4 h-4" />
                    }
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

export function TeamPage() {
  const { user: authUser } = useAuth();
  const isAdmin = authUser?.role === 'admin';

  const { data: members, isLoading, error } = useQuery({
    queryKey: ['teamUsers'],
    queryFn: api.getUsers,
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-cold-400">Loading team…</div>;
  }

  if (error) {
    return (
      <div className="card p-6 text-center">
        <p className="text-alert-critical">Failed to load team: {(error as Error).message}</p>
      </div>
    );
  }

  const active = members?.filter(m => m.is_active).length ?? 0;
  const total  = members?.length ?? 0;

  return (
    <div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <h2 className="text-2xl font-semibold text-white">Team</h2>
          <p className="text-cold-300/70 text-sm mt-1">
            {active} of {total} member{total !== 1 ? 's' : ''} active
          </p>
        </div>
        <button
          disabled
          title="Invite via Keycloak — coming soon"
          className="btn-primary opacity-40 cursor-not-allowed flex items-center gap-2"
        >
          <Users className="w-4 h-4" />
          Invite User
        </button>
      </div>

      {members && members.length > 0 ? (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-cold-700/30">
                <th className="px-5 py-3 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">Member</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">Role</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">Phone</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-cold-400 uppercase tracking-wider">Status</th>
                {isAdmin && <th className="px-5 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-cold-700/20">
              {members.map(member => (
                <MemberRow
                  key={member.id}
                  member={member}
                  isSelf={member.keycloak_id === authUser?.id}
                  isAdmin={isAdmin}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card p-12 text-center">
          <Users className="w-12 h-12 text-cold-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-cold-200 mb-2">No team members yet</h3>
          <p className="text-cold-400 text-sm">
            Users appear here after their first login via Keycloak.
          </p>
        </div>
      )}

      {isAdmin && (
        <p className="text-xs text-cold-500 mt-4">
          To add new users, create them in Keycloak and assign the <code className="text-cold-400">coldchain-scope</code> client scope with the correct <code className="text-cold-400">group_id</code> and <code className="text-cold-400">role</code> claims.
          They will appear here automatically after their first login.
        </p>
      )}
    </div>
  );
}

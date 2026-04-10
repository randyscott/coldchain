import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { api, setAsGroup, getAsGroup } from '../../api/client';

/**
 * Group switcher for platform admins.
 * Renders a <select> showing all groups. Choosing one stores the group ID
 * via setAsGroup() (which adds X-As-Group to every subsequent API request)
 * and flushes the React Query cache so all data reloads in the new context.
 */
export function GroupSwitcher() {
  const qc = useQueryClient();

  const { data: groups } = useQuery({
    queryKey: ['adminGroups'],
    queryFn: api.getAllGroups,
    staleTime: 60_000,
  });

  // On first render, if localStorage had a saved group ensure it's still valid.
  useEffect(() => {
    const saved = getAsGroup();
    if (!saved || !groups) return;
    const valid = groups.some(g => g.id === saved);
    if (!valid) {
      setAsGroup(null);
      qc.invalidateQueries();
    }
  }, [groups, qc]);

  if (!groups || groups.length <= 1) return null;

  const current = getAsGroup() ?? '';

  function handleChange(groupId: string) {
    setAsGroup(groupId || null);
    qc.invalidateQueries();
  }

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <ShieldCheck className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" title="Platform admin" />
      <select
        value={current}
        onChange={e => handleChange(e.target.value)}
        className="bg-cold-800 border border-cold-700/50 text-cold-200 rounded px-2 py-1 text-xs
                   focus:outline-none focus:ring-1 focus:ring-cold-500 cursor-pointer
                   max-w-[160px] truncate"
        title="Operating as group"
      >
        <option value="">My group</option>
        {groups.map(g => (
          <option key={g.id} value={g.id}>{g.name}</option>
        ))}
      </select>
    </div>
  );
}

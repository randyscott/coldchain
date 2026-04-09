import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

/**
 * Returns the count of currently active (unresolved) alerts across all systems.
 * Refreshes every 30s as a baseline; the SSE stream triggers instant invalidation
 * on top of that when alerts change.
 */
export function useActiveAlertCount(): number {
  const { data } = useQuery({
    queryKey: ['allAlertEvents', 'active'],
    queryFn: () => api.getAlertEvents({ active_only: true }),
    refetchInterval: 30_000,
  });
  return data?.length ?? 0;
}

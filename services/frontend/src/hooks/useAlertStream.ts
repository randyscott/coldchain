import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Opens a persistent SSE connection to /api/v1/alerts/stream.
 * On receiving a triggered or resolved event, invalidates the relevant
 * React Query caches so all components refresh automatically.
 *
 * Mount this once at the app level (inside AuthProvider, after login).
 */
export function useAlertStream() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const token = sessionStorage.getItem('access_token');
    if (!token) return;

    // EventSource doesn't support custom headers, so we pass the token as a
    // query param. The backend must accept it as a fallback.
    const url = `/api/v1/alerts/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);

    es.onmessage = () => {
      // Any alert event (triggered or resolved) — refresh alert-related queries
      queryClient.invalidateQueries({ queryKey: ['allAlertEvents'] });
      queryClient.invalidateQueries({ queryKey: ['alertEvents'] });
      queryClient.invalidateQueries({ queryKey: ['systemSummary'] });
    };

    es.onerror = () => {
      // Browser will auto-reconnect; nothing to do here
    };

    return () => es.close();
  }, [queryClient]);
}

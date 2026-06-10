import { useQuery } from '@tanstack/react-query'
import type { AgentDeckLogs } from '@agent-deck/protocol'
import { fetchLogs, type LogsQuery } from './logsApi'

/** The relaxed auto-refresh cadence — logs are a tail, not a live stream, so a
 * gentle 10s poll keeps the view fresh without hammering the dashboard. */
export const LOGS_REFRESH_MS = 10_000

/**
 * React Query hook for the Logs surface. Keyed by the full query (file + lines +
 * level + search) so each filter combination caches independently and switching
 * back is instant.
 *
 * Auto-refresh is GATED to `autoRefresh` (the surface's toggle): when off, the
 * poll stops entirely (React Query skips `refetchInterval` when it's `false`);
 * when on, it re-tails every {@link LOGS_REFRESH_MS}. A manual refresh is always
 * available via `refetch()` regardless of the toggle.
 */
export function useLogs(query: LogsQuery, autoRefresh: boolean) {
  return useQuery<AgentDeckLogs, Error>({
    queryKey: [
      'agent-deck',
      'logs',
      query.file,
      query.lines,
      query.level ?? '',
      query.search ?? '',
    ],
    queryFn: ({ signal }) => fetchLogs(query, signal),
    // Only poll while auto-refresh is on; `false` disables the interval.
    refetchInterval: autoRefresh ? LOGS_REFRESH_MS : false,
    // A short staleness so a filter change refetches but a quick toggle doesn't.
    staleTime: 2_000,
  })
}

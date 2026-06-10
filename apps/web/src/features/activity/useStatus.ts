import { useQuery } from '@tanstack/react-query'
import type { AgentDeckStatus } from '@agent-deck/protocol'
import { fetchStatus } from './statusApi'

/** The `/status` query key, shared so other features (the gateway restart) can
 * invalidate this read instead of duplicating the literal. */
export const statusKey = ['agent-deck', 'status'] as const

/**
 * React Query hook for the cross-source "Active recently" band. The gateway can
 * report WHICH sources are connected and how many sessions are active, but it
 * cannot enumerate individual cross-source runs — so this is a gentle 15s poll
 * (NOT a tight live stream), and the band labels itself "active recently".
 *
 * Uses the root queryClient via the app-wide QueryClientProvider; a failure
 * (gateway/dashboard down) is surfaced to the consumer as a "gateway-down" state
 * rather than throwing, so the surface degrades calmly.
 *
 * Honors `enabled` so a surface can pause the poll (and avoid probing `/status`
 * on load); the 15s refetch resumes the moment it's enabled. Home and the
 * "Active recently" band share this one query key, so mounting both is a single
 * deduped poll, not two.
 */
export function useStatus(enabled = true) {
  return useQuery<AgentDeckStatus>({
    queryKey: statusKey,
    queryFn: ({ signal }) => fetchStatus(signal),
    enabled,
    // A relaxed cross-source heartbeat — not a tight poll. Only fires while
    // enabled (drawer open); React Query skips refetchInterval when disabled.
    refetchInterval: 15_000,
    staleTime: 15_000,
  })
}

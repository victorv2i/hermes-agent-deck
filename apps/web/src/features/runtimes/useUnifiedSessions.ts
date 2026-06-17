import { useQuery } from '@tanstack/react-query'
import { UnifiedSessionsResponse } from '@agent-deck/protocol'
import { authHeaders } from '@/lib/authToken'

/**
 * Fetch the unified session history across runtimes (Hermes + the read-only
 * Claude Code / Codex adapters). The response carries a per-runtime rollup
 * (capabilities + count + availability) that drives the source filter — so the
 * client never invents a runtime that isn't there.
 */
export const unifiedSessionsKey = ['runtimes', 'sessions'] as const

export async function fetchUnifiedSessions(signal?: AbortSignal): Promise<UnifiedSessionsResponse> {
  const res = await fetch('/api/agent-deck/runtimes/sessions', {
    headers: { ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`runtimes/sessions ${res.status}`)
  return UnifiedSessionsResponse.parse(await res.json())
}

export function useUnifiedSessions() {
  return useQuery({
    queryKey: unifiedSessionsKey,
    queryFn: ({ signal }) => fetchUnifiedSessions(signal),
    staleTime: 15_000,
    retry: false,
  })
}

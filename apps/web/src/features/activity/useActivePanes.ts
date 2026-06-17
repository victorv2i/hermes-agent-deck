import { useQuery } from '@tanstack/react-query'
import { ActivePanesResponse } from '@agent-deck/protocol'
import { authHeaders } from '@/lib/authToken'

/**
 * Poll the cross-workspace "active agent panes" aggregate — every saved-workspace
 * pane running Claude Code / Codex, with its live run state read from the CLI's
 * own transcript. Powers the Home "Active recently" band's terminal section.
 * Independent of the Hermes gateway (terminals don't need it), so the band shows
 * pane activity even when the gateway is down.
 */
export const ACTIVE_PANES_POLL_MS = 5_000

export const activePanesKey = ['terminal', 'active-panes'] as const

export async function fetchActivePanes(signal?: AbortSignal): Promise<ActivePanesResponse> {
  const res = await fetch('/api/agent-deck/terminal/active-panes', {
    headers: { ...authHeaders() },
    signal,
  })
  if (!res.ok) throw new Error(`active-panes ${res.status}`)
  return ActivePanesResponse.parse(await res.json())
}

export function useActivePanes(enabled = true) {
  return useQuery({
    queryKey: activePanesKey,
    queryFn: ({ signal }) => fetchActivePanes(signal),
    enabled,
    refetchInterval: enabled ? ACTIVE_PANES_POLL_MS : false,
    staleTime: ACTIVE_PANES_POLL_MS,
    retry: false,
  })
}

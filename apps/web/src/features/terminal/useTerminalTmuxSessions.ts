import { useQuery } from '@tanstack/react-query'
import { TerminalSessionsResponse } from '@agent-deck/protocol'
import { authHeaders } from '@/lib/authToken'

/**
 * Fetch the server's tmux session list (`GET /terminal/sessions`) — the SOURCE
 * OF TRUTH for which shells actually exist on the host. The route uses it to:
 *   - reconcile localStorage against reality (clean dead entries, recover
 *     deck-owned `adk_*` sessions this browser forgot),
 *   - offer the user's own (foreign) tmux sessions for attaching,
 *   - say honestly when shells cannot persist (tmux not installed).
 * Validated with the shared protocol zod schema. A failed probe degrades to
 * "unknown" (no reconcile, no list) rather than blocking the terminal.
 */
const SESSIONS_URL = '/api/agent-deck/terminal/sessions'

export const terminalTmuxSessionsKey = ['terminal', 'tmux-sessions'] as const

/** Fetch + validate the tmux session list. Exported for testing. */
export async function fetchTerminalTmuxSessions(
  fetchImpl: typeof fetch = fetch,
): Promise<TerminalSessionsResponse> {
  const res = await fetchImpl(SESSIONS_URL, { headers: { ...authHeaders() } })
  if (!res.ok) throw new Error(`terminal sessions ${res.status}`)
  return TerminalSessionsResponse.parse(await res.json())
}

export type TerminalTmuxSessionsState =
  | { phase: 'loading' }
  | { phase: 'ready'; data: TerminalSessionsResponse }
  | { phase: 'failed' }

export function useTerminalTmuxSessions(
  fetchImpl: typeof fetch = fetch,
): TerminalTmuxSessionsState {
  const query = useQuery({
    queryKey: terminalTmuxSessionsKey,
    queryFn: () => fetchTerminalTmuxSessions(fetchImpl),
    // Sessions come and go while the deck is open: refetch on each route mount
    // (a short staleTime keeps StrictMode double-mounts to one request).
    staleTime: 5_000,
    retry: false,
  })

  if (query.isError) return { phase: 'failed' }
  if (query.data) return { phase: 'ready', data: query.data }
  return { phase: 'loading' }
}

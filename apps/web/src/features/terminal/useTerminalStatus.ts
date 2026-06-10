import { useQuery } from '@tanstack/react-query'
import { authHeaders } from '@/lib/authToken'

/**
 * Probe the BFF for terminal availability before mounting the (heavy) xterm
 * surface, so we can render a calm "unavailable" panel instead of dialing a dead
 * socket when node-pty failed to build on the host.
 *
 * Now on the app-wide TanStack Query client (the former hand-rolled
 * useEffect+useState probe is gone). `fetchImpl` stays injectable so the route
 * is testable in jsdom without a live BFF; it threads into the query fn.
 */
export interface TerminalStatus {
  available: boolean
  /**
   * Whether a workspace cwd resolves on the server (or $HOME is opted in). When
   * false, a shell spawn is DOOMED, so the UI shows a calm "no workspace" panel
   * BEFORE the real-shell consent gate. Defaults to `true` when the payload
   * omits it (backward compatibility with an older probe).
   */
  cwdAvailable: boolean
  reason?: string
}

export type TerminalStatusState =
  | { phase: 'loading' }
  | { phase: 'ready'; status: TerminalStatus }
  | { phase: 'failed'; error: string }

const STATUS_URL = '/api/agent-deck/terminal/status'

export const terminalKeys = {
  status: ['terminal', 'status'] as const,
}

/** Fetch + validate the terminal status payload. Exported for testing. The
 * bearer token (when present) rides along; on loopback the header map is empty. */
export async function fetchTerminalStatus(
  fetchImpl: typeof fetch = fetch,
): Promise<TerminalStatus> {
  const res = await fetchImpl(STATUS_URL, { headers: { ...authHeaders() } })
  if (!res.ok) throw new Error(`terminal status ${res.status}`)
  const body: unknown = await res.json()
  if (
    !body ||
    typeof body !== 'object' ||
    typeof (body as { available?: unknown }).available !== 'boolean'
  ) {
    throw new Error('malformed terminal status')
  }
  const raw = body as { available: boolean; cwd_available?: unknown; reason?: unknown }
  return {
    available: raw.available,
    // Snake_case on the wire; default true when omitted (older probe).
    cwdAvailable: typeof raw.cwd_available === 'boolean' ? raw.cwd_available : true,
    reason: typeof raw.reason === 'string' ? raw.reason : undefined,
  }
}

export function useTerminalStatus(fetchImpl: typeof fetch = fetch): TerminalStatusState {
  const query = useQuery({
    queryKey: terminalKeys.status,
    queryFn: () => fetchTerminalStatus(fetchImpl),
    // The bind posture / node-pty availability doesn't change without a server
    // restart, so cache it for the session.
    staleTime: Infinity,
    retry: false,
  })

  if (query.isError) {
    return {
      phase: 'failed',
      error:
        query.error instanceof Error ? query.error.message : 'failed to reach terminal backend',
    }
  }
  if (query.data) return { phase: 'ready', status: query.data }
  return { phase: 'loading' }
}

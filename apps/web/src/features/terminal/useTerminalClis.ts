import { useQuery } from '@tanstack/react-query'
import { authHeaders } from '@/lib/authToken'

/**
 * Fetch which agent CLIs are installed so the Terminal launcher offers ONLY what
 * is actually present (honest, never assumed). The server probes through the
 * user's interactive shell, so a `claude` shell ALIAS is detected.
 *
 * Web-local DTO (mirrors the server-local `DetectedCli` shape) — by design this
 * does NOT add a protocol package type; the terminal launcher is a self-contained
 * BFF feature.
 */
export type CliId = 'hermes' | 'claude' | 'codex' | 'shell'

export interface DetectedCli {
  id: CliId
  label: string
  available: boolean
  /** Present only when the CLI is MISSING — a real "Install →" link target. */
  installUrl?: string
}

const CLIS_URL = '/api/agent-deck/terminal/clis'

export const terminalClisKey = ['terminal', 'clis'] as const

const KNOWN_IDS: readonly CliId[] = ['hermes', 'claude', 'codex', 'shell']

function isCliId(value: unknown): value is CliId {
  return typeof value === 'string' && (KNOWN_IDS as readonly string[]).includes(value)
}

/** Fetch + validate the CLI list. Exported for testing. */
export async function fetchTerminalClis(fetchImpl: typeof fetch = fetch): Promise<DetectedCli[]> {
  const res = await fetchImpl(CLIS_URL, { headers: { ...authHeaders() } })
  if (!res.ok) throw new Error(`terminal clis ${res.status}`)
  const body: unknown = await res.json()
  const raw = (body as { clis?: unknown })?.clis
  if (!Array.isArray(raw)) throw new Error('malformed terminal clis')
  const out: DetectedCli[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    if (!isCliId(rec.id) || typeof rec.label !== 'string' || typeof rec.available !== 'boolean') {
      continue
    }
    out.push({
      id: rec.id,
      label: rec.label,
      available: rec.available,
      installUrl: typeof rec.installUrl === 'string' ? rec.installUrl : undefined,
    })
  }
  return out
}

export type TerminalClisState =
  | { phase: 'loading' }
  | { phase: 'ready'; clis: DetectedCli[]; refetch: () => void }
  | { phase: 'failed'; error: string; refetch: () => void }

export function useTerminalClis(fetchImpl: typeof fetch = fetch): TerminalClisState {
  const query = useQuery({
    queryKey: terminalClisKey,
    queryFn: () => fetchTerminalClis(fetchImpl),
    // Installed CLIs don't change without a server restart; cache for the session.
    staleTime: Infinity,
    retry: false,
  })

  // A stable handle to re-run the probe (used by the launcher's failed-state Retry).
  const refetch = () => void query.refetch()

  if (query.isError) {
    return {
      phase: 'failed',
      error: query.error instanceof Error ? query.error.message : 'failed to load CLIs',
      refetch,
    }
  }
  if (query.data) return { phase: 'ready', clis: query.data, refetch }
  return { phase: 'loading' }
}

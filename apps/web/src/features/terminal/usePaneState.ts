import { useQuery } from '@tanstack/react-query'
import { PaneRuntimeState } from '@agent-deck/protocol'
import { authHeaders } from '@/lib/authToken'

/**
 * Poll a pane's live runtime state — what the agent CLI running in it is doing —
 * from the BFF, which reads the CLI's OWN session transcript on disk. Only agent
 * CLIs that write a transcript are aware-able; a raw shell / Hermes pane / a pane
 * with no chosen cwd has nothing to read, so the hook stays disabled and returns
 * null (the header simply shows no awareness chip — honest, never a fake state).
 */
export const PANE_STATE_POLL_MS = 5_000

/** CLIs that write a readable session transcript the BFF can surface. */
const AWARE_CLIS = new Set(['claude', 'codex'])

/** True when a pane's CLI is one the awareness chip can report on. The chip is
 * mounted only for these, so a raw-shell / Hermes pane never spins up a poll. */
export function isAwareCli(cli: string | undefined): boolean {
  return !!cli && AWARE_CLIS.has(cli)
}

export function paneStateKey(cli: string, cwd: string) {
  return ['terminal', 'pane-state', cli, cwd] as const
}

export async function fetchPaneState(
  cli: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<PaneRuntimeState> {
  const url = `/api/agent-deck/terminal/pane-state?cli=${encodeURIComponent(cli)}&cwd=${encodeURIComponent(cwd)}`
  const res = await fetch(url, { headers: { ...authHeaders() }, signal })
  if (!res.ok) throw new Error(`pane-state ${res.status}`)
  return PaneRuntimeState.parse(await res.json())
}

/** The pane's runtime state, or null when not aware-able / still loading / errored. */
export function usePaneState(
  cli: string | undefined,
  cwd: string | undefined,
): PaneRuntimeState | null {
  const enabled = !!cli && AWARE_CLIS.has(cli) && !!cwd
  const query = useQuery({
    queryKey: paneStateKey(cli ?? '', cwd ?? ''),
    queryFn: ({ signal }) => fetchPaneState(cli as string, cwd as string, signal),
    enabled,
    refetchInterval: enabled ? PANE_STATE_POLL_MS : false,
    staleTime: PANE_STATE_POLL_MS,
    retry: false,
  })
  return query.data ?? null
}

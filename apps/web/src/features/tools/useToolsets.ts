import { useQuery, useMutation } from '@tanstack/react-query'
import type { AgentDeckToolset } from '@agent-deck/protocol'
import { fetchToolsets, toggleToolset } from './api'

const toolsetsKey = ['agent-deck', 'toolsets'] as const

/**
 * Read the Tools surface state (the agent's configurable toolsets). Refetches on
 * focus so a change made via the CLI (`hermes tools`) shows when the user returns.
 * A modest `staleTime` keeps the surface from hammering the dashboard read.
 */
export function useToolsets() {
  return useQuery<AgentDeckToolset[]>({
    queryKey: toolsetsKey,
    queryFn: ({ signal }) => fetchToolsets(signal),
    staleTime: 10_000,
  })
}

/**
 * Mutation for toggling a toolset on or off.
 *
 * Proxies stock `PUT /api/tools/toolsets/{name}` (web_server.py:5752). The
 * change persists to config.yaml immediately; the gateway must be restarted
 * for the running session to pick it up. Callers must surface that honestly.
 */
export function useToggleToolset() {
  return useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      toggleToolset(name, enabled),
  })
}

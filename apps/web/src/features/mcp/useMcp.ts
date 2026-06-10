import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  McpState,
  McpMutationResult,
  McpTestResult,
  AddMcpServerRequest,
} from '@agent-deck/protocol'
import { addMcpServer, fetchMcp, removeMcpServer, testMcpServer, toggleMcpServer } from './api'

const mcpKey = ['agent-deck', 'mcp'] as const

/**
 * Read the MCP surface state (configured servers + the curated catalog).
 * Refetches on focus so a change made elsewhere (a server added from the CLI,
 * a toggle) shows when the user returns. A modest `staleTime` keeps the surface
 * from hammering the fs read.
 */
export function useMcp() {
  return useQuery<McpState>({
    queryKey: mcpKey,
    queryFn: ({ signal }) => fetchMcp(signal),
    staleTime: 10_000,
  })
}

/** Re-read the MCP surface on demand (after a gateway restart). */
export function useRefreshMcp(): () => void {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: mcpKey })
  }
}

/**
 * Add a custom server. The mutation result carries the refreshed {@link McpState}
 * (so the list re-resolves) + `restartRequired` — the server only loads on a new
 * gateway session, so the UI prompts the real restart rather than faking a
 * connected state. We also seed the query cache from the result.
 */
export function useAddMcpServer() {
  const qc = useQueryClient()
  return useMutation<McpMutationResult, Error, AddMcpServerRequest>({
    mutationFn: (request) => addMcpServer(request),
    onSuccess: (result) => qc.setQueryData(mcpKey, result.state),
    onSettled: () => qc.invalidateQueries({ queryKey: mcpKey }),
  })
}

/** Toggle a server's enabled config flag. Effective on a new gateway session. */
export function useToggleMcpServer() {
  const qc = useQueryClient()
  return useMutation<McpMutationResult, Error, { name: string; enabled: boolean }>({
    mutationFn: ({ name, enabled }) => toggleMcpServer(name, enabled),
    onSuccess: (result) => qc.setQueryData(mcpKey, result.state),
    onSettled: () => qc.invalidateQueries({ queryKey: mcpKey }),
  })
}

/** Remove a server from the config. Effective on a new gateway session. */
export function useRemoveMcpServer() {
  const qc = useQueryClient()
  return useMutation<McpMutationResult, Error, string>({
    mutationFn: (name) => removeMcpServer(name),
    onSuccess: (result) => qc.setQueryData(mcpKey, result.state),
    onSettled: () => qc.invalidateQueries({ queryKey: mcpKey }),
  })
}

/**
 * Run the REAL non-interactive probe for one server. The result is the server's
 * discovered tools (a one-shot connect, NOT a persisted connection) — so this
 * never flips a standing "connected" state, it just lists what the server offers.
 */
export function useTestMcpServer() {
  return useMutation<McpTestResult, Error, string>({
    mutationFn: (name) => testMcpServer(name),
  })
}

import { apiFetch, apiPost, apiPatch, apiDelete } from '@/lib/apiFetch'
import {
  McpState,
  McpMutationResult,
  McpTestResult,
  type AddMcpServerRequest,
} from '@agent-deck/protocol'

/**
 * The MCP Server Manager's BFF client (agent-deck-OWN routes):
 *
 *   GET    /api/agent-deck/mcp              → McpState (configured servers + catalog)
 *   POST   /api/agent-deck/mcp              → guided ADD (McpMutationResult)
 *   PATCH  /api/agent-deck/mcp/:name        → toggle enabled (McpMutationResult)
 *   DELETE /api/agent-deck/mcp/:name        → remove (McpMutationResult)
 *   POST   /api/agent-deck/mcp/:name/test   → REAL probe (McpTestResult)
 *
 * Every response is parsed through the shared protocol zod schema, so a partial
 * payload throws here (caught by the query/mutation). A masked key is sent ONCE
 * in the add request body (to store it via /api/env); the response NEVER echoes
 * a plaintext value back.
 */

/** Read the full MCP payload: configured servers + the curated catalog. */
export async function fetchMcp(signal?: AbortSignal): Promise<McpState> {
  return McpState.parse(await apiFetch<unknown>('/mcp', { signal }))
}

/** Add a custom server (guided). The masked key is stored via /api/env server-side. */
export async function addMcpServer(request: AddMcpServerRequest): Promise<McpMutationResult> {
  return McpMutationResult.parse(await apiPost<unknown>('/mcp', request))
}

/** Toggle a server's `enabled` config flag (effective on a new gateway session). */
export async function toggleMcpServer(name: string, enabled: boolean): Promise<McpMutationResult> {
  return McpMutationResult.parse(
    await apiPatch<unknown>(`/mcp/${encodeURIComponent(name)}`, { enabled }),
  )
}

/** Remove a server from the config (effective on a new gateway session). */
export async function removeMcpServer(name: string): Promise<McpMutationResult> {
  return McpMutationResult.parse(await apiDelete<unknown>(`/mcp/${encodeURIComponent(name)}`))
}

/** Run the REAL non-interactive probe and return the discovered tools. */
export async function testMcpServer(name: string): Promise<McpTestResult> {
  return McpTestResult.parse(await apiPost<unknown>(`/mcp/${encodeURIComponent(name)}/test`, {}))
}

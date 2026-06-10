import { apiFetch } from '@/lib/apiFetch'
import {
  AgentDeckToolsetsResponse,
  ToggleToolsetResponse,
  type AgentDeckToolset,
  type ToggleToolsetResponse as ToggleToolsetResponseType,
} from '@agent-deck/protocol'

/**
 * The Tools surface's BFF client.
 *
 *   GET /api/agent-deck/toolsets           → { toolsets: AgentDeckToolset[] }
 *   PUT /api/agent-deck/toolsets/:name     → { ok, name, enabled }
 *
 * Responses are parsed through the shared protocol zod schema, so a partial /
 * unexpected payload throws here (caught by the mutation caller).
 *
 * HONESTY: toggling persists the change to config.yaml immediately but the
 * RUNNING gateway does NOT reload config until restart. The UI shows honest
 * "restart gateway to apply" copy — never fakes instant activation.
 */

/** The exact CLI command that opens the interactive toolset configurator. */
export const TOOLS_CLI_COMMAND = 'hermes tools'

/** Read every configurable toolset (enabled/configured flags + resolved tools). */
export async function fetchToolsets(signal?: AbortSignal): Promise<AgentDeckToolset[]> {
  const res = AgentDeckToolsetsResponse.parse(await apiFetch<unknown>('/toolsets', { signal }))
  return res.toolsets
}

/**
 * Toggle a toolset on or off.
 *
 * Proxies `PUT /api/agent-deck/toolsets/:name` → stock
 * `PUT /api/tools/toolsets/{name}` (web_server.py:5752). The response confirms
 * the new state. The gateway must be restarted for the change to take effect in
 * running sessions — the caller must surface that honestly.
 */
export async function toggleToolset(
  name: string,
  enabled: boolean,
): Promise<ToggleToolsetResponseType> {
  const raw = await apiFetch<unknown>(`/toolsets/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  return ToggleToolsetResponse.parse(raw)
}

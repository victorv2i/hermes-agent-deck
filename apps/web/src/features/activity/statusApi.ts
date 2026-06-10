import { AgentDeckStatus } from '@agent-deck/protocol'
import { apiFetch } from '@/lib/apiFetch'

/**
 * Fetch the cross-source agent status (`GET /api/agent-deck/status`) and parse
 * it through the protocol DTO. The BFF already maps the dashboard payload to the
 * slim, whitelisted shape (no filesystem paths); parsing here is a belt-and-
 * braces guard that the client only ever sees the whitelisted fields.
 */
export async function fetchStatus(signal?: AbortSignal): Promise<AgentDeckStatus> {
  return AgentDeckStatus.parse(await apiFetch('/status', { signal }))
}

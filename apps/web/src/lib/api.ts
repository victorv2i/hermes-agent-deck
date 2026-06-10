import { HealthResponse } from '@agent-deck/protocol'
import { apiFetch } from './apiFetch'

export async function fetchHealth(): Promise<HealthResponse> {
  return HealthResponse.parse(await apiFetch('/health'))
}

/**
 * Query keys for the two surface-local `fetchHealth` probes (Home's offline
 * tending copy and Chat's unreachable notice). They live here, next to the
 * probe they key, so the gateway restart (`useRestartGateway`) can invalidate
 * them without importing the route modules (which would be an import cycle:
 * the routes mount the restart button).
 */
export const homeHealthKey = ['agent-deck', 'home', 'health'] as const
export const chatHealthKey = ['agent-deck', 'chat', 'health'] as const

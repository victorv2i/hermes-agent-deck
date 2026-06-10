/**
 * Provider validate BFF route:
 *   POST /api/agent-deck/providers/validate  body { key, value } → ProviderValidateResult
 *
 * Proxies POST /api/providers/validate (web_server.py:1974).
 * The Hermes endpoint live-probes a provider credential before it is saved —
 * it returns { ok, reachable, message } with three distinct honest states:
 *
 *   ok=true, reachable=true   → key accepted (show green / allow save)
 *   ok=false, reachable=true  → key rejected (show red / block save)
 *   ok=false, reachable=false → network probe failed (show amber / allow save)
 *   ok=true, reachable=false  → no probe for this provider (allow save, neutral)
 *
 * SECURITY:
 *  - The key VALUE is forwarded to Hermes for the probe; the BFF never logs it.
 *  - The response MESSAGE is from Hermes and is safe to show (it describes the
 *    HTTP status or a generic rejection, never echoes the key).
 *  - No credential is stored by this route.
 */
import type { FastifyInstance } from 'fastify'
import { ProviderValidateResult } from '@agent-deck/protocol'
import type { DashboardClient } from '../hermes/dashboardClient'

export interface ProviderValidateRouteDeps {
  dashboard: DashboardClient
}

export async function registerProviderValidateRoute(
  app: FastifyInstance,
  deps: ProviderValidateRouteDeps,
): Promise<void> {
  app.post<{ Body: unknown }>('/api/agent-deck/providers/validate', async (req, reply) => {
    const body = req.body as { key?: unknown; value?: unknown } | null | undefined
    if (typeof body?.key !== 'string' || typeof body?.value !== 'string') {
      return reply
        .code(400)
        .send({ error: 'bad_request', message: 'key (string) and value (string) are required' })
    }
    // Forward to Hermes. The key value is in the request body — NEVER logged here.
    try {
      const raw = await deps.dashboard.authedFetch('/api/providers/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: body.key, value: body.value }),
      })
      const json = await raw.json()
      const parsed = ProviderValidateResult.safeParse(json)
      if (!parsed.success) {
        // Hermes returned a shape we don't recognize — fail open (no probe = allow save).
        return reply.send({ ok: true, reachable: false, message: '' })
      }
      return reply.send(parsed.data)
    } catch {
      // Network failure — provider unreachable. Never block an offline user.
      return reply.send({
        ok: false,
        reachable: false,
        message: 'Could not reach the provider to verify the key.',
      })
    }
  })
}

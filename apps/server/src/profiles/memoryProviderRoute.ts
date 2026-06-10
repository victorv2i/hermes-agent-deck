/**
 * Memory-provider BFF routes (facade over real stock Hermes routes):
 *
 *   GET  /api/agent-deck/memory-provider         → MemoryStatus
 *   PUT  /api/agent-deck/memory-provider         body { provider } → { ok, active }
 *   POST /api/agent-deck/memory-provider/reset   body { target }   → MemoryResetResult
 *
 * REAL STOCK ROUTES (verified against web_server.py):
 *   GET  /api/memory          (web_server.py:4983) — active provider + catalog + file sizes
 *   PUT  /api/memory/provider (web_server.py:5018) — switch provider
 *   POST /api/memory/reset    (web_server.py:5042) — reset built-in files (MEMORY.md/USER.md)
 *
 * HONESTY:
 *  - "active" is what config.yaml says; the gateway must restart to apply a
 *    new provider. The BFF returns an `restart_required` flag when the active
 *    changes so the UI can surface an honest "restart to apply" note.
 *  - "configured" is provider-level (plugin setup), NOT connection-probed.
 *    We never claim a provider is "connected" without a real probe.
 *  - Reset is DESTRUCTIVE and IRREVERSIBLE (files are deleted, not archived).
 *    The BFF returns what was actually deleted so the UI can name the files.
 *  - Secrets: no provider credentials cross the wire; the response carries
 *    only the provider name and configured flag.
 */
import type { FastifyInstance, FastifyReply } from 'fastify'
import {
  MemoryStatus,
  MemoryProviderSelectRequest,
  MemoryResetRequest,
  MemoryResetResult,
} from '@agent-deck/protocol'
import type { DashboardClient } from '../hermes/dashboardClient'
import { DashboardError } from '../hermes/dashboardClient'

export interface MemoryProviderRouteDeps {
  dashboard: DashboardClient
}

type DashboardErrorJson = { detail?: unknown; message?: unknown; error?: unknown }

async function readDashboardJson(raw: Response): Promise<unknown> {
  return raw.json().catch(() => null)
}

function dashboardFailureStatus(status: number): number {
  return status >= 400 && status < 500 ? status : 502
}

/**
 * Honest degradation for a THROWN dashboard call (mirrors the Connections
 * tabs, connectionsRoutes sendListError): only the genuinely version-skew
 * shapes get the "this build does not support" copy. Those are a 404 (route
 * absent on this Hermes build) and a 2xx non-JSON body (the SPA catch-all
 * answered for the path, see dashboardClient.getJson). Any other HTTP status
 * means Hermes responded but FAILED (a 500, the session-token bootstrap
 * failing, etc.); claiming version skew there would fabricate a diagnosis,
 * and "Could not reach Hermes" would be a lie too, so we keep an honest
 * generic upstream-failure message. No status at all means a real connection
 * failure.
 */
function sendDashboardFailure(reply: FastifyReply, err: unknown) {
  if (err instanceof DashboardError && err.status !== undefined) {
    const unsupported = err.status === 404 || (err.status >= 200 && err.status < 300)
    if (unsupported) {
      return reply.code(502).send({
        error: 'unsupported',
        message:
          'Hermes responded, but this build does not support memory provider controls. Updating Hermes usually fixes this.',
      })
    }
    return reply.code(502).send({
      error: 'hermes_error',
      message: 'Hermes had a problem answering. Check the System page or try again.',
    })
  }
  return reply.code(502).send({ error: 'unavailable', message: 'Could not reach Hermes.' })
}

function dashboardFailureMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const errorBody = body as DashboardErrorJson
    const detail = errorBody.message ?? errorBody.detail ?? errorBody.error
    if (typeof detail === 'string' && detail.trim()) return detail
  }
  return fallback
}

export async function registerMemoryProviderRoute(
  app: FastifyInstance,
  deps: MemoryProviderRouteDeps,
): Promise<void> {
  // GET /api/agent-deck/memory-provider — fetch memory status from Hermes.
  app.get('/api/agent-deck/memory-provider', async (req, reply) => {
    try {
      const raw = await deps.dashboard.getJson('/api/memory')
      const parsed = MemoryStatus.safeParse(raw)
      if (!parsed.success) {
        req.log.warn({ reason: parsed.error.message }, 'memory status parse failed')
        return reply
          .code(502)
          .send({ error: 'unreadable', message: 'Could not read memory status.' })
      }
      return reply.send(parsed.data)
    } catch (err) {
      req.log.warn({ err }, 'memory status fetch failed')
      return sendDashboardFailure(reply, err)
    }
  })

  // PUT /api/agent-deck/memory-provider  body { provider } → { ok, active, restart_required }
  // Switches the active memory provider. Any real change requires a gateway restart.
  app.put<{ Body: unknown }>('/api/agent-deck/memory-provider', async (req, reply) => {
    const parsed = MemoryProviderSelectRequest.safeParse(req.body)
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'bad_request', message: 'provider (string) is required' })
    }
    try {
      const raw = await deps.dashboard.authedFetch('/api/memory/provider', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: parsed.data.provider }),
      })
      const json = (await readDashboardJson(raw)) as { ok?: boolean; active?: string } | null
      if (!raw.ok) {
        req.log.warn({ status: raw.status }, 'memory provider switch rejected by Hermes')
        return reply.code(dashboardFailureStatus(raw.status)).send({
          error: 'hermes_error',
          message: dashboardFailureMessage(json, 'Could not switch memory provider.'),
        })
      }
      return reply.send({
        ok: json?.ok ?? true,
        active: json?.active ?? parsed.data.provider,
        // A provider switch always requires a gateway restart to take effect.
        restart_required: true,
      })
    } catch (err) {
      req.log.warn({ err }, 'memory provider switch failed')
      return sendDashboardFailure(reply, err)
    }
  })

  // POST /api/agent-deck/memory-provider/reset  body { target } → MemoryResetResult
  // Destructively resets (deletes) MEMORY.md and/or USER.md built-in files.
  app.post<{ Body: unknown }>('/api/agent-deck/memory-provider/reset', async (req, reply) => {
    const parsed = MemoryResetRequest.safeParse(req.body)
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'bad_request', message: 'target must be all | memory | user' })
    }
    try {
      const raw = await deps.dashboard.authedFetch('/api/memory/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: parsed.data.target }),
      })
      const json = await readDashboardJson(raw)
      if (!raw.ok) {
        req.log.warn({ status: raw.status }, 'memory reset rejected by Hermes')
        return reply.code(dashboardFailureStatus(raw.status)).send({
          error: 'hermes_error',
          message: dashboardFailureMessage(json, 'Could not reset built-in memory.'),
        })
      }
      const result = MemoryResetResult.safeParse(json)
      if (!result.success) {
        req.log.warn({ reason: result.error.message }, 'memory reset parse failed')
        return reply
          .code(502)
          .send({ error: 'unreadable', message: 'Could not read memory reset result.' })
      }
      return reply.send(result.data)
    } catch (err) {
      req.log.warn({ err }, 'memory reset failed')
      return sendDashboardFailure(reply, err)
    }
  })
}

/**
 * Curator BFF routes (agent-deck-OWN facade over real stock Hermes routes):
 *
 *   GET  /api/agent-deck/curator          → CuratorStatus
 *   PUT  /api/agent-deck/curator/paused   → { ok, paused }
 *   POST /api/agent-deck/curator/run      → { ok }
 *
 * The curator is a background skill-maintenance process. It reviews skills
 * (archive stale, prune, pin) on a configurable interval. Its controls live
 * on the System/Maintenance dock so operators can pause it, resume it, or
 * trigger a run now.
 *
 * REAL STOCK ROUTES:
 *   GET  /api/curator          (web_server.py:844) — status + config
 *   PUT  /api/curator/paused   (web_server.py:869) — body { paused: bool }
 *   POST /api/curator/run      (web_server.py:877) — trigger a review now
 *
 * HONESTY:
 *  - If the curator module cannot be imported (Hermes returns HTTP 500),
 *    the BFF surface degrades to `available: false` — never a fake green.
 *  - "run now" returns { ok: true } when the action was queued (the actual
 *    run is backgrounded in Hermes — the UI notes this).
 *  - "paused" write returns the new paused state, echoed back.
 */
import type { FastifyInstance } from 'fastify'
import { CuratorStatus } from '@agent-deck/protocol'
import type { DashboardClient } from '../hermes/dashboardClient'

export interface CuratorRouteDeps {
  dashboard: DashboardClient
}

export async function registerCuratorRoute(
  app: FastifyInstance,
  deps: CuratorRouteDeps,
): Promise<void> {
  // GET /api/agent-deck/curator — fetch curator status from Hermes.
  // If Hermes returns HTTP 500 (module not available), degrade honestly.
  app.get('/api/agent-deck/curator', async (req, reply) => {
    try {
      const raw = await deps.dashboard.getJson<Record<string, unknown>>('/api/curator')
      const parsed = CuratorStatus.safeParse({ ...raw, available: true })
      if (!parsed.success) {
        req.log.warn({ reason: parsed.error.message }, 'curator status parse failed')
        return reply.send(unavailableCurator())
      }
      return reply.send(parsed.data)
    } catch (err) {
      // Hermes 500 (module not available) or network failure — honest unavailable.
      req.log.info({ err }, 'curator status unavailable')
      return reply.send(unavailableCurator())
    }
  })

  // PUT /api/agent-deck/curator/paused  body { paused: bool } → { ok, paused }
  app.put<{ Body: unknown }>('/api/agent-deck/curator/paused', async (req, reply) => {
    const body = req.body as { paused?: unknown } | null | undefined
    if (typeof body?.paused !== 'boolean') {
      return reply.code(400).send({ error: 'bad_request', message: 'paused (boolean) is required' })
    }
    try {
      const raw = await deps.dashboard.authedFetch('/api/curator/paused', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: body.paused }),
      })
      const json = (await raw.json()) as { ok?: boolean; paused?: boolean }
      return reply.send({ ok: json.ok ?? true, paused: json.paused ?? body.paused })
    } catch (err) {
      req.log.warn({ err }, 'curator pause/resume failed')
      return reply.code(502).send({ error: 'unavailable', message: 'Could not reach Hermes.' })
    }
  })

  // POST /api/agent-deck/curator/run → { ok }
  // Triggers a curator review now (backgrounded in Hermes — the run is async).
  app.post('/api/agent-deck/curator/run', async (req, reply) => {
    try {
      await deps.dashboard.authedFetch('/api/curator/run', { method: 'POST' })
      return reply.send({ ok: true })
    } catch (err) {
      req.log.warn({ err }, 'curator run-now failed')
      return reply.code(502).send({ error: 'unavailable', message: 'Could not reach Hermes.' })
    }
  })
}

/** The honest unavailable state when the curator module is absent. */
function unavailableCurator(): CuratorStatus {
  return {
    available: false,
    enabled: false,
    paused: false,
    interval_hours: null,
    last_run_at: null,
    min_idle_hours: null,
    stale_after_days: null,
    archive_after_days: null,
  }
}

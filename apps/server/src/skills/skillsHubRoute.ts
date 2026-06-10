/**
 * Skills Hub BFF route plugin.
 *
 * Exposes AGENT-DECK-OWN endpoints that proxy to the REAL stock hermes hub routes:
 *
 *   GET  /api/agent-deck/skills/hub/search?q=…&source=all&limit=20
 *     Proxies → stock GET /api/skills/hub/search (web_server.py:5390).
 *     Returns { results: SkillHubResult[] }.
 *
 *   POST /api/agent-deck/skills/hub/install   body { identifier: string }
 *     Proxies → stock POST /api/skills/hub/install (web_server.py:5350).
 *     Spawns a background action. Returns { ok, action, restartRequired }.
 *
 *   POST /api/agent-deck/skills/hub/uninstall  body { name: string }
 *     Proxies → stock POST /api/skills/hub/uninstall (web_server.py:5367).
 *     Returns { ok, action, restartRequired }.
 *
 *   POST /api/agent-deck/skills/hub/update    (no body)
 *     Proxies → stock POST /api/skills/hub/update (web_server.py:5380).
 *     Returns { ok, action, restartRequired }.
 *
 *   GET  /api/agent-deck/skills/hub/action-status?name=skills-install
 *     Proxies → stock GET /api/actions/{name}/status (web_server.py:1330).
 *     Allows polling while the background action runs.
 *
 * HONESTY: install/uninstall always signal restartRequired=true because a Hermes
 * gateway restart is needed to pick up the changed skill set. The UI surfaces an
 * explicit "restart to apply" note (and can deep-link /system for it). No spinner
 * is left dangling when the response returns — only while the real request is
 * in flight (the background action; the UI polls /action-status for completion).
 *
 * Mount under no prefix (paths already include /api/agent-deck).
 */
import type { FastifyPluginAsync } from 'fastify'
import type { DashboardClient } from '../hermes/dashboardClient'
import { DashboardError } from '../hermes/dashboardClient'
import { SkillsHubClient } from './skillsHubClient'
import type { HubActionName } from './skillsHubClient'

/** Valid hub action names that map to real stock hermes action log files. */
const HUB_ACTION_NAMES: ReadonlySet<string> = new Set([
  'skills-install',
  'skills-uninstall',
  'skills-update',
])

export interface SkillsHubRouteOptions {
  dashboard: DashboardClient
}

export const registerSkillsHubRoutes: FastifyPluginAsync<SkillsHubRouteOptions> = async (
  fastify,
  opts,
) => {
  const hub = new SkillsHubClient(opts.dashboard)

  // ── Search ──
  fastify.get<{ Querystring: { q?: string; source?: string; limit?: string } }>(
    '/api/agent-deck/skills/hub/search',
    async (req, reply) => {
      const q = (req.query.q ?? '').trim()
      const source = req.query.source ?? 'all'
      const limit = Math.min(Math.max(parseInt(req.query.limit ?? '20', 10) || 20, 1), 50)
      try {
        return await hub.search(q, source, limit)
      } catch (err) {
        const status = err instanceof DashboardError ? 502 : 500
        return reply.code(status).send({ error: 'Hub search failed.' })
      }
    },
  )

  // ── Install ──
  fastify.post<{ Body: { identifier?: unknown } }>(
    '/api/agent-deck/skills/hub/install',
    async (req, reply) => {
      const identifier = req.body?.identifier
      if (typeof identifier !== 'string' || identifier.trim() === '') {
        return reply.code(400).send({ error: 'identifier (string) is required' })
      }
      try {
        return await hub.install(identifier.trim())
      } catch (err) {
        const status = err instanceof DashboardError ? 502 : 500
        return reply.code(status).send({ error: 'Hub install failed.' })
      }
    },
  )

  // ── Uninstall ──
  fastify.post<{ Body: { name?: unknown } }>(
    '/api/agent-deck/skills/hub/uninstall',
    async (req, reply) => {
      const name = req.body?.name
      if (typeof name !== 'string' || name.trim() === '') {
        return reply.code(400).send({ error: 'name (string) is required' })
      }
      try {
        return await hub.uninstall(name.trim())
      } catch (err) {
        const status = err instanceof DashboardError ? 502 : 500
        return reply.code(status).send({ error: 'Hub uninstall failed.' })
      }
    },
  )

  // ── Update all ──
  fastify.post('/api/agent-deck/skills/hub/update', async (_req, reply) => {
    try {
      return await hub.update()
    } catch (err) {
      const status = err instanceof DashboardError ? 502 : 500
      return reply.code(status).send({ error: 'Hub update failed.' })
    }
  })

  // ── Action status poll ──
  fastify.get<{ Querystring: { name?: string } }>(
    '/api/agent-deck/skills/hub/action-status',
    async (req, reply) => {
      const name = req.query.name ?? ''
      if (!HUB_ACTION_NAMES.has(name)) {
        return reply
          .code(400)
          .send({ error: 'name must be one of: skills-install, skills-uninstall, skills-update' })
      }
      try {
        return await hub.actionStatus(name as HubActionName)
      } catch (err) {
        const status = err instanceof DashboardError ? 502 : 500
        return reply.code(status).send({ error: 'Could not read action status.' })
      }
    },
  )
}

/**
 * System stats BFF route:
 *   GET /api/agent-deck/system/stats -> SystemStats
 *
 * Proxies GET /api/system/stats (web_server.py:756) — a read-only host/process
 * snapshot. Passes psutil-enriched memory/disk/CPU/uptime when psutil is
 * present, degrades gracefully to OS/arch/version when it is not.
 *
 * SLIM + WHITELISTED: the raw Hermes response includes many OS detail fields
 * (os_version, platform, hostname, python_version, python_impl, cpu_count,
 * process.pid, process.create_time, process.num_threads, process.rss). We
 * strip to the user-meaningful, non-sensitive subset via SystemStats.parse()
 * — absolute paths, PIDs, and internal Python details never cross the wire.
 *
 * FAIL CLOSED: any fetch failure returns 502 with a generic message (no internals).
 */
import type { FastifyInstance } from 'fastify'
import { SystemStats } from '@agent-deck/protocol'
import type { DashboardClient } from '../hermes/dashboardClient'

export interface SystemStatsRouteDeps {
  dashboard: DashboardClient
}

export async function registerSystemStatsRoute(
  app: FastifyInstance,
  deps: SystemStatsRouteDeps,
): Promise<void> {
  app.get('/api/agent-deck/system/stats', async (req, reply) => {
    try {
      const raw = await deps.dashboard.getJson('/api/system/stats')
      // Parse through the schema so only the whitelisted keys cross the wire.
      // Extra fields (pid, create_time, hostname, python_version...) are stripped.
      const stats = SystemStats.safeParse(raw)
      if (!stats.success) {
        req.log.warn({ reason: stats.error.message }, 'system/stats parse failed')
        return reply
          .code(502)
          .send({ error: 'unreadable', message: 'Could not read system stats.' })
      }
      return reply.send(stats.data)
    } catch (err) {
      req.log.warn({ err }, 'system/stats fetch failed')
      return reply.code(502).send({ error: 'unavailable', message: 'Could not reach Hermes.' })
    }
  })
}

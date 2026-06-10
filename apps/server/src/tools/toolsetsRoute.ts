/**
 * Toolsets BFF — the "Tools" surface read + write.
 *
 * DASHBOARD-PROXIED routes:
 *   GET /api/agent-deck/toolsets            → { toolsets: ToolsetSummary[] }
 *   PUT /api/agent-deck/toolsets/:name      → { ok, name, enabled }
 *
 * The GET proxies stock `GET /api/tools/toolsets` (web_server.py:5716), which
 * resolves every configurable toolset's enabled/configured state + resolved
 * tools for the active `cli` platform.
 *
 * The PUT proxies stock `PUT /api/tools/toolsets/{name}` (web_server.py:5752),
 * which persists the enabled/disabled state to `platform_toolsets.cli` in
 * config.yaml — the same helper the `hermes tools` TUI uses. The RUNNING
 * gateway does NOT reload config until restart; the UI must show honest
 * "restart to apply" copy and never fake instant activation.
 *
 * The dashboard session token is handled inside the shared client and is NEVER
 * surfaced.
 *
 * Mount with no prefix (paths are absolute):
 *   await app.register(registerToolsetsRoutes, { dashboard })
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { DashboardClient } from '../hermes/dashboardClient'
import { ToolsetsClient, type ToolsetSummary, type ToolsetToggleResult } from './toolsetsClient'

export interface ToolsetsRouteOptions {
  /** Shared dashboard client (auth + token handling already wired). */
  dashboard: DashboardClient
}

interface ToolsetsListResponse {
  toolsets: ToolsetSummary[]
}
interface ErrorResponse {
  error: string
}

export const registerToolsetsRoutes: FastifyPluginAsync<ToolsetsRouteOptions> = async (
  app: FastifyInstance,
  opts: ToolsetsRouteOptions,
) => {
  const client = new ToolsetsClient(opts.dashboard)

  app.get(
    '/api/agent-deck/toolsets',
    async (_req, reply): Promise<ToolsetsListResponse | ErrorResponse> => {
      try {
        const toolsets = await client.listToolsets()
        return { toolsets }
      } catch {
        // DashboardClient scrubs the token from its messages; we still return a
        // generic message. Any dashboard failure surfaces as 502.
        reply.code(502)
        return { error: 'Unable to reach the hermes dashboard for toolsets.' }
      }
    },
  )

  app.put<{
    Params: { name: string }
    Body: { enabled?: unknown }
  }>(
    '/api/agent-deck/toolsets/:name',
    async (req, reply): Promise<ToolsetToggleResult | ErrorResponse> => {
      const { name } = req.params
      const { enabled } = req.body ?? {}

      // Validate: enabled must be a boolean (not coerced).
      if (typeof enabled !== 'boolean') {
        reply.code(400)
        return { error: '`enabled` must be a boolean.' }
      }

      try {
        return await client.toggleToolset(name, enabled)
      } catch {
        reply.code(502)
        return { error: 'Unable to reach the hermes dashboard to toggle the toolset.' }
      }
    },
  )
}

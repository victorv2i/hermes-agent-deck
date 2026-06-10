/**
 * Logs BFF route plugin — exposes the dashboard's recent log lines to the web
 * Logs surface under a stable, structured contract.
 *
 *   GET /api/agent-deck/logs?file=agent&lines=100&level=ERROR&search=foo
 *     → { file, entries[], truncated }   (see logsClient.ts / protocol/logs.ts)
 *
 * `file` is validated against the known set (agent/errors/gateway) BEFORE the
 * dashboard is touched, so an unknown/path-like value 400s here rather than
 * round-tripping. `lines` defaults to 100 and is clamped to [1, 500] by the
 * client. Auth + transport are delegated to the shared DashboardClient via
 * LogsClient; a dashboard failure maps to 502 and never leaks the session token.
 *
 * Mount with: app.register(registerLogsRoutes, { logsClient }) — no prefix; the
 * full path is declared on the route (the integrator wires this in app.ts).
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { AgentDeckLogs, LogFile } from '@agent-deck/protocol'
import { DashboardError } from '../hermes/dashboardClient'
import type { LogsClient } from './logsClient'

const DEFAULT_FILE = 'agent'
const DEFAULT_LINES = 100

export interface LogsRoutesOptions {
  logsClient: LogsClient
}

interface LogsQuery {
  file?: string
  lines?: string
  level?: string
  search?: string
}

/** Parse + clamp the `lines` query param. Falls back to the default for junk. */
export function parseLines(raw: unknown): number {
  if (typeof raw === 'string' && raw.trim() === '') return DEFAULT_LINES
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN
  if (!Number.isFinite(n)) return DEFAULT_LINES
  // The client clamps to [1, 500]; here we only coerce to an integer.
  return Math.floor(n)
}

export const registerLogsRoutes: FastifyPluginAsync<LogsRoutesOptions> = async (
  app: FastifyInstance,
  opts: LogsRoutesOptions,
) => {
  const { logsClient } = opts

  app.get<{ Querystring: LogsQuery }>(
    '/api/agent-deck/logs',
    async (request, reply): Promise<AgentDeckLogs | { error: string }> => {
      const rawFile = request.query?.file ?? DEFAULT_FILE
      const fileParse = LogFile.safeParse(rawFile)
      if (!fileParse.success) {
        // Validate BEFORE touching the dashboard so a path-like value never
        // round-trips; the dashboard only knows agent/errors/gateway anyway.
        reply.code(400)
        return { error: `Unknown log file: ${String(rawFile)}` }
      }

      try {
        const result = await logsClient.getLogs({
          file: fileParse.data,
          lines: parseLines(request.query?.lines),
          level: request.query?.level,
          search: request.query?.search,
        })
        // Parse through the protocol DTO so a malformed upstream can't widen it.
        return AgentDeckLogs.parse(result)
      } catch (err) {
        // The dashboard is an upstream dependency; surface its failure as a 502.
        // The DashboardError message is safe (never carries the token).
        const message =
          err instanceof DashboardError
            ? `dashboard logs unavailable: ${err.message}`
            : 'dashboard logs unavailable'
        reply.code(502)
        return { error: message }
      }
    },
  )
}

export default registerLogsRoutes

/**
 * Usage BFF route plugin — exposes the dashboard's token/cost analytics to the
 * web Usage surface under a stable, normalized contract.
 *
 *   GET /api/agent-deck/usage?days=N
 *     → { periodDays, totals, daily[], byModel[] }  (see usageClient.ts)
 *
 * `days` is clamped to [1, 365] and defaults to 30; the web period selector only
 * sends 7 / 14 / 30, but we accept any positive window the dashboard supports.
 * Auth + transport are delegated to the shared DashboardClient via UsageClient.
 *
 * Mount with: app.register(usageRoutes, { usageClient }) — no prefix; the full
 * path is declared on the route. On a dashboard failure we map to 502 (the
 * dashboard is an upstream dependency) and never leak the session token.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { DashboardError } from '../hermes/dashboardClient'
import type { UsageClient, UsageSummary } from './usageClient'

const DEFAULT_DAYS = 30
const MIN_DAYS = 1
const MAX_DAYS = 365

export interface UsageRoutesOptions {
  usageClient: UsageClient
}

/** Parse + clamp the `days` query param. Falls back to the default for junk. */
export function parseDays(raw: unknown): number {
  // An empty/whitespace string is "missing" → default (Number('') is 0, not NaN).
  if (typeof raw === 'string' && raw.trim() === '') return DEFAULT_DAYS
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN
  if (!Number.isFinite(n)) return DEFAULT_DAYS
  const floored = Math.floor(n)
  if (floored < MIN_DAYS) return MIN_DAYS
  if (floored > MAX_DAYS) return MAX_DAYS
  return floored
}

export const usageRoutes: FastifyPluginAsync<UsageRoutesOptions> = async (
  app: FastifyInstance,
  opts: UsageRoutesOptions,
) => {
  const { usageClient } = opts

  app.get<{ Querystring: { days?: string } }>(
    '/api/agent-deck/usage',
    async (request, reply): Promise<UsageSummary | { error: string }> => {
      const days = parseDays(request.query?.days)
      try {
        return await usageClient.getUsage(days)
      } catch (err) {
        // The dashboard is an upstream dependency; surface its failure as a 502.
        // The DashboardError message is safe (never carries the token).
        const message =
          err instanceof DashboardError
            ? `dashboard usage unavailable: ${err.message}`
            : 'dashboard usage unavailable'
        reply.code(502)
        return { error: message }
      }
    },
  )
}

export default usageRoutes

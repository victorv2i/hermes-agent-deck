/**
 * Cron / Jobs BFF — REST over the hermes loopback dashboard's scheduler API
 * (`:9123` `/api/cron/*`, see hermes_cli/web_server.py). Mounts seven routes under
 * `/api/agent-deck/cron` that proxy + slim the dashboard's job data into the
 * whitelisted {@link CronJob} wire shape (packages/protocol/src/cron.ts):
 *
 *   GET    /api/agent-deck/cron/jobs                  → list (all profiles)
 *   POST   /api/agent-deck/cron/jobs                  → create
 *   GET    /api/agent-deck/cron/jobs/:id              → one job
 *   PUT    /api/agent-deck/cron/jobs/:id              → edit (prompt/schedule/name)
 *   DELETE /api/agent-deck/cron/jobs/:id              → delete
 *   POST   /api/agent-deck/cron/jobs/:id/pause        → pause
 *   POST   /api/agent-deck/cron/jobs/:id/resume       → resume
 *   POST   /api/agent-deck/cron/jobs/:id/trigger      → run now
 *
 * The {@link CronClient} owns the dashboard auth handshake + the raw→slim mapping;
 * this layer only validates input, names routes, and translates upstream errors to
 * honest HTTP statuses (404 unknown job, 400 bad input/schedule, else 502). The
 * dashboard session token is held server-side and never enters a response or log.
 *
 * Mount with NO prefix (paths are absolute), gated like the other dashboard-proxy
 * routes by the integrator: `await app.register(registerCronRoutes, { cronClient })`.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { CronJobCreateInput, CronJobUpdateInput, type CronJob } from '@agent-deck/protocol'
import { DashboardError } from '../hermes/dashboardClient'
import type { CronClient } from './cronClient'

export interface CronRoutesOptions {
  cronClient: CronClient
}

type JobReply = CronJob | { error: string }
type ListReply = { jobs: CronJob[] } | { error: string }

/**
 * Translate an upstream failure to an HTTP status for the browser:
 *   - DashboardError 404 → 404 (unknown job)
 *   - DashboardError 400 → 400 (bad schedule / invalid update)
 *   - anything else      → 502 (the dashboard is an upstream dependency)
 * The message is generic + token-free (DashboardError never carries the token).
 */
function statusForUpstream(err: unknown): { code: number; message: string } {
  if (err instanceof DashboardError) {
    if (err.status === 404) return { code: 404, message: 'Job not found' }
    if (err.status === 400) return { code: 400, message: 'Invalid cron job request' }
  }
  return { code: 502, message: 'Upstream dashboard error' }
}

export const registerCronRoutes: FastifyPluginAsync<CronRoutesOptions> = async (
  app: FastifyInstance,
  opts: CronRoutesOptions,
) => {
  const { cronClient } = opts

  app.get<{ Querystring: { profile?: string } }>(
    '/api/agent-deck/cron/jobs',
    async (req, reply): Promise<ListReply> => {
      try {
        const jobs = await cronClient.list(req.query.profile ?? 'all')
        return { jobs }
      } catch (err) {
        const { code, message } = statusForUpstream(err)
        reply.code(code)
        return { error: message }
      }
    },
  )

  app.post<{ Querystring: { profile?: string } }>(
    '/api/agent-deck/cron/jobs',
    async (req, reply): Promise<JobReply> => {
      const parsed = CronJobCreateInput.safeParse(req.body)
      if (!parsed.success) {
        reply.code(400)
        return { error: parsed.error.issues[0]?.message ?? 'Invalid cron job' }
      }
      try {
        const profile = parsed.data.profile ?? req.query.profile
        return await cronClient.create({ ...parsed.data, profile })
      } catch (err) {
        const { code, message } = statusForUpstream(err)
        reply.code(code)
        return { error: message }
      }
    },
  )

  app.get<{ Params: { id: string }; Querystring: { profile?: string } }>(
    '/api/agent-deck/cron/jobs/:id',
    async (req, reply): Promise<JobReply> => {
      try {
        return await cronClient.get(req.params.id, req.query.profile)
      } catch (err) {
        const { code, message } = statusForUpstream(err)
        reply.code(code)
        return { error: message }
      }
    },
  )

  app.put<{ Params: { id: string }; Querystring: { profile?: string } }>(
    '/api/agent-deck/cron/jobs/:id',
    async (req, reply): Promise<JobReply> => {
      const parsed = CronJobUpdateInput.safeParse(req.body)
      if (!parsed.success) {
        reply.code(400)
        return { error: parsed.error.issues[0]?.message ?? 'Invalid cron job update' }
      }
      try {
        return await cronClient.update(req.params.id, parsed.data, req.query.profile)
      } catch (err) {
        const { code, message } = statusForUpstream(err)
        reply.code(code)
        return { error: message }
      }
    },
  )

  app.delete<{ Params: { id: string }; Querystring: { profile?: string } }>(
    '/api/agent-deck/cron/jobs/:id',
    async (req, reply): Promise<{ ok: true } | { error: string }> => {
      try {
        await cronClient.remove(req.params.id, req.query.profile)
        return { ok: true }
      } catch (err) {
        const { code, message } = statusForUpstream(err)
        reply.code(code)
        return { error: message }
      }
    },
  )

  // Per-job lifecycle actions share a shape: POST → returns the updated job.
  for (const verb of ['pause', 'resume', 'trigger'] as const) {
    app.post<{ Params: { id: string }; Querystring: { profile?: string } }>(
      `/api/agent-deck/cron/jobs/:id/${verb}`,
      async (req, reply): Promise<JobReply> => {
        try {
          return await cronClient[verb](req.params.id, req.query.profile)
        } catch (err) {
          const { code, message } = statusForUpstream(err)
          reply.code(code)
          return { error: message }
        }
      },
    )
  }
}

export default registerCronRoutes

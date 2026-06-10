/**
 * Kanban BFF — REST over hermes's native kanban dashboard plugin
 * (`/api/plugins/kanban/*`). Mounts the read surface + the three WRITABLE
 * mutations under `/api/agent-deck/kanban`, proxying + slimming the plugin's data
 * into the whitelisted DTOs (packages/protocol/src/kanban.ts):
 *
 *   READS (availability envelope):
 *   GET  /api/agent-deck/kanban/board           (?board=slug)  → full board
 *   GET  /api/agent-deck/kanban/boards                         → multi-project list
 *   GET  /api/agent-deck/kanban/tasks/:id       (?board=slug)  → task drawer detail
 *   GET  /api/agent-deck/kanban/workers/active  (?board=slug)  → active workers strip
 *   GET  /api/agent-deck/kanban/stats           (?board=slug)  → board HUD stats
 *
 *   MUTATIONS (each maps 1:1 onto a REAL stock plugin route — see
 *   knownHermesRoutes.ts cites; the registry test pins every upstream path):
 *   POST /api/agent-deck/kanban/tasks            (?board=slug)  → create a card
 *   POST /api/agent-deck/kanban/tasks/:id/move   (?board=slug)  → move a card's column
 *   POST /api/agent-deck/kanban/tasks/:id/comments (?board=slug) → add a comment
 *
 * Reads use the AVAILABILITY envelope: `{ available: false }` when the kanban plugin
 * is not installed on this hermes (honest empty state), or `{ available: true, data }`.
 * The {@link KanbanClient} owns the plugin-absent (404) → `available:false` degrade
 * and the raw→slim mapping; this layer names routes, validates a write body against the
 * protocol zod schema (400 on a bad body), and translates a REAL upstream failure (not
 * a missing plugin) to a 502. The dashboard session token is held server-side and never
 * enters a response/log.
 *
 * Mount with NO prefix (paths are absolute):
 *   await app.register(registerKanbanRoutes, { kanbanClient })
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import {
  KanbanCommentInput,
  KanbanCreateTaskInput,
  KanbanMoveTaskInput,
  KanbanReassignInput,
  KanbanTerminateInput,
} from '@agent-deck/protocol'
import { DashboardError } from '../hermes/dashboardClient'
import type { KanbanClient } from './kanbanClient'

export interface KanbanRoutesOptions {
  kanbanClient: KanbanClient
}

/**
 * Translate an upstream failure to an HTTP status. NOTE: a missing-plugin 404 NEVER
 * reaches here — the client maps it to `{ available: false }` and resolves normally.
 * So a 404 that DID escape means the upstream genuinely failed; everything maps to 502
 * (the dashboard is an upstream dependency). The message is generic + token-free.
 */
function statusForUpstream(err: unknown): { code: number; message: string } {
  if (err instanceof DashboardError && err.status === 400) {
    return { code: 400, message: 'Invalid kanban request' }
  }
  return { code: 502, message: 'Upstream dashboard error' }
}

export const registerKanbanRoutes: FastifyPluginAsync<KanbanRoutesOptions> = async (
  app: FastifyInstance,
  opts: KanbanRoutesOptions,
) => {
  const { kanbanClient } = opts

  app.get<{ Querystring: { board?: string } }>(
    '/api/agent-deck/kanban/board',
    async (req, reply) => {
      try {
        return await kanbanClient.board(req.query.board)
      } catch (err) {
        const { code, message } = statusForUpstream(err)
        reply.code(code)
        return { error: message }
      }
    },
  )

  app.get('/api/agent-deck/kanban/boards', async (_req, reply) => {
    try {
      return await kanbanClient.boards()
    } catch (err) {
      const { code, message } = statusForUpstream(err)
      reply.code(code)
      return { error: message }
    }
  })

  app.get<{ Params: { id: string }; Querystring: { board?: string } }>(
    '/api/agent-deck/kanban/tasks/:id',
    async (req, reply) => {
      try {
        return await kanbanClient.task(req.params.id, req.query.board)
      } catch (err) {
        const { code, message } = statusForUpstream(err)
        reply.code(code)
        return { error: message }
      }
    },
  )

  app.get<{ Querystring: { board?: string } }>(
    '/api/agent-deck/kanban/workers/active',
    async (req, reply) => {
      try {
        return await kanbanClient.workers(req.query.board)
      } catch (err) {
        const { code, message } = statusForUpstream(err)
        reply.code(code)
        return { error: message }
      }
    },
  )

  app.get<{ Querystring: { board?: string } }>(
    '/api/agent-deck/kanban/stats',
    async (req, reply) => {
      try {
        return await kanbanClient.stats(req.query.board)
      } catch (err) {
        const { code, message } = statusForUpstream(err)
        reply.code(code)
        return { error: message }
      }
    },
  )

  // --- MUTATIONS (writable cut) ---

  /** Create a card. Body validated against the protocol schema; 400 on a bad body. */
  app.post<{ Querystring: { board?: string }; Body: unknown }>(
    '/api/agent-deck/kanban/tasks',
    async (req, reply) => {
      const parsed = KanbanCreateTaskInput.safeParse(req.body)
      if (!parsed.success) {
        reply.code(400)
        return { error: parsed.error.issues[0]?.message ?? 'Invalid task' }
      }
      try {
        return await kanbanClient.createTask(parsed.data, req.query.board)
      } catch (err) {
        const { code, message } = statusForUpstream(err)
        reply.code(code)
        return { error: message }
      }
    },
  )

  /**
   * Move a card to a new column. The body's `status` is constrained by the
   * protocol's {@link KanbanMoveTaskInput} to the backend-ACCEPTED targets only
   * (no running/review/archived), so an impossible move is rejected at the door.
   * A 200 with `{ ok: false, error }` is an HONEST refusal the UI rolls back on.
   */
  app.post<{ Params: { id: string }; Querystring: { board?: string }; Body: unknown }>(
    '/api/agent-deck/kanban/tasks/:id/move',
    async (req, reply) => {
      const parsed = KanbanMoveTaskInput.safeParse(req.body)
      if (!parsed.success) {
        reply.code(400)
        return { error: parsed.error.issues[0]?.message ?? 'Invalid move' }
      }
      try {
        return await kanbanClient.moveTask(req.params.id, parsed.data, req.query.board)
      } catch (err) {
        const { code, message } = statusForUpstream(err)
        reply.code(code)
        return { error: message }
      }
    },
  )

  /** Add a comment to a card. Body validated; 400 on an empty comment. */
  app.post<{ Params: { id: string }; Querystring: { board?: string }; Body: unknown }>(
    '/api/agent-deck/kanban/tasks/:id/comments',
    async (req, reply) => {
      const parsed = KanbanCommentInput.safeParse(req.body)
      if (!parsed.success) {
        reply.code(400)
        return { error: parsed.error.issues[0]?.message ?? 'Invalid comment' }
      }
      try {
        return await kanbanClient.addComment(req.params.id, parsed.data, req.query.board)
      } catch (err) {
        const { code, message } = statusForUpstream(err)
        reply.code(code)
        return { error: message }
      }
    },
  )

  // --- ORCHESTRATION (the run-control cut) ---

  /**
   * Nudge the dispatcher to spawn workers for ready tasks now. No body; proxies
   * `POST /api/plugins/kanban/dispatch` (plugin_api.py:1944). Returns the slim,
   * host-free dispatch tally so the UI can report how many tasks actually started.
   */
  app.post<{ Querystring: { board?: string } }>(
    '/api/agent-deck/kanban/dispatch',
    async (req, reply) => {
      try {
        return await kanbanClient.dispatch(req.query.board)
      } catch (err) {
        const { code, message } = statusForUpstream(err)
        reply.code(code)
        return { error: message }
      }
    },
  )

  /**
   * Terminate a running task's worker (keyed on run_id). Body validated; 400 on a
   * bad body. Proxies `POST /api/plugins/kanban/runs/:runId/terminate`
   * (plugin_api.py:1494). A benign 409 (run already ended) is mapped by the client
   * to a 200 `{ ok: false, error }` — an honest, non-fatal outcome.
   */
  app.post<{ Params: { id: string }; Querystring: { board?: string }; Body: unknown }>(
    '/api/agent-deck/kanban/tasks/:id/terminate',
    async (req, reply) => {
      const parsed = KanbanTerminateInput.safeParse(req.body)
      if (!parsed.success) {
        reply.code(400)
        return { error: parsed.error.issues[0]?.message ?? 'Invalid terminate request' }
      }
      try {
        return await kanbanClient.terminateRun(parsed.data, req.query.board)
      } catch (err) {
        const { code, message } = statusForUpstream(err)
        reply.code(code)
        return { error: message }
      }
    },
  )

  /**
   * Reassign a task to a different worker profile (with optional reclaim-first).
   * Body validated; 400 on a bad body. Proxies `POST
   * /api/plugins/kanban/tasks/:id/reassign` (plugin_api.py:1641). A benign 409
   * (unknown id / still running) is mapped by the client to a 200 `{ ok: false,
   * error }` so the UI can re-offer with reclaim rather than show a hard failure.
   */
  app.post<{ Params: { id: string }; Querystring: { board?: string }; Body: unknown }>(
    '/api/agent-deck/kanban/tasks/:id/reassign',
    async (req, reply) => {
      const parsed = KanbanReassignInput.safeParse(req.body)
      if (!parsed.success) {
        reply.code(400)
        return { error: parsed.error.issues[0]?.message ?? 'Invalid reassign request' }
      }
      try {
        return await kanbanClient.reassignTask(req.params.id, parsed.data, req.query.board)
      } catch (err) {
        const { code, message } = statusForUpstream(err)
        reply.code(code)
        return { error: message }
      }
    },
  )
}

export default registerKanbanRoutes

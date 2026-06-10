/**
 * Skills BFF — the Skills browser surface + on-disk CRUD.
 *
 * DASHBOARD-PROXIED (list + toggle — stock hermes owns these):
 *   GET /api/agent-deck/skills        -> { skills: SkillSummary[] }
 *   PUT /api/agent-deck/skills/toggle -> { name, enabled }   (body { name, enabled })
 *
 * FILESYSTEM-BACKED (create / edit / delete — stock hermes has NO such routes,
 * so the BFF acts on the on-disk skills tree directly, exactly like the SOUL/
 * MEMORY profile files; every path is path-guarded):
 *   GET    /api/agent-deck/skills/body?path=<rel> -> { path, content, exists, hasExtraFiles }
 *   PUT    /api/agent-deck/skills/body  body { path, content }   -> { ok }
 *   POST   /api/agent-deck/skills       body { name, category? } -> 201 { path }
 *   DELETE /api/agent-deck/skills       body { path }            -> { ok }
 *
 * A skill's IDENTITY for the CRUD routes is its directory path RELATIVE to
 * <HERMES_HOME>/skills (e.g. `creative/ascii-art`) — unambiguous + guardable. The
 * list route additionally ENRICHES each dashboard skill with its resolved on-disk
 * `path` (matched by frontmatter name + category) so the UI can drive edit/delete
 * unambiguously; a skill whose path cannot be resolved gets `path: null` and the
 * UI honestly disables edit/delete for it. The dashboard session token is never
 * surfaced. The toggle stays the dashboard's mutation; create/edit/delete are
 * ours, on local files the user owns.
 *
 * Mount with no prefix (paths are absolute):
 *   await app.register(registerSkillsRoutes, { dashboard, hermesHome })
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify'
import type { DashboardClient } from '../hermes/dashboardClient'
import { SkillsClient, type SkillSummary } from './skillsClient'
import { PathGuardError } from '../files/pathGuard'
import {
  readSkillBody,
  writeSkillBody,
  createSkill,
  deleteSkill,
  resolveSkillPathByName,
  SkillNotFoundError,
  SkillExistsError,
  type SkillBody,
} from './skillsFs'

export interface SkillsRouteOptions {
  /** Shared dashboard client (auth + token handling already wired). */
  dashboard: DashboardClient
  /** Override the HERMES_HOME directory (tests / non-default installs). */
  hermesHome?: string
}

/** A listed skill enriched with its resolved on-disk relative path (or null). */
type EnrichedSkill = SkillSummary & { path: string | null }

interface SkillsListResponse {
  skills: EnrichedSkill[]
}
interface ToggleResponse {
  name: string
  enabled: boolean
}
interface ErrorResponse {
  error: string
}

/** Narrow, defensive parse of the toggle request body. */
function parseToggleBody(body: unknown): { name: string; enabled: boolean } | null {
  if (!body || typeof body !== 'object') return null
  const { name, enabled } = body as { name?: unknown; enabled?: unknown }
  if (typeof name !== 'string' || name === '') return null
  if (typeof enabled !== 'boolean') return null
  return { name, enabled }
}

function resolveHermesHome(opts: SkillsRouteOptions): string {
  if (opts.hermesHome) return opts.hermesHome
  if (process.env.HERMES_HOME) return process.env.HERMES_HOME
  return join(homedir(), '.hermes')
}

export const registerSkillsRoutes: FastifyPluginAsync<SkillsRouteOptions> = async (
  app: FastifyInstance,
  opts: SkillsRouteOptions,
) => {
  const client = new SkillsClient(opts.dashboard)
  const hermesHome = resolveHermesHome(opts)

  /** Map a thrown fs/guard error to an HTTP reply (guard → 403, missing → 404). */
  function sendFsError(reply: FastifyReply, err: unknown): FastifyReply {
    if (err instanceof PathGuardError) {
      return reply.code(403).send({ error: 'forbidden' })
    }
    if (err instanceof SkillNotFoundError) {
      return reply.code(404).send({ error: 'not_found' })
    }
    if (err instanceof SkillExistsError) {
      return reply.code(409).send({ error: 'skill_exists' })
    }
    return reply.code(500).send({ error: 'skill request failed' })
  }

  app.get(
    '/api/agent-deck/skills',
    async (_req, reply): Promise<SkillsListResponse | ErrorResponse> => {
      try {
        const skills = await client.listSkills()
        // Enrich with the on-disk path so the UI can edit/delete unambiguously.
        // Best-effort + presence-safe: an fs resolve failure leaves path null
        // (the UI then disables edit/delete for that row, honestly).
        const enriched: EnrichedSkill[] = skills.map((s) => {
          let path: string | null
          try {
            path = resolveSkillPathByName(hermesHome, s.name, s.category)
          } catch {
            path = null
          }
          return { ...s, path }
        })
        return { skills: enriched }
      } catch {
        // DashboardClient scrubs the token from its messages; we still return a
        // generic message. Any dashboard failure surfaces as 502.
        reply.code(502)
        return { error: 'Unable to reach the hermes dashboard for skills.' }
      }
    },
  )

  app.put(
    '/api/agent-deck/skills/toggle',
    async (req, reply): Promise<ToggleResponse | ErrorResponse> => {
      const parsed = parseToggleBody(req.body)
      if (!parsed) {
        reply.code(400)
        return { error: 'Body must be { name: string, enabled: boolean }.' }
      }
      try {
        return await client.toggleSkill(parsed.name, parsed.enabled)
      } catch {
        reply.code(502)
        return { error: 'Unable to update the skill on the hermes dashboard.' }
      }
    },
  )

  // ── Body read (the editable SKILL.md) ──
  app.get<{ Querystring: { path?: string } }>(
    '/api/agent-deck/skills/body',
    async (req, reply): Promise<SkillBody | FastifyReply> => {
      const path = req.query?.path
      if (typeof path !== 'string' || path === '') {
        return reply.code(400).send({ error: 'path (string) is required' })
      }
      try {
        return readSkillBody(hermesHome, path)
      } catch (err) {
        return sendFsError(reply, err)
      }
    },
  )

  // ── Body write (edit an existing skill's SKILL.md) ──
  app.put<{ Body: { path?: unknown; content?: unknown } }>(
    '/api/agent-deck/skills/body',
    async (req, reply) => {
      const { path, content } = req.body ?? {}
      if (typeof path !== 'string' || path === '') {
        return reply.code(400).send({ error: 'path (string) is required' })
      }
      if (typeof content !== 'string') {
        return reply.code(400).send({ error: 'content (string) is required' })
      }
      try {
        writeSkillBody(hermesHome, path, content)
        return await reply.send({ ok: true })
      } catch (err) {
        return sendFsError(reply, err)
      }
    },
  )

  // ── Create (a new skill from the minimal template) ──
  app.post<{ Body: { name?: unknown; category?: unknown } }>(
    '/api/agent-deck/skills',
    async (req, reply) => {
      const { name, category } = req.body ?? {}
      if (typeof name !== 'string' || name === '') {
        return reply.code(400).send({ error: 'name (string) is required' })
      }
      const cat = typeof category === 'string' && category !== '' ? category : null
      try {
        const path = createSkill(hermesHome, name, cat)
        return await reply.code(201).send({ path })
      } catch (err) {
        // An invalid name/category fails the segment guard → 400 (a request
        // shaping error, not a traversal attempt), distinct from a real traversal
        // in an existing path which never reaches here.
        if (err instanceof PathGuardError) {
          return reply.code(400).send({ error: 'invalid name or category' })
        }
        return sendFsError(reply, err)
      }
    },
  )

  // ── Delete (confirm-gated in the UI; here it just removes the dir) ──
  app.delete<{ Body: { path?: unknown } }>('/api/agent-deck/skills', async (req, reply) => {
    const path = req.body?.path
    if (typeof path !== 'string' || path === '') {
      return reply.code(400).send({ error: 'path (string) is required' })
    }
    try {
      deleteSkill(hermesHome, path)
      return await reply.send({ ok: true })
    } catch (err) {
      return sendFsError(reply, err)
    }
  })
}

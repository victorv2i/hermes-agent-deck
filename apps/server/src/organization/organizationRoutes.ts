/**
 * Organization BFF — Agent Deck's OWN project/tag metadata over the read-only
 * hermes session list. Unlike the dashboard-proxy surfaces, this owns a
 * server-side JSON store ({@link OrganizationStore}) at
 * `<HERMES_HOME>/agent-deck/organization.json`, so the data syncs across the
 * user's devices (they drive the one `:7878` over Tailscale).
 *
 *   GET    /api/agent-deck/organization              → { projects, assignments }
 *   POST   /api/agent-deck/projects                  → create (server assigns id)
 *   PATCH  /api/agent-deck/projects/:id              → rename/recolor
 *   DELETE /api/agent-deck/projects/:id              → delete (+ clear its assignments)
 *   PUT    /api/agent-deck/sessions/:id/organization → set project + tags
 *
 * This layer validates input through the protocol DTOs, normalizes tags, names
 * the routes, and maps failures to honest statuses (400 bad input, 404 unknown
 * project). The store never surfaces a filesystem path in any response.
 *
 * Mount with NO prefix (paths are absolute), gated like the other
 * `/api/agent-deck/*` routes by the integrator:
 *   await app.register(registerOrganizationRoutes, { store })
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import {
  Organization,
  ProjectCreateInput,
  ProjectUpdateInput,
  SessionOrganizationInput,
  TAG_MAX_LENGTH,
  TAGS_MAX_COUNT,
  type Project,
  type SessionAssignment,
} from '@agent-deck/protocol'
import type { OrganizationStore } from './organizationStore'

export interface OrganizationRoutesOptions {
  /** The server-side organization store (path injected by the integrator). */
  store: OrganizationStore
}

/**
 * Normalize a raw tag list into the canonical stored shape: trim each tag,
 * lowercase it, drop empties, cap each to {@link TAG_MAX_LENGTH} chars, dedupe
 * (first occurrence wins, order preserved), and cap the set to
 * {@link TAGS_MAX_COUNT}. Pure + total so it's trivially testable and the stored
 * shape is always canonical regardless of what the client sent.
 */
export function normalizeTags(raw: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of raw) {
    const tag = value.trim().toLowerCase().slice(0, TAG_MAX_LENGTH)
    if (tag === '' || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
    if (out.length >= TAGS_MAX_COUNT) break
  }
  return out
}

type ErrorReply = { error: string }

export const registerOrganizationRoutes: FastifyPluginAsync<OrganizationRoutesOptions> = async (
  app: FastifyInstance,
  opts: OrganizationRoutesOptions,
) => {
  const { store } = opts

  app.get(
    '/api/agent-deck/organization',
    async (_req, reply): Promise<Organization | ErrorReply> => {
      try {
        return await store.load()
      } catch {
        reply.code(500)
        return { error: 'Unable to read the organization store.' }
      }
    },
  )

  app.post('/api/agent-deck/projects', async (req, reply): Promise<Project | ErrorReply> => {
    const parsed = ProjectCreateInput.safeParse(req.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: parsed.error.issues[0]?.message ?? 'Invalid project' }
    }
    try {
      reply.code(201)
      return await store.createProject(parsed.data)
    } catch {
      reply.code(500)
      return { error: 'Unable to save the project.' }
    }
  })

  app.patch<{ Params: { id: string } }>(
    '/api/agent-deck/projects/:id',
    async (req, reply): Promise<Project | ErrorReply> => {
      const parsed = ProjectUpdateInput.safeParse(req.body)
      if (!parsed.success) {
        reply.code(400)
        return { error: parsed.error.issues[0]?.message ?? 'Invalid project update' }
      }
      try {
        const updated = await store.updateProject(req.params.id, parsed.data)
        if (!updated) {
          reply.code(404)
          return { error: 'Project not found' }
        }
        return updated
      } catch {
        reply.code(500)
        return { error: 'Unable to update the project.' }
      }
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/agent-deck/projects/:id',
    async (req, reply): Promise<{ ok: true } | ErrorReply> => {
      try {
        const removed = await store.deleteProject(req.params.id)
        if (!removed) {
          reply.code(404)
          return { error: 'Project not found' }
        }
        return { ok: true }
      } catch {
        reply.code(500)
        return { error: 'Unable to delete the project.' }
      }
    },
  )

  app.put<{ Params: { id: string } }>(
    '/api/agent-deck/sessions/:id/organization',
    async (req, reply): Promise<SessionAssignment | ErrorReply> => {
      const parsed = SessionOrganizationInput.safeParse(req.body)
      if (!parsed.success) {
        reply.code(400)
        return { error: parsed.error.issues[0]?.message ?? 'Invalid session organization' }
      }
      try {
        return await store.setSessionOrganization(req.params.id, {
          projectId: parsed.data.projectId,
          tags: normalizeTags(parsed.data.tags),
        })
      } catch {
        reply.code(500)
        return { error: 'Unable to update the session organization.' }
      }
    },
  )
}

export default registerOrganizationRoutes

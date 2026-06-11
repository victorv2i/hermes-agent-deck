/**
 * Sessions BFF — REST proxy over the hermes loopback dashboard (`:9123`).
 *
 * Mounts routes under `/api/agent-deck` that proxy + project the dashboard's
 * session data into the feature-local wire shapes (sessionTypes.ts):
 *   GET    /api/agent-deck/sessions              → dashboard GET  /api/sessions
 *   GET    /api/agent-deck/sessions/stats        → dashboard GET  /api/sessions/stats
 *   GET    /api/agent-deck/sessions/:id          → dashboard GET  /api/sessions/{id}
 *   GET    /api/agent-deck/sessions/:id/messages → dashboard GET  /api/sessions/{id}/messages
 *   GET    /api/agent-deck/sessions/:id/export   → dashboard GET  /api/sessions/{id}/export
 *   GET    /api/agent-deck/search/sessions?q=    → dashboard GET  /api/sessions/search
 *   DELETE /api/agent-deck/sessions/:id          → dashboard DELETE /api/sessions/{id}
 *   PATCH  /api/agent-deck/sessions/:id          → dashboard PATCH /api/sessions/{id} (rename/archive)
 *   POST   /api/agent-deck/sessions/prune        → dashboard POST /api/sessions/prune
 *
 * Stock Hermes v0.15.2 exposes PATCH /api/sessions/{id} for rename + archive
 * (web_server.py:4006) and POST /api/sessions/prune (web_server.py:4063). These
 * routes are real and verified against the stock source.
 *
 * The {@link DashboardClient} owns the same-host auth handshake; this layer only
 * maps payloads and translates upstream errors to honest HTTP statuses. The
 * dashboard session token is held server-side by the client and never enters a
 * response body or log line here.
 *
 * Registered as a Fastify plugin so the integrator wires it with one call in
 * app.ts: `await registerSessionRoutes(app, { dashboard })`.
 */
import type { FastifyInstance } from 'fastify'
import { DashboardClient, DashboardError } from '../hermes/dashboardClient'
import {
  mapSessionSummary,
  mapSessionDetail,
  mapSessionMessage,
  mapSearchResult,
} from './sessionMappers'
import type {
  SessionListResponse,
  SessionDetail,
  SessionMessagesResponse,
  SessionSearchResponse,
  SessionStats,
  SessionPatchRequest,
  SessionPatchResponse,
  SessionPruneRequest,
  SessionPruneResponse,
} from './sessionTypes'

export interface SessionRoutesDeps {
  /** Authenticated client for the loopback hermes dashboard. */
  dashboard: DashboardClient
}

interface RawListPayload {
  sessions?: unknown
  total?: unknown
}
interface RawMessagesPayload {
  session_id?: unknown
  messages?: unknown
}
interface RawSearchPayload {
  results?: unknown
}

/** Translate a {@link DashboardError} to an HTTP status for the browser:
 * upstream 404 → 404 (unknown session); anything else upstream → 502 (bad
 * gateway). The error message is generic; the token never appears in it. */
function statusForUpstream(err: unknown): { code: number; message: string } {
  if (err instanceof DashboardError && err.status === 404) {
    return { code: 404, message: 'Session not found' }
  }
  return { code: 502, message: 'Upstream dashboard error' }
}

/**
 * Like {@link statusForUpstream} but for routes where a 404 from the dashboard
 * is NOT a "session not found" — it means the route itself is unavailable, which
 * is a gateway error for the browser (502). Used for stats, prune, etc. where
 * there is no session ID in the path.
 */
function statusForUpstreamNoSession(): { code: number; message: string } {
  return { code: 502, message: 'Upstream dashboard error' }
}

export async function registerSessionRoutes(
  app: FastifyInstance,
  deps: SessionRoutesDeps,
): Promise<void> {
  const { dashboard } = deps

  app.get<{
    Querystring: { limit?: string; offset?: string; source?: string; order?: string }
  }>('/api/agent-deck/sessions', async (req, reply): Promise<SessionListResponse | void> => {
    // `order` is forwarded as-is ('created' | 'recent', web_server.py:1769) —
    // 'recent' paginates by latest activity so the rail's first page can never
    // miss the most-recently-active conversation.
    const qs = buildQuery({
      limit: req.query.limit,
      offset: req.query.offset,
      source: req.query.source,
      order: req.query.order,
    })
    try {
      const raw = await dashboard.getJson<RawListPayload>(`/api/sessions${qs}`)
      const sessions = Array.isArray(raw.sessions) ? raw.sessions : []
      return {
        sessions: sessions.map(mapSessionSummary),
        total: typeof raw.total === 'number' ? raw.total : sessions.length,
      }
    } catch (err) {
      const { code, message } = statusForUpstream(err)
      return reply.code(code).send({ error: message })
    }
  })

  app.get<{ Params: { id: string } }>(
    '/api/agent-deck/sessions/:id',
    async (req, reply): Promise<SessionDetail | void> => {
      try {
        const raw = await dashboard.getJson<unknown>(
          `/api/sessions/${encodeURIComponent(req.params.id)}`,
        )
        return mapSessionDetail(raw)
      } catch (err) {
        const { code, message } = statusForUpstream(err)
        return reply.code(code).send({ error: message })
      }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/api/agent-deck/sessions/:id/messages',
    async (req, reply): Promise<SessionMessagesResponse | void> => {
      try {
        const raw = await dashboard.getJson<RawMessagesPayload>(
          `/api/sessions/${encodeURIComponent(req.params.id)}/messages`,
        )
        const messages = Array.isArray(raw.messages) ? raw.messages : []
        return {
          session_id: typeof raw.session_id === 'string' ? raw.session_id : req.params.id,
          messages: messages.map(mapSessionMessage),
        }
      } catch (err) {
        const { code, message } = statusForUpstream(err)
        return reply.code(code).send({ error: message })
      }
    },
  )

  app.get<{ Querystring: { q?: string; source?: string; limit?: string } }>(
    '/api/agent-deck/search/sessions',
    async (req, reply): Promise<SessionSearchResponse | void> => {
      const q = (req.query.q ?? '').trim()
      // Mirror the dashboard's own short-circuit: a blank query returns nothing
      // and never touches the upstream FTS index.
      if (!q) return { results: [] }
      const qs = buildQuery({ q, source: req.query.source, limit: req.query.limit })
      try {
        const raw = await dashboard.getJson<RawSearchPayload>(`/api/sessions/search${qs}`)
        const results = Array.isArray(raw.results) ? raw.results : []
        return { results: results.map(mapSearchResult) }
      } catch (err) {
        const { code, message } = statusForUpstream(err)
        return reply.code(code).send({ error: message })
      }
    },
  )

  // The only session mutation: a real, destructive delete that proxies the
  // dashboard's `DELETE /api/sessions/{id}`. We don't echo the (variable)
  // upstream body — a clean `{ deleted: true }` keeps the web client's success
  // contract stable regardless of what the dashboard returns. Upstream 404
  // (unknown session) maps to 404; anything else to 502.
  app.delete<{ Params: { id: string } }>(
    '/api/agent-deck/sessions/:id',
    async (req, reply): Promise<{ deleted: true } | void> => {
      try {
        const res = await dashboard.authedFetch(
          `/api/sessions/${encodeURIComponent(req.params.id)}`,
          { method: 'DELETE', headers: { Accept: 'application/json' } },
        )
        if (!res.ok) {
          throw new DashboardError(`DELETE failed: HTTP ${res.status}`, res.status)
        }
        return { deleted: true }
      } catch (err) {
        const { code, message } = statusForUpstream(err)
        return reply.code(code).send({ error: message })
      }
    },
  )

  // --- Session stats (web_server.py:3916) ---
  // Public read-only aggregate — session counts by source / archive state.
  app.get('/api/agent-deck/sessions/stats', async (_req, reply): Promise<SessionStats | void> => {
    try {
      const raw = await dashboard.getJson<SessionStats>('/api/sessions/stats')
      return raw
    } catch {
      const { code, message } = statusForUpstreamNoSession()
      return reply.code(code).send({ error: message })
    }
  })

  // --- Rename / archive session (web_server.py:4006) ---
  // PATCH accepts { title?, archived? }. The dashboard validates title length/chars;
  // a bad title comes back as a 400, which we surface honestly (not swallowed to 502).
  app.patch<{ Params: { id: string }; Body: SessionPatchRequest }>(
    '/api/agent-deck/sessions/:id',
    async (req, reply): Promise<SessionPatchResponse | void> => {
      const body = req.body ?? {}
      if (body.title === undefined && body.archived === undefined) {
        return reply.code(400).send({ error: "Provide 'title' and/or 'archived'." })
      }
      try {
        const res = await dashboard.authedFetch(
          `/api/sessions/${encodeURIComponent(req.params.id)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(body),
          },
        )
        if (res.status === 400) {
          // Bad title (too long / invalid chars / duplicate) — surface honestly.
          let detail = 'Invalid title'
          try {
            const errBody = (await res.json()) as { detail?: string }
            if (typeof errBody.detail === 'string') detail = errBody.detail
          } catch {
            // ignore
          }
          return reply.code(400).send({ error: detail })
        }
        if (!res.ok) {
          throw new DashboardError(`PATCH failed: HTTP ${res.status}`, res.status)
        }
        const result = (await res.json()) as SessionPatchResponse
        return result
      } catch (err) {
        const { code, message } = statusForUpstream(err)
        return reply.code(code).send({ error: message })
      }
    },
  )

  // --- Export session as JSON (web_server.py:4040) ---
  // Returns the full session payload (metadata + messages) as a JSON blob; the
  // web client turns it into a download. Upstream 404 → 404.
  app.get<{ Params: { id: string } }>(
    '/api/agent-deck/sessions/:id/export',
    async (req, reply): Promise<unknown | void> => {
      try {
        const raw = await dashboard.getJson<unknown>(
          `/api/sessions/${encodeURIComponent(req.params.id)}/export`,
        )
        return raw
      } catch (err) {
        const { code, message } = statusForUpstream(err)
        return reply.code(code).send({ error: message })
      }
    },
  )

  // --- Prune ended sessions (web_server.py:4063) ---
  // Deletes sessions older than N days. The dashboard validates older_than_days >= 1.
  // We pre-validate here to give a clean 400 before hitting the network.
  app.post<{ Body: SessionPruneRequest }>(
    '/api/agent-deck/sessions/prune',
    async (req, reply): Promise<SessionPruneResponse | void> => {
      const { older_than_days, source } = req.body ?? {}
      if (typeof older_than_days !== 'number' || older_than_days < 1) {
        return reply.code(400).send({ error: 'older_than_days must be >= 1' })
      }
      try {
        const res = await dashboard.authedFetch('/api/sessions/prune', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ older_than_days, ...(source ? { source } : {}) }),
        })
        if (!res.ok) {
          throw new DashboardError(`prune failed: HTTP ${res.status}`, res.status)
        }
        const result = (await res.json()) as SessionPruneResponse
        return result
      } catch {
        const { code, message } = statusForUpstreamNoSession()
        return reply.code(code).send({ error: message })
      }
    },
  )
}

/** Build a `?a=b&c=d` query string from defined params (URL-encoded). */
function buildQuery(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') sp.set(key, value)
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

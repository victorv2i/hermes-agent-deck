/**
 * CONNECTIONS BFF — Pairing + Webhooks + Credential Pool.
 *
 * Three sub-surfaces, all thin faithful proxies over REAL stock hermes routes:
 *
 *   GET  /api/agent-deck/pairing
 *     Proxies → stock GET /api/pairing (web_server.py:4620).
 *     Returns { pending: PairingUser[], approved: PairingUser[] }.
 *
 *   POST /api/agent-deck/pairing/approve   { platform, code }
 *     Proxies → stock POST /api/pairing/approve (web_server.py:4629).
 *
 *   POST /api/agent-deck/pairing/revoke    { platform, user_id }
 *     Proxies → stock POST /api/pairing/revoke (web_server.py:4651).
 *
 *   POST /api/agent-deck/pairing/clear-pending
 *     Proxies → stock POST /api/pairing/clear-pending (web_server.py:4665).
 *
 *   GET  /api/agent-deck/webhooks
 *     Proxies → stock GET /api/webhooks (web_server.py:4712).
 *     Secret is NEVER present in the list response (secret_set: bool only).
 *
 *   POST /api/agent-deck/webhooks          { name, description?, events?, ... }
 *     Proxies → stock POST /api/webhooks (web_server.py:4728).
 *     The secret is surfaced ONCE in the create response, then never again.
 *
 *   DELETE /api/agent-deck/webhooks/:name
 *     Proxies → stock DELETE /api/webhooks/{name} (web_server.py:4780).
 *
 *   PUT /api/agent-deck/webhooks/:name/enabled   { enabled: bool }
 *     Proxies → stock PUT /api/webhooks/{name}/enabled (web_server.py:4797).
 *
 *   GET  /api/agent-deck/credentials/pool
 *     Proxies → stock GET /api/credentials/pool (web_server.py:4884).
 *     token_preview is a server-side redacted preview; plaintext NEVER crosses.
 *
 *   POST /api/agent-deck/credentials/pool  { provider, api_key, label? }
 *     Proxies → stock POST /api/credentials/pool (web_server.py:4911).
 *     api_key is write-only — NEVER echoed in any response.
 *
 *   DELETE /api/agent-deck/credentials/pool/:provider/:index
 *     Proxies → stock DELETE /api/credentials/pool/{provider}/{index}
 *     (web_server.py:4945).
 *
 * Mount under no prefix (paths already include /api/agent-deck).
 */
import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import {
  ApprovePairingRequest,
  RevokePairingRequest,
  CreateWebhookRequest,
  AddCredentialRequest,
} from '@agent-deck/protocol'
import type { DashboardClient } from '../hermes/dashboardClient'
import { DashboardError } from '../hermes/dashboardClient'

export interface ConnectionsRoutesOptions {
  dashboard: DashboardClient
}

/**
 * Map a failed GET-list proxy to an HONEST reply. A 404 from upstream means the
 * route is absent on THIS Hermes build (version skew) — distinct from a real
 * outage — so we preserve that as a 404 carrying `{ error: 'unsupported' }`, and
 * the tabs render a calm "not available on this Hermes version" state instead of
 * a generic error. Any other DashboardError is a genuine upstream failure (502);
 * a non-DashboardError is an internal fault (500). The generic `fallback` string
 * is used for the non-unsupported cases.
 */
function sendListError(reply: FastifyReply, err: unknown, fallback: string): unknown {
  if (err instanceof DashboardError) {
    if (err.status === 404) {
      return reply.code(404).send({ error: 'unsupported' })
    }
    return reply.code(502).send({ error: fallback })
  }
  return reply.code(500).send({ error: fallback })
}

export const registerConnectionsRoutes: FastifyPluginAsync<ConnectionsRoutesOptions> = async (
  fastify,
  opts,
) => {
  const { dashboard } = opts

  // ── PAIRING ──────────────────────────────────────────────────────────────

  fastify.get('/api/agent-deck/pairing', async (_req, reply) => {
    try {
      return await dashboard.getJson('/api/pairing')
    } catch (err) {
      return sendListError(reply, err, 'Could not load pairing state.')
    }
  })

  fastify.post<{ Body: unknown }>('/api/agent-deck/pairing/approve', async (req, reply) => {
    const parsed = ApprovePairingRequest.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'platform and code are required' })
    }
    try {
      const res = await dashboard.authedFetch('/api/pairing/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(parsed.data),
      })
      const body = (await res.json().catch(() => null)) as unknown
      if (!res.ok) {
        const detail = (body as { detail?: string } | null)?.detail
        return reply
          .code(res.status >= 400 && res.status < 500 ? res.status : 502)
          .send({ error: detail ?? 'Approve failed.' })
      }
      return body
    } catch (err) {
      const status = err instanceof DashboardError ? 502 : 500
      return reply.code(status).send({ error: 'Could not approve pairing.' })
    }
  })

  fastify.post<{ Body: unknown }>('/api/agent-deck/pairing/revoke', async (req, reply) => {
    const parsed = RevokePairingRequest.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'platform and user_id are required' })
    }
    try {
      const res = await dashboard.authedFetch('/api/pairing/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(parsed.data),
      })
      const body = (await res.json().catch(() => null)) as unknown
      if (!res.ok) {
        const detail = (body as { detail?: string } | null)?.detail
        return reply
          .code(res.status >= 400 && res.status < 500 ? res.status : 502)
          .send({ error: detail ?? 'Revoke failed.' })
      }
      return body
    } catch (err) {
      const status = err instanceof DashboardError ? 502 : 500
      return reply.code(status).send({ error: 'Could not revoke pairing.' })
    }
  })

  fastify.post('/api/agent-deck/pairing/clear-pending', async (_req, reply) => {
    try {
      const res = await dashboard.authedFetch('/api/pairing/clear-pending', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      })
      const body = (await res.json().catch(() => null)) as unknown
      if (!res.ok) {
        return reply.code(502).send({ error: 'Clear pending failed.' })
      }
      return body
    } catch (err) {
      const status = err instanceof DashboardError ? 502 : 500
      return reply.code(status).send({ error: 'Could not clear pending pairing.' })
    }
  })

  // ── WEBHOOKS ─────────────────────────────────────────────────────────────

  fastify.get('/api/agent-deck/webhooks', async (_req, reply) => {
    try {
      return await dashboard.getJson('/api/webhooks')
    } catch (err) {
      return sendListError(reply, err, 'Could not load webhooks.')
    }
  })

  fastify.post<{ Body: unknown }>('/api/agent-deck/webhooks', async (req, reply) => {
    const parsed = CreateWebhookRequest.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'name (string) is required' })
    }
    try {
      const res = await dashboard.authedFetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(parsed.data),
      })
      const body = (await res.json().catch(() => null)) as unknown
      if (!res.ok) {
        const detail = (body as { detail?: string } | null)?.detail
        return reply
          .code(res.status >= 400 && res.status < 500 ? res.status : 502)
          .send({ error: detail ?? 'Create webhook failed.' })
      }
      // body includes the one-time secret — pass it through unchanged.
      return body
    } catch (err) {
      const status = err instanceof DashboardError ? 502 : 500
      return reply.code(status).send({ error: 'Could not create webhook.' })
    }
  })

  fastify.delete<{ Params: { name: string } }>(
    '/api/agent-deck/webhooks/:name',
    async (req, reply) => {
      const name = (req.params.name ?? '').trim()
      if (!name) {
        return reply.code(400).send({ error: 'name is required' })
      }
      try {
        const res = await dashboard.authedFetch(`/api/webhooks/${encodeURIComponent(name)}`, {
          method: 'DELETE',
          headers: { Accept: 'application/json' },
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { detail?: string } | null
          return reply
            .code(res.status === 404 ? 404 : 502)
            .send({ error: body?.detail ?? 'Delete webhook failed.' })
        }
        return { ok: true }
      } catch (err) {
        const status = err instanceof DashboardError ? 502 : 500
        return reply.code(status).send({ error: 'Could not delete webhook.' })
      }
    },
  )

  fastify.put<{ Params: { name: string }; Body: unknown }>(
    '/api/agent-deck/webhooks/:name/enabled',
    async (req, reply) => {
      const name = (req.params.name ?? '').trim()
      const body = req.body as { enabled?: unknown }
      if (!name) return reply.code(400).send({ error: 'name is required' })
      if (typeof body?.enabled !== 'boolean') {
        return reply.code(400).send({ error: 'enabled (boolean) is required' })
      }
      try {
        const res = await dashboard.authedFetch(
          `/api/webhooks/${encodeURIComponent(name)}/enabled`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ enabled: body.enabled }),
          },
        )
        const resBody = (await res.json().catch(() => null)) as unknown
        if (!res.ok) {
          const detail = (resBody as { detail?: string } | null)?.detail
          return reply
            .code(res.status === 404 ? 404 : 502)
            .send({ error: detail ?? 'Set enabled failed.' })
        }
        return resBody
      } catch (err) {
        const status = err instanceof DashboardError ? 502 : 500
        return reply.code(status).send({ error: 'Could not update webhook enabled state.' })
      }
    },
  )

  // ── CREDENTIAL POOL ───────────────────────────────────────────────────────

  fastify.get('/api/agent-deck/credentials/pool', async (_req, reply) => {
    try {
      return await dashboard.getJson('/api/credentials/pool')
    } catch (err) {
      return sendListError(reply, err, 'Could not load credential pool.')
    }
  })

  fastify.post<{ Body: unknown }>('/api/agent-deck/credentials/pool', async (req, reply) => {
    const parsed = AddCredentialRequest.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'provider and api_key are required' })
    }
    try {
      const res = await dashboard.authedFetch('/api/credentials/pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        // api_key passes through write-only; NEVER echoed in response.
        body: JSON.stringify(parsed.data),
      })
      const body = (await res.json().catch(() => null)) as unknown
      if (!res.ok) {
        const detail = (body as { detail?: string } | null)?.detail
        return reply
          .code(res.status >= 400 && res.status < 500 ? res.status : 502)
          .send({ error: detail ?? 'Add credential failed.' })
      }
      // Return { ok, provider, count } — api_key is NEVER in the response.
      return body
    } catch (err) {
      const status = err instanceof DashboardError ? 502 : 500
      return reply.code(status).send({ error: 'Could not add credential.' })
    }
  })

  fastify.delete<{ Params: { provider: string; index: string } }>(
    '/api/agent-deck/credentials/pool/:provider/:index',
    async (req, reply) => {
      const provider = (req.params.provider ?? '').trim()
      const indexStr = req.params.index ?? ''
      const index = parseInt(indexStr, 10)
      if (!provider) return reply.code(400).send({ error: 'provider is required' })
      if (!Number.isInteger(index) || index < 1) {
        return reply.code(400).send({ error: 'index must be a positive integer' })
      }
      try {
        const res = await dashboard.authedFetch(
          `/api/credentials/pool/${encodeURIComponent(provider)}/${index}`,
          {
            method: 'DELETE',
            headers: { Accept: 'application/json' },
          },
        )
        const body = (await res.json().catch(() => null)) as unknown
        if (!res.ok) {
          const detail = (body as { detail?: string } | null)?.detail
          return reply
            .code(res.status === 404 ? 404 : 502)
            .send({ error: detail ?? 'Remove credential failed.' })
        }
        return body
      } catch (err) {
        const status = err instanceof DashboardError ? 502 : 500
        return reply.code(status).send({ error: 'Could not remove credential.' })
      }
    },
  )
}

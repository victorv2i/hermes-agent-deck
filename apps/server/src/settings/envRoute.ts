/**
 * Env surface BFF route plugin.
 *
 * Non-messaging env vars (provider API keys, tool keys, voice keys) need a
 * home where non-technical users can set them without the terminal. This module
 * exposes three AGENT-DECK-OWN endpoints that faithfully proxy the REAL stock
 * hermes env routes — SHAPE-ONLY out, plaintext in (write-only, never echoed):
 *
 *   GET  /api/agent-deck/env
 *     Proxies → stock GET /api/env (web_server.py:1926).
 *     Returns { env: Record<key, EnvVarEntry> } — every redacted_value is the
 *     server's masked preview (e.g. "sk-...abc4"); plaintext NEVER crosses the
 *     wire. Messaging keys (those already surfaced by the Messaging tab) are
 *     included — the UI may choose to de-duplicate or redirect, but the BFF
 *     does not filter by category so the caller has the full picture.
 *
 *   PUT  /api/agent-deck/env   body { key, value }
 *     Proxies → stock PUT /api/env (web_server.py:1945).
 *     The value is forwarded once; the plaintext is NEVER logged, echoed, or
 *     stored in agent-deck state. Response: { ok, key } — the value is not
 *     returned. Writing an env var always signals restartRequired=true (the
 *     gateway must restart to pick up the new value) unless stock returns a
 *     specific "hot-reload" flag (which it does not today).
 *
 *   DELETE /api/agent-deck/env  body { key }
 *     Proxies → stock DELETE /api/env (web_server.py:2029).
 *     Removes a stored env var. Also signals restartRequired=true.
 *
 * SECURITY:
 *  - The plaintext value passes through the BFF once, directly to stock, and is
 *    then dropped. It is never written to disk, logged, or included in any
 *    response body.
 *  - `redacted_value` from the stock GET response IS forwarded to the browser —
 *    this is the server's own masked preview (shape-only), not the real value.
 *  - We do NOT call POST /api/env/reveal — the browser never gets the plaintext.
 *
 * Mount under no prefix (paths already include /api/agent-deck).
 */
import type { FastifyPluginAsync } from 'fastify'
import type { DashboardClient } from '../hermes/dashboardClient'
import { DashboardError } from '../hermes/dashboardClient'

export interface EnvRouteOptions {
  dashboard: DashboardClient
}

export const registerEnvRoutes: FastifyPluginAsync<EnvRouteOptions> = async (fastify, opts) => {
  const { dashboard } = opts

  // ── GET /api/agent-deck/env ──
  fastify.get('/api/agent-deck/env', async (_req, reply) => {
    try {
      const raw = await dashboard.getJson<Record<string, unknown>>('/api/env')
      // Forward the stock shape wholesale — already redacted server-side.
      return { env: raw ?? {} }
    } catch (err) {
      const status = err instanceof DashboardError ? 502 : 500
      return reply.code(status).send({ error: 'Could not load env from the hermes dashboard.' })
    }
  })

  // ── PUT /api/agent-deck/env ──
  fastify.put<{ Body: { key?: unknown; value?: unknown } }>(
    '/api/agent-deck/env',
    async (req, reply) => {
      const { key, value } = req.body ?? {}
      if (typeof key !== 'string' || key.trim() === '') {
        return reply.code(400).send({ error: 'key (string) is required' })
      }
      if (typeof value !== 'string' || value.trim() === '') {
        return reply.code(400).send({ error: 'value (non-empty string) is required' })
      }
      try {
        const res = await dashboard.authedFetch('/api/env', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          // The plaintext value goes directly to hermes and is never stored here.
          body: JSON.stringify({ key: key.trim(), value }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { detail?: string } | null
          const msg = body?.detail ?? `hermes env write failed (HTTP ${res.status})`
          const status = res.status === 400 ? 400 : 502
          return reply.code(status).send({ error: msg })
        }
        // Return shape-only — never echo the value.
        return { ok: true, key: key.trim(), restartRequired: true }
      } catch (err) {
        const status = err instanceof DashboardError ? 502 : 500
        return reply.code(status).send({ error: 'Could not write env to the hermes dashboard.' })
      }
    },
  )

  // ── DELETE /api/agent-deck/env ──
  fastify.delete<{ Body: { key?: unknown } }>('/api/agent-deck/env', async (req, reply) => {
    const { key } = req.body ?? {}
    if (typeof key !== 'string' || key.trim() === '') {
      return reply.code(400).send({ error: 'key (string) is required' })
    }
    try {
      const res = await dashboard.authedFetch('/api/env', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ key: key.trim() }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null
        const msg = body?.detail ?? `hermes env delete failed (HTTP ${res.status})`
        const status = res.status === 404 ? 404 : 502
        return reply.code(status).send({ error: msg })
      }
      return { ok: true, key: key.trim(), restartRequired: true }
    } catch (err) {
      const status = err instanceof DashboardError ? 502 : 500
      return reply.code(status).send({ error: 'Could not delete env key from hermes dashboard.' })
    }
  })
}

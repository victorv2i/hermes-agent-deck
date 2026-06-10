/**
 * Cross-seam hermetic proof of the two hardening contracts wired TOGETHER on the
 * real Files routes (no live dashboard/gateway):
 *
 *  C1 (non-loopback auth gate):
 *    - a loopback-posture app needs NO token to reach the Files API;
 *    - a non-loopback-posture app 401s a Files request with NO token and serves
 *      it (reaching the real route) WITH the correct bearer token.
 *
 *  I1 (read-only roots):
 *    - a write against a read_only root returns 403 (`read_only`) — proven
 *      end-to-end through the real {@link filesRoutes} + {@link FilesService},
 *      AFTER the auth gate has been satisfied.
 *
 * The gate hook here is byte-for-byte the same logic the production app installs
 * in `buildApp` (same exported helpers: resolveAuth / isGatedApiPath /
 * bearerFromHeader / tokensMatch), so this test exercises the real seam, not a
 * paraphrase of it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DashboardClient } from '../hermes/dashboardClient'
import { startMockDashboard, type MockDashboardHandle } from '../hermes/mockDashboard.test-support'
import { FilesService } from '../files/filesService'
import { filesRoutes } from '../files/routes'
import { resolveAuth, isGatedApiPath, bearerFromHeader, tokensMatch, type AuthConfig } from './auth'

const TOKEN = 'a'.repeat(64) // fixed-length hex, deterministic

let app: FastifyInstance
let dashboard: MockDashboardHandle
let tmpRoot: string

/**
 * Build a Fastify app that installs the SAME auth gate as production (over the
 * given `auth` posture) and mounts the real Files routes under the production
 * prefix, with the `tmp` root reported read-only.
 */
async function buildGatedFilesApp(auth: AuthConfig): Promise<FastifyInstance> {
  const client = new DashboardClient({
    hermesDashboardUrl: dashboard.url,
    hermesDashboardHost: dashboard.host,
  })
  const service = new FilesService(client)
  // I1: the only root is READ-ONLY, so any write must be 403'd by the service.
  service.setRootResolver(async (id) =>
    id === 'tmp'
      ? { id: 'tmp', label: 'Tmp', description: '', path: tmpRoot, readOnly: true }
      : null,
  )

  const a = Fastify({ logger: false })
  // C1 gate — identical to buildApp(): only installed when auth.required.
  if (auth.required) {
    a.addHook('onRequest', async (request, reply) => {
      if (!isGatedApiPath(request.raw.url ?? '')) return
      const provided = bearerFromHeader(request.headers.authorization)
      if (!tokensMatch(auth.token, provided)) {
        return reply.code(401).send({ error: 'unauthorized', message: 'missing or invalid token' })
      }
    })
  }
  await a.register(filesRoutes, { service, prefix: '/api/agent-deck' })
  await a.ready()
  return a
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'ad-auth-ro-seam-'))
  dashboard = await startMockDashboard()
})

afterEach(async () => {
  await app?.close()
  await dashboard?.close()
  await rm(tmpRoot, { recursive: true, force: true })
})

describe('C1 + I1 cross-seam (auth gate + read-only Files)', () => {
  it('LOOPBACK: a Files API request needs NO token (reaches the route)', async () => {
    const auth = resolveAuth('127.0.0.1')
    expect(auth.required).toBe(false)
    app = await buildGatedFilesApp(auth)

    // No Authorization header at all. The gate is a no-op on loopback, so the
    // request reaches the real route (here: a 403 read_only write — i.e. it got
    // PAST auth into the handler, never a 401).
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/files/write',
      payload: { root: 'tmp', path: 'note.txt', content: 'hi' },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('read_only')
  })

  it('NON-LOOPBACK: a Files request with NO token is 401 (gate blocks before the route)', async () => {
    const auth = resolveAuth('box.ts.net', { AGENT_DECK_TOKEN: TOKEN })
    expect(auth.required).toBe(true)
    app = await buildGatedFilesApp(auth)

    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/files/write',
      payload: { root: 'tmp', path: 'note.txt', content: 'hi' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('unauthorized')
    // The token is never echoed in the error body.
    expect(res.body).not.toContain(TOKEN)
  })

  it('NON-LOOPBACK: the SAME request WITH the bearer token reaches the route (then 403 read-only)', async () => {
    const auth = resolveAuth('box.ts.net', { AGENT_DECK_TOKEN: TOKEN })
    app = await buildGatedFilesApp(auth)

    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/files/write',
      payload: { root: 'tmp', path: 'note.txt', content: 'hi' },
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    // Past the gate (would be 401 otherwise) → real handler → I1 read-only 403.
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('read_only')
  })

  it('NON-LOOPBACK: a read (GET) also passes the gate WITH the token', async () => {
    const auth = resolveAuth('box.ts.net', { AGENT_DECK_TOKEN: TOKEN })
    app = await buildGatedFilesApp(auth)

    // roots read is served straight from the resolver shape; with the token it
    // reaches the route (200), without it would be 401.
    const noToken = await app.inject({ method: 'GET', url: '/api/agent-deck/files?root=tmp' })
    expect(noToken.statusCode).toBe(401)

    const withToken = await app.inject({
      method: 'GET',
      url: '/api/agent-deck/files?root=tmp',
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    // Past the gate: the route ran (the mock dashboard has no /tree body, so the
    // upstream proxy fails with 502 — but crucially NOT 401, proving the gate let
    // it through to the real handler).
    expect(withToken.statusCode).not.toBe(401)
  })
})

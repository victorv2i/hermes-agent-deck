import { describe, it, expect, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { UnifiedSessionsResponse, type RuntimeSession } from '@agent-deck/protocol'
import { registerRuntimesRoute, hermesSessionToRuntime } from './runtimesRoute'

let app: FastifyInstance | undefined
afterEach(async () => {
  await app?.close()
  app = undefined
})

/** A dashboard stub returning a canned /api/sessions payload (or throwing). */
function dashboard(payload: unknown, throws = false) {
  return {
    getJson: async <T>() => {
      if (throws) throw new Error('dashboard down')
      return payload as T
    },
  }
}

function runtimeSession(
  over: Partial<RuntimeSession> & Pick<RuntimeSession, 'runtime' | 'id'>,
): RuntimeSession {
  return {
    title: null,
    model: null,
    startedAt: null,
    lastActive: null,
    messageCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cwd: null,
    ...over,
  }
}

async function build(opts: Parameters<typeof registerRuntimesRoute>[1]): Promise<FastifyInstance> {
  app = Fastify({ logger: false })
  await app.register(registerRuntimesRoute, opts)
  await app.ready()
  return app
}

describe('hermesSessionToRuntime', () => {
  it('maps a SessionSummary and scales unix seconds to ms', () => {
    const rt = hermesSessionToRuntime({
      id: 'h1',
      source: 'cli',
      model: 'hermes-4',
      title: 'Build',
      started_at: 1_700_000_000, // seconds
      last_active: 1_700_000_500,
      message_count: 4,
      input_tokens: 10,
      output_tokens: 5,
    })
    expect(rt).toMatchObject({
      runtime: 'hermes',
      id: 'h1',
      model: 'hermes-4',
      messageCount: 4,
      cwd: null,
    })
    expect(rt.startedAt).toBe(1_700_000_000_000)
    expect(rt.lastActive).toBe(1_700_000_500_000)
  })
})

describe('GET /api/agent-deck/runtimes/sessions', () => {
  it('merges all runtimes newest-first with per-source rollups', async () => {
    const a = await build({
      dashboard: dashboard({
        sessions: [
          {
            id: 'h1',
            source: 'cli',
            model: 'hermes-4',
            title: 'Hermes run',
            started_at: 1000,
            last_active: 5000,
            message_count: 2,
            input_tokens: 1,
            output_tokens: 1,
          },
        ],
      }),
      listClaudeSessions: () => [
        runtimeSession({ runtime: 'claude', id: 'c1', lastActive: 9_000_000 }),
      ],
      listCodexSessions: () => [
        runtimeSession({ runtime: 'codex', id: 'x1', lastActive: 1_000_000 }),
      ],
    })
    const res = await a.inject({ method: 'GET', url: '/api/agent-deck/runtimes/sessions' })
    expect(res.statusCode).toBe(200)
    const body = UnifiedSessionsResponse.parse(res.json())
    // Newest-active first: claude (9e6) > hermes (5000*1000=5e6) > codex (1e6).
    expect(body.sessions.map((s) => s.id)).toEqual(['c1', 'h1', 'x1'])

    const byRuntime = Object.fromEntries(body.sources.map((s) => [s.runtime, s]))
    expect(byRuntime.hermes).toMatchObject({
      available: true,
      sessionCount: 1,
      capabilities: { chat: true, approvals: true },
    })
    expect(byRuntime.claude).toMatchObject({
      available: true,
      sessionCount: 1,
      capabilities: { chat: false, approvals: false, usage: true, sessions: true },
    })
    expect(byRuntime.codex!.capabilities.chat).toBe(false)
  })

  it('reports Hermes unavailable (empty) when the dashboard fails, still serving the read-only runtimes', async () => {
    const a = await build({
      dashboard: dashboard(null, true),
      listClaudeSessions: () => [runtimeSession({ runtime: 'claude', id: 'c1', lastActive: 1 })],
      listCodexSessions: () => [],
    })
    const res = await a.inject({ method: 'GET', url: '/api/agent-deck/runtimes/sessions' })
    const body = UnifiedSessionsResponse.parse(res.json())
    expect(body.sessions.map((s) => s.id)).toEqual(['c1'])
    const hermes = body.sources.find((s) => s.runtime === 'hermes')!
    expect(hermes.available).toBe(false)
    expect(hermes.sessionCount).toBe(0)
  })

  it('clamps the limit and passes it to the listers', async () => {
    let claudeLimit: number | undefined
    const a = await build({
      dashboard: dashboard({ sessions: [] }),
      listClaudeSessions: ({ limit }) => {
        claudeLimit = limit
        return []
      },
      listCodexSessions: () => [],
    })
    await a.inject({ method: 'GET', url: '/api/agent-deck/runtimes/sessions?limit=9999' })
    expect(claudeLimit).toBe(200) // clamped to the 200 ceiling
  })
})

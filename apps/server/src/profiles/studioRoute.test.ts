/**
 * Agent Studio BFF route tests.
 *
 * The Studio authors everything about ONE hermes profile (an agent) through
 * hermes's own per-profile dashboard API, scoped by `?profile=<name>` (query)
 * or `body.profile`. These tests assert the BFF THREADS the selected profile
 * through to the proxied hermes endpoints, and that no raw secret value ever
 * crosses the wire.
 *
 * Verified stock hermes routes proxied (installed hermes, config schema v29):
 *   GET  /api/config?profile=                 (web_server.py:2946)
 *   PUT  /api/config {config, profile}        (web_server.py:3512)
 *   GET  /api/model/options?profile=          (web_server.py:3079)
 *   PUT  /api/profiles/{name}/model           (web_server.py:9080)
 *   GET  /api/skills?profile=                 (web_server.py:9209)
 *   PUT  /api/skills/toggle {..., profile}     (web_server.py:9222)
 *   GET  /api/env?profile=                    (web_server.py:3525)
 *   PUT  /api/env {key, value, profile}        (web_server.py:3550)
 *
 * The mock dashboard below mirrors the real same-host session-token dance (GET /
 * serves index.html with window.__HERMES_SESSION_TOKEN__ injected; gated calls
 * carry Authorization: Bearer <token>), and RECORDS the profile query/body it
 * received so the tests can assert passthrough.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import { DashboardClient } from '../hermes/dashboardClient'
import { registerStudioRoutes } from './studioRoute'

/* ─── recorded request shapes ─── */
interface Recorded {
  /** ?profile= query the mock saw on the most recent GET/PUT of each path. */
  configGetProfile?: string | null
  configPutBody?: { config: unknown; profile?: string } | undefined
  modelOptionsProfile?: string | null
  modelSetName?: string | undefined
  modelSetBody?: { provider: string; model: string } | undefined
  skillsGetProfile?: string | null
  skillToggleBody?: { name: string; enabled: boolean; profile?: string } | undefined
  envGetProfile?: string | null
  envPutBody?: { key: string; value: string; profile?: string } | undefined
  soulGetName?: string | undefined
  soulPutName?: string | undefined
  soulPutBody?: { content: string } | undefined
}

interface MockHandle {
  url: string
  host: string
  recorded: Recorded
  close(): Promise<void>
}

/**
 * The merged effective config the Studio subset is carved out of. This mirrors
 * the REAL shape hermes's dashboard GET /api/config returns (installed hermes,
 * config schema v29), captured from the live dashboard:
 *  - `model` is a TOP-LEVEL string ("gpt-5.5"), not a nested { default, provider }.
 *  - `toolsets` is the top-level enable list.
 *  - `agent.disabled_toolsets` is a JSON-ENCODED STRING ('["tts"]'), not an array.
 *  - `memory.write_approval` is a BOOLEAN (false), not an 'auto'/'manual' enum.
 *  - `memory.provider` is the provider name string.
 * It also carries secret-bearing keys (provider api_key, an auxiliary api_key)
 * that the StudioConfigSubset whitelist must DROP - never echoed to the browser.
 */
const MOCK_CONFIG: Record<string, unknown> = {
  model: 'gpt-5.5',
  model_context_length: 0,
  fallback_providers: [],
  toolsets: ['hermes-cli'],
  // A top-level provider api_key the subset must never surface.
  api_key: 'sk-should-never-surface-1234',
  agent: { disabled_toolsets: '["tts"]', max_turns: 100 },
  memory: {
    memory_enabled: true,
    user_profile_enabled: true,
    memory_char_limit: 4000,
    user_char_limit: 4000,
    write_approval: false,
    provider: 'holographic_plus',
  },
  // A whole unrelated secret block the subset must not surface.
  auxiliary: { vision: { provider: 'openai-codex', model: 'gpt-5.5', api_key: 'sk-aux-secret-9999' } },
}

const MOCK_MODEL_OPTIONS = {
  providers: [
    {
      slug: 'anthropic',
      name: 'Anthropic',
      is_current: true,
      is_user_defined: false,
      models: ['sonnet', 'opus'],
      total_models: 2,
    },
  ],
  model: 'sonnet',
  provider: 'anthropic',
}

const MOCK_SKILLS = [
  { name: 'ascii-art', description: 'draw', category: 'creative', enabled: true },
  { name: 'web-search', description: 'search', category: null, enabled: false },
]

const MOCK_ENV: Record<string, unknown> = {
  OPENAI_API_KEY: {
    is_set: true,
    redacted_value: 'sk-...abc4',
    description: 'OpenAI API key',
    url: 'https://openai.com',
    category: 'provider',
    is_password: true,
    tools: [],
    advanced: false,
  },
  TAVILY_API_KEY: {
    is_set: false,
    redacted_value: null,
    description: 'Tavily key',
    url: null,
    category: 'tool',
    is_password: true,
    tools: [],
    advanced: false,
  },
}

async function startMock(
  opts: {
    configPutFails?: boolean
    modelSetFails?: boolean
  } = {},
): Promise<MockHandle> {
  const recorded: Recorded = {}
  let activeToken: string | undefined

  const readBody = (req: import('node:http').IncomingMessage): Promise<string> =>
    new Promise((resolve) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => resolve(raw))
    })

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    const profile = url.searchParams.get('profile')
    const host = req.headers['host'] ?? ''
    const origin = typeof req.headers['origin'] === 'string' ? req.headers['origin'] : undefined
    const auth = req.headers['authorization']

    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }

    const hostname = host.split(':')[0]
    const sessionOk =
      hostname === '127.0.0.1' &&
      origin !== undefined &&
      (() => {
        try {
          return new URL(origin).host.toLowerCase() === host.toLowerCase()
        } catch {
          return false
        }
      })()

    // SPA root: token bootstrap.
    if (req.method === 'GET' && path === '/') {
      if (!sessionOk) return json(403, { error: 'forbidden' })
      activeToken = `tok_${randomUUID()}`
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(
        `<html><head><script>window.__HERMES_SESSION_TOKEN__="${activeToken}";</script></head></html>`,
      )
      return
    }

    // All other routes are gated.
    if (auth !== `Bearer ${activeToken}` || activeToken === undefined) {
      return json(401, { error: 'unauthorized' })
    }

    // ── config ──
    if (req.method === 'GET' && path === '/api/config') {
      recorded.configGetProfile = profile
      return json(200, MOCK_CONFIG)
    }
    if (req.method === 'PUT' && path === '/api/config') {
      if (opts.configPutFails) return json(500, { detail: 'save failed' })
      void readBody(req).then((raw) => {
        recorded.configPutBody = JSON.parse(raw) as { config: unknown; profile?: string }
        json(200, { ok: true })
      })
      return
    }

    // ── model ──
    if (req.method === 'GET' && path === '/api/model/options') {
      recorded.modelOptionsProfile = profile
      return json(200, MOCK_MODEL_OPTIONS)
    }
    const modelSetMatch = /^\/api\/profiles\/([^/]+)\/model$/.exec(path)
    if (req.method === 'PUT' && modelSetMatch) {
      recorded.modelSetName = decodeURIComponent(modelSetMatch[1]!)
      if (opts.modelSetFails) return json(500, { detail: 'write failed' })
      void readBody(req).then((raw) => {
        recorded.modelSetBody = JSON.parse(raw) as { provider: string; model: string }
        json(200, { ok: true, provider: recorded.modelSetBody.provider, model: recorded.modelSetBody.model })
      })
      return
    }

    // ── skills ──
    if (req.method === 'GET' && path === '/api/skills') {
      recorded.skillsGetProfile = profile
      return json(200, MOCK_SKILLS)
    }
    if (req.method === 'PUT' && path === '/api/skills/toggle') {
      void readBody(req).then((raw) => {
        recorded.skillToggleBody = JSON.parse(raw) as {
          name: string
          enabled: boolean
          profile?: string
        }
        json(200, {
          ok: true,
          name: recorded.skillToggleBody.name,
          enabled: recorded.skillToggleBody.enabled,
        })
      })
      return
    }

    // ── env ──
    if (req.method === 'GET' && path === '/api/env') {
      recorded.envGetProfile = profile
      return json(200, MOCK_ENV)
    }
    if (req.method === 'PUT' && path === '/api/env') {
      void readBody(req).then((raw) => {
        recorded.envPutBody = JSON.parse(raw) as { key: string; value: string; profile?: string }
        json(200, { ok: true, key: recorded.envPutBody.key })
      })
      return
    }

    // ── soul (path-scoped by {name}) ──
    const soulMatch = /^\/api\/profiles\/([^/]+)\/soul$/.exec(path)
    if (req.method === 'GET' && soulMatch) {
      recorded.soulGetName = decodeURIComponent(soulMatch[1]!)
      return json(200, { content: '# Soul of the agent\n', exists: true })
    }
    if (req.method === 'PUT' && soulMatch) {
      recorded.soulPutName = decodeURIComponent(soulMatch[1]!)
      void readBody(req).then((raw) => {
        recorded.soulPutBody = JSON.parse(raw) as { content: string }
        json(200, { ok: true })
      })
      return
    }

    json(404, { error: 'not found' })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const host = `127.0.0.1:${port}`
  return {
    url: `http://${host}`,
    host,
    recorded,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
        server.closeAllConnections?.()
      }),
  }
}

let mock: MockHandle | undefined
let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  await mock?.close()
  app = undefined
  mock = undefined
})

async function buildApp(m: MockHandle): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false })
  const client = new DashboardClient({ hermesDashboardUrl: m.url, hermesDashboardHost: m.host })
  await fastify.register(registerStudioRoutes, { dashboard: client })
  await fastify.ready()
  return fastify
}

/* ────────────────────────────── CONFIG ────────────────────────────── */
describe('GET /api/agent-deck/studio/config', () => {
  it('passes ?profile= through to hermes GET /api/config and returns the Studio subset', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'GET',
      url: '/api/agent-deck/studio/config?profile=coder',
    })
    expect(res.statusCode).toBe(200)
    // The selected profile was threaded through to hermes.
    expect(mock.recorded.configGetProfile).toBe('coder')
    const body = res.json<{
      config: {
        model?: string
        toolsets?: string[]
        agent?: { disabled_toolsets?: string[] }
        memory?: { memory_enabled?: boolean; write_approval?: boolean; provider?: string }
      }
    }>()
    // The real shapes: model is a top-level string, disabled_toolsets is DECODED
    // from the JSON-string the config carries, write_approval is a boolean.
    expect(body.config.model).toBe('gpt-5.5')
    expect(body.config.toolsets).toEqual(['hermes-cli'])
    expect(body.config.agent?.disabled_toolsets).toEqual(['tts'])
    expect(body.config.memory?.memory_enabled).toBe(true)
    expect(body.config.memory?.write_approval).toBe(false)
    expect(body.config.memory?.provider).toBe('holographic_plus')
  })

  it('targets the active profile when no profile query is given (omits ?profile=)', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/studio/config' })
    expect(res.statusCode).toBe(200)
    // No profile query → hermes sees null (its active-profile default).
    expect(mock.recorded.configGetProfile).toBeNull()
  })

  it('NEVER surfaces a secret value carried in the raw config (subset whitelist drops it)', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'GET',
      url: '/api/agent-deck/studio/config?profile=coder',
    })
    expect(res.statusCode).toBe(200)
    // The top-level api_key and the whole auxiliary.* block live in the raw config
    // but are NOT in the Studio subset whitelist; they must never reach the browser.
    expect(res.body).not.toContain('sk-should-never-surface-1234')
    expect(res.body).not.toContain('sk-aux-secret-9999')
    expect(res.body).not.toContain('api_key')
    expect(res.body).not.toContain('auxiliary')
    // agent.* keys outside the subset (e.g. max_turns) are dropped too.
    expect(res.body).not.toContain('max_turns')
  })

  it('rejects a syntactically invalid profile name with 400 (no dashboard call)', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'GET',
      url: '/api/agent-deck/studio/config?profile=Bad%20Name',
    })
    expect(res.statusCode).toBe(400)
    expect(mock.recorded.configGetProfile).toBeUndefined()
  })

  it('returns 502 when hermes is unreachable', async () => {
    const fastify = Fastify({ logger: false })
    const client = new DashboardClient({
      hermesDashboardUrl: 'http://127.0.0.1:1',
      hermesDashboardHost: '127.0.0.1:1',
      requestTimeoutMs: 200,
    })
    await fastify.register(registerStudioRoutes, { dashboard: client })
    await fastify.ready()
    app = fastify
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/studio/config' })
    expect(res.statusCode).toBe(502)
  })
})

describe('PUT /api/agent-deck/studio/config', () => {
  it('forwards the partial patch AND the profile to hermes PUT /api/config', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/studio/config',
      payload: {
        profile: 'coder',
        config: { memory: { memory_enabled: false }, toolsets: ['web'] },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true })
    // Both the patch AND the profile reached hermes.
    expect(mock.recorded.configPutBody?.profile).toBe('coder')
    expect(mock.recorded.configPutBody?.config).toEqual({
      memory: { memory_enabled: false },
      toolsets: ['web'],
    })
  })

  it('targets the active profile when profile is omitted', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/studio/config',
      payload: { config: { toolsets: ['web'] } },
    })
    expect(res.statusCode).toBe(200)
    expect(mock.recorded.configPutBody?.profile).toBeUndefined()
  })

  it('forwards a disabled_toolsets write as an ARRAY (hermes normalizes on its side)', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/studio/config',
      payload: { profile: 'coder', config: { agent: { disabled_toolsets: ['tts', 'vision'] } } },
    })
    expect(res.statusCode).toBe(200)
    // The Studio writes the full intended blocklist as a JSON array; hermes
    // normalizes/stores it (it surfaces the JSON-string form back on the next read).
    expect(mock.recorded.configPutBody?.config).toEqual({
      agent: { disabled_toolsets: ['tts', 'vision'] },
    })
  })

  it('STRIPS an unknown/secret-shaped key from the config patch (never forwards it to hermes)', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/studio/config',
      // A valid in-subset key (model string) alongside an out-of-subset secret key.
      payload: { config: { model: 'opus', api_key: 'sk-injected-secret' } },
    })
    // The Studio subset has no api_key field, so the subset parse DROPS it: only
    // the whitelisted key (model) is forwarded, and the secret never reaches hermes
    // through the config path (it routes to .env via /api/env instead).
    expect(res.statusCode).toBe(200)
    expect(mock.recorded.configPutBody?.config).toEqual({ model: 'opus' })
    expect(JSON.stringify(mock.recorded.configPutBody)).not.toContain('sk-injected-secret')
    expect(JSON.stringify(mock.recorded.configPutBody)).not.toContain('api_key')
    // And the secret never echoes back to the browser either.
    expect(res.body).not.toContain('sk-injected-secret')
  })

  it('rejects an invalid profile name with 400 (no dashboard call)', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/studio/config',
      payload: { profile: '../etc', config: { toolsets: ['web'] } },
    })
    expect(res.statusCode).toBe(400)
    expect(mock.recorded.configPutBody).toBeUndefined()
  })

  it('returns 502 when hermes rejects the save', async () => {
    mock = await startMock({ configPutFails: true })
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/studio/config',
      payload: { config: { toolsets: ['web'] } },
    })
    expect(res.statusCode).toBe(502)
  })
})

/* ────────────────────────────── MODEL ────────────────────────────── */
describe('GET /api/agent-deck/studio/model-options', () => {
  it('passes ?profile= through to hermes GET /api/model/options', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'GET',
      url: '/api/agent-deck/studio/model-options?profile=coder',
    })
    expect(res.statusCode).toBe(200)
    expect(mock.recorded.modelOptionsProfile).toBe('coder')
    const body = res.json<{ providers: { slug: string }[]; model: string; provider: string }>()
    expect(body.model).toBe('sonnet')
    expect(body.provider).toBe('anthropic')
    expect(body.providers[0]!.slug).toBe('anthropic')
  })

  it('rejects an invalid profile name with 400', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'GET',
      url: '/api/agent-deck/studio/model-options?profile=Bad%20Name',
    })
    expect(res.statusCode).toBe(400)
    expect(mock.recorded.modelOptionsProfile).toBeUndefined()
  })
})

describe('PUT /api/agent-deck/profiles/:name/model', () => {
  it('proxies the per-profile model set to hermes PUT /api/profiles/{name}/model', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/profiles/coder/model',
      payload: { provider: 'anthropic', model: 'opus' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, provider: 'anthropic', model: 'opus' })
    expect(mock.recorded.modelSetName).toBe('coder')
    expect(mock.recorded.modelSetBody).toEqual({ provider: 'anthropic', model: 'opus' })
  })

  it('rejects an empty provider or model with 400 (no dashboard call)', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/profiles/coder/model',
      payload: { provider: '', model: 'opus' },
    })
    expect(res.statusCode).toBe(400)
    expect(mock.recorded.modelSetName).toBeUndefined()
  })

  it('rejects an invalid profile name with 400/403 (no dashboard call)', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/profiles/..%2f..%2fetc/model',
      payload: { provider: 'anthropic', model: 'opus' },
    })
    expect([400, 403]).toContain(res.statusCode)
    expect(mock.recorded.modelSetName).toBeUndefined()
  })

  it('returns 502 when hermes rejects the model write', async () => {
    mock = await startMock({ modelSetFails: true })
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/profiles/coder/model',
      payload: { provider: 'anthropic', model: 'opus' },
    })
    expect(res.statusCode).toBe(502)
  })
})

/* ────────────────────────────── SKILLS ────────────────────────────── */
describe('GET /api/agent-deck/studio/skills', () => {
  it('passes ?profile= through to hermes GET /api/skills', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'GET',
      url: '/api/agent-deck/studio/skills?profile=coder',
    })
    expect(res.statusCode).toBe(200)
    expect(mock.recorded.skillsGetProfile).toBe('coder')
    const body = res.json<{ skills: { name: string; enabled: boolean }[] }>()
    expect(body.skills.find((s) => s.name === 'ascii-art')?.enabled).toBe(true)
    expect(body.skills.find((s) => s.name === 'web-search')?.enabled).toBe(false)
  })

  it('rejects an invalid profile name with 400', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'GET',
      url: '/api/agent-deck/studio/skills?profile=Bad%20Name',
    })
    expect(res.statusCode).toBe(400)
    expect(mock.recorded.skillsGetProfile).toBeUndefined()
  })
})

describe('PUT /api/agent-deck/studio/skills/toggle', () => {
  it('forwards name + enabled + profile to hermes PUT /api/skills/toggle', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/studio/skills/toggle',
      payload: { name: 'ascii-art', enabled: false, profile: 'coder' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ name: 'ascii-art', enabled: false })
    expect(mock.recorded.skillToggleBody).toEqual({
      name: 'ascii-art',
      enabled: false,
      profile: 'coder',
    })
  })

  it('targets the active profile when profile is omitted', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/studio/skills/toggle',
      payload: { name: 'ascii-art', enabled: true },
    })
    expect(res.statusCode).toBe(200)
    expect(mock.recorded.skillToggleBody?.profile).toBeUndefined()
  })

  it('rejects a malformed body with 400', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/studio/skills/toggle',
      payload: { name: 'ascii-art' },
    })
    expect(res.statusCode).toBe(400)
    expect(mock.recorded.skillToggleBody).toBeUndefined()
  })

  it('rejects an invalid profile name with 400', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/studio/skills/toggle',
      payload: { name: 'ascii-art', enabled: true, profile: 'Bad Name' },
    })
    expect(res.statusCode).toBe(400)
    expect(mock.recorded.skillToggleBody).toBeUndefined()
  })
})

/* ────────────────────────────── ENV ────────────────────────────── */
describe('GET /api/agent-deck/studio/env', () => {
  it('passes ?profile= through and returns SHAPE ONLY {key, isSet} (no value, no redacted preview)', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'GET',
      url: '/api/agent-deck/studio/env?profile=coder',
    })
    expect(res.statusCode).toBe(200)
    expect(mock.recorded.envGetProfile).toBe('coder')
    const body = res.json<{ env: { key: string; isSet: boolean }[] }>()
    const openai = body.env.find((e) => e.key === 'OPENAI_API_KEY')
    const tavily = body.env.find((e) => e.key === 'TAVILY_API_KEY')
    expect(openai).toEqual({ key: 'OPENAI_API_KEY', isSet: true })
    expect(tavily).toEqual({ key: 'TAVILY_API_KEY', isSet: false })
    // The Studio env view is shape-only: not even the server-side redacted preview
    // ("sk-...abc4") may cross the wire through this DTO.
    expect(res.body).not.toContain('sk-...abc4')
    expect(res.body).not.toContain('redacted_value')
  })

  it('rejects an invalid profile name with 400', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'GET',
      url: '/api/agent-deck/studio/env?profile=Bad%20Name',
    })
    expect(res.statusCode).toBe(400)
    expect(mock.recorded.envGetProfile).toBeUndefined()
  })
})

describe('PUT /api/agent-deck/studio/env', () => {
  it('forwards key + value + profile to hermes and NEVER echoes the plaintext', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/studio/env',
      payload: { key: 'OPENAI_API_KEY', value: 'sk-plaintext-secret-2468', profile: 'coder' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ ok: boolean; key: string; restartRequired: boolean }>()
    expect(body.ok).toBe(true)
    expect(body.key).toBe('OPENAI_API_KEY')
    expect(body.restartRequired).toBe(true)
    // The plaintext must NEVER appear in the response.
    expect(res.body).not.toContain('sk-plaintext-secret-2468')
    // It WAS forwarded to hermes, scoped to the selected profile.
    expect(mock.recorded.envPutBody?.key).toBe('OPENAI_API_KEY')
    expect(mock.recorded.envPutBody?.value).toBe('sk-plaintext-secret-2468')
    expect(mock.recorded.envPutBody?.profile).toBe('coder')
  })

  it('400s on a missing key or empty value', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const r1 = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/studio/env',
      payload: { value: 'x' },
    })
    expect(r1.statusCode).toBe(400)
    const r2 = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/studio/env',
      payload: { key: 'OPENAI_API_KEY', value: '' },
    })
    expect(r2.statusCode).toBe(400)
  })

  it('rejects an invalid profile name with 400 (no dashboard call, no plaintext echo)', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/studio/env',
      payload: { key: 'OPENAI_API_KEY', value: 'sk-plaintext-secret-2468', profile: 'Bad Name' },
    })
    expect(res.statusCode).toBe(400)
    expect(mock.recorded.envPutBody).toBeUndefined()
    expect(res.body).not.toContain('sk-plaintext-secret-2468')
  })
})

/* ────────────────────────────── SOUL ────────────────────────────── */
describe('GET /api/agent-deck/studio/profiles/:name/soul', () => {
  it('proxies hermes GET /api/profiles/{name}/soul (the API, not a flat-file read)', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'GET',
      url: '/api/agent-deck/studio/profiles/coder/soul',
    })
    expect(res.statusCode).toBe(200)
    expect(mock.recorded.soulGetName).toBe('coder')
    expect(res.json()).toMatchObject({ content: '# Soul of the agent\n', exists: true })
  })

  it('rejects an invalid profile name with 400/403 (no dashboard call)', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'GET',
      url: '/api/agent-deck/studio/profiles/..%2f..%2fetc/soul',
    })
    expect([400, 403]).toContain(res.statusCode)
    expect(mock.recorded.soulGetName).toBeUndefined()
  })
})

describe('PUT /api/agent-deck/studio/profiles/:name/soul', () => {
  it('proxies hermes PUT /api/profiles/{name}/soul with the content body', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/studio/profiles/coder/soul',
      payload: { content: '# New soul\n' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true })
    expect(mock.recorded.soulPutName).toBe('coder')
    expect(mock.recorded.soulPutBody).toEqual({ content: '# New soul\n' })
  })

  it('rejects a non-string content body with 400 (no dashboard call)', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/studio/profiles/coder/soul',
      payload: { content: 123 },
    })
    expect(res.statusCode).toBe(400)
    expect(mock.recorded.soulPutName).toBeUndefined()
  })

  it('rejects an invalid profile name with 400/403 (no dashboard call)', async () => {
    mock = await startMock()
    app = await buildApp(mock)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/studio/profiles/..%2f..%2fetc/soul',
      payload: { content: 'x' },
    })
    expect([400, 403]).toContain(res.statusCode)
    expect(mock.recorded.soulPutName).toBeUndefined()
  })
})

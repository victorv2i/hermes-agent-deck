import { describe, it, expect, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { DashboardClient } from '../hermes/dashboardClient'
import { registerModelsRoutes, mapModelsResponse } from './modelsRoute'
import type { ModelsResponse } from './types'

let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

/**
 * Stock contract payloads, cited from hermes_cli/web_server.py:
 *  - GET /api/model/info       (lines 937-1011)
 *  - GET /api/model/options    (build_models_payload → {providers[], model, provider})
 *  - GET /api/model/auxiliary  (lines 1055-1096)
 * No /api/chat/model-state — that endpoint does NOT exist in stock.
 */
const MODEL_INFO = {
  model: 'anthropic/claude-opus-4.7',
  provider: 'openrouter',
  auto_context_length: 200000,
  config_context_length: 0,
  effective_context_length: 200000,
  capabilities: {
    supports_tools: true,
    supports_vision: true,
    supports_reasoning: true,
    context_window: 200000,
    max_output_tokens: 64000,
    model_family: 'claude',
  },
} as const

const MODEL_OPTIONS = {
  providers: [
    {
      slug: 'openrouter',
      name: 'OpenRouter',
      is_current: true,
      is_user_defined: false,
      models: ['anthropic/claude-opus-4.7', 'openai/gpt-5'],
      total_models: 2,
      source: 'built-in',
    },
    {
      slug: 'google',
      name: 'Google',
      is_current: false,
      is_user_defined: false,
      models: ['google/gemini-3-pro'],
      total_models: 1,
      source: 'built-in',
    },
    {
      // copilot: present in the options list but NOT logged-in via oauth, AND
      // not the active provider → usable:false. It also shares the `openai/gpt-5`
      // model id with openrouter → an id collision the qualified id resolves.
      slug: 'copilot',
      name: 'GitHub Copilot',
      is_current: false,
      is_user_defined: false,
      models: ['openai/gpt-5'],
      total_models: 1,
      source: 'built-in',
    },
  ],
  model: 'anthropic/claude-opus-4.7',
  provider: 'openrouter',
} as const

const MODEL_AUXILIARY = {
  tasks: [
    { task: 'vision', provider: 'auto', model: '', base_url: '' },
    { task: 'compression', provider: 'openrouter', model: 'openai/gpt-5', base_url: '' },
    { task: 'title_generation', provider: 'auto', model: '', base_url: '' },
  ],
  main: { provider: 'openrouter', model: 'anthropic/claude-opus-4.7' },
} as const

/**
 * Stock `GET /api/providers/oauth` (web_server.py:1573) — each provider carries a
 * `status.logged_in`. Here `google` is logged in; `copilot` is NOT (no usable
 * creds). The active provider (`openrouter`) need not appear in this catalog at
 * all (it's a key-auth provider) — it's usable because it's active.
 */
const PROVIDERS_OAUTH = {
  providers: [
    { id: 'google', name: 'Google', status: { logged_in: true, source: 'pkce' } },
    { id: 'copilot', name: 'GitHub Copilot', status: { logged_in: false, source: null } },
  ],
} as const

/**
 * A hermetic fetch double that speaks the STOCK dashboard auth recipe (the token
 * is injected into the SPA root's index.html as `window.__HERMES_SESSION_TOKEN__`,
 * read by GET /, then sent as a Bearer) and serves the three stock model
 * endpoints. `delays` lets a test slow one endpoint so we can prove concurrency /
 * graceful degrade. `fail` lets a test make one endpoint error.
 */
interface FakeOpts {
  delays?: Partial<Record<string, number>>
  fail?: Partial<Record<string, true>>
  onStart?: (path: string, at: number) => void
  onEnd?: (path: string, at: number) => void
}

function makeFakeDashboard(opts: FakeOpts = {}): {
  client: DashboardClient
  paths: string[]
  requests: Array<{ method: string; path: string; body: unknown }>
  posts: Array<{ path: string; body: unknown }>
} {
  const paths: string[] = []
  const requests: Array<{ method: string; path: string; body: unknown }> = []
  const posts: Array<{ path: string; body: unknown }> = []
  const bodies: Record<string, unknown> = {
    '/api/model/info': MODEL_INFO,
    '/api/model/options': MODEL_OPTIONS,
    '/api/model/auxiliary': MODEL_AUXILIARY,
    '/api/providers/oauth': PROVIDERS_OAUTH,
  }
  const parseBody = (body: BodyInit | null | undefined): unknown => {
    if (typeof body !== 'string') return null
    try {
      return JSON.parse(body)
    } catch {
      return null
    }
  }
  const fetchImpl: typeof fetch = async (input, init) => {
    const path = new URL(input as string).pathname
    if (path === '/') {
      // Stock serves the SPA root with the session token injected into the HTML.
      return new Response(
        '<html><head><script>window.__HERMES_SESSION_TOKEN__="tok_fake";</script></head></html>',
        { headers: { 'Content-Type': 'text/html' } },
      )
    }
    const method = (init?.method ?? 'GET').toUpperCase()
    const parsedBody = parseBody(init?.body)
    paths.push(path)
    requests.push({ method, path, body: parsedBody })
    opts.onStart?.(path, Date.now())
    const delay = opts.delays?.[path] ?? 0
    if (delay > 0) await new Promise((r) => setTimeout(r, delay))
    opts.onEnd?.(path, Date.now())
    if (opts.fail?.[path]) return new Response('boom', { status: 500 })
    // POST /api/model/set — the cross-provider switch the BFF proxies. Capture
    // the forwarded body + echo the stock success shape.
    if (method === 'POST' && path === '/api/model/set') {
      posts.push({ path, body: parsedBody })
      const b = parsedBody as { provider?: string; model?: string } | null
      return Response.json({ ok: true, provider: b?.provider, model: b?.model })
    }
    if (method === 'POST' && path === '/api/providers/oauth/google/start') {
      return Response.json({
        ok: true,
        provider_id: 'google',
        session_id: 'sess-1',
        body: parsedBody,
      })
    }
    if (method === 'POST' && path === '/api/providers/oauth/google/submit') {
      return Response.json({ ok: true, provider_id: 'google', body: parsedBody })
    }
    if (method === 'GET' && path === '/api/providers/oauth/google/poll/sess-1') {
      return Response.json({ ok: true, provider_id: 'google', session_id: 'sess-1' })
    }
    if (method === 'DELETE' && path === '/api/providers/oauth/sessions/sess-1') {
      return Response.json({ ok: true, session_id: 'sess-1' })
    }
    if (method === 'DELETE' && path === '/api/providers/oauth/google') {
      return Response.json({ ok: true, provider_id: 'google' })
    }
    if (path in bodies) return Response.json(bodies[path])
    return new Response('not found', { status: 404 })
  }
  const client = new DashboardClient({
    hermesDashboardUrl: 'http://127.0.0.1:9123',
    hermesDashboardHost: '127.0.0.1:9123',
    fetchImpl,
  })
  return { client, paths, requests, posts }
}

async function buildApp(client: DashboardClient): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false })
  await fastify.register(registerModelsRoutes, { dashboard: client })
  await fastify.ready()
  return fastify
}

describe('GET /api/agent-deck/models', () => {
  it('maps the three stock endpoints into the feature contract', async () => {
    const { client } = makeFakeDashboard()
    app = await buildApp(client)

    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/models' })
    expect(res.statusCode).toBe(200)

    const body = res.json<ModelsResponse>()
    // activeModelId comes from /api/model/info.model
    expect(body.activeModelId).toBe('anthropic/claude-opus-4.7')
    // provider: id from info.provider, label from the matching options row (name).
    expect(body.provider).toEqual({ id: 'openrouter', label: 'OpenRouter' })

    // options providers are flattened to ModelEntry: slug->provider, the model id
    // string is both id and label, source carried through. 4 entries: the two
    // openrouter models, gemini under google, and openai/gpt-5 under copilot
    // (the id collision with openrouter's openai/gpt-5).
    expect(body.models).toHaveLength(4)
    const ids = body.models.map((m) => m.id)
    expect(ids).toContain('anthropic/claude-opus-4.7')
    expect(ids).toContain('openai/gpt-5')
    expect(ids).toContain('google/gemini-3-pro')

    const gemini = body.models.find((m) => m.id === 'google/gemini-3-pro')!
    // slug -> provider, NOT the {id,name} overlay shape.
    expect(gemini.provider).toBe('google')
    expect(gemini.label).toBe('google/gemini-3-pro')
    expect(gemini.source).toBe('built-in')
    expect(gemini.active).toBe(false)

    // Exactly one model is flagged active, and it is the info.model under its
    // is_current provider.
    const active = body.models.filter((m) => m.active)
    expect(active).toHaveLength(1)
    expect(active[0]!.id).toBe('anthropic/claude-opus-4.7')
    expect(active[0]!.provider).toBe('openrouter')
  })

  it('surfaces capabilities + context lengths from /api/model/info', async () => {
    const { client } = makeFakeDashboard()
    app = await buildApp(client)
    const body = (
      await app.inject({ method: 'GET', url: '/api/agent-deck/models' })
    ).json<ModelsResponse>()

    expect(body.capabilities).toEqual({
      supportsTools: true,
      supportsVision: true,
      supportsReasoning: true,
      contextWindow: 200000,
      maxOutputTokens: 64000,
      modelFamily: 'claude',
      autoContextLength: 200000,
      configContextLength: 0,
      effectiveContextLength: 200000,
    })
  })

  it('surfaces the auxiliary task assignments (hermes signature slots)', async () => {
    const { client } = makeFakeDashboard()
    app = await buildApp(client)
    const body = (
      await app.inject({ method: 'GET', url: '/api/agent-deck/models' })
    ).json<ModelsResponse>()

    expect(body.auxiliary).toEqual([
      { task: 'vision', provider: 'auto', model: '' },
      { task: 'compression', provider: 'openrouter', model: 'openai/gpt-5' },
      { task: 'title_generation', provider: 'auto', model: '' },
    ])
  })

  it('emits none of the retired overlay-only fields', async () => {
    const { client } = makeFakeDashboard()
    app = await buildApp(client)
    const body = (await app.inject({ method: 'GET', url: '/api/agent-deck/models' })).json<
      Record<string, unknown>
    >()

    expect(body).not.toHaveProperty('reasoningEffort')
    expect(body).not.toHaveProperty('scope')
    expect(body).not.toHaveProperty('hasChannelOverride')
  })

  it('fetches the four endpoints concurrently (not serially)', async () => {
    const started: Array<{ path: string; at: number }> = []
    // Each endpoint takes 80ms. Serial would be ~320ms; concurrent ~80ms. We
    // assert all four START before any one finishes (true parallelism).
    let firstEnd = Infinity
    const { client } = makeFakeDashboard({
      delays: {
        '/api/model/info': 80,
        '/api/model/options': 80,
        '/api/model/auxiliary': 80,
        '/api/providers/oauth': 80,
      },
      onStart: (path, at) => started.push({ path, at }),
      onEnd: (_path, at) => {
        firstEnd = Math.min(firstEnd, at)
      },
    })
    app = await buildApp(client)
    await app.inject({ method: 'GET', url: '/api/agent-deck/models' })

    expect(started).toHaveLength(4)
    // All four started before the earliest one ended → concurrent.
    for (const s of started) {
      expect(s.at).toBeLessThan(firstEnd)
    }
  })

  it('degrades gracefully when options + auxiliary fail (keeps info)', async () => {
    // info succeeds; the other two error. We still get 200 with the active model
    // + capabilities, an empty models list, and empty auxiliary — never a 502.
    const { client } = makeFakeDashboard({
      fail: { '/api/model/options': true, '/api/model/auxiliary': true },
    })
    app = await buildApp(client)

    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/models' })
    expect(res.statusCode).toBe(200)
    const body = res.json<ModelsResponse>()
    expect(body.activeModelId).toBe('anthropic/claude-opus-4.7')
    expect(body.capabilities.supportsVision).toBe(true)
    // No provider row to read the label from → fall back to the provider id.
    expect(body.provider).toEqual({ id: 'openrouter', label: 'openrouter' })
    // options failed → at least the active model is synthesized so the page is
    // never empty when a model is configured.
    expect(body.models).toHaveLength(1)
    expect(body.models[0]!.id).toBe('anthropic/claude-opus-4.7')
    expect(body.models[0]!.active).toBe(true)
    // The active model is ALWAYS usable (it's the running provider).
    expect(body.models[0]!.usable).toBe(true)
    expect(body.auxiliary).toEqual([])
  })

  it('tags `usable` from /api/providers/oauth (active OR logged-in provider)', async () => {
    const { client } = makeFakeDashboard()
    app = await buildApp(client)
    const body = (
      await app.inject({ method: 'GET', url: '/api/agent-deck/models' })
    ).json<ModelsResponse>()

    // openrouter is the ACTIVE provider → usable, even without an oauth row.
    for (const m of body.models.filter((x) => x.provider === 'openrouter')) {
      expect(m.usable).toBe(true)
    }
    // google is logged-in via oauth → usable.
    expect(body.models.find((m) => m.provider === 'google')!.usable).toBe(true)
    // copilot is in options but NOT logged-in and NOT active → usable:false.
    expect(body.models.find((m) => m.provider === 'copilot')!.usable).toBe(false)
  })

  it('emits a stable provider-qualified id (resolves cross-provider id collisions)', async () => {
    const { client } = makeFakeDashboard()
    app = await buildApp(client)
    const body = (
      await app.inject({ method: 'GET', url: '/api/agent-deck/models' })
    ).json<ModelsResponse>()

    // openai/gpt-5 exists under BOTH openrouter and copilot → bare `id` collides
    // but `qualifiedId` is unique (provider/id).
    const gpt5 = body.models.filter((m) => m.id === 'openai/gpt-5')
    expect(gpt5).toHaveLength(2)
    const qualified = gpt5.map((m) => m.qualifiedId).sort()
    expect(qualified).toEqual(['copilot/openai/gpt-5', 'openrouter/openai/gpt-5'])
    // qualifiedId values are unique across the whole list.
    const allQualified = body.models.map((m) => m.qualifiedId)
    expect(new Set(allQualified).size).toBe(allQualified.length)
  })

  it('degrades to usable:true for every model when oauth fetch fails (fail-open on the active provider only is too strict to render)', async () => {
    // oauth is best-effort; if it can't be read we must not falsely disable
    // every non-active provider. We fall back to "usable" so the picker still
    // offers the configured providers (the real switch attempt is the honesty
    // boundary). The active provider stays usable regardless.
    const { client } = makeFakeDashboard({ fail: { '/api/providers/oauth': true } })
    app = await buildApp(client)
    const body = (
      await app.inject({ method: 'GET', url: '/api/agent-deck/models' })
    ).json<ModelsResponse>()
    expect(body.models.every((m) => m.usable)).toBe(true)
  })

  it('flags providerStatusUnknown:true when the oauth probe FAILS (honest fail-open)', async () => {
    // When the oauth probe can't be read we fail OPEN (every model usable) — but
    // we must SIGNAL that we couldn't verify provider status, so the page can warn
    // that some models may not actually be usable instead of silently lying.
    const { client } = makeFakeDashboard({ fail: { '/api/providers/oauth': true } })
    app = await buildApp(client)
    const body = (
      await app.inject({ method: 'GET', url: '/api/agent-deck/models' })
    ).json<ModelsResponse>()
    expect(body.providerStatusUnknown).toBe(true)
  })

  it('flags providerStatusUnknown:false when the oauth probe SUCCEEDS', async () => {
    // The happy path verified provider status → no warning needed.
    const { client } = makeFakeDashboard()
    app = await buildApp(client)
    const body = (
      await app.inject({ method: 'GET', url: '/api/agent-deck/models' })
    ).json<ModelsResponse>()
    expect(body.providerStatusUnknown).toBe(false)
  })

  it('never includes the dashboard session token even with oauth fetched', async () => {
    const { client } = makeFakeDashboard()
    app = await buildApp(client)
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/models' })
    expect(res.body).not.toMatch(/tok_/)
  })

  it('502s only on TOTAL failure (info itself unreachable)', async () => {
    const fastify = Fastify({ logger: false })
    const client = new DashboardClient({
      hermesDashboardUrl: 'http://127.0.0.1:1',
      hermesDashboardHost: '127.0.0.1:1',
      requestTimeoutMs: 200,
    })
    await fastify.register(registerModelsRoutes, { dashboard: client })
    await fastify.ready()
    app = fastify

    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/models' })
    expect(res.statusCode).toBe(502)
    expect(typeof res.json<{ error: string }>().error).toBe('string')
  })

  it('never leaks the dashboard session token in the response', async () => {
    const { client } = makeFakeDashboard()
    app = await buildApp(client)
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/models' })
    expect(res.body).not.toMatch(/tok_/)
  })
})

describe('POST /api/agent-deck/model/set (cross-provider switch proxy)', () => {
  it('proxies provider + model to the stock POST /api/model/set', async () => {
    const fake = makeFakeDashboard()
    app = await buildApp(fake.client)

    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/model/set',
      payload: { provider: 'google', model: 'google/gemini-3-pro' },
    })
    expect(res.statusCode).toBe(200)
    // The BFF forwarded EXACTLY { provider, model } to the stock endpoint.
    expect(fake.posts).toHaveLength(1)
    expect(fake.posts[0]!.path).toBe('/api/model/set')
    expect(fake.posts[0]!.body).toEqual({ provider: 'google', model: 'google/gemini-3-pro' })
    expect(res.json()).toEqual({ ok: true, provider: 'google', model: 'google/gemini-3-pro' })
  })

  it('400s when provider or model is missing/blank (never reaches the dashboard)', async () => {
    const fake = makeFakeDashboard()
    app = await buildApp(fake.client)

    for (const payload of [
      {},
      { provider: 'google' },
      { model: 'x' },
      { provider: '', model: 'x' },
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/agent-deck/model/set',
        payload,
      })
      expect(res.statusCode).toBe(400)
    }
    // No dashboard call was made for any rejected body.
    expect(fake.posts).toHaveLength(0)
  })

  it('502s (not 500) when the dashboard switch fails, with a generic message', async () => {
    const fake = makeFakeDashboard({ fail: { '/api/model/set': true } })
    app = await buildApp(fake.client)

    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/model/set',
      payload: { provider: 'google', model: 'google/gemini-3-pro' },
    })
    expect(res.statusCode).toBe(502)
    expect(typeof res.json<{ error: string }>().error).toBe('string')
  })

  it('never leaks the dashboard session token on the switch path', async () => {
    const fake = makeFakeDashboard()
    app = await buildApp(fake.client)
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/model/set',
      payload: { provider: 'google', model: 'google/gemini-3-pro' },
    })
    expect(res.body).not.toMatch(/tok_/)
  })
})

describe('/api/agent-deck/provider-oauth (stock provider OAuth proxies)', () => {
  it('proxies all provider OAuth calls to stock dashboard paths and passes JSON bodies through', async () => {
    const fake = makeFakeDashboard()
    app = await buildApp(fake.client)

    const startBody = { redirect_uri: 'http://127.0.0.1:7878/callback', source: 'agent-deck' }
    const submitBody = { code: 'oauth-code', state: 'state-1' }

    const responses = [
      await app.inject({ method: 'GET', url: '/api/agent-deck/provider-oauth' }),
      await app.inject({
        method: 'POST',
        url: '/api/agent-deck/provider-oauth/google/start',
        payload: startBody,
      }),
      await app.inject({
        method: 'POST',
        url: '/api/agent-deck/provider-oauth/google/submit',
        payload: submitBody,
      }),
      await app.inject({
        method: 'GET',
        url: '/api/agent-deck/provider-oauth/google/poll/sess-1',
      }),
      await app.inject({
        method: 'DELETE',
        url: '/api/agent-deck/provider-oauth/sessions/sess-1',
      }),
      await app.inject({ method: 'DELETE', url: '/api/agent-deck/provider-oauth/google' }),
    ]

    for (const res of responses) expect(res.statusCode).toBe(200)

    expect(fake.requests).toEqual([
      { method: 'GET', path: '/api/providers/oauth', body: null },
      { method: 'POST', path: '/api/providers/oauth/google/start', body: startBody },
      { method: 'POST', path: '/api/providers/oauth/google/submit', body: submitBody },
      { method: 'GET', path: '/api/providers/oauth/google/poll/sess-1', body: null },
      { method: 'DELETE', path: '/api/providers/oauth/sessions/sess-1', body: null },
      { method: 'DELETE', path: '/api/providers/oauth/google', body: null },
    ])
  })

  it('400s on blank provider/session params before touching the dashboard', async () => {
    const fake = makeFakeDashboard()
    app = await buildApp(fake.client)

    for (const req of [
      { method: 'POST', url: '/api/agent-deck/provider-oauth/%20/start', payload: {} },
      { method: 'POST', url: '/api/agent-deck/provider-oauth/%20/submit', payload: {} },
      { method: 'GET', url: '/api/agent-deck/provider-oauth/%20/poll/sess-1' },
      { method: 'GET', url: '/api/agent-deck/provider-oauth/google/poll/%20' },
      { method: 'DELETE', url: '/api/agent-deck/provider-oauth/sessions/%20' },
      { method: 'DELETE', url: '/api/agent-deck/provider-oauth/%20' },
    ] as const) {
      const res = await app.inject(req)
      expect(res.statusCode).toBe(400)
    }

    expect(fake.requests).toHaveLength(0)
  })

  it('returns a generic 502 on dashboard failure without leaking token or dashboard URL', async () => {
    const fake = makeFakeDashboard({ fail: { '/api/providers/oauth/google/start': true } })
    app = await buildApp(fake.client)

    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/provider-oauth/google/start',
      payload: { redirect_uri: 'http://127.0.0.1:7878/callback' },
    })

    expect(res.statusCode).toBe(502)
    expect(res.body).not.toContain('tok_fake')
    expect(res.body).not.toContain('127.0.0.1:9123')
    expect(res.json()).toEqual({
      error: 'provider_oauth_dashboard_failed',
      message: 'Unable to reach the hermes dashboard for provider OAuth.',
    })
  })
})

describe('mapModelsResponse — usable honors API-key-configured providers (not just OAuth)', () => {
  // A provider Hermes lists with source 'hermes' is one the user has CONFIGURED
  // (a stored credential — OAuth OR api-key). The /api/providers/oauth probe only
  // reports OAUTH logins, so an api-key-connected provider (e.g. Nous via
  // `hermes auth add nous --type api-key`) would be wrongly marked not-usable even
  // though its models work. 'built-in' rows are unconfigured catalog entries.
  const info = { model: 'gpt-5', provider: 'openai-codex' }
  const options = {
    providers: [
      {
        slug: 'openai-codex',
        name: 'Codex',
        is_current: true,
        models: ['gpt-5'],
        source: 'hermes',
      },
      {
        slug: 'nous',
        name: 'Nous Portal',
        is_current: false,
        models: ['nvidia/nemotron-3'],
        source: 'hermes',
      },
      {
        slug: 'copilot',
        name: 'Copilot',
        is_current: false,
        models: ['gpt-5'],
        source: 'built-in',
      },
    ],
  }
  it('marks a configured (source=hermes) provider usable even with NO OAuth login', () => {
    // oauth reports NOTHING logged in — only the source signal should save nous.
    const res = mapModelsResponse(info as never, options as never, null, { providers: [] } as never)
    const byProv = (p: string) => res.models.filter((m) => m.provider === p)
    expect(byProv('nous').length).toBeGreaterThan(0)
    expect(byProv('nous').every((m) => m.usable)).toBe(true) // api-key-configured → usable
    expect(byProv('copilot').every((m) => m.usable === false)).toBe(true) // built-in catalog → not usable
    expect(byProv('openai-codex').every((m) => m.usable)).toBe(true) // active provider → usable
  })
})

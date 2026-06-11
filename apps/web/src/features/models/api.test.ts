import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  connectProvider,
  fetchModels,
  fetchProviderOAuthProviders,
  normalizeModelsResponse,
  setActiveModel,
} from './api'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const EMPTY_CAPS = {
  supportsTools: false,
  supportsVision: false,
  supportsReasoning: false,
  contextWindow: 0,
  maxOutputTokens: 0,
  modelFamily: '',
  autoContextLength: 0,
  configContextLength: 0,
  effectiveContextLength: 0,
}

describe('normalizeModelsResponse', () => {
  it('passes through a well-formed payload (capabilities + auxiliary)', () => {
    const out = normalizeModelsResponse({
      activeModelId: 'a/b',
      provider: { id: 'openrouter', label: 'OpenRouter' },
      models: [
        { id: 'a/b', label: 'a/b', provider: 'openrouter', active: true, source: 'built-in' },
      ],
      capabilities: {
        supportsTools: true,
        supportsVision: true,
        supportsReasoning: false,
        contextWindow: 200000,
        maxOutputTokens: 64000,
        modelFamily: 'claude',
        autoContextLength: 200000,
        configContextLength: 0,
        effectiveContextLength: 200000,
      },
      auxiliary: [{ task: 'vision', provider: 'auto', model: '' }],
    })
    expect(out.activeModelId).toBe('a/b')
    expect(out.provider).toEqual({ id: 'openrouter', label: 'OpenRouter' })
    expect(out.models).toHaveLength(1)
    expect(out.capabilities.supportsVision).toBe(true)
    expect(out.capabilities.contextWindow).toBe(200000)
    expect(out.auxiliary).toEqual([{ task: 'vision', provider: 'auto', model: '' }])
  })

  it('coerces a partial / malformed payload to safe defaults', () => {
    const out = normalizeModelsResponse({
      models: [{ id: 'only-id' }, { label: 'no-id-dropped' }, 42],
    })
    expect(out.activeModelId).toBe('')
    expect(out.provider).toEqual({ id: 'unknown', label: 'unknown' })
    // Entries without an id are dropped; the id-only entry is kept + defaulted.
    // A payload without qualifiedId/usable defaults to `<provider>/<id>` + fails
    // OPEN to usable:true (older BFF compatibility).
    expect(out.models).toEqual([
      {
        id: 'only-id',
        qualifiedId: 'unknown/only-id',
        label: 'only-id',
        provider: 'unknown',
        active: false,
        usable: true,
        source: 'static',
      },
    ])
    // Missing capabilities → all-falsy defaults; missing auxiliary → [].
    expect(out.capabilities).toEqual(EMPTY_CAPS)
    expect(out.auxiliary).toEqual([])
  })

  it('drops auxiliary entries without a task name', () => {
    const out = normalizeModelsResponse({
      auxiliary: [
        { task: 'compression', provider: 'openrouter', model: 'x' },
        { provider: 'auto' },
        7,
      ],
    })
    expect(out.auxiliary).toEqual([{ task: 'compression', provider: 'openrouter', model: 'x' }])
  })

  it('does NOT carry any retired overlay fields onto the result', () => {
    const out = normalizeModelsResponse({
      activeModelId: 'a/b',
      reasoningEffort: 'high',
      scope: 'channel',
      hasChannelOverride: true,
    }) as unknown as Record<string, unknown>
    expect(out).not.toHaveProperty('reasoningEffort')
    expect(out).not.toHaveProperty('scope')
    expect(out).not.toHaveProperty('hasChannelOverride')
  })

  it('treats a non-object as empty', () => {
    expect(normalizeModelsResponse(null).models).toEqual([])
    expect(normalizeModelsResponse(undefined).activeModelId).toBe('')
    expect(normalizeModelsResponse(null).capabilities).toEqual(EMPTY_CAPS)
    expect(normalizeModelsResponse(null).auxiliary).toEqual([])
  })

  it('surfaces providerStatusUnknown only when the BFF reports it true (default false)', () => {
    expect(normalizeModelsResponse({ providerStatusUnknown: true }).providerStatusUnknown).toBe(
      true,
    )
    // Anything else — false, missing, or an older payload — defaults to false.
    expect(normalizeModelsResponse({ providerStatusUnknown: false }).providerStatusUnknown).toBe(
      false,
    )
    expect(normalizeModelsResponse({}).providerStatusUnknown).toBe(false)
    expect(normalizeModelsResponse(null).providerStatusUnknown).toBe(false)
  })
})

describe('fetchModels', () => {
  it('GETs the BFF endpoint and normalizes the body', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        activeModelId: 'a/b',
        provider: { id: 'openrouter', label: 'OpenRouter' },
        models: [{ id: 'a/b', active: true }],
        capabilities: { supportsVision: true },
        auxiliary: [],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const out = await fetchModels()
    expect(fetchMock).toHaveBeenCalledWith('/api/agent-deck/models', {
      signal: undefined,
      headers: { Accept: 'application/json' },
    })
    expect(out.activeModelId).toBe('a/b')
    expect(out.models[0]).toEqual({
      id: 'a/b',
      qualifiedId: 'openrouter/a/b',
      label: 'a/b',
      provider: 'openrouter',
      active: true,
      usable: true,
      source: 'static',
    })
    expect(out.capabilities.supportsVision).toBe(true)
  })

  it('throws on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 502 })),
    )
    await expect(fetchModels()).rejects.toThrow(/502/)
  })
})

describe('connectProvider', () => {
  it('POSTs the slug + key to the live setup route and returns the verdict', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      Response.json({ provider: 'openrouter', connected: true }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const out = await connectProvider('openrouter', 'sk-live-secret')
    // Hits the ABSOLUTE setup route (not the /models base), POST + JSON body.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/agent-deck/setup/provider-key')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      provider: 'openrouter',
      apiKey: 'sk-live-secret',
    })
    expect(out).toEqual({ provider: 'openrouter', connected: true })
  })

  it('returns connected:false honestly when the add reports no usable model', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ provider: 'openrouter', connected: false })),
    )
    expect(await connectProvider('openrouter', 'sk-x')).toEqual({
      provider: 'openrouter',
      connected: false,
    })
  })

  it('throws on a non-ok response (key never resurfaces in the error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: 'Hermes could not add the credential.' }), {
            status: 502,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
    await expect(connectProvider('openrouter', 'sk-secret')).rejects.toThrow(/could not add/i)
  })
})

describe('fetchProviderOAuthProviders', () => {
  it('returns the lowercased set of oauth-capable provider ids from the live list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          providers: [
            { id: 'Nous', status: { logged_in: false } },
            { provider: 'anthropic' },
            { id: 'qwen-oauth' },
            { id: '' }, // dropped
            'garbage', // dropped
          ],
        }),
      ),
    )
    const out = await fetchProviderOAuthProviders()
    expect(out).toEqual(new Set(['nous', 'anthropic', 'qwen-oauth']))
  })

  it('throws on a non-ok response (caller decides the fallback)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 502 })),
    )
    await expect(fetchProviderOAuthProviders()).rejects.toThrow(/502/)
  })
})

describe('setActiveModel', () => {
  it('POSTs provider + model to the real /model/set proxy and resolves on success', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      Response.json({ ok: true }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await setActiveModel('anthropic', 'claude-opus-4-5-20251101')
    expect(result).toEqual({ status: 'switched' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    // The wave-0 BFF proxy of the stock POST /api/model/set. No confirm flag
    // rides along unless explicitly passed (the guard stays in force).
    expect(url).toBe('/api/agent-deck/model/set')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-4-5-20251101',
    })
  })

  it('surfaces the expensive-model guard as confirm-required (a 200 that did NOT switch)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ok: false,
          confirm_required: true,
          confirm_message: 'claude-opus-4-5 costs $25/M input. Confirm to switch.',
        }),
      ),
    )
    const result = await setActiveModel('anthropic', 'claude-opus-4-5-20251101')
    expect(result).toEqual({
      status: 'confirm-required',
      confirmMessage: 'claude-opus-4-5 costs $25/M input. Confirm to switch.',
    })
  })

  it('sends the explicit confirm flag on a user-confirmed expensive switch', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      Response.json({ ok: true }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await setActiveModel('anthropic', 'claude-opus-4-5-20251101', true)
    expect(result).toEqual({ status: 'switched' })
    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse(init?.body as string)).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-4-5-20251101',
      confirmExpensiveModel: true,
    })
  })

  it('throws (never claims a switch) on a 200 ok:false WITHOUT confirm_required', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ok: false, message: 'assignment rejected' })),
    )
    await expect(setActiveModel('anthropic', 'claude-opus-4-5-20251101')).rejects.toThrow(
      /assignment rejected/,
    )
  })

  it('throws an honest error on a gateway rejection (no silent no-op)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'Unable to switch the model on the dashboard.' }), {
            status: 502,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
    await expect(setActiveModel('anthropic', 'claude-opus-4-5-20251101')).rejects.toThrow(
      /unable to switch/i,
    )
  })
})

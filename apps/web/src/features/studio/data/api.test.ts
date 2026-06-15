import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  fetchStudioConfig,
  writeStudioConfig,
  fetchModelOptions,
  setProfileModel,
  fetchSoul,
  writeSoul,
  fetchStudioSkills,
  toggleStudioSkill,
  fetchStudioEnv,
  setStudioEnv,
  createStudioProfile,
  switchActiveProfile,
  normalizeStudioEnv,
} from './api'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Mock fetch returning a JSON body; returns the spy for call assertions. */
function mockJson(body: unknown) {
  const fetchMock = vi.fn<typeof fetch>(async () => Response.json(body))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function call(fetchMock: ReturnType<typeof mockJson>, i = 0): [string, RequestInit] {
  return fetchMock.mock.calls[i]! as [string, RequestInit]
}

/* -------------------------------------------------------------------------- */
/* Config                                                                     */
/* -------------------------------------------------------------------------- */

describe('fetchStudioConfig', () => {
  it('GETs the studio config scoped by profile and parses the subset', async () => {
    // The REAL response the BFF returns is the subset WRAPPED in a { config }
    // envelope (studioRoute returns `{ config: parsed.data }`), where model is a
    // top-level string, agent.disabled_toolsets is a JSON STRING, and
    // memory.write_approval is a boolean. The client must unwrap that envelope.
    const fetchMock = mockJson({
      config: {
        model: 'gpt-5.5',
        toolsets: ['hermes-cli'],
        agent: { disabled_toolsets: '["tts"]' },
        memory: { memory_enabled: true, memory_char_limit: 4000, write_approval: false },
        // an out-of-subset key the parse must DROP
        delegation: { enabled: true },
      },
    })
    const res = await fetchStudioConfig('coder')
    expect(call(fetchMock)[0]).toBe('/api/agent-deck/studio/config?profile=coder')
    expect(res.model).toBe('gpt-5.5')
    expect(res.toolsets).toEqual(['hermes-cli'])
    // The JSON-string blocklist is decoded to a string[] for the surface.
    expect(res.agent?.disabled_toolsets).toEqual(['tts'])
    expect(res.memory?.memory_enabled).toBe(true)
    expect(res.memory?.write_approval).toBe(false)
    expect((res as Record<string, unknown>).delegation).toBeUndefined()
  })

  it('tolerates a bare (unwrapped) subset body for forward/back compatibility', async () => {
    // If an older/newer BFF returns the subset at the top level (no envelope),
    // the client still reads it rather than silently dropping every key.
    mockJson({ toolsets: ['hermes-cli'], memory: { memory_enabled: true } })
    const res = await fetchStudioConfig('coder')
    expect(res.toolsets).toEqual(['hermes-cli'])
    expect(res.memory?.memory_enabled).toBe(true)
  })

  it('omits the profile query when targeting the active profile', async () => {
    const fetchMock = mockJson({ config: {} })
    await fetchStudioConfig(null)
    expect(call(fetchMock)[0]).toBe('/api/agent-deck/studio/config')
  })
})

describe('writeStudioConfig', () => {
  it('PUTs the partial patch with the profile in the body', async () => {
    const fetchMock = mockJson({ ok: true })
    const res = await writeStudioConfig('coder', { memory: { memory_enabled: false } })
    expect(res).toEqual({ ok: true })
    const [url, init] = call(fetchMock)
    expect(url).toBe('/api/agent-deck/studio/config')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string)).toEqual({
      profile: 'coder',
      config: { memory: { memory_enabled: false } },
    })
  })

  it('omits profile from the body when targeting the active profile', async () => {
    const fetchMock = mockJson({ ok: true })
    await writeStudioConfig(null, { toolsets: ['web'] })
    expect(JSON.parse(call(fetchMock)[1].body as string)).toEqual({
      config: { toolsets: ['web'] },
    })
  })
})

/* -------------------------------------------------------------------------- */
/* Model                                                                      */
/* -------------------------------------------------------------------------- */

describe('fetchModelOptions', () => {
  it('GETs scoped model options and parses the picker shape', async () => {
    const fetchMock = mockJson({
      providers: [
        {
          slug: 'anthropic',
          name: 'Anthropic',
          is_current: true,
          is_user_defined: false,
          models: ['claude-opus-4-8'],
          total_models: 12,
        },
      ],
      model: 'claude-opus-4-8',
      provider: 'anthropic',
    })
    const res = await fetchModelOptions('coder')
    expect(call(fetchMock)[0]).toBe('/api/agent-deck/studio/model-options?profile=coder')
    expect(res.provider).toBe('anthropic')
    expect(res.providers[0]!.models).toEqual(['claude-opus-4-8'])
  })
})

describe('setProfileModel', () => {
  it('PUTs provider+model to the per-profile model route (name in the path)', async () => {
    const fetchMock = mockJson({ ok: true, provider: 'anthropic', model: 'claude-opus-4-8' })
    const res = await setProfileModel('coder', 'anthropic', 'claude-opus-4-8')
    expect(res).toEqual({ ok: true, provider: 'anthropic', model: 'claude-opus-4-8' })
    const [url, init] = call(fetchMock)
    expect(url).toBe('/api/agent-deck/profiles/coder/model')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string)).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-4-8',
    })
  })

  it('path-encodes a profile name with special characters', async () => {
    const fetchMock = mockJson({ ok: true, provider: 'p', model: 'm' })
    await setProfileModel('a/b', 'p', 'm')
    expect(call(fetchMock)[0]).toBe('/api/agent-deck/profiles/a%2Fb/model')
  })
})

/* -------------------------------------------------------------------------- */
/* Soul                                                                       */
/* -------------------------------------------------------------------------- */

describe('fetchSoul', () => {
  it('GETs the per-profile soul file (name in the path)', async () => {
    const fetchMock = mockJson({ content: '# Soul', exists: true })
    const res = await fetchSoul('coder')
    expect(call(fetchMock)[0]).toBe('/api/agent-deck/studio/profiles/coder/soul')
    expect(res).toEqual({ content: '# Soul', exists: true })
  })

  it('coerces a thin payload to a safe { content, exists } shape', async () => {
    mockJson({})
    const res = await fetchSoul('coder')
    expect(res).toEqual({ content: '', exists: false })
  })
})

describe('writeSoul', () => {
  it('PUTs the content to the per-profile soul route', async () => {
    const fetchMock = mockJson({ ok: true })
    const res = await writeSoul('coder', '# New soul')
    expect(res).toEqual({ ok: true })
    const [url, init] = call(fetchMock)
    expect(url).toBe('/api/agent-deck/studio/profiles/coder/soul')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string)).toEqual({ content: '# New soul' })
  })
})

/* -------------------------------------------------------------------------- */
/* Skills (per-agent, profile-scoped)                                         */
/* -------------------------------------------------------------------------- */

describe('fetchStudioSkills', () => {
  it('GETs skills scoped by profile and normalizes the list', async () => {
    const fetchMock = mockJson({
      skills: [
        { name: 'web-search', description: 'search', category: 'research', enabled: true },
        { name: 'shell', description: 'shell', category: null, enabled: false },
        // a malformed entry (no name) is dropped
        { description: 'nameless' },
      ],
    })
    const res = await fetchStudioSkills('coder')
    expect(call(fetchMock)[0]).toBe('/api/agent-deck/studio/skills?profile=coder')
    expect(res).toEqual([
      { name: 'web-search', description: 'search', category: 'research', enabled: true },
      { name: 'shell', description: 'shell', category: null, enabled: false },
    ])
  })

  it('omits the profile query when targeting the active profile and degrades on a thin payload', async () => {
    const fetchMock = mockJson({})
    const res = await fetchStudioSkills(null)
    expect(call(fetchMock)[0]).toBe('/api/agent-deck/studio/skills')
    expect(res).toEqual([])
  })

  it('defaults a skill missing the enabled flag to enabled (visible == usable)', async () => {
    mockJson({ skills: [{ name: 'web-search', description: 'd', category: null }] })
    const res = await fetchStudioSkills('coder')
    expect(res[0]!.enabled).toBe(true)
  })
})

describe('toggleStudioSkill', () => {
  it('PUTs name + enabled + profile and returns the confirmed state', async () => {
    const fetchMock = mockJson({ name: 'shell', enabled: false })
    const res = await toggleStudioSkill('coder', 'shell', false)
    expect(res).toEqual({ name: 'shell', enabled: false })
    const [url, init] = call(fetchMock)
    expect(url).toBe('/api/agent-deck/studio/skills/toggle')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'shell',
      enabled: false,
      profile: 'coder',
    })
  })

  it('omits profile from the body for the active profile', async () => {
    const fetchMock = mockJson({ name: 'shell', enabled: true })
    await toggleStudioSkill(null, 'shell', true)
    expect(JSON.parse(call(fetchMock)[1].body as string)).toEqual({ name: 'shell', enabled: true })
  })

  it('falls back to the requested state when the echo is thin', async () => {
    mockJson({})
    const res = await toggleStudioSkill('coder', 'shell', true)
    expect(res).toEqual({ name: 'shell', enabled: true })
  })
})

/* -------------------------------------------------------------------------- */
/* Env (redacted, shape-only)                                                 */
/* -------------------------------------------------------------------------- */

describe('normalizeStudioEnv', () => {
  it('projects the slim {key,isSet} array shape', () => {
    const out = normalizeStudioEnv({
      env: [
        { key: 'OPENAI_API_KEY', isSet: true },
        { key: 'GEMINI_API_KEY', isSet: false },
      ],
    })
    expect(out.env).toEqual([
      { key: 'OPENAI_API_KEY', isSet: true },
      { key: 'GEMINI_API_KEY', isSet: false },
    ])
  })

  it('projects the rich record shape to key+isSet and DROPS any value/preview', () => {
    const out = normalizeStudioEnv({
      env: {
        OPENAI_API_KEY: { is_set: true, redacted_value: 'sk-...abc4' },
        EMPTY_KEY: { is_set: false, redacted_value: '' },
      },
    })
    // Only key + isSet survive; no redacted_value or raw value is carried.
    expect(out.env).toEqual([
      { key: 'OPENAI_API_KEY', isSet: true },
      { key: 'EMPTY_KEY', isSet: false },
    ])
    const serialized = JSON.stringify(out)
    expect(serialized).not.toContain('redacted_value')
    expect(serialized).not.toContain('sk-...abc4')
  })

  it('treats a present-but-blank value as set=false (record shape, no is_set flag)', () => {
    const out = normalizeStudioEnv({
      env: { K1: { redacted_value: 'x' }, K2: { redacted_value: '' } },
    })
    expect(out.env).toEqual([
      { key: 'K1', isSet: true },
      { key: 'K2', isSet: false },
    ])
  })

  it('degrades gracefully on a non-object / missing env', () => {
    expect(normalizeStudioEnv(null).env).toEqual([])
    expect(normalizeStudioEnv({}).env).toEqual([])
    expect(normalizeStudioEnv({ env: 'nope' }).env).toEqual([])
  })
})

describe('fetchStudioEnv', () => {
  it('GETs env scoped by profile and normalizes to shape-only entries', async () => {
    const fetchMock = mockJson({
      env: { OPENAI_API_KEY: { is_set: true, redacted_value: 'sk-...9' } },
    })
    const res = await fetchStudioEnv('coder')
    expect(call(fetchMock)[0]).toBe('/api/agent-deck/studio/env?profile=coder')
    expect(res.env).toEqual([{ key: 'OPENAI_API_KEY', isSet: true }])
  })
})

describe('setStudioEnv', () => {
  it('PUTs key+value+profile and returns ok (never echoes the value)', async () => {
    const fetchMock = mockJson({ ok: true, key: 'OPENAI_API_KEY', restartRequired: true })
    const res = await setStudioEnv('coder', 'OPENAI_API_KEY', 'sk-secret-value')
    expect(res.ok).toBe(true)
    const [url, init] = call(fetchMock)
    expect(url).toBe('/api/agent-deck/studio/env')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string)).toEqual({
      key: 'OPENAI_API_KEY',
      value: 'sk-secret-value',
      profile: 'coder',
    })
  })

  it('omits profile from the body for the active profile', async () => {
    const fetchMock = mockJson({ ok: true, key: 'K' })
    await setStudioEnv(null, 'K', 'v')
    expect(JSON.parse(call(fetchMock)[1].body as string)).toEqual({ key: 'K', value: 'v' })
  })
})

/* -------------------------------------------------------------------------- */
/* Profiles: create+clone, switch                                             */
/* -------------------------------------------------------------------------- */

describe('createStudioProfile', () => {
  it('POSTs a plain create (no clone fields)', async () => {
    const fetchMock = mockJson({ name: 'writer' })
    const res = await createStudioProfile({ name: 'writer' })
    expect(res.name).toBe('writer')
    const [url, init] = call(fetchMock)
    expect(url).toBe('/api/agent-deck/profiles')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ name: 'writer' })
  })

  it('POSTs a clone, forwarding the source agent + clone flag', async () => {
    const fetchMock = mockJson({ name: 'writer' })
    await createStudioProfile({ name: 'writer', cloneFrom: 'coder' })
    expect(JSON.parse(call(fetchMock)[1].body as string)).toEqual({
      name: 'writer',
      clone: true,
      cloneFrom: 'coder',
    })
  })

  it('carries an avatar through when provided', async () => {
    const fetchMock = mockJson({ name: 'writer', avatar: 'v3' })
    await createStudioProfile({ name: 'writer', avatar: 'v3' })
    expect(JSON.parse(call(fetchMock)[1].body as string)).toEqual({ name: 'writer', avatar: 'v3' })
  })
})

describe('switchActiveProfile', () => {
  it('POSTs the name to the switch route and returns the active agent', async () => {
    const fetchMock = mockJson({ active: 'coder' })
    const res = await switchActiveProfile('coder')
    expect(res).toEqual({ active: 'coder' })
    const [url, init] = call(fetchMock)
    expect(url).toBe('/api/agent-deck/profiles/switch')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ name: 'coder' })
  })
})

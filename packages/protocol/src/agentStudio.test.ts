import { describe, it, expect } from 'vitest'
import {
  StudioModelId,
  StudioMemoryConfig,
  StudioAgentConfig,
  DisabledToolsets,
  StudioConfigSubset,
  StudioConfigWriteRequest,
  StudioConfigWriteResponse,
  ModelOption,
  ModelOptionsResponse,
  ProfileModelSetRequest,
  ProfileModelSetResponse,
  RedactedEnvEntry,
  StudioEnvResponse,
} from './agentStudio'

describe('StudioModelId DTO', () => {
  it('parses the top-level model id string the effective config carries', () => {
    // Installed hermes stores the main model id at the TOP-LEVEL `model:` key as a
    // plain string (e.g. "gpt-5.5"), NOT a nested { default, provider } block.
    expect(StudioModelId.parse('gpt-5.5')).toBe('gpt-5.5')
  })

  it('rejects a non-string model id', () => {
    expect(() => StudioModelId.parse({ default: 'gpt-5.5' })).toThrow()
  })
})

describe('StudioMemoryConfig DTO', () => {
  // Mirrors the REAL effective config GET /api/config returns: write_approval is a
  // BOOLEAN (hermes config schema v29 types it as boolean), not an 'auto'/'manual' enum.
  const full = {
    memory_enabled: true,
    user_profile_enabled: false,
    memory_char_limit: 4000,
    user_char_limit: 2000,
    write_approval: false,
    provider: 'holographic_plus',
  }

  it('parses the full memory block the Studio reads/writes', () => {
    const parsed = StudioMemoryConfig.parse(full)
    expect(parsed.memory_enabled).toBe(true)
    expect(parsed.user_profile_enabled).toBe(false)
    expect(parsed.memory_char_limit).toBe(4000)
    expect(parsed.user_char_limit).toBe(2000)
    expect(parsed.write_approval).toBe(false)
    expect(parsed.provider).toBe('holographic_plus')
  })

  it('tolerates a partial memory block (effective config may omit keys)', () => {
    const parsed = StudioMemoryConfig.parse({ memory_enabled: false })
    expect(parsed.memory_enabled).toBe(false)
    expect(parsed.memory_char_limit).toBeUndefined()
  })

  it('reads write_approval as a boolean (the real hermes type)', () => {
    expect(StudioMemoryConfig.parse({ write_approval: true }).write_approval).toBe(true)
    // The old 'auto'/'manual' string form is NOT this config's shape and is rejected.
    expect(() => StudioMemoryConfig.parse({ write_approval: 'auto' })).toThrow()
  })

  it('rejects a non-integer char limit', () => {
    expect(() => StudioMemoryConfig.parse({ memory_char_limit: 1.5 })).toThrow()
  })

  it('rejects a negative char limit', () => {
    expect(() => StudioMemoryConfig.parse({ user_char_limit: -1 })).toThrow()
  })
})

describe('DisabledToolsets DTO', () => {
  it('decodes the JSON-ENCODED STRING form the effective config carries', () => {
    // The real GET /api/config surfaces agent.disabled_toolsets as a JSON string,
    // e.g. '["tts"]', NOT a JSON array.
    expect(DisabledToolsets.parse('["tts"]')).toEqual(['tts'])
    expect(DisabledToolsets.parse('["browser","vision"]')).toEqual(['browser', 'vision'])
  })

  it('passes an already-array value through untouched (normalized config / write patch)', () => {
    expect(DisabledToolsets.parse(['browser', 'vision'])).toEqual(['browser', 'vision'])
  })

  it('decodes an empty string to an empty list', () => {
    expect(DisabledToolsets.parse('')).toEqual([])
  })

  it('rejects a non-list value (a string that is not a JSON array)', () => {
    expect(() => DisabledToolsets.parse('not-json')).toThrow()
    expect(() => DisabledToolsets.parse('"tts"')).toThrow()
  })
})

describe('StudioAgentConfig DTO', () => {
  it('parses agent.disabled_toolsets from the JSON-string form the config returns', () => {
    const parsed = StudioAgentConfig.parse({ disabled_toolsets: '["tts"]' })
    expect(parsed.disabled_toolsets).toEqual(['tts'])
  })

  it('parses agent.disabled_toolsets from an array (the write patch shape)', () => {
    const parsed = StudioAgentConfig.parse({ disabled_toolsets: ['browser', 'vision'] })
    expect(parsed.disabled_toolsets).toEqual(['browser', 'vision'])
  })

  it('tolerates an absent disabled_toolsets', () => {
    expect(StudioAgentConfig.parse({}).disabled_toolsets).toBeUndefined()
  })
})

describe('StudioConfigSubset DTO (read view)', () => {
  it('parses the per-profile subset the Studio reads from the REAL effective config', () => {
    // This is the real GET /api/config shape: model is a top-level string,
    // agent.disabled_toolsets is a JSON STRING, memory.write_approval is a boolean.
    const parsed = StudioConfigSubset.parse({
      model: 'gpt-5.5',
      toolsets: ['hermes-cli'],
      agent: { disabled_toolsets: '["tts"]' },
      memory: {
        memory_enabled: true,
        user_profile_enabled: true,
        memory_char_limit: 4000,
        user_char_limit: 4000,
        write_approval: false,
        provider: 'holographic_plus',
      },
    })
    expect(parsed.model).toBe('gpt-5.5')
    expect(parsed.toolsets).toEqual(['hermes-cli'])
    expect(parsed.agent?.disabled_toolsets).toEqual(['tts'])
    expect(parsed.memory?.write_approval).toBe(false)
    expect(parsed.memory?.provider).toBe('holographic_plus')
  })

  it('whitelists exactly the Studio subset (drops unrelated config keys incl. secrets)', () => {
    const parsed = StudioConfigSubset.parse({
      model: 'gpt-5.5',
      toolsets: [],
      // the effective config carries dozens of keys the Studio does not touch,
      // including secret-bearing ones the whitelist must DROP:
      delegation: { enabled: true },
      auxiliary: { vision: { api_key: 'sk-should-never-surface' } },
      gateway: { platforms: ['telegram'] },
      _internal: 'x',
    })
    expect(Object.keys(parsed).sort()).toEqual(['model', 'toolsets'].sort())
    expect(parsed).not.toHaveProperty('delegation')
    expect(parsed).not.toHaveProperty('auxiliary')
    expect(parsed).not.toHaveProperty('gateway')
    expect(JSON.stringify(parsed)).not.toContain('sk-should-never-surface')
  })

  it('tolerates an entirely empty subset (a freshly-created profile)', () => {
    expect(StudioConfigSubset.parse({})).toEqual({})
  })

  it('rejects a non-string toolset entry', () => {
    expect(() => StudioConfigSubset.parse({ toolsets: ['web', 3] })).toThrow()
  })
})

describe('StudioConfigWriteRequest DTO', () => {
  it('wraps a partial config patch with an optional profile scope', () => {
    const parsed = StudioConfigWriteRequest.parse({
      profile: 'worker_beta',
      config: { toolsets: ['web'], agent: { disabled_toolsets: ['browser'] } },
    })
    expect(parsed.profile).toBe('worker_beta')
    expect(parsed.config.toolsets).toEqual(['web'])
  })

  it('allows an omitted profile (targets the active profile)', () => {
    const parsed = StudioConfigWriteRequest.parse({ config: { model: 'gpt-5.5' } })
    expect(parsed.profile).toBeUndefined()
    expect(parsed.config.model).toBe('gpt-5.5')
  })

  it('rejects an invalid profile name (path-traversal guard)', () => {
    expect(() =>
      StudioConfigWriteRequest.parse({ profile: '../../etc', config: {} }),
    ).toThrow()
  })

  it('echoes the stock { ok } write response', () => {
    expect(StudioConfigWriteResponse.parse({ ok: true })).toEqual({ ok: true })
  })
})

describe('ModelOption + ModelOptionsResponse DTO', () => {
  it('parses one provider row from GET /api/model/options', () => {
    const parsed = ModelOption.parse({
      slug: 'anthropic',
      name: 'Anthropic',
      is_current: true,
      is_user_defined: false,
      models: ['claude-opus-4-8', 'claude-sonnet-4-6'],
      total_models: 2,
    })
    expect(parsed.slug).toBe('anthropic')
    expect(parsed.models).toHaveLength(2)
    expect(parsed.is_current).toBe(true)
  })

  it('tolerates the optional picker-hint fields without requiring them', () => {
    const parsed = ModelOption.parse({
      slug: 'openrouter',
      name: 'OpenRouter',
      is_current: false,
      is_user_defined: false,
      models: [],
      total_models: 0,
      authenticated: false,
      auth_type: 'api-key',
      key_env: 'OPENROUTER_API_KEY',
      warning: 'Add a key to use this provider.',
      source: 'canonical',
    })
    expect(parsed.authenticated).toBe(false)
    expect(parsed.key_env).toBe('OPENROUTER_API_KEY')
  })

  it('parses the { providers, model, provider } envelope', () => {
    const parsed = ModelOptionsResponse.parse({
      providers: [
        { slug: 'anthropic', name: 'Anthropic', is_current: true, is_user_defined: false, models: ['m'], total_models: 1 },
      ],
      model: 'm',
      provider: 'anthropic',
    })
    expect(parsed.providers).toHaveLength(1)
    expect(parsed.model).toBe('m')
    expect(parsed.provider).toBe('anthropic')
  })
})

describe('ProfileModelSet DTOs', () => {
  it('parses a valid set request (provider + model)', () => {
    const parsed = ProfileModelSetRequest.parse({ provider: 'anthropic', model: 'claude-opus-4-8' })
    expect(parsed).toEqual({ provider: 'anthropic', model: 'claude-opus-4-8' })
  })

  it('rejects an empty provider or model', () => {
    expect(() => ProfileModelSetRequest.parse({ provider: '', model: 'm' })).toThrow()
    expect(() => ProfileModelSetRequest.parse({ provider: 'p', model: '' })).toThrow()
  })

  it('parses the stock { ok, provider, model } response', () => {
    const parsed = ProfileModelSetResponse.parse({ ok: true, provider: 'anthropic', model: 'm' })
    expect(parsed).toEqual({ ok: true, provider: 'anthropic', model: 'm' })
  })
})

describe('RedactedEnvEntry + StudioEnvResponse DTO', () => {
  it('parses the slim { key, isSet } redacted entry', () => {
    const parsed = RedactedEnvEntry.parse({ key: 'OPENAI_API_KEY', isSet: true })
    expect(parsed).toEqual({ key: 'OPENAI_API_KEY', isSet: true })
  })

  it('NEVER carries a value (drops any plaintext or redacted preview)', () => {
    const parsed = RedactedEnvEntry.parse({
      key: 'OPENAI_API_KEY',
      isSet: true,
      value: 'sk-secret-plaintext',
      redacted_value: 'sk-...abc4',
    })
    expect(Object.keys(parsed).sort()).toEqual(['isSet', 'key'].sort())
    expect(parsed).not.toHaveProperty('value')
    expect(parsed).not.toHaveProperty('redacted_value')
  })

  it('rejects an empty key', () => {
    expect(() => RedactedEnvEntry.parse({ key: '', isSet: false })).toThrow()
  })

  it('parses the Studio env list response', () => {
    const parsed = StudioEnvResponse.parse({
      env: [
        { key: 'OPENAI_API_KEY', isSet: true },
        { key: 'GEMINI_API_KEY', isSet: false },
      ],
    })
    expect(parsed.env).toHaveLength(2)
    expect(parsed.env[1]!.isSet).toBe(false)
  })
})

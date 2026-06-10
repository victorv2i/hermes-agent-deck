import { describe, it, expect } from 'vitest'
import { composeVoiceState } from './voiceService'
import { voiceKeyEnvVars, isVoiceKeyEnvVar } from './registry'

/**
 * VOICE SERVICE TESTS — composition is faithful to the config + env, fail-safe to
 * the hermes defaults, and keys are SHAPE-ONLY (never the plaintext).
 */

describe('composeVoiceState', () => {
  const fullConfig = {
    tts: {
      provider: 'elevenlabs',
      edge: { voice: 'en-US-AriaNeural' },
      elevenlabs: { voice_id: 'pNInz6obpgDQGcFmaJgB' },
      neutts: { model: 'neuphonic/neutts-air' },
    },
    stt: { enabled: true, provider: 'groq', local: { model: 'base' } },
    voice: { auto_tts: true, beep_enabled: false },
  }
  const env = {
    ELEVENLABS_API_KEY: { is_set: true, redacted_value: 'el-…abcd' },
    GROQ_API_KEY: { is_set: false, redacted_value: null },
    // a plaintext field that must NEVER surface
    OPENAI_API_KEY: { is_set: true, redacted_value: 'sk-…wxyz', value: 'sk-PLAINTEXT' },
  }

  it('reads the active providers + toggles from the config', () => {
    const state = composeVoiceState(fullConfig, env)
    expect(state.ttsProvider).toBe('elevenlabs')
    expect(state.sttProvider).toBe('groq')
    expect(state.sttEnabled).toBe(true)
    expect(state.toggles).toEqual({ autoTts: true, beepEnabled: false })
  })

  it('lists all 10 TTS + 5 STT built-in providers with their voice + key shape', () => {
    const state = composeVoiceState(fullConfig, env)
    expect(state.ttsProviders.map((p) => p.id)).toEqual([
      'edge',
      'elevenlabs',
      'openai',
      'xai',
      'mistral',
      'minimax',
      'gemini',
      'neutts',
      'kittentts',
      'piper',
    ])
    expect(state.sttProviders.map((p) => p.id)).toEqual([
      'local',
      'openai',
      'mistral',
      'groq',
      'xai',
    ])

    const el = state.ttsProviders.find((p) => p.id === 'elevenlabs')!
    expect(el.voiceField).toBe('voice_id')
    expect(el.voice).toBe('pNInz6obpgDQGcFmaJgB')
    expect(el.local).toBe(false)
    expect(el.key.envVar).toBe('ELEVENLABS_API_KEY')
    expect(el.key.isSet).toBe(true)
    expect(el.key.redactedValue).toBe('el-…abcd')

    const neutts = state.ttsProviders.find((p) => p.id === 'neutts')!
    expect(neutts.local).toBe(true)
    expect(neutts.key.envVar).toBeNull()
    expect(neutts.voice).toBe('neuphonic/neutts-air')
  })

  it('NEVER surfaces a plaintext key value (shape-only)', () => {
    const state = composeVoiceState(fullConfig, env)
    const blob = JSON.stringify(state)
    expect(blob).not.toContain('sk-PLAINTEXT')
    // only the redacted preview is present
    const openai = state.ttsProviders.find((p) => p.id === 'openai')!
    expect(openai.key.redactedValue).toBe('sk-…wxyz')
  })

  it('falls back to hermes defaults for missing/garbled blocks', () => {
    const state = composeVoiceState({}, {})
    expect(state.ttsProvider).toBe('edge')
    expect(state.sttProvider).toBe('local')
    expect(state.sttEnabled).toBe(true) // default true
    expect(state.toggles).toEqual({ autoTts: false, beepEnabled: false })
    // local providers report no key, unset cloud providers report isSet:false
    expect(state.ttsProviders.find((p) => p.id === 'edge')!.key.isSet).toBe(false)
    expect(state.ttsProviders.find((p) => p.id === 'openai')!.key.isSet).toBe(false)
  })

  it('treats an unknown provider value as the default', () => {
    const state = composeVoiceState({ tts: { provider: 'bogus' }, stt: { provider: 'bogus' } }, {})
    expect(state.ttsProvider).toBe('edge')
    expect(state.sttProvider).toBe('local')
  })

  it('respects an explicit stt.enabled = false', () => {
    const state = composeVoiceState({ stt: { enabled: false } }, {})
    expect(state.sttEnabled).toBe(false)
  })
})

describe('voice key allowlist', () => {
  it('is the union of every cloud provider key env var', () => {
    const vars = voiceKeyEnvVars()
    for (const v of [
      'ELEVENLABS_API_KEY',
      'OPENAI_API_KEY',
      'XAI_API_KEY',
      'MISTRAL_API_KEY',
      'MINIMAX_API_KEY',
      'VOICE_TOOLS_OPENAI_KEY',
      'GROQ_API_KEY',
    ]) {
      expect(vars.has(v)).toBe(true)
    }
  })

  it('rejects arbitrary / non-voice env vars', () => {
    expect(isVoiceKeyEnvVar('ELEVENLABS_API_KEY')).toBe(true)
    expect(isVoiceKeyEnvVar('API_SERVER_KEY')).toBe(false)
    expect(isVoiceKeyEnvVar('ANTHROPIC_API_KEY')).toBe(false)
    expect(isVoiceKeyEnvVar('')).toBe(false)
  })
})

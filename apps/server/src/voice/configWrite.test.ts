import { describe, it, expect } from 'vitest'
import {
  assertVoiceBlockPath,
  buildVoicePatches,
  applyVoicePatch,
  applyVoicePatches,
} from './configWrite'

/**
 * VOICE CONFIG WRITE TESTS — the allowlist honesty boundary. Every write must be
 * confined to the tts/stt/voice blocks; a secret in another block must round-trip
 * verbatim; an out-of-block or unsafe path must be a hard throw.
 */

describe('assertVoiceBlockPath', () => {
  it('accepts paths rooted at tts / stt / voice', () => {
    expect(() => assertVoiceBlockPath('tts.provider')).not.toThrow()
    expect(() => assertVoiceBlockPath('tts.elevenlabs.voice_id')).not.toThrow()
    expect(() => assertVoiceBlockPath('stt.enabled')).not.toThrow()
    expect(() => assertVoiceBlockPath('voice.auto_tts')).not.toThrow()
  })

  it('REJECTS paths outside the three voice blocks', () => {
    expect(() => assertVoiceBlockPath('API_SERVER_KEY')).toThrow()
    expect(() => assertVoiceBlockPath('model.provider')).toThrow()
    expect(() => assertVoiceBlockPath('agent.max_turns')).toThrow()
    expect(() => assertVoiceBlockPath('ttsxx.provider')).toThrow()
  })

  it('REJECTS prototype-pollution segments', () => {
    expect(() => assertVoiceBlockPath('voice.__proto__')).toThrow()
    expect(() => assertVoiceBlockPath('tts.constructor.x')).toThrow()
  })
})

describe('buildVoicePatches', () => {
  it('maps each request field to its in-block dot-path', () => {
    const patches = buildVoicePatches({
      ttsProvider: 'elevenlabs',
      ttsVoice: { provider: 'elevenlabs', voice: 'Adam' },
      sttProvider: 'groq',
      sttEnabled: false,
      autoTts: true,
      beepEnabled: false,
    })
    expect(patches).toEqual([
      { path: 'tts.provider', value: 'elevenlabs' },
      { path: 'tts.elevenlabs.voice_id', value: 'Adam' },
      { path: 'stt.provider', value: 'groq' },
      { path: 'stt.enabled', value: false },
      { path: 'voice.auto_tts', value: true },
      { path: 'voice.beep_enabled', value: false },
    ])
  })

  it('resolves the TTS voice sub-field from the registry, not client input', () => {
    // edge uses `voice`, neutts uses `model` — the path comes from the registry.
    expect(
      buildVoicePatches({ ttsVoice: { provider: 'edge', voice: 'en-US-AriaNeural' } }),
    ).toEqual([{ path: 'tts.edge.voice', value: 'en-US-AriaNeural' }])
    expect(buildVoicePatches({ ttsVoice: { provider: 'neutts', voice: 'neuphonic/x' } })).toEqual([
      { path: 'tts.neutts.model', value: 'neuphonic/x' },
    ])
  })
})

describe('applyVoicePatch (read-modify-write)', () => {
  it('sets the in-block value and leaves OTHER blocks (incl. secrets) untouched', () => {
    const config = {
      API_SERVER_KEY: 'super-secret',
      model: { provider: 'anthropic' },
      tts: { provider: 'edge', edge: { voice: 'en-US-AriaNeural' } },
    }
    const next = applyVoicePatch(config, 'tts.provider', 'openai')
    expect(next.tts).toMatchObject({ provider: 'openai', edge: { voice: 'en-US-AriaNeural' } })
    // The secret + the model block round-trip verbatim.
    expect(next.API_SERVER_KEY).toBe('super-secret')
    expect(next.model).toEqual({ provider: 'anthropic' })
    // Input not mutated.
    expect((config.tts as { provider: string }).provider).toBe('edge')
  })

  it('creates a missing sub-block path', () => {
    const next = applyVoicePatch({}, 'tts.elevenlabs.voice_id', 'Adam')
    expect(next).toEqual({ tts: { elevenlabs: { voice_id: 'Adam' } } })
  })

  it('REFUSES to write outside the voice blocks', () => {
    expect(() => applyVoicePatch({}, 'API_SERVER_KEY', 'x')).toThrow()
  })

  it('applyVoicePatches applies a sequence in order', () => {
    const next = applyVoicePatches({ secret: 'keep' }, [
      { path: 'tts.provider', value: 'xai' },
      { path: 'voice.auto_tts', value: true },
    ])
    expect(next).toMatchObject({
      secret: 'keep',
      tts: { provider: 'xai' },
      voice: { auto_tts: true },
    })
  })
})

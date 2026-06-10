import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DashboardClient } from '../hermes/dashboardClient'
import {
  VoiceState,
  AudioNoteList,
  UpdateVoiceConfigResponse,
  SetVoiceKeyResponse,
} from '@agent-deck/protocol'
import { registerVoiceRoutes } from './voiceRoutes'
import { audioRoot } from './audioFs'

let app: FastifyInstance | undefined
let home: string

const CONFIG_BODY = () => ({
  // a secret in another block — must round-trip untouched on any write
  API_SERVER_KEY: 'super-secret',
  model: { provider: 'anthropic' },
  tts: {
    provider: 'edge',
    edge: { voice: 'en-US-AriaNeural' },
    elevenlabs: { voice_id: 'Adam' },
  },
  stt: { enabled: true, provider: 'local', local: { model: 'base' } },
  voice: { auto_tts: false, beep_enabled: true, record_key: 'space' },
})

const ENV_BODY = () => ({
  ELEVENLABS_API_KEY: { is_set: true, redacted_value: 'el-…abcd' },
  OPENAI_API_KEY: { is_set: false, redacted_value: null },
})

/**
 * A fake hermes dashboard as an injectable `fetch`. Records the LAST PUT body for
 * /api/config + /api/env so the test can assert what we wrote — and that secrets
 * in other blocks round-trip verbatim.
 */
function makeFakeDashboard(opts: { configFail?: boolean } = {}): {
  fetchImpl: typeof fetch
  configPuts: Array<{ config: Record<string, unknown> }>
  envPuts: Array<{ key: string; value: string }>
} {
  const configPuts: Array<{ config: Record<string, unknown> }> = []
  const envPuts: Array<{ key: string; value: string }> = []
  let config = CONFIG_BODY()
  let env = ENV_BODY()
  const token = 'tok_test_123'

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input.toString())
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = url.pathname
    const json = (status: number, body: unknown): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })

    if (method === 'GET' && path === '/') {
      return new Response(
        `<!doctype html><script>window.__HERMES_SESSION_TOKEN__="${token}";</script>`,
        { status: 200, headers: { 'Content-Type': 'text/html' } },
      )
    }
    if (method === 'GET' && path === '/api/config') {
      if (opts.configFail) return json(500, { error: 'boom' })
      return json(200, config)
    }
    if (method === 'PUT' && path === '/api/config') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { config: Record<string, unknown> }
      configPuts.push(body)
      config = body.config as ReturnType<typeof CONFIG_BODY>
      return json(200, { ok: true })
    }
    if (method === 'GET' && path === '/api/env') {
      return json(200, env)
    }
    if (method === 'PUT' && path === '/api/env') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { key: string; value: string }
      envPuts.push(body)
      env = {
        ...env,
        [body.key]: { is_set: true, redacted_value: `${body.value.slice(0, 2)}-…last` },
      }
      return json(200, { ok: true, key: body.key })
    }
    return json(404, { error: 'not_found' })
  }) as typeof fetch

  return { fetchImpl, configPuts, envPuts }
}

async function buildApp(fetchImpl: typeof fetch): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false })
  const dashboard = new DashboardClient({
    hermesDashboardUrl: 'http://127.0.0.1:9123',
    hermesDashboardHost: '127.0.0.1:9123',
    fetchImpl,
  })
  await instance.register(registerVoiceRoutes, { dashboard, hermesHome: home })
  await instance.ready()
  return instance
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'voice-routes-'))
  mkdirSync(audioRoot(home), { recursive: true })
})

afterEach(async () => {
  await app?.close()
  app = undefined
  rmSync(home, { recursive: true, force: true })
})

describe('GET /api/agent-deck/voice', () => {
  it('composes the voice state from config + env (shape-only keys)', async () => {
    const { fetchImpl } = makeFakeDashboard()
    app = await buildApp(fetchImpl)
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/voice' })
    expect(res.statusCode).toBe(200)
    const state = VoiceState.parse(res.json())
    expect(state.ttsProvider).toBe('edge')
    expect(state.sttProvider).toBe('local')
    const el = state.ttsProviders.find((p) => p.id === 'elevenlabs')!
    expect(el.key.isSet).toBe(true)
    expect(el.voice).toBe('Adam')
    expect(res.payload).not.toContain('super-secret')
  })

  it('502s on an upstream failure', async () => {
    const { fetchImpl } = makeFakeDashboard({ configFail: true })
    app = await buildApp(fetchImpl)
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/voice' })
    expect(res.statusCode).toBe(502)
  })
})

describe('PUT /api/agent-deck/voice', () => {
  it('writes ONLY the voice blocks and round-trips secrets in other blocks', async () => {
    const fake = makeFakeDashboard()
    app = await buildApp(fake.fetchImpl)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/voice',
      payload: { ttsProvider: 'elevenlabs', autoTts: true },
    })
    expect(res.statusCode).toBe(200)
    const body = UpdateVoiceConfigResponse.parse(res.json())
    expect(body.restartRequired).toBe(true)
    expect(body.state.ttsProvider).toBe('elevenlabs')
    expect(body.state.toggles.autoTts).toBe(true)

    // The written config kept the secret + model block verbatim.
    const written = fake.configPuts.at(-1)!.config
    expect(written.API_SERVER_KEY).toBe('super-secret')
    expect(written.model).toEqual({ provider: 'anthropic' })
    expect((written.tts as { provider: string }).provider).toBe('elevenlabs')
    expect((written.voice as { auto_tts: boolean }).auto_tts).toBe(true)
  })

  it('writes a TTS voice to the provider-specific sub-field', async () => {
    const fake = makeFakeDashboard()
    app = await buildApp(fake.fetchImpl)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/agent-deck/voice',
      payload: { ttsVoice: { provider: 'elevenlabs', voice: 'Rachel' } },
    })
    expect(res.statusCode).toBe(200)
    const written = fake.configPuts.at(-1)!.config
    expect((written.tts as { elevenlabs: { voice_id: string } }).elevenlabs.voice_id).toBe('Rachel')
  })

  it('400s an empty / malformed body (no write)', async () => {
    const fake = makeFakeDashboard()
    app = await buildApp(fake.fetchImpl)
    const res = await app.inject({ method: 'PUT', url: '/api/agent-deck/voice', payload: {} })
    expect(res.statusCode).toBe(400)
    expect(fake.configPuts).toHaveLength(0)
  })
})

describe('POST /api/agent-deck/voice/key', () => {
  it('stores an allowlisted voice key and returns shape-only state', async () => {
    const fake = makeFakeDashboard()
    app = await buildApp(fake.fetchImpl)
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/voice/key',
      payload: { envVar: 'OPENAI_API_KEY', value: 'sk-PLAINTEXT-123' },
    })
    expect(res.statusCode).toBe(200)
    const body = SetVoiceKeyResponse.parse(res.json())
    expect(body.restartRequired).toBe(true)
    // The PLAINTEXT was forwarded once (as {key,value}) but is NEVER echoed back.
    expect(fake.envPuts.at(-1)).toEqual({ key: 'OPENAI_API_KEY', value: 'sk-PLAINTEXT-123' })
    expect(res.payload).not.toContain('sk-PLAINTEXT-123')
  })

  it('REJECTS a non-voice env var BEFORE any write', async () => {
    const fake = makeFakeDashboard()
    app = await buildApp(fake.fetchImpl)
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/voice/key',
      payload: { envVar: 'API_SERVER_KEY', value: 'x' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('not_a_voice_key')
    expect(fake.envPuts).toHaveLength(0)
  })
})

describe('audio routes', () => {
  it('GET /voice/audio lists the real cached files', async () => {
    writeFileSync(join(audioRoot(home), 'audio_a.ogg'), Buffer.from('OggS'))
    writeFileSync(join(audioRoot(home), 'audio_b.mp3'), Buffer.from('ID3'))
    const { fetchImpl } = makeFakeDashboard()
    app = await buildApp(fetchImpl)
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/voice/audio' })
    expect(res.statusCode).toBe(200)
    const list = AudioNoteList.parse(res.json())
    expect(list.notes.map((n) => n.name).sort()).toEqual(['audio_a.ogg', 'audio_b.mp3'])
  })

  it('GET /voice/audio/:file serves the bytes with the audio content type', async () => {
    writeFileSync(join(audioRoot(home), 'audio_x.ogg'), Buffer.from('OggS-data'))
    const { fetchImpl } = makeFakeDashboard()
    app = await buildApp(fetchImpl)
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/voice/audio/audio_x.ogg' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('audio/ogg')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.rawPayload.toString()).toBe('OggS-data')
  })

  it('REJECTS traversal on the serve route (403)', async () => {
    writeFileSync(join(home, 'cache', 'secret.ogg'), Buffer.from('SECRET'))
    const { fetchImpl } = makeFakeDashboard()
    app = await buildApp(fetchImpl)
    // %2F-encoded traversal — fastify decodes the param; the guard must still reject.
    const res = await app.inject({
      method: 'GET',
      url: '/api/agent-deck/voice/audio/..%2Fsecret.ogg',
    })
    expect([400, 403, 404]).toContain(res.statusCode)
    expect(res.rawPayload.toString()).not.toContain('SECRET')
  })

  it('REJECTS a non-audio filename (400)', async () => {
    writeFileSync(join(audioRoot(home), 'config.yaml'), 'secret: v')
    const { fetchImpl } = makeFakeDashboard()
    app = await buildApp(fetchImpl)
    const res = await app.inject({
      method: 'GET',
      url: '/api/agent-deck/voice/audio/config.yaml',
    })
    expect(res.statusCode).toBe(400)
    expect(res.rawPayload.toString()).not.toContain('secret: v')
  })

  it('404s a missing audio file', async () => {
    const { fetchImpl } = makeFakeDashboard()
    app = await buildApp(fetchImpl)
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/voice/audio/nope.ogg' })
    expect(res.statusCode).toBe(404)
  })
})

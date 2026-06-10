/**
 * VOICE CONSOLE BFF — `/api/agent-deck/voice`.
 *
 * Five routes. The first three are thin faithful proxies over stock hermes (no
 * new hermes endpoints — they reuse `/api/config` + `/api/env`); the last two are
 * agent-deck-OWN, path-guarded fs routes over the real audio cache (the native
 * dashboard has no audio route).
 *
 *   GET  /api/agent-deck/voice
 *     Composes {@link VoiceState} = the hermes config's tts/stt/voice blocks
 *     (`GET /api/config`) × each provider key's SHAPE (`GET /api/env` is_set /
 *     redacted_value) × the static provider catalog.
 *
 *   PUT  /api/agent-deck/voice
 *     Writes provider/voice/toggle scalars CONFINED to the tts/stt/voice config
 *     blocks (read-modify-write against stock `PUT /api/config`). The request
 *     shape cannot express an out-of-block path; every produced dot-path is
 *     re-asserted in-block ({@link assertVoiceBlockPath}) before the write.
 *
 *   POST /api/agent-deck/voice/key
 *     Stores ONE provider key. The `envVar` is ALLOWLISTED against the known voice
 *     key env vars ({@link isVoiceKeyEnvVar}) BEFORE any dashboard call (no
 *     arbitrary env writes). Proxies stock `PUT /api/env`; the response carries
 *     only the refreshed SHAPE-ONLY state, never the plaintext.
 *
 *   GET  /api/agent-deck/voice/audio
 *     LISTS the real cached audio files (name/ext/size/mtime), path-guarded to
 *     `<HERMES_HOME>/cache/audio/`.
 *
 *   GET  /api/agent-deck/voice/audio/:file
 *     SERVES one cached audio file as audio, path-guarded — traversal + non-audio
 *     names rejected. Streams the bytes with the audio content type + nosniff.
 *
 * SECURITY: a plaintext key value is NEVER returned or logged. Config writes are
 * confined to the three voice blocks. Audio is served from inside the cache dir
 * only. Mount under no prefix (the paths already include `/api/agent-deck`).
 */
import type { FastifyPluginAsync } from 'fastify'
import {
  VoiceState,
  UpdateVoiceConfigRequest,
  SetVoiceKeyRequest,
  AudioNoteList,
  type UpdateVoiceConfigResponse,
  type SetVoiceKeyResponse,
} from '@agent-deck/protocol'
import type { DashboardClient } from '../hermes/dashboardClient'
import { composeVoiceState } from './voiceService'
import { buildVoicePatches, applyVoicePatches } from './configWrite'
import { isVoiceKeyEnvVar } from './registry'
import { listAudioNotes, readAudioNote, AudioNotFoundError, NotAudioError } from './audioFs'
import { PathGuardError } from '../files/pathGuard'

export interface VoiceRoutesOptions {
  /** Gated client for the loopback hermes dashboard (GET/PUT /api/config, /api/env). */
  dashboard: DashboardClient
  /** Absolute HERMES_HOME — the audio cache lives at `<hermesHome>/cache/audio`. */
  hermesHome: string
}

/** Read the current config + env, compose the wire state (helper for GET + writes). */
async function readVoiceState(dashboard: DashboardClient): Promise<VoiceState> {
  const [config, env] = await Promise.all([
    dashboard.getJson<Record<string, unknown>>('/api/config'),
    dashboard.getJson<Record<string, unknown>>('/api/env'),
  ])
  return composeVoiceState(config, env)
}

export const registerVoiceRoutes: FastifyPluginAsync<VoiceRoutesOptions> = async (
  fastify,
  opts,
) => {
  const { dashboard, hermesHome } = opts

  // GET — compose the voice surface state.
  fastify.get('/api/agent-deck/voice', async (_req, reply): Promise<VoiceState> => {
    try {
      return await readVoiceState(dashboard)
    } catch {
      reply.code(502)
      return {
        error: 'Unable to reach the hermes dashboard for voice state.',
      } as unknown as VoiceState
    }
  })

  // PUT — write provider/voice/toggle scalars confined to tts/stt/voice blocks.
  fastify.put('/api/agent-deck/voice', async (req, reply) => {
    const parsed = UpdateVoiceConfigRequest.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'bad_request',
        message: 'Expected at least one voice config field.',
      })
    }

    let patches
    try {
      // buildVoicePatches re-asserts every path is in-block (defense in depth).
      patches = buildVoicePatches(parsed.data)
    } catch {
      return reply
        .code(400)
        .send({ error: 'invalid_value', message: 'That voice config change is not writable.' })
    }
    if (patches.length === 0) {
      return reply.code(400).send({ error: 'bad_request', message: 'No writable changes.' })
    }

    try {
      // Read the FULL, UNREDACTED config, patch the voice blocks, PUT it all back.
      const current = await dashboard.getJson<Record<string, unknown>>('/api/config')
      const next = applyVoicePatches(current, patches)
      await dashboard.putJson<unknown>('/api/config', { config: next })
      const state = await readVoiceState(dashboard)
      const response: UpdateVoiceConfigResponse = { state, restartRequired: true }
      return reply.send(response)
    } catch {
      return reply
        .code(502)
        .send({ error: 'upstream_error', message: 'Could not save the voice configuration.' })
    }
  })

  // POST key — store ONE provider key. Allowlist FIRST (before any dashboard call).
  fastify.post('/api/agent-deck/voice/key', async (req, reply) => {
    const parsed = SetVoiceKeyRequest.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'bad_request',
        message: 'Expected { envVar, value } with a non-empty value.',
      })
    }
    const { envVar, value } = parsed.data

    // ALLOWLIST GATE: the env var must be a known voice provider key. Anything
    // else (a non-voice var, an arbitrary env var) is refused with no write.
    if (!isVoiceKeyEnvVar(envVar)) {
      return reply.code(400).send({
        error: 'not_a_voice_key',
        message: `${envVar} is not a configurable voice provider key.`,
      })
    }

    try {
      // Proxy stock PUT /api/env. The plaintext value flows straight through and
      // is never logged or retained here.
      await dashboard.putJson<unknown>('/api/env', { key: envVar, value })
      const state = await readVoiceState(dashboard)
      const response: SetVoiceKeyResponse = { state, restartRequired: true }
      return reply.send(response)
    } catch {
      return reply
        .code(502)
        .send({ error: 'upstream_error', message: 'Could not store the voice provider key.' })
    }
  })

  // GET audio list — the real cached voice notes (path-guarded fs read).
  fastify.get('/api/agent-deck/voice/audio', async (): Promise<AudioNoteList> => {
    // listAudioNotes is fail-safe (missing dir → empty list); parse to pin shape.
    return AudioNoteList.parse(listAudioNotes(hermesHome))
  })

  // GET audio serve — stream ONE cached file as audio, path-guarded.
  fastify.get<{ Params: { file: string } }>(
    '/api/agent-deck/voice/audio/:file',
    async (req, reply) => {
      const { file } = req.params
      try {
        const { data, contentType, size } = readAudioNote(hermesHome, file)
        return await reply
          .header('Content-Type', contentType)
          .header('Content-Length', String(size))
          .header('Content-Disposition', 'inline')
          // A strict CSP + nosniff: this is audio bytes only, never executed.
          .header('Content-Security-Policy', "default-src 'none'")
          .header('X-Content-Type-Options', 'nosniff')
          .header('Cache-Control', 'no-store')
          .send(data)
      } catch (err) {
        if (err instanceof NotAudioError) {
          return reply
            .code(400)
            .send({ error: 'not_audio', message: 'Only cached audio files can be played.' })
        }
        if (err instanceof PathGuardError) {
          return reply.code(403).send({ error: 'forbidden', code: err.code, message: err.message })
        }
        if (err instanceof AudioNotFoundError) {
          return reply.code(404).send({ error: 'not_found', message: 'Audio note not found.' })
        }
        return reply
          .code(500)
          .send({ error: 'read_error', message: 'Could not read the audio note.' })
      }
    },
  )
}

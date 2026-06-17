import { apiFetch, apiPost, API_BASE } from '@/lib/apiFetch'
import { authHeaders } from '@/lib/authToken'
import {
  VoiceState,
  AudioNoteList,
  UpdateVoiceConfigResponse,
  SetVoiceKeyResponse,
  TranscribeAudioResponse,
  type UpdateVoiceConfigRequest,
  type SetVoiceKeyRequest,
  type TranscribeAudioRequest,
} from '@agent-deck/protocol'

/**
 * The Voice Console's BFF client (agent-deck-OWN routes):
 *
 *   GET  /api/agent-deck/voice            → VoiceState
 *   PUT  /api/agent-deck/voice            → UpdateVoiceConfigResponse
 *   POST /api/agent-deck/voice/key        → SetVoiceKeyResponse
 *   GET  /api/agent-deck/voice/audio      → AudioNoteList
 *   GET  /api/agent-deck/voice/audio/:f   → audio bytes (object URL)
 *
 * Every JSON response is parsed through the shared protocol zod schema, so a
 * partial/unexpected payload throws here (caught by the query/mutation) rather
 * than rendering a half-built surface. Provider keys cross the wire SHAPE-ONLY:
 * the request carries the plaintext once (to store it); the response NEVER echoes
 * it, only `isSet` + a `redactedValue` preview.
 */

const BASE = '/voice'

/** Read the full voice surface state. */
export async function fetchVoice(signal?: AbortSignal): Promise<VoiceState> {
  return VoiceState.parse(await apiFetch<unknown>(BASE, { signal }))
}

/** Update voice config (confined to tts/stt/voice blocks server-side). */
export async function updateVoiceConfig(
  request: UpdateVoiceConfigRequest,
): Promise<UpdateVoiceConfigResponse> {
  return UpdateVoiceConfigResponse.parse(
    await apiFetch<unknown>(BASE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }),
  )
}

/** Store/replace a provider key (allowlisted to known voice key vars server-side). */
export async function setVoiceKey(request: SetVoiceKeyRequest): Promise<SetVoiceKeyResponse> {
  return SetVoiceKeyResponse.parse(await apiPost<unknown>(`${BASE}/key`, request))
}

/**
 * Composer DICTATION: POST a recorded clip (base64 data URL) to the BFF, which
 * proxies stock hermes `POST /api/audio/transcribe`, and return the transcript.
 * Used as the durable any-browser voice-input path (when the Web Speech API is
 * absent). The recognized text fills the composer for the user to review + send.
 */
export async function transcribeAudio(
  request: TranscribeAudioRequest,
  signal?: AbortSignal,
): Promise<TranscribeAudioResponse> {
  return TranscribeAudioResponse.parse(
    await apiPost<unknown>(`${BASE}/transcribe`, request, { signal }),
  )
}

/** List the real cached voice notes (newest first). */
export async function fetchAudioNotes(signal?: AbortSignal): Promise<AudioNoteList> {
  return AudioNoteList.parse(await apiFetch<unknown>(`${BASE}/audio`, { signal }))
}

/**
 * Absolute URL for the BFF audio-serve route. Auth-gated like every `/api/*`
 * path, so a bare `<audio src>` (which cannot carry an Authorization header)
 * would 401 on a non-loopback bind — use {@link fetchAudioObjectUrl}, which
 * fetches the bytes WITH the bearer token and hands back an object URL.
 */
export function audioServeUrl(name: string): string {
  return `${API_BASE}${BASE}/audio/${encodeURIComponent(name)}`
}

/**
 * Fetch a cached audio note through the auth-gated BFF and return a blob object
 * URL the caller assigns to an `<audio src>`. On a non-loopback bind it sends
 * `Authorization: Bearer <token>` (via {@link authHeaders}); on loopback the
 * header map is empty, so behavior is unchanged. The caller MUST revoke the
 * returned URL (URL.revokeObjectURL) when it unmounts/changes.
 */
export async function fetchAudioObjectUrl(name: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(audioServeUrl(name), { signal, headers: { ...authHeaders() } })
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = (await res.json()) as { error?: string; message?: string }
      const detail = body.message ?? body.error
      if (detail) message = detail
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new Error(message)
  }
  return URL.createObjectURL(await res.blob())
}

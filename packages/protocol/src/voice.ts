import { z } from 'zod'

/**
 * VOICE CONSOLE contract - the typed shapes behind the "your agent has a voice"
 * surface: pick a TTS provider + voice, an STT provider, store the (shape-only)
 * provider keys, flip the `voice.*` toggles, and play back the REAL cached audio
 * artifacts your agent already wrote.
 *
 * The honest model (no fake states, every boundary the spec pins):
 *  - There is NO live browser mic-voice. `getUserMedia` would capture the BROWSER
 *    machine's mic, not where the agent runs - a dishonest layer. We don't build
 *    it. Playback is REAL cached artifacts from `~/.hermes/cache/audio/` only.
 *  - Provider keys are SHAPE-ONLY across the wire: a stored key surfaces as
 *    `isSet` + a `redactedValue` preview; the plaintext is NEVER returned/logged.
 *  - Local providers (edge/neutts/piper for TTS, local for STT) need NO key -
 *    the catalog says so, and the BFF never offers a key field for them.
 *  - xAI TTS can use Grok OAuth *or* `XAI_API_KEY`; we surface the key field AND
 *    note the OAuth alternative honestly rather than implying a key is required.
 *
 * SOURCE OF TRUTH (verified against the running hermes, NOT guessed):
 *  - TTS providers + their config sub-block voice field + key env var:
 *    `~/hermes-agent/tools/tts_tool.py` (DEFAULT_PROVIDER="edge"; `tts.<prov>.<field>`).
 *  - STT providers + key env var: `~/hermes-agent/tools/transcription_tools.py`
 *    (DEFAULT_PROVIDER="local"; groq→GROQ_API_KEY, openai→VOICE_TOOLS_OPENAI_KEY,
 *    mistral→MISTRAL_API_KEY).
 *  - The `voice.*` toggles + the `tts`/`stt` block shapes: `~/.hermes/config.yaml`.
 *  - The audio cache dir: `~/.hermes/cache/audio/*.{ogg,mp3}`.
 */

/* -------------------------------------------------------------------------- */
/* Provider enums - the governed, hand-transcribed sets                       */
/* -------------------------------------------------------------------------- */

/** The 8 built-in TTS providers (tts_tool.py built-ins, in catalog order). */
export const TtsProvider = z.enum([
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
export type TtsProvider = z.infer<typeof TtsProvider>

/** The STT providers (transcription_tools.py BUILTIN_STT_PROVIDERS). `local` is the default. */
export const SttProvider = z.enum(['local', 'openai', 'mistral', 'groq', 'xai'])
export type SttProvider = z.infer<typeof SttProvider>

/* -------------------------------------------------------------------------- */
/* Shape-only key field (identical contract to messaging tokens)              */
/* -------------------------------------------------------------------------- */

/**
 * One provider credential. The value NEVER crosses the wire - only whether it
 * `isSet` and a redacted preview (e.g. `sk-…abcd`) for recognition. `null`
 * `envVar` means the provider needs NO key (a local provider) - there is no
 * field to fill, and `isSet` is meaningless (left false).
 */
export const VoiceKeyField = z.object({
  /** The env var name (e.g. `ELEVENLABS_API_KEY`), or null for a local provider. */
  envVar: z.string().nullable(),
  /** Human label for the field (e.g. "ElevenLabs API key"). */
  label: z.string(),
  /** Whether a value is currently stored in the gateway env. */
  isSet: z.boolean(),
  /** A shape-only masked preview, or null when unset. NEVER the plaintext. */
  redactedValue: z.string().nullable(),
})
export type VoiceKeyField = z.infer<typeof VoiceKeyField>

/* -------------------------------------------------------------------------- */
/* Provider catalog entries (static metadata the BFF composes)                */
/* -------------------------------------------------------------------------- */

/** Catalog metadata for one TTS provider, fused with its live key shape. */
export const TtsProviderCatalogEntry = z.object({
  id: TtsProvider,
  /** Display name (e.g. "ElevenLabs"). */
  label: z.string(),
  /** True for fully-local providers (edge/neutts/piper) - they need NO key. */
  local: z.boolean(),
  /** The config sub-key under `tts.<id>` that holds the chosen voice name
   * (e.g. `voice` for edge/openai/piper, `voice_id` for elevenlabs/xai/mistral/
   * minimax, `model` for neutts). The dependent voice-name field writes here. */
  voiceField: z.string(),
  /** Human label for the dependent voice field (e.g. "Voice", "Voice ID"). */
  voiceLabel: z.string(),
  /** The provider's currently-configured voice value, or '' when unset. */
  voice: z.string(),
  /** The shape-only key status for this provider (envVar null when local). */
  key: VoiceKeyField,
  /** An honest one-line note (e.g. the xAI OAuth alternative, or "No key needed"). */
  note: z.string().nullable(),
})
export type TtsProviderCatalogEntry = z.infer<typeof TtsProviderCatalogEntry>

/** Catalog metadata for one STT provider, fused with its live key shape. */
export const SttProviderCatalogEntry = z.object({
  id: SttProvider,
  label: z.string(),
  /** True for the fully-local provider (`local`) - it needs NO key. */
  local: z.boolean(),
  /** The shape-only key status for this provider (envVar null when local). */
  key: VoiceKeyField,
  /** An honest one-line note (e.g. "No key needed - runs on-device"). */
  note: z.string().nullable(),
})
export type SttProviderCatalogEntry = z.infer<typeof SttProviderCatalogEntry>

/* -------------------------------------------------------------------------- */
/* The voice.* toggles                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The two honest `voice.*` toggles this surface edits. Other `voice.*` keys
 * (record_key, silence thresholds) are CLI/audio-capture concerns we don't touch.
 */
export const VoiceToggles = z.object({
  /** Whether the agent speaks replies aloud automatically (`voice.auto_tts`). */
  autoTts: z.boolean(),
  /** Whether a beep plays on record start/stop (`voice.beep_enabled`). */
  beepEnabled: z.boolean(),
})
export type VoiceToggles = z.infer<typeof VoiceToggles>

/* -------------------------------------------------------------------------- */
/* The composed surface state (GET response)                                  */
/* -------------------------------------------------------------------------- */

/** The whole Voice surface payload: current config + catalogs + key shapes. */
export const VoiceState = z.object({
  /** The currently-selected TTS provider (`tts.provider`, default `edge`). */
  ttsProvider: TtsProvider,
  /** The currently-selected STT provider (`stt.provider`, default `local`). */
  sttProvider: SttProvider,
  /** Whether STT is enabled at all (`stt.enabled`, default true). */
  sttEnabled: z.boolean(),
  /** The TTS provider catalog × each provider's voice + key shape. */
  ttsProviders: z.array(TtsProviderCatalogEntry),
  /** The STT provider catalog × each provider's key shape. */
  sttProviders: z.array(SttProviderCatalogEntry),
  /** The `voice.*` toggles. */
  toggles: VoiceToggles,
})
export type VoiceState = z.infer<typeof VoiceState>

/* -------------------------------------------------------------------------- */
/* Config write (PUT) - confined to the tts/stt/voice blocks only             */
/* -------------------------------------------------------------------------- */

/**
 * Update the voice config. EVERY field is optional - the UI sends only what
 * changed - and the BFF writes ONLY into the `tts`/`stt`/`voice` config blocks
 * (a read-modify-write against stock `PUT /api/config`). Anything outside those
 * blocks is impossible to express here: the request only carries provider/voice/
 * toggle scalars, allowlisted by the server before any write.
 */
export const UpdateVoiceConfigRequest = z
  .object({
    /** Select the active TTS provider (`tts.provider`). */
    ttsProvider: TtsProvider.optional(),
    /** Set the chosen voice for a specific TTS provider (`tts.<provider>.<voiceField>`). */
    ttsVoice: z.object({ provider: TtsProvider, voice: z.string() }).optional(),
    /** Select the active STT provider (`stt.provider`). */
    sttProvider: SttProvider.optional(),
    /** Enable/disable STT (`stt.enabled`). */
    sttEnabled: z.boolean().optional(),
    /** Set `voice.auto_tts`. */
    autoTts: z.boolean().optional(),
    /** Set `voice.beep_enabled`. */
    beepEnabled: z.boolean().optional(),
  })
  // At least one field must be present - an empty patch is a no-op the BFF rejects.
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one voice config field must be provided.',
  })
export type UpdateVoiceConfigRequest = z.infer<typeof UpdateVoiceConfigRequest>

/** Result of a config write: the refreshed {@link VoiceState} + the restart nudge. */
export const UpdateVoiceConfigResponse = z.object({
  state: VoiceState,
  /** True - voice config changes only take effect on a new gateway session. */
  restartRequired: z.literal(true),
})
export type UpdateVoiceConfigResponse = z.infer<typeof UpdateVoiceConfigResponse>

/* -------------------------------------------------------------------------- */
/* Provider-key write (POST) - masked, allowlisted to known voice key vars    */
/* -------------------------------------------------------------------------- */

/**
 * Store/replace a voice provider key. The BFF ALLOWLISTS `envVar` against the
 * known voice key env vars (the union of every catalog `key.envVar`) - anything
 * else is refused before any dashboard call (no arbitrary env writes). `value`
 * is the plaintext sent ONCE; the response NEVER echoes it.
 */
export const SetVoiceKeyRequest = z.object({
  envVar: z.string(),
  value: z.string().min(1),
})
export type SetVoiceKeyRequest = z.infer<typeof SetVoiceKeyRequest>

/** Result of storing a key: the refreshed {@link VoiceState} (shape-only). */
export const SetVoiceKeyResponse = z.object({
  state: VoiceState,
  /** True - a stored key takes effect on the next gateway session. */
  restartRequired: z.literal(true),
})
export type SetVoiceKeyResponse = z.infer<typeof SetVoiceKeyResponse>

/* -------------------------------------------------------------------------- */
/* Recent voice notes - the real cached audio artifacts                       */
/* -------------------------------------------------------------------------- */

/** The audio file extensions the surface lists + serves (the only ones hermes
 * writes to the cache: Opus `.ogg` for voice bubbles, `.mp3` for everything else). */
export const AudioExtension = z.enum(['ogg', 'mp3'])
export type AudioExtension = z.infer<typeof AudioExtension>

/** One cached audio artifact (a real file on disk under the audio cache dir). */
export const AudioNote = z.object({
  /** The bare filename (e.g. `audio_0075e7c8e022.ogg`) - the serve-route key. */
  name: z.string(),
  /** The extension, governed to the two real formats. */
  ext: AudioExtension,
  /** File size in bytes. */
  size: z.number().int().nonnegative(),
  /** Last-modified time, ISO 8601. */
  modifiedAt: z.string(),
})
export type AudioNote = z.infer<typeof AudioNote>

/** The recent-voice-notes list (newest first, capped). */
export const AudioNoteList = z.object({
  notes: z.array(AudioNote),
  /** Whether the listing was capped (more files exist than returned). */
  truncated: z.boolean(),
})
export type AudioNoteList = z.infer<typeof AudioNoteList>

/* -------------------------------------------------------------------------- */
/* Composer DICTATION transcribe - server-side speech-to-text                 */
/* -------------------------------------------------------------------------- */

/**
 * Composer DICTATION request: the browser records the USER speaking (getUserMedia
 * + MediaRecorder), and POSTs the recording so hermes transcribes it; the returned
 * text fills the message box for the user to review + send. This is the durable
 * voice-input path that works on ANY browser (Firefox/Chrome/Safari alike), used
 * when the Web Speech API is absent.
 *
 * This is NOT the Voice Console's "agent's mic" boundary. There, capturing the
 * browser mic would be dishonest (it would record the wrong machine). Here the
 * captured speech IS the user's own message - exactly what dictation means - so
 * recording it and showing the user the transcript before they send is honest.
 *
 * The audio crosses the wire as a base64 `data:` URL (matching stock hermes
 * `POST /api/audio/transcribe`, which takes `{ data_url, mime_type? }`). Nothing
 * is persisted by the BFF; it proxies the bytes straight through.
 */
export const TranscribeAudioRequest = z.object({
  /** A `data:<audio-mime>;base64,<...>` URL of the recorded clip. */
  dataUrl: z.string().min(1),
  /** The recording's MIME type (e.g. `audio/webm`); hermes also infers it from the
   * data URL header, so this is an optional hint. */
  mimeType: z.string().optional(),
})
export type TranscribeAudioRequest = z.infer<typeof TranscribeAudioRequest>

/** The transcription result: the recognized text (may be empty for silence). */
export const TranscribeAudioResponse = z.object({
  transcript: z.string(),
})
export type TranscribeAudioResponse = z.infer<typeof TranscribeAudioResponse>

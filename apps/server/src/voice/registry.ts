/**
 * VOICE PROVIDER REGISTRY — the typed, hand-transcribed source of truth for the
 * Voice Console. It encodes, per provider: the display label, whether it is a
 * fully-LOCAL provider (no key), the config sub-block VOICE FIELD that holds the
 * chosen voice name, and the writable KEY env var (null for local providers).
 *
 * SOURCE OF TRUTH (verified against the running hermes, NOT guessed):
 *  - TTS — `~/hermes-agent/tools/tts_tool.py`:
 *      DEFAULT_PROVIDER = "edge". Built-ins: edge/elevenlabs/openai/xai/mistral/
 *      minimax/neutts/piper. Per-provider config sub-block + voice field:
 *        edge       → `tts.edge.voice`            key: none (local)
 *        elevenlabs → `tts.elevenlabs.voice_id`   key: ELEVENLABS_API_KEY
 *        openai     → `tts.openai.voice`          key: OPENAI_API_KEY
 *        xai        → `tts.xai.voice_id`          key: XAI_API_KEY (or Grok OAuth)
 *        mistral    → `tts.mistral.voice_id`      key: MISTRAL_API_KEY
 *        minimax    → `tts.minimax.voice_id`      key: MINIMAX_API_KEY
 *        neutts     → `tts.neutts.model`          key: none (local, on-device)
 *        piper      → `tts.piper.voice`           key: none (local, on-device)
 *  - STT — `~/hermes-agent/tools/transcription_tools.py`:
 *      DEFAULT_PROVIDER = "local". Providers + key env var:
 *        local   → key: none (faster-whisper on-device)
 *        openai  → key: VOICE_TOOLS_OPENAI_KEY
 *        mistral → key: MISTRAL_API_KEY
 *        groq    → key: GROQ_API_KEY
 *
 * The flat allowlist of writable key env vars is the UNION of every provider's
 * keyEnvVar — `POST /api/agent-deck/voice/key` refuses anything outside it BEFORE
 * any dashboard call (no arbitrary env writes).
 */
import type { TtsProvider, SttProvider } from '@agent-deck/protocol'

/** Static metadata for one TTS provider. */
export interface TtsRegistryEntry {
  /** Stable id matching the `tts.provider` value. */
  readonly id: TtsProvider
  /** Display name. */
  readonly label: string
  /** True for fully-local providers (edge/neutts/piper) — they need NO key. */
  readonly local: boolean
  /** The config sub-key under `tts.<id>` that holds the chosen voice name. */
  readonly voiceField: string
  /** Human label for the dependent voice field. */
  readonly voiceLabel: string
  /** The writable key env var, or null for a local provider. */
  readonly keyEnvVar: string | null
  /** Human label for the key field (when keyEnvVar is non-null). */
  readonly keyLabel: string
  /** An honest one-line note, or null. */
  readonly note: string | null
}

/** Static metadata for one STT provider. */
export interface SttRegistryEntry {
  readonly id: SttProvider
  readonly label: string
  readonly local: boolean
  readonly keyEnvVar: string | null
  readonly keyLabel: string
  readonly note: string | null
}

// Local providers carry NO note: the key field already renders the one honest
// "No key needed" line, so a note here would just repeat it.

/** The TTS provider catalog. Order = the catalog/dropdown order (edge first). */
export const TTS_REGISTRY: readonly TtsRegistryEntry[] = [
  {
    id: 'edge',
    label: 'Edge (Microsoft)',
    local: true,
    voiceField: 'voice',
    voiceLabel: 'Voice',
    keyEnvVar: null,
    keyLabel: '',
    note: 'Free Microsoft Edge neural voices (needs ffmpeg for Opus).',
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    local: false,
    voiceField: 'voice_id',
    voiceLabel: 'Voice ID',
    keyEnvVar: 'ELEVENLABS_API_KEY',
    keyLabel: 'ElevenLabs API key',
    note: null,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    local: false,
    voiceField: 'voice',
    voiceLabel: 'Voice',
    keyEnvVar: 'OPENAI_API_KEY',
    keyLabel: 'OpenAI API key',
    note: null,
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    local: false,
    voiceField: 'voice_id',
    voiceLabel: 'Voice ID',
    keyEnvVar: 'XAI_API_KEY',
    keyLabel: 'xAI API key',
    // Honest: xAI TTS can use Grok OAuth credentials OR XAI_API_KEY — the key is
    // one of two paths, not strictly required.
    note: 'xAI TTS can also use your Grok OAuth login (set in `hermes model`) instead of a key.',
  },
  {
    id: 'mistral',
    label: 'Mistral (Voxtral)',
    local: false,
    voiceField: 'voice_id',
    voiceLabel: 'Voice ID',
    keyEnvVar: 'MISTRAL_API_KEY',
    keyLabel: 'Mistral API key',
    note: null,
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    local: false,
    voiceField: 'voice_id',
    voiceLabel: 'Voice ID',
    keyEnvVar: 'MINIMAX_API_KEY',
    keyLabel: 'MiniMax API key',
    note: null,
  },
  {
    id: 'gemini',
    label: 'Gemini (Google)',
    local: false,
    voiceField: 'voice',
    voiceLabel: 'Voice',
    keyEnvVar: 'GEMINI_API_KEY',
    keyLabel: 'Gemini API key',
    note: '30 prebuilt voices (e.g. Kore).',
  },
  {
    id: 'neutts',
    label: 'NeuTTS (local)',
    local: true,
    voiceField: 'model',
    voiceLabel: 'Model',
    keyEnvVar: null,
    keyLabel: '',
    note: null,
  },
  {
    id: 'kittentts',
    label: 'KittenTTS (local)',
    local: true,
    voiceField: 'voice',
    voiceLabel: 'Voice',
    keyEnvVar: null,
    keyLabel: '',
    note: null,
  },
  {
    id: 'piper',
    label: 'Piper (local)',
    local: true,
    voiceField: 'voice',
    voiceLabel: 'Voice',
    keyEnvVar: null,
    keyLabel: '',
    note: null,
  },
]

/** The STT provider catalog. Order = dropdown order (local first). */
export const STT_REGISTRY: readonly SttRegistryEntry[] = [
  {
    id: 'local',
    label: 'Local (faster-whisper)',
    local: true,
    keyEnvVar: null,
    keyLabel: '',
    note: null,
  },
  {
    id: 'openai',
    label: 'OpenAI (Whisper)',
    local: false,
    keyEnvVar: 'VOICE_TOOLS_OPENAI_KEY',
    keyLabel: 'OpenAI voice key',
    note: null,
  },
  {
    id: 'mistral',
    label: 'Mistral (Voxtral)',
    local: false,
    keyEnvVar: 'MISTRAL_API_KEY',
    keyLabel: 'Mistral API key',
    note: null,
  },
  {
    id: 'groq',
    label: 'Groq (Whisper)',
    local: false,
    keyEnvVar: 'GROQ_API_KEY',
    keyLabel: 'Groq API key',
    note: null,
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    local: false,
    keyEnvVar: 'XAI_API_KEY',
    keyLabel: 'xAI API key',
    note: null,
  },
]

const TTS_BY_ID = new Map<string, TtsRegistryEntry>(TTS_REGISTRY.map((e) => [e.id, e]))
const STT_BY_ID = new Map<string, SttRegistryEntry>(STT_REGISTRY.map((e) => [e.id, e]))

export function getTtsEntry(id: string): TtsRegistryEntry | undefined {
  return TTS_BY_ID.get(id)
}

export function getSttEntry(id: string): SttRegistryEntry | undefined {
  return STT_BY_ID.get(id)
}

/**
 * The flat set of every env var the voice-key route may write — the UNION of all
 * non-null `keyEnvVar`s across both catalogs. Anything outside this set is refused
 * before any dashboard call (no arbitrary env writes).
 */
export function voiceKeyEnvVars(): Set<string> {
  const out = new Set<string>()
  for (const e of TTS_REGISTRY) if (e.keyEnvVar) out.add(e.keyEnvVar)
  for (const e of STT_REGISTRY) if (e.keyEnvVar) out.add(e.keyEnvVar)
  return out
}

/** True iff `envVar` is a known, writable voice provider key env var. */
export function isVoiceKeyEnvVar(envVar: string): boolean {
  return voiceKeyEnvVars().has(envVar)
}

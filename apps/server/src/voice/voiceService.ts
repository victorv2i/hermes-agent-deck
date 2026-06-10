/**
 * VOICE SERVICE — the PURE composition layer behind the Voice Console BFF.
 *
 * It fuses two reads into the wire {@link VoiceState}:
 *   1. the hermes config's `tts` / `stt` / `voice` blocks (provider selections,
 *      per-provider voice names, the `voice.*` toggles), and
 *   2. each provider key's SHAPE (`is_set` + redacted preview) from `/api/env`.
 *
 * No network here — the route module does the fetches and hands raw bodies in.
 * Everything is fail-safe: a missing/garbled block falls back to the hermes
 * DEFAULTS (`tts.provider`→edge, `stt.provider`→local, `stt.enabled`→true), and a
 * plaintext key never enters the result (only `is_set` / `redacted_value`).
 */
import {
  VoiceState,
  type TtsProvider,
  type SttProvider,
  type TtsProviderCatalogEntry,
  type SttProviderCatalogEntry,
  type VoiceKeyField,
} from '@agent-deck/protocol'
import {
  TTS_REGISTRY,
  STT_REGISTRY,
  type TtsRegistryEntry,
  type SttRegistryEntry,
} from './registry'

/** Raw `/api/env` entry shape (only the SHAPE-ONLY fields are ever read). */
interface RawEnvEntry {
  is_set?: unknown
  redacted_value?: unknown
}

/** Stock hermes defaults (tts_tool.py / transcription_tools.py). */
const DEFAULT_TTS_PROVIDER: TtsProvider = 'edge'
const DEFAULT_STT_PROVIDER: SttProvider = 'local'

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/**
 * Build a SHAPE-ONLY key field for a provider from the raw `/api/env` body. A
 * local provider (keyEnvVar null) yields a field with `envVar:null`, `isSet:false`
 * — there is no credential to fill. The plaintext is NEVER read.
 */
function buildKeyField(
  keyEnvVar: string | null,
  keyLabel: string,
  envBody: Record<string, unknown>,
): VoiceKeyField {
  if (keyEnvVar === null) {
    return { envVar: null, label: keyLabel, isSet: false, redactedValue: null }
  }
  const raw = envBody[keyEnvVar]
  const e: RawEnvEntry = raw && typeof raw === 'object' ? (raw as RawEnvEntry) : {}
  const isSet = e.is_set === true
  const redacted = isSet && typeof e.redacted_value === 'string' ? e.redacted_value : null
  return { envVar: keyEnvVar, label: keyLabel, isSet, redactedValue: redacted }
}

/** Read the chosen voice value for a TTS provider from its `tts.<id>.<field>`. */
function readTtsVoice(ttsBlock: Record<string, unknown>, entry: TtsRegistryEntry): string {
  const sub = asRecord(ttsBlock[entry.id])
  return str(sub[entry.voiceField])
}

/** Project one TTS registry entry onto its catalog wire shape. */
function buildTtsEntry(
  entry: TtsRegistryEntry,
  ttsBlock: Record<string, unknown>,
  envBody: Record<string, unknown>,
): TtsProviderCatalogEntry {
  return {
    id: entry.id,
    label: entry.label,
    local: entry.local,
    voiceField: entry.voiceField,
    voiceLabel: entry.voiceLabel,
    voice: readTtsVoice(ttsBlock, entry),
    key: buildKeyField(entry.keyEnvVar, entry.keyLabel, envBody),
    note: entry.note,
  }
}

/** Project one STT registry entry onto its catalog wire shape. */
function buildSttEntry(
  entry: SttRegistryEntry,
  envBody: Record<string, unknown>,
): SttProviderCatalogEntry {
  return {
    id: entry.id,
    label: entry.label,
    local: entry.local,
    key: buildKeyField(entry.keyEnvVar, entry.keyLabel, envBody),
    note: entry.note,
  }
}

/** Resolve the active TTS provider, defaulting to `edge` for an unknown value. */
function resolveTtsProvider(ttsBlock: Record<string, unknown>): TtsProvider {
  const raw = str(ttsBlock.provider).toLowerCase().trim()
  return TTS_REGISTRY.some((e) => e.id === raw) ? (raw as TtsProvider) : DEFAULT_TTS_PROVIDER
}

/** Resolve the active STT provider, defaulting to `local` for an unknown value. */
function resolveSttProvider(sttBlock: Record<string, unknown>): SttProvider {
  const raw = str(sttBlock.provider).toLowerCase().trim()
  return STT_REGISTRY.some((e) => e.id === raw) ? (raw as SttProvider) : DEFAULT_STT_PROVIDER
}

/**
 * Compose the whole {@link VoiceState} from a raw hermes config body and a raw
 * `/api/env` body. The result is parsed through the protocol schema so a
 * malformed upstream can never widen the wire shape.
 */
export function composeVoiceState(
  configBody: Record<string, unknown>,
  envBody: Record<string, unknown>,
): VoiceState {
  const ttsBlock = asRecord(configBody.tts)
  const sttBlock = asRecord(configBody.stt)
  const voiceBlock = asRecord(configBody.voice)

  // stt.enabled defaults to TRUE (transcription_tools.is_stt_enabled): only an
  // explicit `false` disables it.
  const sttEnabled = sttBlock.enabled !== false

  return VoiceState.parse({
    ttsProvider: resolveTtsProvider(ttsBlock),
    sttProvider: resolveSttProvider(sttBlock),
    sttEnabled,
    ttsProviders: TTS_REGISTRY.map((e) => buildTtsEntry(e, ttsBlock, envBody)),
    sttProviders: STT_REGISTRY.map((e) => buildSttEntry(e, envBody)),
    toggles: {
      autoTts: voiceBlock.auto_tts === true,
      beepEnabled: voiceBlock.beep_enabled === true,
    },
  })
}

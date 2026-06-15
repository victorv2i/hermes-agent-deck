import { useId, useState, type FormEvent } from 'react'
import { Volume2 } from 'lucide-react'
import type {
  VoiceState,
  TtsProvider,
  SetVoiceKeyRequest,
  UpdateVoiceConfigRequest,
} from '@agent-deck/protocol'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { VoiceKeyField } from './VoiceKeyField'

/**
 * TtsCard — pick a TTS provider, then a DEPENDENT voice-name field for that
 * provider (the sub-field name + label come from the catalog the BFF returned),
 * then the masked key (local providers show "No key needed"). Presentational:
 * props in / callbacks out, so the page owns the real mutations.
 *
 * Honest: the voice field writes to the provider's real config sub-block; the key
 * is shape-only. Switching the provider only stages the selection — it is applied
 * by the page's mutation, and the surface says a gateway restart is needed.
 */

export interface TtsCardProps {
  state: VoiceState
  onUpdate: (request: UpdateVoiceConfigRequest) => void
  onSetKey: (request: SetVoiceKeyRequest) => void
  /** Whether a config write is in flight (disables the provider select). */
  saving: boolean
}

export function TtsCard({ state, onUpdate, onSetKey, saving }: TtsCardProps) {
  const titleId = useId()
  const providerId = useId()

  const active = state.ttsProviders.find((p) => p.id === state.ttsProvider) ?? state.ttsProviders[0]

  return (
    <section aria-labelledby={titleId} role="region" aria-label="Text to speech">
      <Card>
        <CardHeader>
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden
              className="ad-surface grid size-9 shrink-0 place-items-center rounded-[10px] bg-muted text-foreground-tertiary"
            >
              <Volume2 className="size-[18px]" aria-hidden />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <CardTitle id={titleId}>Text to speech</CardTitle>
              <p className="text-[13px] text-muted-foreground">The voice your agent speaks with.</p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="-mt-1 flex flex-col gap-4">
          {/* Provider dropdown */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={providerId} className="text-xs font-medium text-muted-foreground">
              Provider
            </label>
            <Select
              id={providerId}
              value={state.ttsProvider}
              disabled={saving}
              onChange={(e) => onUpdate({ ttsProvider: e.target.value as TtsProvider })}
            >
              {state.ttsProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>

          {active ? (
            <>
              {active.note ? (
                <p className="text-[12px] leading-relaxed text-foreground-tertiary">
                  {active.note}
                </p>
              ) : null}

              {/* Dependent voice field for the active provider. Re-keyed on
                  the provider AND its stored voice so it remounts (resetting the
                  draft) when the provider changes or a fresh fetch lands — no
                  setState-in-effect needed.
                  Edge gets a friendly dropdown of curated voices; other providers
                  get a text input with a helpful placeholder. */}
              {active.id === 'edge' ? (
                <EdgeVoicePicker
                  key={`${active.id}:${active.voice}`}
                  label={active.voiceLabel}
                  value={active.voice}
                  onSave={(voice) => onUpdate({ ttsVoice: { provider: active.id, voice } })}
                  disabled={saving}
                />
              ) : (
                <VoiceNameField
                  key={`${active.id}:${active.voice}`}
                  label={active.voiceLabel}
                  value={active.voice}
                  onSave={(voice) => onUpdate({ ttsVoice: { provider: active.id, voice } })}
                  placeholder={VOICE_PLACEHOLDER[active.id] ?? 'Provider default'}
                  disabled={saving}
                />
              )}

              {/* Masked key (local providers render "No key needed"). */}
              <VoiceKeyField field={active.key} onSetKey={onSetKey} disabled={saving} />
            </>
          ) : null}
        </CardContent>
      </Card>
    </section>
  )
}

/**
 * Helpful placeholder text for the voice name input, per TTS provider. Shows a
 * real example so a non-technical user knows what format to enter. Edge is omitted
 * because it uses the curated picker instead of a text input.
 */
const VOICE_PLACEHOLDER: Partial<Record<string, string>> = {
  elevenlabs: 'e.g. Adam, Rachel, Bella',
  openai: 'e.g. alloy, echo, fable, onyx, nova, shimmer',
  xai: 'e.g. sonic, aura',
  mistral: 'Provider default',
  minimax: 'Provider default',
  gemini: 'e.g. Puck, Charon, Kore, Fenrir',
  neutts: 'e.g. en/vits-piper-en_US-libritts_r-medium',
  kittentts: 'Provider default',
  piper: 'e.g. en_US-lessac-medium',
}

/**
 * Common Edge TTS voices — a curated set of high-quality, natural-sounding voices
 * covering major languages. Shown as a friendly picker so a non-technical user
 * doesn't have to memorise IDs like "en-US-AriaNeural".
 *
 * Source: Microsoft Edge TTS (Neural voices, widely available). The format is
 * always `<Locale>-<Name>Neural`. This list covers the most commonly requested
 * voices; the full catalog has 400+ but presenting all would overwhelm.
 */
const EDGE_VOICES: { id: string; label: string }[] = [
  { id: 'en-US-AriaNeural', label: 'Aria (US English, female)' },
  { id: 'en-US-JennyNeural', label: 'Jenny (US English, female)' },
  { id: 'en-US-GuyNeural', label: 'Guy (US English, male)' },
  { id: 'en-US-AndrewNeural', label: 'Andrew (US English, male)' },
  { id: 'en-US-EmmaNeural', label: 'Emma (US English, female)' },
  { id: 'en-GB-SoniaNeural', label: 'Sonia (UK English, female)' },
  { id: 'en-GB-RyanNeural', label: 'Ryan (UK English, male)' },
  { id: 'en-AU-NatashaNeural', label: 'Natasha (Australian English, female)' },
  { id: 'en-CA-ClaraNeural', label: 'Clara (Canadian English, female)' },
  { id: 'es-ES-ElviraNeural', label: 'Elvira (Spanish, female)' },
  { id: 'es-MX-DaliaNeural', label: 'Dalia (Mexican Spanish, female)' },
  { id: 'fr-FR-DeniseNeural', label: 'Denise (French, female)' },
  { id: 'de-DE-KatjaNeural', label: 'Katja (German, female)' },
  { id: 'pt-BR-FranciscaNeural', label: 'Francisca (Brazilian Portuguese, female)' },
  { id: 'it-IT-ElsaNeural', label: 'Elsa (Italian, female)' },
  { id: 'ja-JP-NanamiNeural', label: 'Nanami (Japanese, female)' },
  { id: 'zh-CN-XiaoxiaoNeural', label: 'Xiaoxiao (Chinese Mandarin, female)' },
  { id: 'ko-KR-SunHiNeural', label: 'Sun-Hi (Korean, female)' },
]

/**
 * EdgeVoicePicker — a friendly dropdown for the Edge TTS provider's voice.
 * When the stored voice isn't in the curated list, it's added as the first option
 * so the user can still see (and keep) their current setting honestly.
 */
function EdgeVoicePicker({
  label,
  value,
  onSave,
  disabled,
}: {
  label: string
  value: string
  onSave: (voice: string) => void
  disabled?: boolean
}) {
  const id = useId()

  // If the stored voice isn't in our curated list, add it as the first option so
  // the user sees their real current setting (honesty: never silently drop it).
  const storedIsUnknown = value !== '' && !EDGE_VOICES.some((v) => v.id === value)
  const options: { id: string; label: string }[] = storedIsUnknown
    ? [{ id: value, label: value }, ...EDGE_VOICES]
    : EDGE_VOICES

  const current = value !== '' ? value : EDGE_VOICES[0]!.id

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Select id={id} value={current} disabled={disabled} onChange={(e) => onSave(e.target.value)}>
        {options.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </Select>
    </div>
  )
}

/** The dependent voice-name input — a small save-on-submit text field.
 * Used for providers without a curated voice list (ElevenLabs, OpenAI, etc.).
 * Shows provider-appropriate placeholder text so a user knows what to enter. */
function VoiceNameField({
  label,
  value,
  onSave,
  placeholder,
  disabled,
}: {
  label: string
  value: string
  onSave: (voice: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  const id = useId()
  // The draft is seeded from `value` at mount; the parent re-keys this component
  // on `${provider}:${value}` so a provider switch or a fresh fetch remounts it
  // (resetting the draft) without a setState-in-effect.
  const [draft, setDraft] = useState(value)

  const dirty = draft.trim() !== value.trim()

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!dirty || disabled) return
    onSave(draft.trim())
  }

  return (
    <form className="flex flex-col gap-1.5" onSubmit={submit} aria-label={`Set ${label}`}>
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          id={id}
          value={draft}
          spellCheck={false}
          placeholder={placeholder ?? 'Provider default'}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          className="flex-1 font-mono"
        />
        <Button
          type="submit"
          variant="outline"
          disabled={disabled || !dirty}
          className="h-10 shrink-0"
        >
          Save
        </Button>
      </div>
    </form>
  )
}

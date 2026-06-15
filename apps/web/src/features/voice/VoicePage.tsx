import { AudioLines, Bell, Volume2 } from 'lucide-react'
import type {
  VoiceState,
  AudioNote,
  SetVoiceKeyRequest,
  UpdateVoiceConfigRequest,
} from '@agent-deck/protocol'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TtsCard } from './TtsCard'
import { SttCard } from './SttCard'
import { VoiceToggle } from './VoiceToggle'
import { VoiceNotesList } from './VoiceNotesList'

/**
 * VoicePage — the Voice Console. Purely presentational (props in / callbacks
 * out): TTS provider→voice→key, STT provider→key, the `voice.*` toggles, and the
 * recent-voice-notes playback list. The route owns the read + the mutations.
 *
 * Every control is REAL: provider/voice/toggle writes go to the agent's config
 * (confined to the voice blocks server-side); keys are shape-only; playback is the
 * agent's actual cached audio. A "Restart to apply" note is honest — config
 * changes take effect on the next gateway session.
 */

export interface VoicePageProps {
  state: VoiceState
  notes: AudioNote[]
  notesTruncated: boolean
  onUpdate: (request: UpdateVoiceConfigRequest) => void
  onSetKey: (request: SetVoiceKeyRequest) => void
  /** Whether a config write is in flight. */
  saving: boolean
}

export function VoicePage({
  state,
  notes,
  notesTruncated,
  onUpdate,
  onSetKey,
  saving,
}: VoicePageProps) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-6 pb-12 md:pb-16">
      <PageHeader
        icon={AudioLines}
        title="Voice"
        subtitle="Give your agent a voice. Pick a text-to-speech provider and voice, set how it transcribes the notes you send, and play back what it has spoken."
      />

      <div className="flex flex-col gap-4">
        <TtsCard state={state} onUpdate={onUpdate} onSetKey={onSetKey} saving={saving} />
        <SttCard state={state} onUpdate={onUpdate} onSetKey={onSetKey} saving={saving} />

        {/* The voice.* behavior toggles. */}
        <section aria-label="Voice behavior" role="region">
          <Card>
            <CardHeader>
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden
                  className="ad-surface grid size-9 shrink-0 place-items-center rounded-md bg-muted text-foreground-tertiary"
                >
                  <Volume2 className="size-[18px]" aria-hidden />
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <CardTitle>Behavior</CardTitle>
                  <p className="text-13 text-muted-foreground">How and when your agent speaks.</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="-mt-1 flex flex-col gap-5">
              <VoiceToggle
                icon={Volume2}
                label="Speak replies automatically"
                hint="Your agent speaks its replies aloud as they arrive (voice.auto_tts)."
                checked={state.toggles.autoTts}
                onChange={(next) => onUpdate({ autoTts: next })}
                disabled={saving}
              />
              <VoiceToggle
                icon={Bell}
                label="Beep on record start/stop"
                hint="Play a short beep when voice recording begins and ends (voice.beep_enabled)."
                checked={state.toggles.beepEnabled}
                onChange={(next) => onUpdate({ beepEnabled: next })}
                disabled={saving}
              />
            </CardContent>
          </Card>
        </section>

        {/* Honest restart note — config changes take effect on the next session. */}
        <p className="text-[12px] leading-relaxed text-foreground-tertiary">
          Voice settings apply on your agent&apos;s next session. Restart your agent from the System
          page to apply them now.
        </p>

        <VoiceNotesList notes={notes} truncated={notesTruncated} />
      </div>
    </div>
  )
}

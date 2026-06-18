import { useId } from 'react'
import { Mic, Power } from 'lucide-react'
import type {
  VoiceState,
  SttProvider,
  SetVoiceKeyRequest,
  UpdateVoiceConfigRequest,
} from '@agent-deck/protocol'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { VoiceKeyField } from './VoiceKeyField'
import { VoiceToggle } from './VoiceToggle'

/**
 * SttCard — pick a speech-to-text provider + its masked key (local shows "No key
 * needed"), plus the honest enable toggle (`stt.enabled`). Presentational.
 *
 * HONEST BOUNDARY: there is NO live browser mic capture here. `getUserMedia` would
 * record the BROWSER machine's mic, not where the agent runs — a dishonest layer.
 * This card configures the provider the AGENT uses for transcription; the surface
 * says so plainly rather than offering a fake "record" button.
 */

export interface SttCardProps {
  state: VoiceState
  onUpdate: (request: UpdateVoiceConfigRequest) => void
  onSetKey: (request: SetVoiceKeyRequest) => void
  saving: boolean
}

export function SttCard({ state, onUpdate, onSetKey, saving }: SttCardProps) {
  const titleId = useId()
  const providerId = useId()

  const active = state.sttProviders.find((p) => p.id === state.sttProvider) ?? state.sttProviders[0]

  return (
    <section aria-labelledby={titleId} role="region" aria-label="Speech to text">
      <Card>
        <CardHeader>
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden
              className="ad-surface grid size-9 shrink-0 place-items-center rounded-md bg-muted text-foreground-tertiary"
            >
              <Mic className="size-[18px]" aria-hidden />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <CardTitle id={titleId}>Speech to text</CardTitle>
              <p className="text-13 text-muted-foreground">
                How your agent transcribes voice notes you send it.
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="-mt-1 flex flex-col gap-4">
          <VoiceToggle
            icon={Power}
            label="Transcription enabled"
            hint="When on, voice notes sent to your agent are transcribed with the provider below."
            checked={state.sttEnabled}
            onChange={(next) => onUpdate({ sttEnabled: next })}
            disabled={saving}
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor={providerId} className="text-xs font-medium text-muted-foreground">
              Provider
            </label>
            <Select
              id={providerId}
              value={state.sttProvider}
              disabled={saving}
              onChange={(e) => onUpdate({ sttProvider: e.target.value as SttProvider })}
            >
              {state.sttProviders.map((p) => (
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
              <VoiceKeyField field={active.key} onSetKey={onSetKey} disabled={saving} />
            </>
          ) : null}

          <p className="border-t border-border pt-3 text-[12px] leading-relaxed text-foreground-tertiary">
            This sets the provider your agent uses. Agentdeck doesn&apos;t record from your
            browser&apos;s microphone; that would capture this device, not where your agent runs.
          </p>
        </CardContent>
      </Card>
    </section>
  )
}

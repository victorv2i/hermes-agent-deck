import { CornerDownLeft, Command, Volume2 } from 'lucide-react'
import { useId } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Switch } from '@/components/ui/switch'
import { useSendKeyPref, type SendKeyPref } from '@/features/chat-input/sendKeyPref'
import { useVoicePrefs } from '@/features/voice'

/**
 * ComposerPrefsControl — the editable "Composer" preferences on the Settings
 * surface, sitting alongside Density/Theme. Two controls, each bound to a
 * self-contained Foundation store (no React provider), so the choice persists
 * (localStorage) and every composer/message stays in sync live:
 *
 *   - SEND-KEY — a two-option segmented radiogroup (Enter sends / ⌘·Ctrl+Enter
 *     sends), bound to `useSendKeyPref`. Modelled on DensityControl's radiogroup.
 *   - AUTO-SPEAK — an opt-in switch ("Auto-speak replies in this browser"), bound
 *     to the voice `autoSpeak` pref via `useVoicePrefs`. OFF by default (opt-in
 *     TTS per spec). Named "in this browser" to disambiguate it from /voice's
 *     gateway `voice.auto_tts` — this one is the local Web-Speech playback.
 *
 * Governance: the active radio / on-switch carry the governed action accent;
 * everything else is neutral. Accessible (radiogroup with labelled radios; a
 * `role="switch"` toggle with an accessible name + `aria-checked`). LOCAL-ONLY.
 */

const SEND_KEY_OPTIONS = [
  {
    value: 'enter' as SendKeyPref,
    label: 'Enter sends',
    hint: 'Enter sends; ⌘/Ctrl+Enter inserts a newline',
    icon: CornerDownLeft,
  },
  {
    value: 'mod-enter' as SendKeyPref,
    label: '⌘·Ctrl+Enter sends',
    hint: '⌘/Ctrl+Enter sends; Enter inserts a newline',
    icon: Command,
  },
]

export function ComposerPrefsControl() {
  const { pref, setPref } = useSendKeyPref()
  const { autoSpeak, setAutoSpeak } = useVoicePrefs()
  const sendKeyLabelId = useId()
  const autoSpeakLabelId = useId()
  const autoSpeakHintId = useId()

  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex flex-col gap-5 p-5">
        <div className="min-w-0">
          <h2 className="font-heading text-base leading-snug font-medium text-foreground">
            Composer
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            How you send messages and whether replies are spoken aloud.
          </p>
        </div>

        {/* SEND-KEY — segmented radiogroup, mirroring the Density control. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p id={sendKeyLabelId} className="text-sm font-medium text-foreground">
              Send key
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Which keystroke sends; the other inserts a newline. Shift+Enter is always a newline.
            </p>
          </div>

          <SegmentedControl
            value={pref}
            onValueChange={(v) => setPref(v)}
            options={SEND_KEY_OPTIONS}
            aria-labelledby={sendKeyLabelId}
          />
        </div>

        {/* AUTO-SPEAK — an opt-in switch. */}
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p
              id={autoSpeakLabelId}
              className="flex items-center gap-1.5 text-sm font-medium text-foreground"
            >
              <Volume2 className="size-3.5 shrink-0 text-foreground-tertiary" aria-hidden />
              Auto-speak replies in this browser
            </p>
            <p id={autoSpeakHintId} className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Speak assistant replies aloud as they arrive, using your browser&rsquo;s built-in
              voice. Off by default. (Your agent&rsquo;s own gateway voice is set on the Voice
              page.)
            </p>
          </div>

          <Switch
            checked={autoSpeak}
            onCheckedChange={setAutoSpeak}
            aria-labelledby={autoSpeakLabelId}
            aria-describedby={autoSpeakHintId}
          />
        </div>
      </CardContent>
    </Card>
  )
}

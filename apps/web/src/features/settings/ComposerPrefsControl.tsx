import { CornerDownLeft, Command, Volume2 } from 'lucide-react'
import { useId } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
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

interface SendKeyOption {
  value: SendKeyPref
  label: string
  hint: string
  icon: typeof CornerDownLeft
}

const SEND_KEY_OPTIONS: SendKeyOption[] = [
  {
    value: 'enter',
    label: 'Enter sends',
    hint: 'Enter sends; ⌘/Ctrl+Enter inserts a newline',
    icon: CornerDownLeft,
  },
  {
    value: 'mod-enter',
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

          <div
            role="radiogroup"
            aria-labelledby={sendKeyLabelId}
            className="ad-surface inline-flex shrink-0 rounded-[10px] bg-surface-1 p-1"
          >
            {SEND_KEY_OPTIONS.map((opt) => {
              const checked = pref === opt.value
              const Icon = opt.icon
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  title={opt.hint}
                  onClick={() => setPref(opt.value)}
                  className={cn(
                    // min-h-11 keeps a 44px touch target on mobile, relaxed to
                    // the compact density on sm+ (touch-manipulation drops delay).
                    'inline-flex min-h-11 touch-manipulation items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[13px] font-medium transition-colors sm:min-h-0',
                    'focus-visible:ad-focus',
                    checked
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                  {opt.label}
                </button>
              )
            })}
          </div>
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

          <button
            type="button"
            role="switch"
            aria-checked={autoSpeak}
            aria-labelledby={autoSpeakLabelId}
            aria-describedby={autoSpeakHintId}
            onClick={() => setAutoSpeak(!autoSpeak)}
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
              'focus-visible:ad-focus',
              autoSpeak ? 'bg-primary' : 'bg-muted',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'inline-block size-5 rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none',
                autoSpeak ? 'translate-x-[22px]' : 'translate-x-0.5',
              )}
            />
          </button>
        </div>
      </CardContent>
    </Card>
  )
}

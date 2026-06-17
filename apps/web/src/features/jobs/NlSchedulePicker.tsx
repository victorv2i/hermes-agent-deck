/**
 * NlSchedulePicker — a plain-language helper that sits ABOVE the raw schedule field
 * in the Job form so a non-technical user can type "every morning at 8" instead of
 * remembering cron syntax. It parses the phrase with the pure {@link parseNlSchedule}
 * translator and, HONESTLY, shows:
 *   - the exact 5-field cron it becomes (so the user sees the truth, not magic), and
 *   - a "runs:" preview of the next few real fire times.
 * On "Use this schedule" it hands the cron string up via `onApply`; the parent fills
 * the real schedule field and submits through the EXISTING cron-create path.
 *
 * If the phrase isn't recognized it says so and the Apply button stays disabled —
 * the user falls back to the raw cron field below rather than getting a wrong guess.
 *
 * Design spine: the sky-blue accent lives ONLY on the primary "Use this schedule" action; the
 * parsed-cron chip + preview are neutral; the input is a ≥40px touch target with a
 * labelled, keyboard-reachable control and an aria-live region for the result.
 */
import { useId, useMemo, useState } from 'react'
import { ArrowDown, CalendarClock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { parseNlSchedule, nextRuns } from './nlSchedule'

export interface NlSchedulePickerProps {
  /** Called with the parsed 5-field cron string when the user applies it. */
  onApply: (cron: string) => void
  /** Number of upcoming fire times to preview (defaults to 3). */
  previewCount?: number
}

const INPUT_CLASS =
  'h-10 w-full min-w-0 rounded-md border border-border bg-background px-3 text-13 text-foreground outline-none transition-colors placeholder:text-foreground-tertiary focus-visible:border-ring focus-visible:ad-focus'

/** Format a fire time as a short, human, locale-aware "Mon, Jun 1, 8:00 AM". */
function formatRun(d: Date): string {
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function NlSchedulePicker({ onApply, previewCount = 3 }: NlSchedulePickerProps) {
  const ids = useId()
  const [phrase, setPhrase] = useState('')

  const parsed = useMemo(() => parseNlSchedule(phrase), [phrase])
  const runs = useMemo(
    () => (parsed ? nextRuns(parsed.cron, { count: previewCount }) : []),
    [parsed, previewCount],
  )

  const trimmed = phrase.trim()
  const unknown = trimmed !== '' && !parsed

  return (
    <div className="ad-surface flex flex-col gap-2 rounded-lg bg-surface-2/50 p-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${ids}-nl`} className="text-xs font-medium text-muted-foreground">
          Plain-language schedule <span className="text-foreground-tertiary">(optional)</span>
        </label>
        <input
          id={`${ids}-nl`}
          value={phrase}
          placeholder="every weekday at 9am · every morning · every 3 hours"
          onChange={(e) => setPhrase(e.target.value)}
          className={INPUT_CLASS}
          aria-describedby={`${ids}-nl-result`}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-[11px] text-foreground-tertiary">
          Describe when it should run and we’ll turn it into a cron expression, shown below so you
          can see exactly what it becomes.
        </p>
      </div>

      <div id={`${ids}-nl-result`} aria-live="polite" className="flex flex-col gap-2">
        {parsed ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-muted-foreground">Becomes</span>
              <code className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[12px] text-foreground">
                {parsed.cron}
              </code>
              <span className="text-[11px] text-foreground-tertiary">· {parsed.label}</span>
            </div>

            {runs.length > 0 ? (
              <div
                data-testid="nl-next-runs"
                className="flex items-start gap-1.5 text-[11px] leading-relaxed text-foreground-tertiary"
              >
                <CalendarClock className="mt-px size-3 shrink-0" aria-hidden />
                <span>
                  <span className="text-muted-foreground">Runs:</span>{' '}
                  {runs.map((r) => formatRun(r)).join(' · ')}
                  {' · …'}
                </span>
              </div>
            ) : null}
          </>
        ) : unknown ? (
          <p className="text-[11px] leading-relaxed text-foreground-tertiary">
            Didn’t understand “{trimmed}”. Try “every morning at 8”, “every weekday at 9am”, or
            “every 3 hours”, or type a cron expression in the Schedule field below.
          </p>
        ) : null}
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          disabled={!parsed}
          onClick={() => parsed && onApply(parsed.cron)}
        >
          <ArrowDown className="size-3.5" />
          Use this schedule
        </Button>
      </div>
    </div>
  )
}

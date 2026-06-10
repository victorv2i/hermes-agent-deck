/**
 * JobForm — the create / edit form for a cron job. A calm card with three fields
 * (name, schedule, prompt) + a couple of schedule hints, governed-amber primary
 * submit, an inline error row. Pure props in / callbacks out: the route owns the
 * mutation. When `job` is provided it edits (PUT), otherwise it creates (POST).
 *
 * The schedule field is a free-text string the BACKEND parses + validates (cron
 * expr, "every 30m", an ISO timestamp, or a duration like "2h"); we don't re-parse
 * it client-side — we surface the backend's 400 verbatim instead.
 */
import { useId, useState } from 'react'
import { ChevronDown, Info, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { humanizeDeliver } from './format'
import { NlSchedulePicker } from './NlSchedulePicker'
import type { CronJob, CronJobCreateInput, CronJobUpdateInput } from './types'

export interface JobFormProps {
  /** When set, the form edits this job; otherwise it creates a new one. */
  job?: CronJob
  busy?: boolean
  error?: string | null
  /**
   * Profile names to offer in the create form (sourced from the real
   * /api/agent-deck/profiles list). Defaults to just "default" so the field is
   * always honest even before profiles load.
   */
  profiles?: string[]
  /**
   * Delivery targets to offer beyond "local" — the distinct `deliver` values
   * already in use on real jobs, which are therefore PROVEN-ACCEPTED by this
   * backend's config (we never offer a target that can only fail).
   */
  deliverTargets?: string[]
  onSubmitCreate?: (input: CronJobCreateInput) => void
  onSubmitEdit?: (input: CronJobUpdateInput) => void
  onCancel: () => void
}

const INPUT_CLASS =
  'h-10 w-full min-w-0 rounded-md border border-border bg-background px-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-foreground-tertiary focus-visible:border-ring focus-visible:ad-focus'

const SELECT_CLASS = `${INPUT_CLASS} appearance-none pr-7`

/** A friendly option label for a delivery value ("Run in place", "Telegram …7894"). */
function deliverOptionLabel(value: string): string {
  if (value === 'local') return 'Run in place (no delivery)'
  const h = humanizeDeliver(value)
  if (!h) return value
  return h.target ? `${h.label} · ${h.target}` : h.label
}

export function JobForm({
  job,
  busy,
  error,
  profiles,
  deliverTargets,
  onSubmitCreate,
  onSubmitEdit,
  onCancel,
}: JobFormProps) {
  const editing = !!job
  const ids = useId()
  const [name, setName] = useState(job?.name ?? '')
  const [schedule, setSchedule] = useState(job?.schedule.display ?? '')
  const [prompt, setPrompt] = useState(job?.prompt ?? '')
  const [deliver, setDeliver] = useState('local')
  const [profile, setProfile] = useState('default')

  // Honest option sets: "default" always present + the real profile list; "local"
  // always present + the proven-accepted in-use delivery targets (de-duped).
  const profileOptions = Array.from(new Set(['default', ...(profiles ?? [])]))
  const deliverOptions = Array.from(new Set(['local', ...(deliverTargets ?? [])]))

  const canSubmit = editing
    ? schedule.trim() !== '' || prompt.trim() !== '' || name.trim() !== job?.name
    : schedule.trim() !== '' && prompt.trim() !== ''

  function submit() {
    if (!canSubmit || busy) return
    if (editing) {
      const update: CronJobUpdateInput = {}
      if (name.trim() !== job?.name) update.name = name.trim()
      if (schedule.trim() && schedule.trim() !== job?.schedule.display)
        update.schedule = schedule.trim()
      if (prompt !== job?.prompt) update.prompt = prompt
      onSubmitEdit?.(update)
    } else {
      onSubmitCreate?.({
        prompt: prompt.trim(),
        schedule: schedule.trim(),
        name: name.trim() || undefined,
        deliver: deliver === 'local' ? undefined : deliver,
        profile: profile === 'default' ? undefined : profile,
      })
    }
  }

  return (
    <form
      className="ad-surface flex flex-col gap-3 rounded-xl bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      aria-label={editing ? 'Edit task' : 'New task'}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={`${ids}-name`} className="text-xs font-medium text-muted-foreground">
          Name <span className="text-foreground-tertiary">(optional)</span>
        </label>
        <input
          id={`${ids}-name`}
          value={name}
          placeholder="Morning digest"
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          className={INPUT_CLASS}
        />
      </div>

      <NlSchedulePicker onApply={setSchedule} />

      <div className="flex flex-col gap-1">
        <label htmlFor={`${ids}-schedule`} className="text-xs font-medium text-muted-foreground">
          Schedule
        </label>
        <input
          id={`${ids}-schedule`}
          value={schedule}
          placeholder="every 30m · 0 9 * * 1-5 · 2026-06-01T09:00"
          disabled={busy}
          onChange={(e) => setSchedule(e.target.value)}
          className={`${INPUT_CLASS} font-mono`}
          aria-describedby={`${ids}-schedule-hint`}
        />
        <p id={`${ids}-schedule-hint`} className="text-[11px] text-foreground-tertiary">
          A cron expression, an interval like “every 30m”, or a one-shot timestamp/duration. Or fill
          this from the plain-language box above.
        </p>
      </div>

      {!editing ? (
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor={`${ids}-deliver`} className="text-xs font-medium text-muted-foreground">
              Send result to
            </label>
            <div className="relative">
              <select
                id={`${ids}-deliver`}
                value={deliver}
                disabled={busy}
                onChange={(e) => setDeliver(e.target.value)}
                className={SELECT_CLASS}
                aria-describedby={`${ids}-deliver-caveat`}
              >
                {deliverOptions.map((value) => (
                  <option key={value} value={value}>
                    {deliverOptionLabel(value)}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-foreground-tertiary"
                aria-hidden
              />
            </div>
            <p
              id={`${ids}-deliver-caveat`}
              data-testid="deliver-caveat"
              className="flex items-start gap-1.5 text-[11px] leading-relaxed text-foreground-tertiary"
            >
              <Info className="mt-px size-3 shrink-0" aria-hidden />
              <span>
                Only targets already used by Hermes appear here. If a target goes offline later,
                Hermes may fail delivery without sending a message.
              </span>
            </p>
          </div>

          {profileOptions.length > 1 ? (
            <div className="flex flex-1 flex-col gap-1">
              <label
                htmlFor={`${ids}-profile`}
                className="text-xs font-medium text-muted-foreground"
              >
                Agent profile
              </label>
              <div className="relative">
                <select
                  id={`${ids}-profile`}
                  value={profile}
                  disabled={busy}
                  onChange={(e) => setProfile(e.target.value)}
                  className={SELECT_CLASS}
                >
                  {profileOptions.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-foreground-tertiary"
                  aria-hidden
                />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor={`${ids}-prompt`} className="text-xs font-medium text-muted-foreground">
          Prompt
        </label>
        <textarea
          id={`${ids}-prompt`}
          value={prompt}
          placeholder="What should the agent do on this schedule?"
          disabled={busy}
          rows={3}
          onChange={(e) => setPrompt(e.target.value)}
          className={`${INPUT_CLASS} h-auto resize-y py-1.5 leading-relaxed`}
        />
      </div>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!canSubmit || busy}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          {editing ? 'Save changes' : 'Create task'}
        </Button>
      </div>
    </form>
  )
}

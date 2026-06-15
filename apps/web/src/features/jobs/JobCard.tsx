/**
 * JobCard — one cron job in the list. Leads with the schedule IN WORDS plus the
 * next/last run as relative time (the plain-language story), with the raw cron
 * expression and delivery target ids demoted to a quiet secondary detail line —
 * full information, machine-speak last. A governed status badge and the
 * enabled/paused state sit in the title row.
 * Per-job actions live in a hover-quiet row: pause/resume, run-now (trigger),
 * edit, and delete (inline confirm, never a modal). A "Run history" disclosure
 * surfaces the honest available history — the dashboard exposes the LAST run only
 * (last_run_at / last_status / last_error) plus the cumulative run count; there is
 * no per-run log route, so we present exactly what's real, not a faked timeline.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { Clock, History, Loader2, Pause, Pencil, Play, Send, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  humanizeDeliver,
  relativeTime,
  runsLabel,
  scheduleInWords,
  statusLabel,
  statusTone,
} from './format'
import type { CronJob } from './types'

const jobActionButtonClass = 'min-h-11 min-w-11 sm:min-h-6 sm:min-w-0'

export interface JobCardProps {
  job: CronJob
  /** The action currently in flight for THIS job (disables its controls). */
  pendingAction?: 'pause' | 'resume' | 'trigger' | 'delete' | null
  actionError?: string | null
  onEdit: (job: CronJob) => void
  onToggle: (job: CronJob) => void
  onTrigger: (job: CronJob) => void
  onDelete: (job: CronJob) => void
}

export function JobCard({
  job,
  pendingAction,
  actionError,
  onEdit,
  onToggle,
  onTrigger,
  onDelete,
}: JobCardProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const confirmDeleteRef = useRef<HTMLButtonElement>(null)
  const confirmTextId = useId()
  const historyId = useId()
  const busy = pendingAction != null

  // When the inline confirm opens, move focus into it so a keyboard / screen-reader
  // user lands on the destructive action (the trigger row it replaced is gone).
  useEffect(() => {
    if (confirmingDelete) confirmDeleteRef.current?.focus()
  }, [confirmingDelete])
  const nextRun = relativeTime(job.nextRunAt)
  const lastRun = relativeTime(job.lastRunAt)
  const deliver = humanizeDeliver(job.deliver)
  const scheduleWords = scheduleInWords(job.schedule)
  // The raw cron expression is demoted to the detail line — shown only when it
  // adds information the words line doesn't already carry verbatim.
  const rawCron =
    job.schedule.kind === 'cron' && job.schedule.expr && job.schedule.expr !== scheduleWords
      ? job.schedule.expr
      : null

  return (
    <li
      className="ad-surface ad-raised group/job flex flex-col gap-2 rounded-xl bg-card p-4"
      data-testid={`job-${job.id}`}
      data-paused={job.paused}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {job.name || job.id}
            </span>
            {job.paused ? (
              <Badge variant="muted">Paused</Badge>
            ) : (
              <Badge variant="active">Active</Badge>
            )}
            {job.noAgent ? <Badge variant="secondary">Script</Badge> : null}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground" title={job.schedule.display}>
            {scheduleWords}
          </p>
        </div>
        <Badge variant={statusTone(job.lastStatus)}>{statusLabel(job.lastStatus)}</Badge>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground-tertiary">
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3" aria-hidden />
          {job.paused ? 'Paused' : nextRun ? `Next ${nextRun}` : 'Not scheduled'}
        </span>
        <span>{lastRun ? `Last ran ${lastRun}` : 'Never run'}</span>
        <span>{runsLabel(job)}</span>
        {deliver ? (
          <span className="inline-flex items-center gap-1" title={`Delivers to ${deliver.full}`}>
            <Send className="size-3" aria-hidden />
            <span className="text-foreground">{deliver.label}</span>
          </span>
        ) : null}
      </div>

      {/* The machine-speak detail line: the raw cron expression + the delivery
          target/thread ids, kept (never removed) but quiet and last. */}
      {rawCron || deliver?.target ? (
        <div
          data-testid="job-detail-line"
          className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-foreground-tertiary"
        >
          {rawCron ? (
            <code title="The cron expression this schedule runs on">{rawCron}</code>
          ) : null}
          {deliver?.target ? (
            <span title={`Delivers to ${deliver.full}`}>{deliver.target}</span>
          ) : null}
        </div>
      ) : null}

      {confirmingDelete ? (
        <div
          role="alertdialog"
          aria-label="Confirm delete"
          aria-describedby={confirmTextId}
          className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5"
        >
          <p id={confirmTextId} className="min-w-0 flex-1 text-xs text-foreground">
            Delete this job permanently?
          </p>
          <Button
            ref={confirmDeleteRef}
            variant="destructive"
            size="xs"
            className={jobActionButtonClass}
            disabled={busy}
            onClick={() => onDelete(job)}
          >
            {pendingAction === 'delete' ? <Loader2 className="animate-spin" /> : null}
            Delete
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className={jobActionButtonClass}
            disabled={busy}
            onClick={() => setConfirmingDelete(false)}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="outline"
            size="xs"
            className={jobActionButtonClass}
            disabled={busy}
            onClick={() => onToggle(job)}
            aria-label={job.paused ? 'Resume task' : 'Pause task'}
          >
            {pendingAction === 'pause' || pendingAction === 'resume' ? (
              <Loader2 className="animate-spin" />
            ) : job.paused ? (
              <Play className="size-3" />
            ) : (
              <Pause className="size-3" />
            )}
            {job.paused ? 'Resume' : 'Pause'}
          </Button>
          <Button
            variant="outline"
            size="xs"
            className={jobActionButtonClass}
            disabled={busy}
            onClick={() => onTrigger(job)}
            aria-label="Run task now"
          >
            {pendingAction === 'trigger' ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Play className="size-3" />
            )}
            Run now
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className={jobActionButtonClass}
            disabled={busy}
            onClick={() => onEdit(job)}
            aria-label="Edit task"
          >
            <Pencil className="size-3" />
            Edit
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className={jobActionButtonClass}
            disabled={busy}
            onClick={() => setShowHistory((v) => !v)}
            aria-expanded={showHistory}
            aria-controls={showHistory ? historyId : undefined}
            aria-label="Toggle run history"
          >
            <History className="size-3" />
            History
          </Button>
          <Button
            variant="outline"
            size="xs"
            disabled={busy}
            onClick={() => setConfirmingDelete(true)}
            aria-label="Delete task"
            className={`${jobActionButtonClass} border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive`}
          >
            <Trash2 className="size-3" />
            Delete
          </Button>
        </div>
      )}

      {actionError ? (
        <p role="alert" className="text-xs text-destructive">
          Couldn’t update this job: {actionError}
        </p>
      ) : null}

      {showHistory ? (
        <div
          id={historyId}
          className="mt-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs"
        >
          <p className="mb-1 font-medium text-muted-foreground">Run history</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-foreground-tertiary">
            <dt>Last run</dt>
            <dd className="text-foreground">{lastRun ? `${lastRun}` : 'Never'}</dd>
            <dt>Last status</dt>
            <dd className="text-foreground">{statusLabel(job.lastStatus)}</dd>
            {job.lastError ? (
              <>
                <dt>Last error</dt>
                <dd className="break-words text-destructive">{job.lastError}</dd>
              </>
            ) : null}
            <dt>Total</dt>
            <dd className="text-foreground">{runsLabel(job)}</dd>
            <dt>Created</dt>
            <dd className="text-foreground">{relativeTime(job.createdAt) ?? '—'}</dd>
          </dl>
          <p className="mt-1.5 text-[11px] text-foreground-tertiary">
            Only the most recent run is available here.
          </p>
        </div>
      ) : null}
    </li>
  )
}

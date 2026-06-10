/**
 * JobsPage — the presentational Jobs (cron) surface. Pure props in (jobs + loading/
 * error + the per-job pending action) / callbacks out; the route (JobsRoute) owns
 * the queries + mutations. Layout follows the design language: a calm PageHeader
 * with a governed-amber "New task" action, an optional inline create/edit form, and
 * the job list (or a skeleton / empty / error state).
 */
import { CalendarClock, Plus } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState } from '@/components/ui/state'
import { JobCard } from './JobCard'
import { JobForm } from './JobForm'
import type { CronJob, CronJobCreateInput, CronJobUpdateInput } from './types'

export interface JobsPageProps {
  jobs?: CronJob[]
  isLoading: boolean
  isFetching: boolean
  error?: Error | null
  onRetry?: () => void

  /** Which form (if any) is open: 'create', or a job being edited. */
  formMode: 'create' | { editing: CronJob } | null
  onOpenCreate: () => void
  onOpenEdit: (job: CronJob) => void
  onCloseForm: () => void
  formBusy?: boolean
  formError?: string | null
  /** Profile names to offer in the create form (real /api/agent-deck/profiles). */
  profiles?: string[]
  /** Proven-accepted delivery targets to offer beyond "local". */
  deliverTargets?: string[]
  onSubmitCreate: (input: CronJobCreateInput) => void
  onSubmitEdit: (id: string, input: CronJobUpdateInput) => void

  /** The job id with an action in flight + which action, for disabling controls. */
  pending?: { id: string; action: 'pause' | 'resume' | 'trigger' | 'delete' } | null
  actionError?: { id: string; message: string } | null
  onToggle: (job: CronJob) => void
  onTrigger: (job: CronJob) => void
  onDelete: (job: CronJob) => void
}

export function JobsPage(props: JobsPageProps) {
  const {
    jobs,
    isLoading,
    isFetching,
    error,
    onRetry,
    formMode,
    onOpenCreate,
    onOpenEdit,
    onCloseForm,
    formBusy,
    formError,
    profiles,
    deliverTargets,
    onSubmitCreate,
    onSubmitEdit,
    pending,
    actionError,
    onToggle,
    onTrigger,
    onDelete,
  } = props

  const editingJob = formMode && formMode !== 'create' ? formMode.editing : undefined

  // Keep the raw internal error (e.g. "session-token request failed: fetch
  // failed") available for diagnostics, but never render it: the user sees a
  // calm human sentence (below), the developer sees the plumbing in the console.
  if (error) {
    console.warn('[jobs] failed to load:', error.message)
  }

  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-col gap-6 px-6 py-8">
      <PageHeader
        icon={CalendarClock}
        title="Tasks"
        subtitle={
          <>
            Scheduled work your agent runs for you (digests, checks, reminders).
            {isFetching && !isLoading ? (
              <span className="ml-2 opacity-70" aria-live="polite">
                updating…
              </span>
            ) : null}
          </>
        }
        actions={
          <Button size="sm" onClick={onOpenCreate} disabled={formMode === 'create'}>
            <Plus className="size-3.5" />
            New task
          </Button>
        }
        className="mb-0"
      />

      {formMode ? (
        <JobForm
          job={editingJob}
          busy={formBusy}
          error={formError}
          profiles={profiles}
          deliverTargets={deliverTargets}
          onSubmitCreate={onSubmitCreate}
          onSubmitEdit={(input) => editingJob && onSubmitEdit(editingJob.id, input)}
          onCancel={onCloseForm}
        />
      ) : null}

      {error ? (
        <ErrorState
          icon={CalendarClock}
          title="Couldn’t load tasks"
          description="Scheduled tasks come from your agent. Start your agent or retry when it is reachable."
          onRetry={onRetry}
        />
      ) : isLoading ? (
        <JobsSkeleton />
      ) : jobs && jobs.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              pendingAction={pending?.id === job.id ? pending.action : null}
              actionError={actionError?.id === job.id ? actionError.message : null}
              onEdit={onOpenEdit}
              onToggle={onToggle}
              onTrigger={onTrigger}
              onDelete={onDelete}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={CalendarClock}
          title="No scheduled tasks"
          description="Create one task, write what your agent should do, and choose a schedule. The form accepts plain language like “every weekday at 9am”."
          action={
            <Button size="sm" onClick={onOpenCreate}>
              <Plus className="size-3.5" />
              New task
            </Button>
          }
        />
      )}
    </div>
  )
}

function JobsSkeleton() {
  return (
    <div role="status" aria-live="polite" data-testid="jobs-skeleton">
      <span className="sr-only">Loading scheduled tasks</span>
      <div className="flex flex-col gap-3" aria-hidden>
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="ad-surface h-[116px] animate-pulse rounded-xl bg-surface-2/60 motion-reduce:animate-none"
          />
        ))}
      </div>
    </div>
  )
}

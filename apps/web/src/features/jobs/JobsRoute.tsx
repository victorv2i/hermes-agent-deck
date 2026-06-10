/**
 * JobsRoute — the Jobs (cron) surface route element (mounted at `/jobs` by the
 * integrator). Owns the react-query list + the create/edit/lifecycle mutations,
 * the open-form state, and the per-job in-flight action (so only the acting job's
 * controls disable). Hands everything to the presentational {@link JobsPage}.
 *
 * Reads + writes ride the single app-wide QueryClient (main.tsx); mutations
 * invalidate the list (see hooks.ts) so next/last-run + paused state refresh.
 */
import { useState } from 'react'
import { useProfiles } from '@/features/profiles/useProfiles'
import { JobsPage } from './JobsPage'
import { useCreateJob, useDeleteJob, useJobAction, useJobs, useUpdateJob } from './hooks'
import type { CronJob, CronJobCreateInput, CronJobUpdateInput } from './types'

type FormMode = 'create' | { editing: CronJob } | null
type PendingAction = { id: string; action: 'pause' | 'resume' | 'trigger' | 'delete' } | null

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong'
}

export function JobsRoute() {
  const jobs = useJobs()
  const profiles = useProfiles()
  const create = useCreateJob()
  const update = useUpdateJob()
  const action = useJobAction()
  const remove = useDeleteJob()

  // The create form only offers what the backend really accepts: the real profile
  // list, and delivery targets PROVEN-ACCEPTED by being already in use on a job
  // (so we never present a control that can only fail).
  const profileNames = profiles.data?.profiles.map((p) => p.name) ?? []
  const deliverTargets = Array.from(
    new Set((jobs.data ?? []).map((j) => j.deliver).filter((d) => d && d !== 'local')),
  )

  const [formMode, setFormMode] = useState<FormMode>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingAction>(null)
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null)

  function closeForm() {
    setFormMode(null)
    setFormError(null)
  }

  function submitCreate(input: CronJobCreateInput) {
    setFormError(null)
    create.mutate(input, {
      onSuccess: closeForm,
      onError: (err) => setFormError(messageOf(err)),
    })
  }

  function submitEdit(id: string, input: CronJobUpdateInput) {
    setFormError(null)
    update.mutate(
      { id, input },
      {
        onSuccess: closeForm,
        onError: (err) => setFormError(messageOf(err)),
      },
    )
  }

  function runAction(id: string, verb: 'pause' | 'resume' | 'trigger') {
    setActionError(null)
    setPending({ id, action: verb })
    action.mutate(
      { id, verb },
      {
        onError: (err) => setActionError({ id, message: messageOf(err) }),
        onSettled: () => setPending(null),
      },
    )
  }

  function deleteJob(job: CronJob) {
    setActionError(null)
    setPending({ id: job.id, action: 'delete' })
    remove.mutate(job.id, {
      onError: (err) => setActionError({ id: job.id, message: messageOf(err) }),
      onSettled: () => setPending(null),
    })
  }

  return (
    <JobsPage
      jobs={jobs.data}
      isLoading={jobs.isLoading}
      isFetching={jobs.isFetching}
      error={jobs.error}
      onRetry={() => void jobs.refetch()}
      formMode={formMode}
      onOpenCreate={() => {
        setFormError(null)
        setFormMode('create')
      }}
      onOpenEdit={(job) => {
        setFormError(null)
        setFormMode({ editing: job })
      }}
      onCloseForm={closeForm}
      formBusy={create.isPending || update.isPending}
      formError={formError}
      profiles={profileNames}
      deliverTargets={deliverTargets}
      onSubmitCreate={submitCreate}
      onSubmitEdit={submitEdit}
      pending={pending}
      actionError={actionError}
      onToggle={(job) => runAction(job.id, job.paused ? 'resume' : 'pause')}
      onTrigger={(job) => runAction(job.id, 'trigger')}
      onDelete={deleteJob}
    />
  )
}

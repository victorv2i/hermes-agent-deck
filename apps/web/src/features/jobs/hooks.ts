/**
 * TanStack Query hooks for the Jobs (cron) surface. The job list is cached under
 * `['jobs']`; every mutation (create / edit / pause / resume / trigger / delete)
 * invalidates it so the list reflects the new schedule + run state immediately.
 * Reads ride the single app-wide QueryClient (main.tsx) + its converged retry
 * policy, so this surface carries no client of its own.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { createJob, deleteJob, fetchJobRuns, fetchJobs, jobAction, updateJob } from './api'
import type { CronJob, CronJobCreateInput, CronJobUpdateInput, CronRunList } from './types'

export const jobKeys = {
  all: ['jobs'] as const,
  list: ['jobs', 'list'] as const,
}

export function useJobs(): UseQueryResult<CronJob[]> {
  return useQuery({
    queryKey: jobKeys.list,
    queryFn: ({ signal }) => fetchJobs(signal),
    // Cron state (next_run/last_run) drifts slowly; a short stale window keeps the
    // list fresh after a mutation without hammering the dashboard.
    staleTime: 10_000,
  })
}

export function useCreateJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CronJobCreateInput) => createJob(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: jobKeys.list }),
  })
}

export function useUpdateJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CronJobUpdateInput }) => updateJob(id, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: jobKeys.list }),
  })
}

export function useJobAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, verb }: { id: string; verb: 'pause' | 'resume' | 'trigger' }) =>
      jobAction(id, verb),
    onSuccess: () => void qc.invalidateQueries({ queryKey: jobKeys.list }),
  })
}

export function useDeleteJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteJob(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: jobKeys.list }),
  })
}

export function useJobRuns(id: string, enabled: boolean): UseQueryResult<CronRunList> {
  return useQuery({
    queryKey: [...jobKeys.all, 'runs', id],
    queryFn: ({ signal }) => fetchJobRuns(id, signal),
    enabled,
    staleTime: 10_000,
  })
}

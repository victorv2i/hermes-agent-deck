/**
 * Jobs (cron) surface client — talks to the BFF cron routes
 * (`/api/agent-deck/cron/*`). The shared {@link apiFetch}/{@link apiPost} handle
 * auth + the ok-check + a typed error; this module only names routes + shapes
 * bodies. The BFF already maps the raw scheduler job to the slim wire shape.
 */
import { apiFetch, apiPost } from '@/lib/apiFetch'
import type { CronJob, CronJobCreateInput, CronJobUpdateInput, CronRunList } from './types'

/** GET the full job list (all profiles). */
export async function fetchJobs(signal?: AbortSignal): Promise<CronJob[]> {
  const { jobs } = await apiFetch<{ jobs: CronJob[] }>('/cron/jobs', { signal })
  return jobs ?? []
}

/** POST a new job. */
export function createJob(input: CronJobCreateInput): Promise<CronJob> {
  return apiPost<CronJob>('/cron/jobs', input)
}

/** PUT an edit (partial prompt/schedule/name). */
export function updateJob(id: string, input: CronJobUpdateInput): Promise<CronJob> {
  return apiFetch<CronJob>(`/cron/jobs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

/** POST a lifecycle action (pause / resume / trigger). */
export function jobAction(id: string, verb: 'pause' | 'resume' | 'trigger'): Promise<CronJob> {
  return apiPost<CronJob>(`/cron/jobs/${encodeURIComponent(id)}/${verb}`, {})
}

/** DELETE a job. */
export function deleteJob(id: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/cron/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** GET the per-run history for a job. */
export function fetchJobRuns(id: string, signal?: AbortSignal): Promise<CronRunList> {
  return apiFetch<CronRunList>(`/cron/jobs/${encodeURIComponent(id)}/runs`, { signal })
}

/**
 * Typed wrapper over the loopback dashboard's cron API (`/api/cron/jobs` and
 * friends, see hermes_cli/web_server.py + cron/jobs.py). It maps the raw scheduler
 * job dict — which carries on-disk layout fields (`hermes_home`, `workdir`) and
 * delivery internals — into the SLIM, whitelisted {@link CronJob} wire shape, so a
 * remote Agentdeck operator never learns the server's filesystem layout.
 *
 * Auth + transport are delegated to the shared {@link DashboardClient}: this layer
 * only names routes, shapes bodies, and normalizes payloads. The dashboard session
 * token lives inside the client and never enters a response or log here.
 *
 * The scheduler models a schedule as a tagged union (`kind`): `cron` (expr),
 * `interval` (minutes), `once` (run_at). `paused` is surfaced positively (the
 * inverse of the scheduler's `enabled` + `state: paused`).
 */
import { DashboardError, type DashboardClient } from '../hermes/dashboardClient'
import type {
  CronJob,
  CronJobCreateInput,
  CronJobStatus,
  CronJobUpdateInput,
  CronSchedule,
  CronScheduleKind,
} from '@agent-deck/protocol'

/** Minimal slice of DashboardClient this client needs (eases test injection). */
export interface CronDashboard {
  getJson<T>(path: string): Promise<T>
  authedFetch(path: string, init?: RequestInit): Promise<Response>
}

/** Raw scheduler schedule dict (only the fields we map). */
interface RawSchedule {
  kind?: unknown
  display?: unknown
  expr?: unknown
  minutes?: unknown
  run_at?: unknown
}

/** Raw scheduler repeat counter dict. */
interface RawRepeat {
  times?: unknown
  completed?: unknown
}

/** Raw scheduler job dict as the dashboard returns it (superset; we map a subset). */
interface RawCronJob {
  id?: unknown
  name?: unknown
  prompt?: unknown
  schedule?: unknown
  schedule_display?: unknown
  enabled?: unknown
  state?: unknown
  profile?: unknown
  deliver?: unknown
  no_agent?: unknown
  context_from?: unknown
  created_at?: unknown
  next_run_at?: unknown
  last_run_at?: unknown
  last_status?: unknown
  last_error?: unknown
  repeat?: unknown
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Coerce the scheduler's `last_status` into the governed vocabulary (else null). */
function mapStatus(v: unknown): CronJobStatus | null {
  return v === 'ok' || v === 'error' || v === 'skipped' ? v : null
}

/** Coerce the scheduler's schedule `kind` into the tagged-union set (default cron). */
function mapKind(v: unknown): CronScheduleKind {
  return v === 'cron' || v === 'interval' || v === 'once' ? v : 'cron'
}

function mapSchedule(raw: RawSchedule | null | undefined, fallbackDisplay: unknown): CronSchedule {
  const kind = mapKind(raw?.kind)
  const display = str(raw?.display) || str(fallbackDisplay)
  return {
    kind,
    display,
    expr: strOrNull(raw?.expr),
    minutes: numOrNull(raw?.minutes),
    runAt: strOrNull(raw?.run_at),
  }
}

/**
 * Map a raw scheduler job dict to the slim {@link CronJob}. This is the security
 * boundary: ONLY the fields below cross to the client. `paused` is the inverse of
 * `enabled` AND/OR an explicit `state: 'paused'` (the scheduler sets both on pause).
 */
export function mapCronJob(raw: RawCronJob): CronJob {
  const enabled = raw.enabled !== false
  const paused = !enabled || raw.state === 'paused'
  const repeat = (raw.repeat ?? {}) as RawRepeat
  const schedule =
    raw.schedule && typeof raw.schedule === 'object' ? (raw.schedule as RawSchedule) : undefined
  return {
    id: str(raw.id),
    name: str(raw.name),
    prompt: str(raw.prompt),
    schedule: mapSchedule(schedule, raw.schedule_display),
    enabled,
    paused,
    profile: str(raw.profile) || 'default',
    deliver: str(raw.deliver) || 'local',
    noAgent: raw.no_agent === true,
    createdAt: strOrNull(raw.created_at),
    nextRunAt: strOrNull(raw.next_run_at),
    lastRunAt: strOrNull(raw.last_run_at),
    lastStatus: mapStatus(raw.last_status),
    lastError: strOrNull(raw.last_error),
    runCount: num(repeat.completed),
    repeatTimes: numOrNull(repeat.times),
  }
}

/** Build a `?a=b` query string from defined, non-empty params (URL-encoded). */
function buildQuery(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') sp.set(key, value)
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/**
 * Read a mutation's single-job response. `authedFetch` returns the raw Response
 * (it never throws on a non-2xx), so we map the upstream status to a
 * {@link DashboardError} here — letting the route translate 400 (bad schedule) /
 * 404 (unknown job) / anything-else (→ 502) honestly. The error message carries
 * only the status, never the session token.
 */
async function readJob(res: Response, label: string): Promise<CronJob> {
  if (!res.ok) {
    throw new DashboardError(`${label} failed: HTTP ${res.status}`, res.status)
  }
  const raw = (await res.json()) as RawCronJob
  return mapCronJob(raw)
}

export class CronClient {
  constructor(private readonly dashboard: CronDashboard | DashboardClient) {}

  /** List all jobs across profiles (`profile=all`), normalized + slimmed. */
  async list(profile = 'all'): Promise<CronJob[]> {
    const raw = await this.dashboard.getJson<unknown>(`/api/cron/jobs${buildQuery({ profile })}`)
    const jobs = Array.isArray(raw) ? raw : []
    return jobs.filter((j): j is RawCronJob => !!j && typeof j === 'object').map(mapCronJob)
  }

  /** Fetch one job by id. The dashboard locates the profile when omitted. */
  async get(id: string, profile?: string): Promise<CronJob> {
    const raw = await this.dashboard.getJson<RawCronJob>(
      `/api/cron/jobs/${encodeURIComponent(id)}${buildQuery({ profile })}`,
    )
    return mapCronJob(raw)
  }

  /** Create a job. The dashboard parses + validates the schedule string. */
  async create(input: CronJobCreateInput): Promise<CronJob> {
    const profile = input.profile ?? 'default'
    const res = await this.dashboard.authedFetch(`/api/cron/jobs${buildQuery({ profile })}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        prompt: input.prompt,
        schedule: input.schedule,
        name: input.name ?? '',
        deliver: input.deliver ?? 'local',
      }),
    })
    return readJob(res, 'POST /api/cron/jobs')
  }

  /**
   * Edit a job's prompt/schedule/name. The dashboard expects a `{ updates: {...} }`
   * envelope; we forward only the fields the caller set so a partial edit stays
   * partial.
   */
  async update(id: string, input: CronJobUpdateInput, profile?: string): Promise<CronJob> {
    const updates: Record<string, string> = {}
    if (input.prompt !== undefined) updates.prompt = input.prompt
    if (input.schedule !== undefined) updates.schedule = input.schedule
    if (input.name !== undefined) updates.name = input.name
    const res = await this.dashboard.authedFetch(
      `/api/cron/jobs/${encodeURIComponent(id)}${buildQuery({ profile })}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ updates }),
      },
    )
    return readJob(res, `PUT /api/cron/jobs/${id}`)
  }

  /** Pause a job (scheduler sets enabled=false, state=paused). */
  async pause(id: string, profile?: string): Promise<CronJob> {
    return this.action(id, 'pause', profile)
  }

  /** Resume a paused job (scheduler re-enables + recomputes next_run). */
  async resume(id: string, profile?: string): Promise<CronJob> {
    return this.action(id, 'resume', profile)
  }

  /** Trigger an immediate run (does not consume the schedule). */
  async trigger(id: string, profile?: string): Promise<CronJob> {
    return this.action(id, 'trigger', profile)
  }

  private async action(id: string, verb: string, profile?: string): Promise<CronJob> {
    const res = await this.dashboard.authedFetch(
      `/api/cron/jobs/${encodeURIComponent(id)}/${verb}${buildQuery({ profile })}`,
      { method: 'POST', headers: { Accept: 'application/json' } },
    )
    return readJob(res, `POST /api/cron/jobs/${id}/${verb}`)
  }

  /** Delete a job permanently. Maps a non-2xx upstream to a {@link DashboardError}. */
  async remove(id: string, profile?: string): Promise<void> {
    const res = await this.dashboard.authedFetch(
      `/api/cron/jobs/${encodeURIComponent(id)}${buildQuery({ profile })}`,
      { method: 'DELETE', headers: { Accept: 'application/json' } },
    )
    if (!res.ok) {
      throw new DashboardError(`DELETE /api/cron/jobs/${id} failed: HTTP ${res.status}`, res.status)
    }
  }
}

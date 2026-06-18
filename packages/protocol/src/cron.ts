import { z } from 'zod'

/**
 * Cron job DTO — the WHITELISTED view of a hermes scheduler job as exposed by the
 * loopback dashboard's cron API (`/api/cron/jobs`, see hermes_cli/web_server.py +
 * cron/jobs.py `create_job`). The dashboard stores far more per job than a remote
 * Agentdeck operator needs (and some of it is filesystem-shaped); this schema is
 * the contract that keeps the wire shape SLIM and stable.
 *
 * SECURITY: the raw dashboard job dict carries on-disk layout fields
 * (`hermes_home`, `workdir`) and delivery/origin internals. NONE of them appear
 * here — the BFF maps ONLY the fields below, so a remote operator never learns the
 * server's filesystem layout. Anything not declared here cannot reach the client.
 *
 * The hermes scheduler models a schedule as a small tagged union (`kind`):
 *   - `cron`     → a 5/6-field cron expression (`expr`)
 *   - `interval` → "every Nm" (`minutes`)
 *   - `once`     → a one-shot ISO timestamp (`runAt`)
 * Every kind also carries a human `display` string the scheduler computed.
 */

/** A job's last-run outcome, as the scheduler records it (`last_status`). */
export const CronJobStatus = z.enum(['ok', 'error', 'skipped'])
export type CronJobStatus = z.infer<typeof CronJobStatus>

/** The schedule kind — a tagged union over how the next run is computed. */
export const CronScheduleKind = z.enum(['cron', 'interval', 'once'])
export type CronScheduleKind = z.infer<typeof CronScheduleKind>

/**
 * Normalized schedule. `kind` selects which of the optional fields is meaningful:
 * `cron` → `expr`, `interval` → `minutes`, `once` → `runAt`. `display` is always
 * the scheduler's own human-readable rendering (e.g. "every 30m", "0 9 * * 1").
 */
export const CronSchedule = z.object({
  kind: CronScheduleKind,
  /** Human rendering of the schedule (always present). */
  display: z.string(),
  /** Cron expression — present (non-null) only when `kind === 'cron'`. */
  expr: z.string().nullable(),
  /** Interval in minutes — present only when `kind === 'interval'`. */
  minutes: z.number().nullable(),
  /** One-shot ISO timestamp — present only when `kind === 'once'`. */
  runAt: z.string().nullable(),
})
export type CronSchedule = z.infer<typeof CronSchedule>

/**
 * A single cron job as Agentdeck surfaces it. `paused` is the inverse of the
 * scheduler's `enabled` flag (a paused job is `enabled: false` + `state: paused`),
 * surfaced positively so the UI's pause/resume toggle reads naturally.
 */
export const CronJob = z.object({
  /** Stable job id (hermes uses a 12-char hex). */
  id: z.string(),
  /** Friendly name (defaults to a prompt-derived label on the backend). */
  name: z.string(),
  /** The prompt the job runs (empty for `noAgent` script-only jobs). */
  prompt: z.string(),
  /** Normalized schedule (see {@link CronSchedule}). */
  schedule: CronSchedule,
  /** Whether the job is currently scheduled to run (scheduler `enabled`). */
  enabled: z.boolean(),
  /** Whether the operator has paused the job (inverse of enabled + state). */
  paused: z.boolean(),
  /** Which profile the job belongs to (e.g. "default"). */
  profile: z.string(),
  /** Where output is delivered ("local", "telegram", "origin", …). */
  deliver: z.string(),
  /** A script-only job (no LLM agent) — runs `script` and delivers stdout. */
  noAgent: z.boolean(),
  /** ISO timestamp the job was created (null if unknown). */
  createdAt: z.string().nullable(),
  /** ISO timestamp of the next scheduled run (null when paused/finished). */
  nextRunAt: z.string().nullable(),
  /** ISO timestamp of the most recent run (null if it has never run). */
  lastRunAt: z.string().nullable(),
  /** Outcome of the most recent run (null if it has never run). */
  lastStatus: CronJobStatus.nullable(),
  /** Error detail from the most recent failed run (null when healthy). */
  lastError: z.string().nullable(),
  /** How many times the job has completed (from the scheduler's repeat counter). */
  runCount: z.number(),
  /** Total runs the job is configured to make (null = forever). */
  repeatTimes: z.number().nullable(),
})
export type CronJob = z.infer<typeof CronJob>

/** The list payload `GET /api/agent-deck/cron/jobs` returns. */
export const CronJobList = z.object({
  jobs: z.array(CronJob),
})
export type CronJobList = z.infer<typeof CronJobList>

/**
 * The create payload the UI POSTs (mirrors the dashboard's `CronJobCreate`).
 * `schedule` accepts any form the scheduler understands (cron expr, "every 30m",
 * an ISO timestamp, or a duration like "2h"); the backend parses + validates it.
 */
export const CronJobCreateInput = z.object({
  prompt: z.string().min(1, 'A prompt is required'),
  schedule: z.string().min(1, 'A schedule is required'),
  /** Optional friendly name (defaults to a prompt-derived label server-side). */
  name: z.string().optional(),
  /** Delivery target — defaults to "local". */
  deliver: z.string().optional(),
  /** Profile to create the job under — defaults to "default". */
  profile: z.string().optional(),
})
export type CronJobCreateInput = z.infer<typeof CronJobCreateInput>

/**
 * The edit payload the UI PUTs. v1 edits the two fields a schedule change needs —
 * the prompt and the schedule — both optional so a caller can change just one. The
 * BFF forwards these as the scheduler's `{ updates: {...} }` shape.
 */
export const CronJobUpdateInput = z.object({
  prompt: z.string().optional(),
  schedule: z.string().optional(),
  name: z.string().optional(),
})
export type CronJobUpdateInput = z.infer<typeof CronJobUpdateInput>

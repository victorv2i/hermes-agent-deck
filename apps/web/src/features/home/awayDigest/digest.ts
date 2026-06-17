/**
 * The pure "While you were away" digest helper: the honesty spine of the
 * on-return catch-up card. Given the data the app ALREADY loads (the sessions
 * list + the cron jobs list) plus the last-seen timestamp, it computes a calm,
 * truthful summary of what actually happened during the absence.
 *
 * HONESTY (load-bearing): every number traces to real history. We count
 *  - sessions that reached a TERMINAL state with their last activity AFTER the
 *    last visit (split completed vs failed), and
 *  - cron jobs whose most recent run landed AFTER the last visit (split ok vs
 *    error, with skipped counted only in the total).
 * Nothing else is invented: there is deliberately no "pending approvals",
 * "notifications", or cost field, because the gateway exposes no honest source
 * for them outside an active run. When there is nothing real to report (or it is
 * the first visit, or the absence is too short to matter) the helper returns
 * null and the card renders nothing.
 *
 * Timeline: `lastSeenAt` / `now` are unix MILLISECONDS (Date.now). Session
 * timestamps are unix SECONDS (state.db native), and cron `lastRunAt` is an ISO
 * string. This helper normalizes both onto the ms timeline so the comparison is
 * apples-to-apples.
 */
import type { SessionSummary } from '@/features/sessions/types'
import { isFailedSession } from '@/features/sessions/sessionStatus'
import type { CronJob } from '@/features/jobs/types'

/**
 * Minimum absence before a digest is worth showing. A quick refresh or an active
 * working session (the operator never really left) must NOT trigger the card, so
 * we suppress anything under this window. 30 minutes matches the spec.
 */
export const AWAY_THRESHOLD_MS = 30 * 60 * 1000

/** How many human titles/names to keep for the card's "for example" detail. */
const SAMPLE_LIMIT = 3

/** The finished-runs slice of the digest. */
export interface AwayRunsSummary {
  /** Terminal runs that finished since last visit (completed + failed). */
  total: number
  /** Finished runs that completed normally. */
  completed: number
  /** Finished runs that ended in an error/failed state. */
  failed: number
  /** A few human titles of completed runs (capped, untitled ones dropped). */
  completedTitles: string[]
  /** A few human titles of failed runs (capped, untitled ones dropped). */
  failedTitles: string[]
  /** The id of the most-recently-finished run, so the card can deep-link to it. */
  latestId: string | null
}

/** The cron-runs slice of the digest. */
export interface AwayCronsSummary {
  /** Cron jobs that ran since last visit (ok + error + skipped). */
  total: number
  /** Jobs whose last run succeeded. */
  ok: number
  /** Jobs whose last run errored. */
  error: number
  /** Names of the jobs whose last run errored (capped). */
  failedNames: string[]
}

/** The structured, honest digest. Null/empty cases are handled by the caller. */
export interface AwayDigest {
  /** The lastSeenAt the digest was computed against (ms), for the card's copy. */
  sinceMs: number
  runs: AwayRunsSummary
  crons: AwayCronsSummary
}

export interface AwayDigestInputs {
  /** The sessions list the app already loaded (newest-first or any order). */
  sessions: SessionSummary[]
  /** The cron jobs list the app already loaded. */
  jobs: CronJob[]
  /** The previously-stored last-seen timestamp (ms), or null on first visit. */
  lastSeenAt: number | null
  /** The current time (ms); injectable for deterministic tests. */
  now: number
}

/** Unix seconds → ms. */
function secToMs(seconds: number): number {
  return seconds * 1000
}

/**
 * Whether a session is in a TERMINAL (finished, not live) state. The gateway
 * computes `is_active` as "ended_at IS NULL and last activity within ~5m", so a
 * non-active session is the honest "this run is done" signal; the list summary
 * carries no `ended_at` of its own. A still-active session is excluded (it has
 * not finished, so it is not catch-up news).
 */
function isTerminalSession(s: SessionSummary): boolean {
  return s.is_active !== true
}

/** Parse an ISO timestamp to ms, or null when absent/unparseable. */
function isoToMs(iso: string | null): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

/** A trimmed human title, or null when there is nothing meaningful to show. */
function cleanTitle(title: string | null): string | null {
  const t = (title ?? '').trim()
  return t.length > 0 ? t : null
}

/**
 * Compute the honest away-digest, or null when there is nothing to surface.
 *
 * Returns null when: it is the first visit (no `lastSeenAt`), the absence is
 * shorter than {@link AWAY_THRESHOLD_MS}, or nothing terminal/cron happened in
 * the window. Otherwise it returns the structured counts (and never an
 * approvals/notifications field, which have no honest source).
 */
export function computeAwayDigest({
  sessions,
  jobs,
  lastSeenAt,
  now,
}: AwayDigestInputs): AwayDigest | null {
  // First-ever visit: there is nothing to catch up on.
  if (lastSeenAt === null) return null
  // Too short an absence (a refresh / an active session): stay quiet.
  if (now - lastSeenAt < AWAY_THRESHOLD_MS) return null

  // --- Runs: terminal sessions whose last activity is after last seen. ---
  const finished = sessions
    .filter((s) => isTerminalSession(s) && secToMs(s.last_active) > lastSeenAt)
    // Newest-finished first, so the sample + the deep-link id favour the most
    // recent run regardless of the input order.
    .sort((a, b) => b.last_active - a.last_active)

  let completed = 0
  let failed = 0
  const completedTitles: string[] = []
  const failedTitles: string[] = []
  for (const s of finished) {
    if (isFailedSession(s)) {
      failed += 1
      const t = cleanTitle(s.title)
      if (t && failedTitles.length < SAMPLE_LIMIT) failedTitles.push(t)
    } else {
      completed += 1
      const t = cleanTitle(s.title)
      if (t && completedTitles.length < SAMPLE_LIMIT) completedTitles.push(t)
    }
  }

  const runs: AwayRunsSummary = {
    total: finished.length,
    completed,
    failed,
    completedTitles,
    failedTitles,
    latestId: finished.length > 0 ? finished[0]!.id : null,
  }

  // --- Crons: jobs whose most recent run landed after last seen. ---
  let cronOk = 0
  let cronError = 0
  let cronTotal = 0
  const failedNames: string[] = []
  for (const j of jobs) {
    const ran = isoToMs(j.lastRunAt)
    if (ran === null || ran <= lastSeenAt) continue
    cronTotal += 1
    if (j.lastStatus === 'ok') cronOk += 1
    else if (j.lastStatus === 'error') {
      cronError += 1
      if (failedNames.length < SAMPLE_LIMIT) failedNames.push(j.name)
    }
    // 'skipped' (and a null status on a job that nonetheless reports a run time)
    // count toward the total but are neither a success nor a failure.
  }

  const crons: AwayCronsSummary = {
    total: cronTotal,
    ok: cronOk,
    error: cronError,
    failedNames,
  }

  // Nothing real to report → render nothing.
  if (runs.total === 0 && crons.total === 0) return null

  return { sinceMs: lastSeenAt, runs, crons }
}

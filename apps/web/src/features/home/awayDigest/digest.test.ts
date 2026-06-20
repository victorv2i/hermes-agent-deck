import { describe, it, expect } from 'vitest'
import { computeAwayDigest, AWAY_THRESHOLD_MS } from './digest'
import type { SessionSummary } from '@/features/sessions/types'
import type { CronJob } from '@/features/jobs/types'

/**
 * The pure digest helper is the honesty spine of "While you were away": every
 * count it returns must trace to real history. These tests pin the since-last-visit
 * window, the completed/failed and ok/error splits, and the suppression rules
 * (first visit, below-threshold, nothing-to-report) that keep it quiet.
 *
 * Timeline convention (mirrors the helper): `lastSeenAt`/`now` are unix ms
 * (Date.now). Session timestamps are unix SECONDS (state.db native), cron
 * `lastRunAt` is an ISO string. The helper normalizes both onto the ms timeline.
 */

const HOUR = 60 * 60 * 1000
const SEC = 1000

// A fixed "now" so the windows are deterministic.
const NOW = Date.UTC(2026, 5, 16, 12, 0, 0) // 2026-06-16T12:00:00Z (ms)
// "Last seen" two hours ago, comfortably past the threshold.
const LAST_SEEN = NOW - 2 * HOUR

/** A session summary with sane defaults; override per-case. */
function session(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    id: 's1',
    source: 'cron',
    model: 'gpt-5',
    title: 'A scheduled run',
    preview: '',
    started_at: Math.floor((NOW - 3 * HOUR) / SEC),
    last_active: Math.floor((NOW - HOUR) / SEC),
    message_count: 4,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    cost_usd: null,
    is_active: false,
    status: 'completed',
    end_reason: 'completed',
    handoff_state: null,
    ...overrides,
  }
}

/** A cron job with sane defaults; override per-case. */
function job(overrides: Partial<CronJob>): CronJob {
  return {
    id: 'j1',
    name: 'Nightly digest',
    prompt: 'summarize',
    schedule: { kind: 'interval', display: 'every 30m', expr: null, minutes: 30, runAt: null },
    enabled: true,
    paused: false,
    profile: 'default',
    deliver: 'local',
    noAgent: false,
    createdAt: null,
    nextRunAt: null,
    lastRunAt: new Date(NOW - HOUR).toISOString(),
    lastStatus: 'ok',
    lastError: null,
    runCount: 10,
    repeatTimes: null,
    ...overrides,
  }
}

describe('computeAwayDigest', () => {
  describe('suppression', () => {
    it('returns null on the first-ever visit (no stored lastSeenAt)', () => {
      const digest = computeAwayDigest({
        sessions: [session({})],
        jobs: [job({})],
        lastSeenAt: null,
        now: NOW,
      })
      expect(digest).toBeNull()
    })

    it('returns null when the absence is below the threshold (a quick refresh)', () => {
      const recent = NOW - (AWAY_THRESHOLD_MS - 60_000) // just under the threshold
      const digest = computeAwayDigest({
        sessions: [session({})],
        jobs: [job({})],
        lastSeenAt: recent,
        now: NOW,
      })
      expect(digest).toBeNull()
    })

    it('returns null when there is nothing to report since last visit', () => {
      // Everything terminal happened BEFORE last seen, so nothing is new.
      const old = Math.floor((LAST_SEEN - HOUR) / SEC)
      const digest = computeAwayDigest({
        sessions: [session({ last_active: old })],
        jobs: [job({ lastRunAt: new Date(LAST_SEEN - HOUR).toISOString() })],
        lastSeenAt: LAST_SEEN,
        now: NOW,
      })
      expect(digest).toBeNull()
    })

    it('returns null when both lists are empty', () => {
      const digest = computeAwayDigest({ sessions: [], jobs: [], lastSeenAt: LAST_SEEN, now: NOW })
      expect(digest).toBeNull()
    })
  })

  describe('runs since last visit', () => {
    it('counts a completed session whose last activity is after last seen', () => {
      const digest = computeAwayDigest({
        sessions: [session({ id: 'done-1', title: 'Backup', status: 'completed' })],
        jobs: [],
        lastSeenAt: LAST_SEEN,
        now: NOW,
      })
      expect(digest).not.toBeNull()
      expect(digest!.runs.completed).toBe(1)
      expect(digest!.runs.failed).toBe(0)
      expect(digest!.runs.total).toBe(1)
    })

    it('counts a failed session via status/end_reason tokens', () => {
      const digest = computeAwayDigest({
        sessions: [
          session({ id: 'bad-1', title: 'Crawl', status: 'failed', end_reason: 'error' }),
          session({ id: 'bad-2', title: 'Sync', status: 'error', end_reason: null }),
        ],
        jobs: [],
        lastSeenAt: LAST_SEEN,
        now: NOW,
      })
      expect(digest!.runs.failed).toBe(2)
      expect(digest!.runs.completed).toBe(0)
      expect(digest!.runs.failedTitles).toEqual(['Crawl', 'Sync'])
    })

    it('excludes a session that is still active (not terminal)', () => {
      const digest = computeAwayDigest({
        sessions: [session({ id: 'live', is_active: true, status: 'running', end_reason: null })],
        jobs: [],
        lastSeenAt: LAST_SEEN,
        now: NOW,
      })
      expect(digest).toBeNull()
    })

    it('excludes a terminal session that finished before last seen', () => {
      const before = Math.floor((LAST_SEEN - 10 * 60_000) / SEC)
      const digest = computeAwayDigest({
        sessions: [session({ id: 'old', last_active: before })],
        jobs: [],
        lastSeenAt: LAST_SEEN,
        now: NOW,
      })
      expect(digest).toBeNull()
    })

    it('keeps a few finished titles for display (capped) and de-nulls missing titles', () => {
      const many = Array.from({ length: 6 }, (_, i) =>
        session({ id: `done-${i}`, title: i === 0 ? null : `Run ${i}`, status: 'completed' }),
      )
      const digest = computeAwayDigest({
        sessions: many,
        jobs: [],
        lastSeenAt: LAST_SEEN,
        now: NOW,
      })
      expect(digest!.runs.completed).toBe(6)
      // A capped, non-empty sample of human titles; the untitled one is dropped (not "null").
      expect(digest!.runs.completedTitles.length).toBeGreaterThan(0)
      expect(digest!.runs.completedTitles.length).toBeLessThanOrEqual(3)
      expect(digest!.runs.completedTitles).not.toContain('null')
      expect(digest!.runs.completedTitles.every((t) => typeof t === 'string' && t.length > 0)).toBe(
        true,
      )
    })

    it('carries the most recent finished session id so the card can link to it', () => {
      const older = session({
        id: 'older',
        last_active: Math.floor((NOW - 90 * 60_000) / SEC),
        status: 'completed',
      })
      const newer = session({
        id: 'newer',
        last_active: Math.floor((NOW - 10 * 60_000) / SEC),
        status: 'completed',
      })
      const digest = computeAwayDigest({
        sessions: [older, newer],
        jobs: [],
        lastSeenAt: LAST_SEEN,
        now: NOW,
      })
      expect(digest!.runs.latestId).toBe('newer')
    })
  })

  describe('cron jobs since last visit', () => {
    it('counts an ok job run after last seen', () => {
      const digest = computeAwayDigest({
        sessions: [],
        jobs: [job({ id: 'ok-1', lastStatus: 'ok' })],
        lastSeenAt: LAST_SEEN,
        now: NOW,
      })
      expect(digest!.crons.ok).toBe(1)
      expect(digest!.crons.error).toBe(0)
      expect(digest!.crons.total).toBe(1)
    })

    it('counts an errored job run and keeps its name', () => {
      const digest = computeAwayDigest({
        sessions: [],
        jobs: [
          job({ id: 'err-1', name: 'Zillow watch', lastStatus: 'error', lastError: 'boom' }),
          job({ id: 'ok-1', name: 'Healthy', lastStatus: 'ok' }),
        ],
        lastSeenAt: LAST_SEEN,
        now: NOW,
      })
      expect(digest!.crons.error).toBe(1)
      expect(digest!.crons.ok).toBe(1)
      expect(digest!.crons.failedNames).toEqual(['Zillow watch'])
    })

    it('counts a skipped run in the total but not in ok/error', () => {
      const digest = computeAwayDigest({
        sessions: [],
        jobs: [job({ id: 'skip-1', lastStatus: 'skipped' })],
        lastSeenAt: LAST_SEEN,
        now: NOW,
      })
      expect(digest!.crons.total).toBe(1)
      expect(digest!.crons.ok).toBe(0)
      expect(digest!.crons.error).toBe(0)
    })

    it('excludes a job that has never run (null lastRunAt)', () => {
      const digest = computeAwayDigest({
        sessions: [],
        jobs: [job({ id: 'virgin', lastRunAt: null, lastStatus: null })],
        lastSeenAt: LAST_SEEN,
        now: NOW,
      })
      expect(digest).toBeNull()
    })

    it('excludes a job whose last run predates last seen', () => {
      const digest = computeAwayDigest({
        sessions: [],
        jobs: [job({ id: 'stale', lastRunAt: new Date(LAST_SEEN - HOUR).toISOString() })],
        lastSeenAt: LAST_SEEN,
        now: NOW,
      })
      expect(digest).toBeNull()
    })

    it('ignores an unparseable lastRunAt rather than counting it', () => {
      const digest = computeAwayDigest({
        sessions: [],
        jobs: [job({ id: 'bad-ts', lastRunAt: 'not-a-date' })],
        lastSeenAt: LAST_SEEN,
        now: NOW,
      })
      expect(digest).toBeNull()
    })
  })

  describe('combined', () => {
    it('reports runs and crons together and surfaces lastSeenAt back', () => {
      const digest = computeAwayDigest({
        sessions: [
          session({ id: 'c1', status: 'completed' }),
          session({ id: 'f1', status: 'failed', end_reason: 'error', title: 'Broken' }),
        ],
        jobs: [
          job({ id: 'jo', lastStatus: 'ok' }),
          job({ id: 'je', lastStatus: 'error', name: 'Failing job' }),
        ],
        lastSeenAt: LAST_SEEN,
        now: NOW,
      })
      expect(digest!.runs.completed).toBe(1)
      expect(digest!.runs.failed).toBe(1)
      expect(digest!.crons.ok).toBe(1)
      expect(digest!.crons.error).toBe(1)
      expect(digest!.sinceMs).toBe(LAST_SEEN)
    })

    it('NEVER fabricates an approvals field (honesty: gateway has no such endpoint)', () => {
      const digest = computeAwayDigest({
        sessions: [session({ status: 'completed' })],
        jobs: [],
        lastSeenAt: LAST_SEEN,
        now: NOW,
      })
      expect(digest as object).not.toHaveProperty('approvals')
      expect(digest as object).not.toHaveProperty('pendingApprovals')
      expect(digest as object).not.toHaveProperty('notifications')
    })
  })
})

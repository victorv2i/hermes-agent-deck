/**
 * Pure helper that distills the EXISTING data hooks into the plain-language
 * "what your agent is tending" summary the Home strip shows. Kept pure +
 * unit-tested so the strip's honest degrade-when-Hermes-is-down behaviour is
 * exercisable without mounting react-query.
 *
 * HONESTY (the spine): every fact reflects a real check — a count is shown ONLY
 * when it is non-zero, and NOTHING is reported when the dashboard is unreachable
 * (status === undefined). The connection tone is a SEMANTIC status (ok / warn /
 * idle), never the amber action accent.
 */
import type { AgentDeckStatus, CronJob, KanbanBoardResponse } from '@agent-deck/protocol'

/** The (already-fetched) inputs the summary composes from existing hooks. */
export interface TendingInputs {
  /** Cross-source status (GET /api/status), or undefined when unreachable. */
  status: AgentDeckStatus | undefined
  /**
   * Lower-level health probe reachability (GET /api/agent-deck/health). Used only
   * as a fallback when the detailed dashboard status is unavailable; it proves the
   * Hermes gateway is reachable but does NOT provide platform/session facts.
   */
  hermesReachable?: boolean
  /** The cron job list, or undefined while loading. */
  jobs: CronJob[] | undefined
  /** The kanban board availability response, or undefined (plugin/loading). */
  board: KanbanBoardResponse | undefined
  /**
   * Unanswered approval gates in chats THIS deck carries (the live `/chat-run`
   * socket sees approval.request/responded only for runs started here). Honest
   * scope: it can never count approvals from Telegram/CLI runs, so the summary
   * surfaces a count when one is waiting and claims nothing when it is zero.
   */
  pendingApprovals?: number
  /** Render-time clock (injectable for deterministic tests). */
  now: number
}

/** A semantic connection headline — tone is a STATUS color, never amber. */
export interface TendingConnection {
  label: string
  tone: 'ok' | 'warn' | 'idle'
}

export interface TendingSummary {
  connection: TendingConnection
  /** Plain-language activity facts; empty when there is nothing real to tend. */
  facts: string[]
  /** True when connected but with no real activity to report (calm empty state). */
  idle: boolean
  /**
   * Unanswered approvals in chats started HERE (deck-carried runs only — see
   * {@link TendingInputs.pendingApprovals}). 0/absent = no line is shown; the
   * strip never claims "all clear" for runs it cannot see (Telegram/CLI).
   */
  needsOk?: number
}

/** The honest copy for the "needs your OK" line — shared by the strip and its
 * tests so the scope claim ("chats started here") can't drift. */
export const NEEDS_OK_COPY = {
  /** count → the visible line ("a chat here needs your OK"). */
  line: (count: number) =>
    count === 1 ? 'a chat here needs your OK' : `${count} chats here need your OK`,
  /** The plain-language scope note (tooltip): deck-carried chats only. */
  scope: 'Covers chats started here. Runs from Telegram or the command line do not show here.',
} as const

/** Count of scheduled (enabled, not paused) jobs — the things being watched. */
function countScheduled(jobs: CronJob[]): number {
  return jobs.filter((j) => j.enabled && !j.paused).length
}

/** Count of jobs whose most recent run landed on the same calendar day as `now`. */
function countRanToday(jobs: CronJob[], now: number): number {
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)
  const dayStart = startOfDay.getTime()
  return jobs.filter((j) => {
    if (!j.lastRunAt) return false
    const ts = Date.parse(j.lastRunAt)
    return Number.isFinite(ts) && ts >= dayStart && ts <= now
  }).length
}

/** Count of cards in the kanban `running` column (work in progress). */
function countWip(board: KanbanBoardResponse | undefined): number {
  if (!board || !board.available) return 0
  const running = board.data.columns.find((c) => c.name === 'running')
  return running ? running.cards.length : 0
}

/** "N thing" / "N things" — singularize when the count is exactly 1. */
function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`
}

/**
 * Distill the live status + jobs + board into the warm, honest tending summary.
 * When detailed `status` is undefined, a reachable health fallback may still say
 * "Connected" but it reports no detailed facts; without that proof the summary is
 * a calm offline state.
 */
export function summarizeTending({
  status,
  hermesReachable,
  jobs,
  board,
  pendingApprovals,
  now,
}: TendingInputs): TendingSummary {
  // An unanswered approval rides EVERY branch: it comes from the deck's own
  // live chat socket, so it is true (and actionable) even when the dashboard
  // status is unavailable.
  const needsOk = pendingApprovals ?? 0

  // Detailed status unavailable. If the lower-level health probe proves the
  // Hermes gateway is reachable, keep the connection copy aligned with the
  // header/health truth but report NO detailed facts (health does not carry them).
  if (status === undefined) {
    if (hermesReachable === true) {
      return { connection: { label: 'Connected', tone: 'ok' }, facts: [], idle: false, needsOk }
    }
    return {
      connection: { label: 'Hermes is offline', tone: 'idle' },
      facts: [],
      idle: false,
      needsOk,
    }
  }

  const list = jobs ?? []
  const facts: string[] = []

  const scheduled = countScheduled(list)
  if (scheduled > 0) facts.push(`watching ${plural(scheduled, 'schedule', 'schedules')}`)

  const ranToday = countRanToday(list, now)
  if (ranToday > 0) facts.push(`${plural(ranToday, 'job', 'jobs')} ran today`)

  const active = status.activeSessions
  if (active > 0) facts.push(`${plural(active, 'active session', 'active sessions')}`)

  const wip = countWip(board)
  if (wip > 0) facts.push(`${plural(wip, 'task in progress', 'tasks in progress')}`)

  return {
    connection: connectionHeadline(status),
    facts,
    idle: facts.length === 0,
    needsOk,
  }
}

/** The semantic connection headline from the gateway + per-platform fleet. */
function connectionHeadline(status: AgentDeckStatus): TendingConnection {
  if (!status.gatewayRunning) {
    return { label: 'Hermes is not running', tone: 'warn' }
  }
  const troubled = status.platforms.filter(
    (p) => p.state === 'degraded' || p.state === 'down',
  ).length
  if (troubled > 0) {
    return { label: 'Connected · a platform needs attention', tone: 'warn' }
  }
  return { label: 'Connected', tone: 'ok' }
}

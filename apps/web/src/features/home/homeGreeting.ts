/**
 * Compose the Home hero SUBHEAD as the agent speaking in FIRST PERSON, folding ONE
 * real fact from the EXISTING tending summary into a warm while-you-were-away line —
 * e.g. "While you were away I finished 2 jobs." (the headline above it already says
 * "Welcome back", so the subhead must not repeat the phrase). When there is no
 * real, non-zero fact to share (idle, offline, or no summary yet) the helper
 * degrades to the calm static front-door copy. NOTHING is ever fabricated: every
 * spoken fact is lifted from a real `tendingSummary` fact the route already vetted.
 *
 * Kept pure + unit-tested so the honest "speak only when there's something real"
 * behaviour is exercisable without mounting the hero.
 */
import type { TendingSummary } from './tendingSummary'

/**
 * The recognized tending facts, in priority order — the FIRST one present wins,
 * preferring the most "while you were away" relevant news (finished work first,
 * then in-flight work, then what's being watched). Each maps the existing fact's
 * leading count to a first-person clause. The `count` group captures the number so
 * the clause inherits the summary's already-correct singular/plural wording.
 */
const FIRST_PERSON_FACTS: { match: RegExp; clause: (count: string, rest: string) => string }[] = [
  // "3 jobs ran today" / "1 job ran today" → "I finished 3 jobs"
  {
    match: /^(\d+) (jobs? ran today)$/,
    clause: (n) => `I finished ${n} ${n === '1' ? 'job' : 'jobs'}`,
  },
  // "2 tasks in progress" / "1 task in progress" → "I have 2 tasks in progress"
  { match: /^(\d+) (tasks? in progress)$/, clause: (n, rest) => `I have ${n} ${rest}` },
  // "1 active session" / "3 active sessions" → "I have 3 active sessions going"
  { match: /^(\d+) (active sessions?)$/, clause: (n, rest) => `I have ${n} ${rest} going` },
  // "watching 2 schedules" / "watching 1 schedule" → "I'm watching 2 schedules"
  { match: /^watching (\d+) (schedules?)$/, clause: (n, rest) => `I'm watching ${n} ${rest}` },
]

/** The calm static front-door copy, used when the agent has nothing real to share. */
export function staticGreeting(friendly: string | null): string {
  return friendly
    ? `Chat with ${friendly}, follow along as it works, and pick up any session. This is your agent's home base.`
    : "Chat with your Hermes agent, follow along as it works, and pick up any session. Your agent's home base."
}

/**
 * Build the hero subhead. For a RETURNING (onboarded) user, when `tending` carries a
 * recognized real fact the agent speaks it first-person ("While you were away I
 * finished 2 jobs."); otherwise the calm static copy is returned. On a genuine
 * FIRST run (`onboarded === false`) the subhead is ALWAYS the static intro copy —
 * a "while you were away" line there would contradict the "Meet {name}" headline even
 * when the agent already ran a cron job before first open. `friendly` is the agent's
 * display name (or null for the unnamed default) — it only flavours the static copy.
 */
export function composeGreeting(
  friendly: string | null,
  tending: TendingSummary | undefined,
  onboarded = true,
): string {
  if (!onboarded) return staticGreeting(friendly)
  const clause = firstPersonClause(tending)
  if (!clause) return staticGreeting(friendly)
  return `While you were away ${clause}.`
}

/** The first-person clause for the highest-priority real fact, or null when none. */
function firstPersonClause(tending: TendingSummary | undefined): string | null {
  if (!tending || tending.facts.length === 0) return null
  for (const { match, clause } of FIRST_PERSON_FACTS) {
    for (const fact of tending.facts) {
      const m = fact.match(match)
      if (m) return clause(m[1]!, m[2]!)
    }
  }
  return null
}

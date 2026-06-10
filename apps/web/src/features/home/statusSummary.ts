/**
 * Pure helpers that distill the live status + usage payloads into the FEW
 * numbers the Home status strip shows (spec §2.3: "3-4 numbers ONLY"). Kept
 * pure + unit-tested so the strip's degrade-when-unreachable behaviour is
 * exercisable without mounting react-query.
 */
import type { AgentDeckStatus } from '@agent-deck/protocol'
import type { UsageSummary } from '@/features/usage/types'
import { formatTokens, formatCost } from '@/lib/format'

/** Roll the per-platform connection states into a single fleet headline. */
export interface FleetSummary {
  /** Platforms reporting a healthy `connected` state. */
  connected: number
  /** Platforms reporting `degraded` or `down`. */
  troubled: number
  /** Total platforms reported. */
  total: number
}

export function summarizeFleet(status: AgentDeckStatus | undefined): FleetSummary {
  const platforms = status?.platforms ?? []
  let connected = 0
  let troubled = 0
  for (const p of platforms) {
    if (p.state === 'connected') connected += 1
    else if (p.state === 'degraded' || p.state === 'down') troubled += 1
  }
  return { connected, troubled, total: platforms.length }
}

/**
 * A one-line usage snapshot for the strip, e.g. "25.5K tokens · $0.63 · 8
 * sessions · last 7 days". The time window suffix gives the numbers context so
 * they do not float without meaning. Cost is omitted when it rounds to nothing
 * (`formatCost` returns null) so the line never shows a wall of "$0.00".
 * Returns null when there's no usage at all (so the strip can stay calm).
 */
export function summarizeUsageLine(usage: UsageSummary | undefined): string | null {
  // Guard `totals` too: a degraded/empty API response can deserialize to an
  // object with no `totals`, which would crash on `totals.inputTokens`.
  if (!usage || !usage.totals) return null
  const { totals, periodDays } = usage
  const totalTokens = totals.inputTokens + totals.outputTokens
  if (totalTokens === 0 && totals.sessions === 0) return null

  const parts: string[] = [`${formatTokens(totalTokens)} tokens`]
  const cost = formatCost(totals.estimatedCost)
  if (cost) parts.push(cost)
  if (totals.sessions > 0) {
    parts.push(`${totals.sessions} ${totals.sessions === 1 ? 'session' : 'sessions'}`)
  }
  // Always append the window so numbers have context for cost decisions.
  parts.push(`last ${periodDays} days`)
  return parts.join(' · ')
}

/** Short, human version label (drops a leading "v" duplicate if present). */
export function formatVersion(version: string | undefined): string | null {
  const v = version?.trim()
  if (!v) return null
  return v.startsWith('v') ? v : `v${v}`
}

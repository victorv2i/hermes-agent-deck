/**
 * SessionBreakdown — the Usage page's per-session drill-down: sessions active in
 * the selected window, ranked by total tokens (desc), each linking back to its
 * conversation at `/chat/:id`.
 *
 * SOURCE + HONESTY: rows come from the SAME dashboard sessions API the deck
 * already serves (`GET /api/agent-deck/sessions` → state.db `sessions` rows —
 * the very table the Usage analytics SUM over, so the numbers share one source
 * of truth). Two honest caveats are surfaced, not hidden:
 *  - a session's token/cost figures are WHOLE-SESSION totals; a session that
 *    started before the window carries tokens from before it (the dashboard has
 *    no per-window slice per session), so the caption says so;
 *  - the route fetches a deep recency slice (see UsageRoute's fetch limit), but
 *    a fetch that comes back FULL means older in-window sessions may exist
 *    beyond it, possibly bigger than anything fetched. In that state the
 *    caption scopes the ranking claim to "your N most recently active sessions"
 *    and the overflow line stops calling hidden rows "smaller" (we cannot know
 *    that). Under the limit, the fetched set is the whole window and the plain
 *    "ranked by total tokens" claim is fully true.
 * Cost cells show real dollars when recorded; under a flat subscription they
 * say "included" (never a fake $0), and an unresolved billing signal shows
 * "not recorded" rather than implying free.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CHAT_PATH } from '@/app/navigation'
import { formatCost, formatRelative, formatTokens, formatTokensFull } from '@/lib/format'
import type { SessionSummary } from '@/features/sessions/types'

/** Cap the table at a readable depth; the rest is acknowledged by count. */
const MAX_ROWS = 12

export interface SessionBreakdownProps {
  /** The selected Usage window, in days. */
  periodDays: number
  /** Session rows from the sessions BFF (most recently active first). */
  sessions?: SessionSummary[]
  /** The limit `sessions` was fetched with. A full fetch (rows >= limit) means
   * the window may extend beyond what was fetched, so the caption scopes its
   * ranking claim honestly. Omitted → the rows are treated as complete. */
  fetchLimit?: number
  isLoading?: boolean
  error?: Error | null
  /** The period's server-derived billing mode (drives the honest cost cell). */
  billingMode?: string
  /** Injectable clock (unix seconds) so tests are deterministic. */
  nowSeconds?: number
}

/** The honest cost cell: real dollars > "included" (subscription) > honest absence. */
function costLabel(cost: number | null, billingMode: string | undefined): string {
  const real = formatCost(cost)
  if (real) return real
  if (billingMode === 'subscription') return 'included'
  if (billingMode === 'local') return 'no billed cost'
  return 'not recorded'
}

/** A session's display name: its title, else its preview head, else its id. */
function sessionLabel(s: SessionSummary): string {
  const title = s.title?.trim()
  if (title) return title
  const preview = s.preview?.trim()
  if (preview) return preview
  return s.id
}

export function SessionBreakdown({
  periodDays,
  sessions,
  fetchLimit,
  isLoading = false,
  error = null,
  billingMode,
  nowSeconds,
}: SessionBreakdownProps) {
  // The window anchor: the injected test clock, else the mount time (a lazy
  // initializer keeps render pure; per-second drift is irrelevant at day scale).
  const [mountNow] = useState(() => Math.floor(Date.now() / 1000))
  const now = nowSeconds ?? mountNow
  const windowStart = now - periodDays * 86_400

  const inWindow = useMemo(() => {
    if (!Array.isArray(sessions)) return []
    return sessions
      .filter((s) => s.last_active >= windowStart && (s.total_tokens > 0 || s.message_count > 0))
      .slice()
      .sort((a, b) => b.total_tokens - a.total_tokens)
  }, [sessions, windowStart])

  const rows = inWindow.slice(0, MAX_ROWS)
  const overflow = inWindow.length - rows.length
  // A fetch that came back full may have cut the window off: older in-window
  // sessions can exist beyond the fetched recency slice, and any of them could
  // out-token everything fetched. In that state the caption scopes the ranking
  // claim to the fetched set and the overflow line drops "smaller".
  const truncated =
    typeof fetchLimit === 'number' && Array.isArray(sessions) && sessions.length >= fetchLimit

  return (
    <Card className="ad-raised">
      <CardHeader>
        <CardTitle>By session</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="py-8 text-center text-sm text-muted-foreground" role="status">
            Couldn&rsquo;t load sessions. The hermes dashboard may be offline.
          </p>
        ) : isLoading ? (
          <div className="flex flex-col gap-2" aria-hidden>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-9 animate-pulse rounded-lg bg-surface-2/60" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No sessions with activity in this period.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0 text-13">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th scope="col" className="pb-2 pr-3 font-medium">
                      Session
                    </th>
                    <th scope="col" className="pb-2 pr-3 text-right font-medium">
                      Tokens in
                    </th>
                    <th scope="col" className="pb-2 pr-3 text-right font-medium">
                      Tokens out
                    </th>
                    <th scope="col" className="pb-2 pr-3 text-right font-medium">
                      Est. cost
                    </th>
                    <th scope="col" className="pb-2 pr-3 text-right font-medium">
                      Messages
                    </th>
                    <th scope="col" className="pb-2 text-right font-medium">
                      Last activity
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id} data-testid="session-usage-row" className="align-baseline">
                      <td className="max-w-[260px] truncate py-1.5 pr-3">
                        <Link
                          to={`${CHAT_PATH}/${encodeURIComponent(s.id)}`}
                          title={sessionLabel(s)}
                          className="text-foreground underline-offset-2 hover:underline focus-visible:ad-focus"
                        >
                          {sessionLabel(s)}
                        </Link>
                      </td>
                      <td
                        className="py-1.5 pr-3 text-right tabular-nums"
                        title={`${formatTokensFull(s.input_tokens)} input tokens`}
                      >
                        {formatTokens(s.input_tokens)}
                      </td>
                      <td
                        className="py-1.5 pr-3 text-right tabular-nums"
                        title={`${formatTokensFull(s.output_tokens)} output tokens`}
                      >
                        {formatTokens(s.output_tokens)}
                      </td>
                      <td className="py-1.5 pr-3 text-right text-muted-foreground tabular-nums">
                        {costLabel(s.cost_usd, billingMode)}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{s.message_count}</td>
                      <td className="py-1.5 text-right whitespace-nowrap text-muted-foreground">
                        {formatRelative(s.last_active)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-foreground-tertiary">
              {truncated
                ? `Sessions active in the last ${periodDays} days, ranked by total tokens among your ${fetchLimit} most recently active sessions.`
                : `Sessions active in the last ${periodDays} days, ranked by total tokens.`}{' '}
              Figures are whole-session totals from your agent&rsquo;s records, so a session that
              started before this window includes its earlier tokens.
              {overflow > 0
                ? truncated
                  ? ` ${overflow} more sessions are not shown.`
                  : ` ${overflow} smaller sessions are not shown.`
                : ''}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

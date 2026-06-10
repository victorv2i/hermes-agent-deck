import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRestartGateway } from './useSystem'
import { START_AGENT_COPY } from './startAgentCopy'

/**
 * How long the "started" report stays up before the mutation resets and the
 * button returns. If the recovery was real the gating probes (invalidated by
 * `useRestartGateway`) unmount this component well before then; if the agent
 * flapped back down, the chip must not sit forever next to a contradicting
 * "not running" notice with no retry affordance.
 */
const STARTED_RESET_MS = 30_000

/**
 * One-click recovery for a down Hermes gateway, shared by the chat unreachable
 * notice and Home's offline tending headline. REUSES the Maintenance dock's
 * restart machinery (the same `useRestartGateway` mutation the System page and
 * the command palette fire); no second restart path exists.
 *
 * Honesty contract:
 *  - The pending copy claims only that a start was asked for.
 *  - "Started" is the BFF's RE-PROBED `running` state, never the click itself.
 *    The surfaces then recover from their own REAL probes (invalidated by
 *    `useRestartGateway` at the hook level, so the nudge lands even if this
 *    button unmounts mid-restart), and the notice clears from fresh reads, not
 *    a faked local success. The started report itself is transient: if the
 *    agent flaps back down, the mutation resets after ~30s and the button
 *    honestly returns.
 *  - A failed call, or a re-probe that is not `running`, says so plainly and
 *    points at the System page, the deeper maintenance path.
 *
 * GATING IS THE CALLER'S JOB: render this only when the deck's own server has
 * answered a probe AND that answer says the agent is down. When the BFF itself
 * is unreachable the restart POST cannot land, so the caller keeps the honest
 * no-action copy instead.
 *
 * Inline-only markup (span/button/anchor) so it can sit inside a one-line
 * notice or the tending strip's <p> headline.
 */
export function StartAgentButton({ className }: { className?: string }) {
  const restart = useRestartGateway()
  const reported = restart.data?.status
  const started = reported === 'running'
  const failed = restart.isError || (reported !== undefined && !started)

  // Treat the started report as TRANSIENT. On real recovery the caller's gate
  // unmounts this component long before the timer fires (the invalidated probes
  // re-read within seconds); if it is still mounted at 30s the agent flapped
  // back down, so reset to the actionable button instead of pinning a stale
  // "reports running" next to a down notice.
  const reset = restart.reset
  useEffect(() => {
    if (!started) return
    const timer = setTimeout(() => {
      reset()
    }, STARTED_RESET_MS)
    return () => clearTimeout(timer)
  }, [started, reset])

  const start = () => {
    if (restart.isPending) return
    // The recovery invalidations live in `useRestartGateway` itself (hook-level
    // onSuccess), so they run even if this button unmounts mid-restart.
    restart.mutate()
  }

  if (started) {
    return (
      <span
        data-testid="start-agent-started"
        role="status"
        className={cn('text-muted-foreground', className)}
      >
        {START_AGENT_COPY.started}
      </span>
    )
  }

  return (
    <span
      data-testid="start-agent"
      className={cn('inline-flex flex-wrap items-center gap-x-2 gap-y-1', className)}
    >
      <button
        type="button"
        onClick={start}
        disabled={restart.isPending}
        data-testid="start-agent-button"
        className="inline-flex items-center gap-1.5 rounded font-medium text-foreground underline-offset-2 hover:underline focus-visible:ad-focus disabled:pointer-events-none disabled:opacity-60"
      >
        {restart.isPending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
        {START_AGENT_COPY.action}
      </button>
      {restart.isPending ? (
        <span role="status" className="text-muted-foreground">
          {START_AGENT_COPY.pending}
        </span>
      ) : failed ? (
        <span role="alert" className="text-destructive">
          {START_AGENT_COPY.failureLead}{' '}
          <Link
            to="/system"
            className="font-medium underline-offset-2 hover:underline focus-visible:ad-focus"
          >
            {START_AGENT_COPY.failureLink}
          </Link>{' '}
          {START_AGENT_COPY.failureTail}
        </span>
      ) : null}
    </span>
  )
}

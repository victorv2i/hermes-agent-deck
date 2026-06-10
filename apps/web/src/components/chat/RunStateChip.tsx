import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/state/useChatStore'
import {
  deriveRunState,
  formatSince,
  lastSignalAt,
  RUN_STATE_LABEL,
  RUN_STATE_DETAIL,
  type LiveRunState,
} from '@/state/runState'
import type { ConnectionStatus } from '@/lib/chatSocket'

/**
 * The honest live run-state chip (chat header). Answers the #1 "is my agent
 * still doing anything?" question with ONLY what the deck truly observes:
 *
 *  - working           — a real event arrived in the last 10s
 *  - thinking          — events are quiet but the stream's keepalives prove life
 *  - waiting_approval  — the run is intentionally paused on the user's OK
 *  - maybe_stalled     — no event AND no keepalive for 120s+ (soft claim; the
 *                        existing Stop control is the action)
 *  - offline           — the socket is terminally down (matches the header dot)
 *
 * It DISAPPEARS when no run is active — idle is not a status. Calm by design:
 * muted for the healthy states; the amber `warning` tone only when something
 * waits on (or may need) the user; `destructive` only for offline, matching the
 * established error tone. The full honest sentence (plus "last signal Xs ago"
 * when known) rides the tooltip and the accessible label.
 */

/** tone classes per bucket — semantic tokens only, never the action accent. */
const STATE_TONE: Record<Exclude<LiveRunState, null>, string> = {
  working: 'bg-muted text-muted-foreground',
  thinking: 'bg-muted text-muted-foreground',
  waiting_approval: 'bg-warning/12 text-warning',
  maybe_stalled: 'bg-warning/12 text-warning',
  offline: 'bg-destructive/10 text-destructive',
}

/** Presentational chip — pure render from the derived bucket (unit-tested per
 * state). Renders NOTHING for the idle/null bucket. */
export function RunStateChip({
  state,
  signalAt,
  now,
}: {
  state: LiveRunState
  /** Epoch ms of the freshest observed signal (event or heartbeat), or null. */
  signalAt: number | null
  /** Render clock (epoch ms) for the "last signal" detail. */
  now: number
}) {
  if (state === null) return null
  const since = formatSince(signalAt, now)
  // The honest tooltip detail: the full sentence, plus the last-signal age when
  // we have one and it is informative (it always is for the quiet states).
  const detail =
    since && state !== 'waiting_approval' && state !== 'offline'
      ? `${RUN_STATE_DETAIL[state]} Last signal ${since}.`
      : RUN_STATE_DETAIL[state]
  return (
    <span
      data-testid="run-state-chip"
      data-state={state}
      role="status"
      // The accessible label is STABLE per bucket (no per-second age) so the
      // polite status region announces only real state changes, never a ticking
      // clock. The age detail lives in the hover tooltip.
      aria-label={RUN_STATE_DETAIL[state]}
      title={detail}
      className={cn(
        'inline-flex h-5 max-w-[18ch] shrink-0 items-center gap-1.5 truncate rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap',
        STATE_TONE[state],
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0 rounded-full bg-current',
          // A quiet motion-safe pulse only while genuinely alive (working /
          // thinking) — never on the states that wait on the user or are down.
          (state === 'working' || state === 'thinking') && 'motion-safe:animate-pulse',
        )}
      />
      <span className="truncate">{RUN_STATE_LABEL[state]}</span>
    </span>
  )
}

/** How often the connected chip re-derives while a run is active. The buckets
 * move on 10s/120s boundaries, so a 1s tick is plenty and cheap (one interval,
 * chip-local re-render only). */
const TICK_MS = 1_000

/**
 * Connected chip: subscribes to the chat store's observed facts and re-derives
 * the bucket on a single 1s interval WHILE a run is active (no timers when
 * idle). Self-contained so its per-second tick re-renders only this tiny
 * component, never the chat surface.
 */
export function LiveRunStateChip({ connection }: { connection: ConnectionStatus }) {
  const runStatus = useChatStore((s) => s.runStatus)
  const hasPendingApproval = useChatStore((s) => s.pendingApproval !== null)
  const lastEventAt = useChatStore((s) => s.lastEventAt)
  const lastHeartbeatAt = useChatStore((s) => s.lastHeartbeatAt)

  // The render clock. Ticks only while a run is active; frozen (and unused —
  // the chip renders nothing) when idle. A stale clock at run start is harmless:
  // the fresh lastEventAt then reads as "recent" (working), exactly right for a
  // run that just produced an event, and the first tick trues it up.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (runStatus === 'idle') return
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [runStatus])

  const state = deriveRunState({
    runStatus,
    hasPendingApproval,
    lastEventAt,
    lastHeartbeatAt,
    connection,
    now,
  })
  return (
    <RunStateChip
      state={state}
      signalAt={lastSignalAt({ lastEventAt, lastHeartbeatAt })}
      now={now}
    />
  )
}

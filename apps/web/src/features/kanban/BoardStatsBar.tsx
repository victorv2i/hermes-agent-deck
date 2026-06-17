import { Loader2, ListChecks, Clock } from 'lucide-react'
import type { KanbanStats } from '@agent-deck/protocol'
import { formatDuration } from './format'

/**
 * BoardStatsBar — a slim queue-health strip under the board header. It answers the
 * question RunControls raises ("Queued, every worker is busy"): how many workers
 * are running, how deep the ready queue is, and how long the oldest ready task has
 * waited. Sourced from the live `/stats` read.
 *
 * Honest + calm: renders NOTHING on an idle board (no running or ready work) so it
 * never adds noise, and shows the "oldest waiting" line only when something is
 * actually queued. The running spinner is a sanctioned live/active accent use.
 */
export function BoardStatsBar({ stats }: { stats: KanbanStats | null }) {
  if (!stats) return null
  const running = stats.byStatus.running ?? 0
  const ready = stats.byStatus.ready ?? 0
  // Nothing in flight and nothing waiting: stay out of the way.
  if (running === 0 && ready === 0) return null
  const oldestWait = ready > 0 ? formatDuration(stats.oldestReadyAgeSeconds) : null

  return (
    <div
      data-testid="board-stats-bar"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-1.5 text-xs text-muted-foreground"
    >
      {running > 0 && (
        <span className="flex items-center gap-1.5 text-foreground">
          <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden />
          {running} running
        </span>
      )}
      {ready > 0 && (
        <span className="flex items-center gap-1.5">
          <ListChecks className="size-3.5" aria-hidden />
          {ready} ready
        </span>
      )}
      {oldestWait && (
        <span className="flex items-center gap-1.5">
          <Clock className="size-3.5" aria-hidden />
          oldest waiting {oldestWait}
        </span>
      )}
    </div>
  )
}

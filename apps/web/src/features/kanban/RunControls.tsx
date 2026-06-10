/**
 * RunControls — the orchestration panel inside the {@link TaskDrawer}. This is the
 * flagship of the Kanban surface: the board doesn't just SHOW work, it DRIVES it.
 * Every control here maps onto a REAL stock kanban-plugin route; nothing is faked.
 *
 * The HONESTY spine of this panel (load-bearing): hermes has NO route that sets a
 * task to `running` directly (the bulk route refuses it: "use the dispatcher/claim
 * path"). So "Run task" is a TWO-STEP truth -- move the card to `ready`, then nudge
 * the dispatcher. The dispatcher spawns a worker on its next pass WHEN a profile has
 * capacity; it is best-effort, not an instant guarantee. The button copy + the
 * result toast say exactly that ("Queued to run" / "Started N task(s)" /
 * "Queued -- every worker is busy"), never a fake "Running now".
 *
 * Controls, each gated to when its backing route can succeed:
 *   - Run task      (ready-able columns)         -> move-to-ready + dispatch
 *   - Stop          (running, with a live runId)  -> terminate the run
 *   - Reassign      (any non-done task)           -> reassign profile (+reclaim when running)
 *
 * Accent governance: the ONE accent here is the primary "Run task" action and the
 * running-state pulse; Stop is the semantic destructive variant; reassign is neutral.
 */
import { useState } from 'react'
import { Loader2, Play, Square, UserCog } from 'lucide-react'
import type { KanbanCard, KanbanTask } from '@agent-deck/protocol'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { useReassignTask, useRunTask, useTerminateRun } from './hooks'

export interface RunControlsProps {
  /** The slim card (always present -- backs the controls while detail loads). */
  card: KanbanCard
  /** The full task detail when loaded (carries the run history for the runId). */
  task: KanbanTask | undefined
  /** Board slug the task lives on (threaded through every write). */
  board?: string
  /** Known assignees on the board, offered as quick reassign targets. */
  assignees?: string[]
}

/** Columns from which a task can be MADE READY (and thus run). A running or done
 *  task is excluded; `blocked` is included (making it ready clears the block). */
const RUNNABLE_COLUMNS = new Set(['triage', 'todo', 'scheduled', 'ready', 'blocked', 'review'])

/** The active (unended) run id for a task, when it is running -- the terminate key. */
function activeRunId(card: KanbanCard, task: KanbanTask | undefined): number | null {
  if (card.column !== 'running') return null
  // The drawer's full run history is the source of truth; fall back to the card's
  // embedded worker (board enrichment) when detail hasn't loaded yet.
  const fromRuns = task?.runs.find((r) => r.endedAt === null)?.id
  if (typeof fromRuns === 'number') return fromRuns
  return card.worker?.id ?? null
}

export function RunControls({ card, task, board, assignees = [] }: RunControlsProps) {
  const run = useRunTask(board)
  const stop = useTerminateRun(board)
  const reassign = useReassignTask(board)
  const [reassignOpen, setReassignOpen] = useState(false)

  const isRunning = card.column === 'running'
  const isDone = card.column === 'done'
  const runId = activeRunId(card, task)
  const canRun = RUNNABLE_COLUMNS.has(card.column) && !isRunning
  // Stop is only honest when we actually hold a live run id to terminate.
  const canStop = isRunning && runId !== null
  const busy = run.isPending || stop.isPending || reassign.isPending

  function handleRun() {
    run.mutate(
      { id: card.id },
      {
        onSuccess: (result) => {
          const started = result.spawnedIds.includes(card.id) || result.spawned > 0
          if (started) {
            toast.success('Started the task', {
              description:
                result.spawned > 1 ? `${result.spawned} tasks picked up this pass.` : undefined,
            })
          } else {
            toast.info('Queued to run', {
              description: 'Every worker is busy -- the dispatcher will pick it up shortly.',
            })
          }
        },
        onError: (err) => {
          toast.error('Could not run the task', {
            description: err instanceof Error ? err.message : undefined,
          })
        },
      },
    )
  }

  function handleStop() {
    if (runId === null) return
    stop.mutate(
      { id: card.id, input: { runId } },
      {
        onSuccess: (result) => {
          if (result.ok) toast.success('Stopped the task')
          else toast.info('The run already ended', { description: result.error ?? undefined })
        },
        onError: (err) => {
          toast.error('Could not stop the task', {
            description: err instanceof Error ? err.message : undefined,
          })
        },
      },
    )
  }

  function handleReassign(profile: string) {
    setReassignOpen(false)
    if (profile === (card.assignee ?? '')) return
    reassign.mutate(
      // A running task must release its claim first, or the backend refuses.
      { id: card.id, input: { profile, reclaimFirst: isRunning } },
      {
        onSuccess: (result) => {
          toast.success(result.assignee ? `Reassigned to ${result.assignee}` : 'Unassigned')
        },
        onError: (err) => {
          toast.error('Could not reassign', {
            description: err instanceof Error ? err.message : undefined,
          })
        },
      },
    )
  }

  // A done task is terminal: no run/stop, only the (rare) reassign-for-retry is
  // omitted too -- the board's move control handles re-opening it. Render nothing.
  if (isDone) return null

  const reassignTargets = assignees.filter((a) => a !== card.assignee)

  return (
    <div data-testid="kanban-run-controls" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {canRun ? (
          <Button
            type="button"
            size="sm"
            onClick={handleRun}
            disabled={busy}
            data-testid="kanban-run-button"
          >
            {run.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Play className="size-3.5" aria-hidden />
            )}
            {run.isPending ? 'Starting...' : 'Run task'}
          </Button>
        ) : null}

        {canStop ? (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={handleStop}
            disabled={busy}
            data-testid="kanban-stop-button"
          >
            {stop.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Square className="size-3.5" aria-hidden />
            )}
            {stop.isPending ? 'Stopping...' : 'Stop'}
          </Button>
        ) : null}

        {/* Running but no live run id yet (detail still loading) -- be honest, don't
            offer a Stop that can't key a run. */}
        {isRunning && !canStop ? (
          <span className="text-[11.5px] text-foreground-tertiary">Locating the worker run...</span>
        ) : null}

        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setReassignOpen((o) => !o)}
          disabled={busy}
          aria-expanded={reassignOpen}
          data-testid="kanban-reassign-toggle"
        >
          {reassign.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <UserCog className="size-3.5" aria-hidden />
          )}
          Reassign
        </Button>
      </div>

      {reassignOpen ? (
        <ReassignPicker
          current={card.assignee}
          targets={reassignTargets}
          onPick={handleReassign}
          onCancel={() => setReassignOpen(false)}
        />
      ) : null}

      {/* The honest two-step note -- shown next to Run so the operator knows it's a
          dispatcher nudge, not an instant spawn. */}
      {canRun ? (
        <p className="text-[11px] leading-relaxed text-foreground-tertiary">
          Marks the task ready and nudges the dispatcher; a worker starts when a profile is free.
        </p>
      ) : null}
    </div>
  )
}

/**
 * ReassignPicker -- the inline reassign form. Quick chips for the board's known
 * assignees plus a free-text profile field (an unassign clears it). Selection rings
 * use the neutral strong border, never the accent (identity governance).
 */
function ReassignPicker({
  current,
  targets,
  onPick,
  onCancel,
}: {
  current: string | null
  targets: string[]
  onPick: (profile: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  const trimmed = value.trim()

  return (
    <form
      data-testid="kanban-reassign-picker"
      onSubmit={(e) => {
        e.preventDefault()
        onPick(trimmed)
      }}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2.5"
    >
      {targets.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {targets.map((profile) => (
            <button
              key={profile}
              type="button"
              onClick={() => onPick(profile)}
              className={cn(
                'inline-flex items-center rounded-md border border-border bg-surface-1 px-2 py-1 text-[11.5px] text-foreground',
                'transition-colors hover:border-[var(--border-strong)] hover:bg-muted',
                'focus-visible:ad-focus',
              )}
            >
              {profile}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <input
          aria-label="New worker profile"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={current ? `Reassign from ${current}...` : 'Profile name (blank = unassign)'}
          maxLength={200}
          className={cn(
            'min-w-0 flex-1 rounded-md border border-border bg-surface-1 px-2 py-1 text-[12px] text-foreground outline-none',
            'placeholder:text-foreground-tertiary',
            'focus-visible:border-ring focus-visible:ad-focus',
          )}
        />
        <Button type="submit" size="xs">
          {trimmed ? 'Reassign' : 'Unassign'}
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

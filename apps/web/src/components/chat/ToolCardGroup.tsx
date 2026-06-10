import { useState } from 'react'
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import type { ToolCall } from '@/state/chatStore'
import { ToolCard } from './ToolCard'

/**
 * A turn's tool calls, with a quiet "Expand all / Collapse all" affordance when
 * there's more than one. Each card stays independently toggleable; the group
 * control just sets a baseline that individual clicks can diverge from.
 *
 * Calm + governed: the control is a small, metadata-colored ghost button shown
 * only when it earns its place (2+ calls). Single-call turns render bare cards.
 */
export function ToolCardGroup({
  calls,
  defaultOpen,
}: {
  calls: ToolCall[]
  /** Seed every card open on mount (driven by the "Detailed" verbosity pref).
   * Deliberately does NOT seed the group `forced` baseline — that would flip the
   * "Expand all" button to "Collapse all" on first paint. */
  defaultOpen?: boolean
}) {
  // `null` = no group-baseline applied (cards keep their own state). A boolean
  // forces every card open/closed via a re-keyed render so a later individual
  // toggle is still free to diverge.
  const [forced, setForced] = useState<boolean | null>(null)
  const [epoch, setEpoch] = useState(0)

  if (calls.length === 0) return null

  const apply = (next: boolean) => {
    setForced(next)
    setEpoch((e) => e + 1)
  }

  return (
    <div className="flex flex-col gap-1">
      {calls.length > 1 && (
        <button
          type="button"
          onClick={() => apply(!(forced ?? false))}
          className="inline-flex min-h-11 items-center gap-1 self-start rounded-md px-2 text-[11px] text-foreground-tertiary transition-colors hover:bg-surface-2/60 hover:text-muted-foreground focus-visible:ad-focus sm:min-h-7 sm:px-1.5"
        >
          {forced ? (
            <>
              <ChevronsDownUp className="size-3" aria-hidden />
              Collapse all
            </>
          ) : (
            <>
              <ChevronsUpDown className="size-3" aria-hidden />
              Expand all
            </>
          )}
        </button>
      )}
      {calls.map((call, i) => (
        // Re-key on `epoch` so each "expand/collapse all" reseeds the card's
        // initial open state from the group baseline, while still letting an
        // individual click diverge afterwards.
        <ToolCardItem
          key={`${call.tool}-${i}-${epoch}`}
          call={call}
          initialOpen={forced ?? false}
          defaultOpen={defaultOpen ?? false}
        />
      ))}
    </div>
  )
}

/** One card seeded from the group baseline (or the verbosity default), then
 * independently toggleable. */
function ToolCardItem({
  call,
  initialOpen,
  defaultOpen,
}: {
  call: ToolCall
  initialOpen: boolean
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(initialOpen || defaultOpen)
  return <ToolCard call={call} open={open} onOpenChange={setOpen} />
}

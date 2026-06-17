import { ArrowRight, Cable } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusDot, type StatusTone } from '@/components/ui/StatusDot'

/**
 * StudioLaunchpad — the slim one-line launchpad strip at the top of the Studio
 * (Home). It keeps Home a daily landing: the agent's tending status (reusing the
 * existing status summary) on the left, and the global actions on the right —
 * a quiet "Connections" entry (Voice/Messaging/MCP apply to every agent, so this
 * status/action bar is their natural home) and the primary "Start a chat".
 * Deliberately minimal so the Studio (the roster + workbench) leads.
 *
 * Presentational: the status summary + the action callbacks arrive as props (the
 * route composes the status from the shared status hook). The connection dot uses
 * the governed semantic tone (never the sky-blue action accent); the facts are quiet
 * neutral text.
 */
export interface LaunchpadStatus {
  tone: StatusTone
  label: string
  /** Plain-language facts (e.g. "watching 2 schedules"), already composed. */
  facts: string[]
}

export interface StudioLaunchpadProps {
  /** The tending status summary, or undefined while the first read loads. */
  status: LaunchpadStatus | undefined
  /** Start a chat (lands on the Chat surface). */
  onStartChat: () => void
  /** Open the global Connections surface (Voice/Messaging/MCP — applies to all agents). */
  onOpenConnections: () => void
}

export function StudioLaunchpad({ status, onStartChat, onOpenConnections }: StudioLaunchpadProps) {
  return (
    <section
      aria-label="Studio launchpad"
      // Raised + the elevated surface step so the "Connected / watching ..."
      // strip reads as a present bar with real depth, not a flat sliver.
      className="ad-surface ad-raised flex min-h-13 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-surface-elevated px-4 py-3 text-sm"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {status ? (
          <>
            <StatusDot tone={status.tone} label={status.label} role="status" />
            <p className="min-w-0 truncate leading-snug text-foreground">
              <span className="font-medium">{status.label}</span>
              {status.facts.length > 0 && (
                // The verbose facts hide on narrow screens so the key status label
                // (e.g. "Connected") stays fully readable instead of clipping to
                // "Con..." next to the action buttons; they return at >=sm.
                <span className="text-muted-foreground max-sm:hidden">
                  {status.facts.map((fact) => (
                    <span key={fact}>
                      <span aria-hidden className="text-foreground-tertiary">
                        {' · '}
                      </span>
                      {fact}
                    </span>
                  ))}
                </span>
              )}
            </p>
          </>
        ) : (
          // No status yet (still loading or unreachable): keep the strip honest +
          // quiet rather than inventing a "Connected" claim.
          <span className="text-foreground-tertiary">Your agent</span>
        )}
      </div>

      <div className="flex shrink-0 basis-full items-center justify-end gap-1.5 sm:basis-auto">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onOpenConnections}
          data-icon="inline-start"
        >
          <Cable aria-hidden />
          Connections
        </Button>
        <Button type="button" size="sm" onClick={onStartChat} data-icon="inline-end">
          Start a chat
          <ArrowRight aria-hidden />
        </Button>
      </div>
    </section>
  )
}

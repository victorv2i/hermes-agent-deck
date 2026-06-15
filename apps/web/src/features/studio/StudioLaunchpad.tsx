import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusDot, type StatusTone } from '@/components/ui/StatusDot'

/**
 * StudioLaunchpad — the slim one-line launchpad strip at the top of the Studio
 * (Home). It keeps Home a daily landing: the agent's tending status (reusing the
 * existing status summary) on the left, and the single "Start a chat" action on
 * the right. Deliberately minimal so the Studio (the roster + workbench) leads.
 *
 * Presentational: the status summary + the `onStartChat` action arrive as props
 * (the route composes the status from the shared status hook). The connection dot
 * uses the governed semantic tone (never the amber action accent); the facts are
 * quiet neutral text.
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
}

export function StudioLaunchpad({ status, onStartChat }: StudioLaunchpadProps) {
  return (
    <section
      aria-label="Studio launchpad"
      className="ad-surface flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-card px-4 py-2.5 text-sm"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {status ? (
          <>
            <StatusDot tone={status.tone} label={status.label} role="status" />
            <p className="min-w-0 truncate leading-snug text-foreground">
              <span className="font-medium">{status.label}</span>
              {status.facts.length > 0 && (
                <span className="text-muted-foreground">
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

      <Button type="button" size="sm" onClick={onStartChat} data-icon="inline-end">
        Start a chat
        <ArrowRight aria-hidden />
      </Button>
    </section>
  )
}

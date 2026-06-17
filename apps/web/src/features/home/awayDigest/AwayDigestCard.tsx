import { CalendarClock, MessagesSquare, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AwayDigest } from './digest'

/**
 * AwayDigestCard: the calm, dismissible "While you were away" catch-up summary
 * shown at the top of the Studio (Home) when the operator returns after an
 * absence. It states REAL counts from history in plain language (finished chats,
 * scheduled jobs that ran, how many failed) and links each to the surface where
 * the detail lives (the session transcript, the jobs page).
 *
 * Presentational by design: the computed {@link AwayDigest} + the nav/dismiss
 * callbacks arrive as props (the {@link useAwayDigest} hook + the StudioRoute wire
 * them), so the surface is testable hermetically. It is INFORMATIONAL, so it
 * stays quiet: a raised panel with a single sky-blue accent on its actions, never
 * a loud banner. When the digest has nothing real to report it renders nothing.
 *
 * HONESTY: there is no approvals/notifications/cost line. The card shows only the
 * two slices the gateway can truthfully back (finished runs, cron runs).
 */
export interface AwayDigestCardProps {
  digest: AwayDigest
  /** Dismiss the card for this return (the hook persists the dismissal). */
  onDismiss: () => void
  /** Open a finished run's transcript (the most-recently-finished session). */
  onOpenSession: (id: string) => void
  /** Open the Jobs page (to review the cron runs / failures). */
  onOpenJobs: () => void
}

/** "1 chat" / "2 chats" (singularize at exactly one). */
function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`
}

export function AwayDigestCard({
  digest,
  onDismiss,
  onOpenSession,
  onOpenJobs,
}: AwayDigestCardProps) {
  const { runs, crons } = digest
  // Defensive: the hook only renders this when there is something to report, but
  // keep the guard so a stray empty digest never paints an empty card.
  if (runs.total === 0 && crons.total === 0) return null

  const hasRuns = runs.total > 0
  const hasCrons = crons.total > 0

  return (
    <section
      aria-label="While you were away"
      // Raised, squared (rounded-md), compact: it reads as a gentle on-return note
      // with real depth, not a loud alert. The single sky-blue accent lives on the
      // action buttons only (governed: the action accent is never decoration).
      className="ad-surface ad-raised relative flex flex-col gap-2.5 rounded-md bg-surface-elevated px-4 py-3 text-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-heading text-sm font-medium text-foreground">While you were away</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Dismiss"
          className="-mt-1 -mr-1.5 shrink-0"
        >
          <X aria-hidden />
        </Button>
      </div>

      <ul className="flex flex-col gap-2">
        {hasRuns && (
          <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <MessagesSquare
              className="size-4 shrink-0 text-foreground-tertiary"
              aria-hidden
            />
            <span className="text-foreground">
              {plural(runs.total, 'chat finished', 'chats finished')}
              {runs.failed > 0 && (
                <span className="text-muted-foreground">
                  {' '}
                  ({plural(runs.failed, 'failed', 'failed')})
                </span>
              )}
            </span>
            {runs.latestId && (
              <Button
                type="button"
                variant="link"
                size="xs"
                className="px-0"
                onClick={() => onOpenSession(runs.latestId as string)}
              >
                View chats
              </Button>
            )}
          </li>
        )}

        {hasCrons && (
          <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <CalendarClock className="size-4 shrink-0 text-foreground-tertiary" aria-hidden />
            <span className="text-foreground">
              {plural(crons.total, 'scheduled job ran', 'scheduled jobs ran')}
              {crons.error > 0 && (
                <span className="text-muted-foreground">
                  {' '}
                  ({plural(crons.error, 'failed', 'failed')})
                </span>
              )}
            </span>
            <Button
              type="button"
              variant="link"
              size="xs"
              className="px-0"
              onClick={onOpenJobs}
            >
              Review jobs
            </Button>
          </li>
        )}
      </ul>
    </section>
  )
}

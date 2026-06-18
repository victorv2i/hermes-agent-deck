import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { RUNGS, type Rung } from './onboardingState'

/** Human labels + the one-line intent for each rung's header. */
const RUNG_META: Record<Rung, { step: string; title: string; lede: string }> = {
  detect: {
    step: 'Detect',
    title: 'Find Hermes',
    lede: 'Agentdeck is a calm way to see and talk to the Hermes agent running on your machine.',
  },
  connect: {
    step: 'Connect',
    title: 'Connect a model',
    lede: 'Give your agent a brain: connect a provider so it can think.',
  },
  identity: {
    step: 'Identity',
    title: 'Give your agent a face',
    lede: 'This is your existing "default" agent: give it a face and an optional nickname for the app. Its model, memory, and personality stay exactly as they are. Everything saves locally.',
  },
  chat: {
    step: 'First chat',
    title: 'Say hello',
    lede: "Send the first message. When your agent replies, you're set up.",
  },
}

/**
 * RungChrome - the shared full-screen scaffold every rung renders inside: a
 * centered card with a quiet step indicator, the rung's title + lede, the rung
 * body, and a footer with Back, the rung's primary action (passed as
 * `primary`), and the always-present quiet skip fast-path. The skip is a
 * LINK-styled button (never the sky-blue action accent) so the rung's real action
 * stays the single sky-blue affordance.
 */
export function RungChrome({
  rung,
  children,
  primary,
  onBack,
  onSkip,
}: {
  rung: Rung
  children: ReactNode
  /** The rung's primary action node (e.g. the sky-blue Continue button). */
  primary: ReactNode
  /** Go to the previous rung; omitted/undefined on the first rung. */
  onBack?: () => void
  /** The quiet skip fast-path (always present). */
  onSkip: () => void
}) {
  const meta = RUNG_META[rung]
  const index = RUNGS.indexOf(rung)

  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-start overflow-y-auto px-4 py-6 sm:justify-center sm:px-5 sm:py-10">
      <div className="ad-enter ad-surface w-full max-w-lg min-w-0 rounded-xl bg-card p-6 text-card-foreground sm:p-8">
        {/* Quiet step indicator - dots, the current one on the identity ring
            (border-strong), NEVER the sky-blue action accent. */}
        <ol className="mb-6 flex items-center gap-2" aria-label="Setup progress">
          {RUNGS.map((r, i) => {
            const done = i < index
            const current = i === index
            return (
              <li key={r} className="flex items-center gap-2">
                <span
                  aria-current={current ? 'step' : undefined}
                  className={cn(
                    'size-2 rounded-full transition-colors',
                    done && 'bg-foreground-tertiary',
                    current &&
                      'bg-foreground ring-2 ring-[var(--border-strong)] ring-offset-2 ring-offset-card',
                    !done && !current && 'bg-surface-2',
                  )}
                />
                <span className="sr-only">
                  {RUNG_META[r].step}
                  {current ? ' (current)' : done ? ' (done)' : ''}
                </span>
              </li>
            )
          })}
          <li className="ml-1 text-xs text-foreground-tertiary" aria-hidden>
            Step {index + 1} of {RUNGS.length}
          </li>
        </ol>

        <header className="mb-5">
          <p className="ad-section-label mb-1 text-foreground-tertiary">{meta.step}</p>
          <h1 className="font-heading text-xl leading-snug font-medium [overflow-wrap:anywhere]">
            {meta.title}
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            {meta.lede}
          </p>
        </header>

        <div className="grid gap-4">{children}</div>

        {/* The footer stacks VERTICALLY by default (primary full-width on top) so
            no button is clipped off-screen on narrow phones (≤390px); it only
            switches to the side-by-side row at ≥512px (`min-[512px]:`) where there's
            room. The secondary cluster wraps so Back + Skip never overflow either. */}
        <footer className="mt-7 flex flex-col gap-3 min-[512px]:flex-row min-[512px]:items-center min-[512px]:justify-between">
          <div className="order-2 flex min-w-0 flex-wrap items-center gap-1 min-[512px]:order-1">
            {onBack && (
              // ≥40px secondary control: h-10 with comfortable padding.
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onBack}
                className="h-10 px-3 text-sm"
              >
                Back
              </Button>
            )}
            {/* The honest fast-path - a quiet link, never the sky-blue action. >=40px hit
                area while staying a quiet link visually. */}
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={onSkip}
              className="h-10 px-3 text-sm text-muted-foreground hover:text-foreground"
            >
              Skip setup for now
            </Button>
          </div>
          <div className="order-1 flex w-full items-center gap-2 min-[512px]:order-2 min-[512px]:w-auto [&>button]:w-full min-[512px]:[&>button]:w-auto">
            {primary}
          </div>
        </footer>
      </div>
    </div>
  )
}

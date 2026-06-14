import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useOnboarded } from '@/lib/useOnboarded'
import { useSetupStatus } from './useSetupStatus'
import { isSetupComplete, shouldShowWizard } from './onboardingState'

// The first-run wizard (and its animation deps, including framer-motion via the
// HatchCeremony) is lazy-loaded so it stays OFF the eager entry path: a returning,
// already-onboarded user never downloads it. The gate's own probe-driven decision
// is cheap and stays eager; only the heavy full-screen takeover defers behind
// Suspense, which a first-run user crosses once.
const OnboardingWizard = lazy(() =>
  import('./OnboardingWizard').then((m) => ({ default: m.OnboardingWizard })),
)

/**
 * OnboardingGate — wraps the App shell and decides, from the REAL setup-status
 * probe, whether a first-run user sees the "Wake your agent" wizard instead of
 * the shell. Mounted ahead of the shell in App.tsx.
 *
 * Safety properties (spec):
 *  - The gate is driven by the probe, NOT the `useOnboarded` localStorage bit —
 *    which is used ONLY as a "don't show again" suppressor.
 *  - It FAILS OPEN: an unreachable probe (or a still-loading one) renders the
 *    shell, so a returning user is NEVER trapped behind a wizard.
 *  - The wizard is a full-screen takeover (the shell is not mounted behind it),
 *    so exactly one live `/chat-run` socket exists at a time.
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const [onboarded, markOnboarded] = useOnboarded()
  const [dismissedForNow, setDismissedForNow] = useState(false)
  // Only poll while the suppressor is off — a returning user never re-probes.
  const { status, refetch, isFetching } = useSetupStatus({ enabled: !onboarded })

  const show = !dismissedForNow && shouldShowWizard({ status, onboarded })

  // Dismissing the wizard sets the for-now suppressor. But if every PROBE rung is
  // already satisfied (the user finished setup and hit "Finish later" before the
  // chat ever streamed a token), the only thing left is the un-probeable first
  // chat — so persist the onboarded bit too. Otherwise Home keeps showing the
  // first-run framing forever, since the bit is normally written by the first
  // streamed token (which never came). Fails closed: only marks when setup is
  // genuinely complete; a mid-setup "Skip for now" still leaves a resume action.
  const handleDismiss = () => {
    setDismissedForNow(true)
    if (status && isSetupComplete(status)) markOnboarded()
  }

  // The wizard auto-closes the instant the probe reports all three rungs done
  // (shouldShowWizard → false), which can happen BEFORE the first chat ever
  // streams a token (the only other thing that sets `onboarded`). Without this,
  // a user who completed every setup step in the wizard lands back on Home's
  // first-run framing indefinitely. So when the wizard we WERE showing closes
  // because setup just became complete, persist the bit — same effect as a
  // "Finish later" tap on the now-complete chat rung. Tracked via a ref so we
  // only fire on the show→hide-by-completion transition (never for a returning,
  // already-set-up user who never saw the wizard).
  const wasShownRef = useRef(false)
  useEffect(() => {
    const completed = status != null && isSetupComplete(status)
    if (wasShownRef.current && !onboarded && completed && !dismissedForNow) {
      markOnboarded()
    }
    wasShownRef.current = show
  }, [show, status, onboarded, dismissedForNow, markOnboarded])

  const showResume =
    dismissedForNow &&
    !onboarded &&
    status !== null &&
    status !== undefined &&
    !isSetupComplete(status)

  // `show` is only ever true when `status` is a real SetupStatus (the gate's
  // contract: null/undefined → fail open / hold), so this is safe.
  if (show && status) {
    return (
      <Suspense
        fallback={
          <div className="fixed inset-0 z-50 grid place-items-center bg-background">
            <Loader2
              className="size-6 animate-spin text-muted-foreground"
              aria-label="Loading setup"
            />
          </div>
        }
      >
        <OnboardingWizard
          status={status}
          onRecheck={() => void refetch()}
          rechecking={isFetching}
          onMarkOnboarded={markOnboarded}
          onDismiss={handleDismiss}
        />
      </Suspense>
    )
  }
  return (
    <>
      {children}
      {showResume ? (
        <div className="fixed inset-x-4 bottom-4 z-50 sm:left-auto sm:w-full sm:max-w-sm">
          <div className="ad-surface rounded-xl bg-card px-4 py-3 text-sm shadow-lg">
            <p className="font-medium text-foreground">Setup is not finished</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Agent Deck is open, but your agent still needs setup before everything works.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setDismissedForNow(false)
                  void refetch()
                }}
              >
                Resume setup
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void refetch()}
                disabled={isFetching}
              >
                <RefreshCw className={isFetching ? 'animate-spin' : undefined} aria-hidden />
                Re-check
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

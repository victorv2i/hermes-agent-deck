import { useCallback, useEffect, useRef, useState } from 'react'
import type { SetupStatus } from '@agent-deck/protocol'
import { DEFAULT_PALETTE_ID } from '@/features/themes/palette-registry'
import { useChatRun, toDotStatus } from '@/state/useChatRun'
import { RUNGS, firstUnfinishedRung, type Rung } from './onboardingState'
import { usePinPalette } from './usePinPalette'
import { useFirstToken } from './useFirstToken'
import { DetectRung } from './DetectRung'
import { ConnectRung } from './ConnectRung'
import { IdentityRung } from './IdentityRung'
import { FirstChatRung } from './FirstChatRung'

/**
 * OnboardingWizard — the full-screen 4-rung "Wake your agent" wizard. Shown by
 * the {@link OnboardingGate} when the REAL probe reports setup incomplete. It:
 *
 *  - PINS Clay & Sky (the owner's default) for the wizard's lifetime and restores
 *    the saved palette on exit (never clobbering it) via `usePinPalette`.
 *  - RESUMES on the first unfinished rung from the probe; the user can also step
 *    forward/back manually (the probe still gates "Continue").
 *  - owns the ONLY live `/chat-run` socket while it's up, for the real first chat.
 *  - fires `markOnboarded()` on the FIRST streamed token, which is what
 *    permanently closes the wizard.
 *
 * Every rung carries a quiet "Skip setup for now" fast-path. Skipping only
 * dismisses the takeover for now; it does NOT write the persistent completed bit.
 */
export function OnboardingWizard({
  status,
  onRecheck,
  rechecking,
  onMarkOnboarded,
  onDismiss,
}: {
  /** The latest REAL probe — drives rung completion + the resume point. */
  status: SetupStatus
  /** Force an immediate re-probe (Re-check buttons + post-key-add). */
  onRecheck: () => void
  /** True while a (re)probe is in flight (drives the Re-check spinner). */
  rechecking: boolean
  /** The persistent completed bit — fired on the first genuine streamed token. */
  onMarkOnboarded: () => void
  /** Dismiss this takeover without marking setup complete. */
  onDismiss: () => void
}) {
  // Pin the owner's default look for the wizard; restore their saved palette on
  // exit. Never persists, so a returning user's choice is untouched.
  usePinPalette(DEFAULT_PALETTE_ID)

  // The live socket — the wizard owns the ONLY one while it's mounted (the App
  // shell isn't rendered behind it), so the first chat is a genuine run.
  const { connection, send } = useChatRun()

  // The first genuine streamed token closes the wizard for good.
  useFirstToken(onMarkOnboarded)

  // The rung the user is viewing. Initialised to the probe's resume point; the
  // user can navigate, but "Continue" stays gated on the real probe.
  const [rung, setRung] = useState<Rung>(() => firstUnfinishedRung(status))

  // When the probe advances a rung the user is sitting on (e.g. they connected a
  // key elsewhere), auto-advance to the next gap so the wizard tracks
  // reality — but never yank them BACKWARD or past a rung they're mid-editing.
  const resume = firstUnfinishedRung(status)
  const lastResumeRef = useRef(resume)
  useEffect(() => {
    if (lastResumeRef.current !== resume) {
      lastResumeRef.current = resume
      // Only pull forward (never backward), and only when the current rung is now
      // satisfied — so a user typing on a later rung isn't interrupted.
      setRung((cur) => (RUNGS.indexOf(resume) > RUNGS.indexOf(cur) ? resume : cur))
    }
  }, [resume])

  const go = useCallback((next: Rung) => setRung(next), [])
  const back = useCallback((from: Rung) => {
    const i = RUNGS.indexOf(from)
    if (i > 0) setRung(RUNGS[i - 1] as Rung)
  }, [])

  const skip = onDismiss

  switch (rung) {
    case 'detect':
      return (
        <DetectRung
          installed={status.hermesInstalled}
          rechecking={rechecking}
          onRecheck={onRecheck}
          onContinue={() => go('connect')}
          onSkip={skip}
        />
      )
    case 'connect':
      return (
        <ConnectRung
          connected={status.providerConnected}
          rechecking={rechecking}
          onRecheck={onRecheck}
          onConnected={onRecheck}
          onContinue={() => go('identity')}
          onBack={() => back('connect')}
          onSkip={skip}
        />
      )
    case 'identity':
      return (
        <IdentityRung
          named={status.agentNamed}
          onContinue={() => {
            onRecheck()
            go('chat')
          }}
          onBack={() => back('identity')}
          onSkip={skip}
        />
      )
    case 'chat':
      return (
        <FirstChatRung
          connection={toDotStatus(connection)}
          onSend={send}
          onStarted={onRecheck}
          onBack={() => back('chat')}
          onSkip={skip}
        />
      )
  }
}

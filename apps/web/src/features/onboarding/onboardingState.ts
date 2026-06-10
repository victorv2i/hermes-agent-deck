/**
 * Onboarding rung gating — the PURE logic behind the first-run "Wake your agent"
 * wizard, kept free of React so the resume point, per-rung completion, and the
 * fail-open gate are unit-testable without a render.
 *
 * The four rungs map directly onto the REAL `SetupStatus` probe (each field a
 * genuine fs/exec check, never a remembered flag):
 *   detect   ← hermesInstalled
 *   connect  ← providerConnected
 *   identity ← agentNamed
 *   chat     ← (never probe-complete) the agent greets you; the FIRST streamed
 *              token fires markOnboarded(), which is what actually closes the
 *              wizard. The probe can't "see" a chat, so it never auto-completes
 *              this rung.
 */
import type { SetupStatus } from '@agent-deck/protocol'

/** The ordered rung sequence. The wizard resumes on the first unfinished one. */
export const RUNGS = ['detect', 'connect', 'identity', 'chat'] as const
export type Rung = (typeof RUNGS)[number]

/**
 * Whether a given rung is satisfied by the real probe. `chat` is intentionally
 * never probe-complete: the probe cannot observe a first chat, so closing the
 * wizard is owned by `markOnboarded()` (fired on the first streamed token), not
 * by this function.
 */
export function isRungComplete(rung: Rung, status: SetupStatus): boolean {
  switch (rung) {
    case 'detect':
      return status.hermesInstalled
    case 'connect':
      return status.providerConnected
    case 'identity':
      return status.agentNamed
    case 'chat':
      return false
  }
}

/**
 * The first unfinished rung — the wizard's resume point. Returns the FIRST rung
 * (in order) that the probe reports incomplete, so a half-set-up returning user
 * always lands on the earliest real gap (never skipping a missing earlier step
 * just because a later one happens to read true).
 */
export function firstUnfinishedRung(status: SetupStatus): Rung {
  for (const rung of RUNGS) {
    if (!isRungComplete(rung, status)) return rung
  }
  // Unreachable (chat never completes), but keep the function total.
  return 'chat'
}

/** True once every PROBE rung (detect/connect/identity) is satisfied. */
export function isSetupComplete(status: SetupStatus): boolean {
  return status.hermesInstalled && status.providerConnected && status.agentNamed
}

export interface ShouldShowWizardInput {
  /**
   * The probe result: a `SetupStatus` once known, `null` when the probe is
   * UNREACHABLE (fail open — never trap a returning user), `undefined` while the
   * first probe is still loading (hold the gate closed; no flash of wizard).
   */
  status: SetupStatus | null | undefined
  /** The localStorage "don't show again" suppressor (useOnboarded). */
  onboarded: boolean
}

/**
 * The probe-driven gate decision. The wizard shows ONLY when:
 *   - the user has not been onboarded (the suppressor is off), AND
 *   - the probe returned a real status (not loading, not unreachable), AND
 *   - that status reports setup incomplete.
 *
 * Fail-open is the safety property: an unreachable probe (`null`) or a still
 * onboarded user resolves to "don't show", so a returning user is never trapped
 * behind a wizard they can't dismiss.
 */
export function shouldShowWizard({ status, onboarded }: ShouldShowWizardInput): boolean {
  // The suppressor: once onboarded ("don't show again" / completed first chat),
  // the wizard never reappears regardless of the probe.
  if (onboarded) return false
  // Loading (undefined) or unreachable (null) → fail open / no flash.
  if (status == null) return false
  // A real probe: show only while genuine setup work remains.
  return !isSetupComplete(status)
}

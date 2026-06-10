import { describe, it, expect } from 'vitest'
import type { SetupStatus } from '@agent-deck/protocol'
import {
  RUNGS,
  firstUnfinishedRung,
  isRungComplete,
  shouldShowWizard,
  type Rung,
} from './onboardingState'

/** Build a SetupStatus with everything false, overriding the given fields. */
function status(over: Partial<SetupStatus> = {}): SetupStatus {
  return { hermesInstalled: false, providerConnected: false, agentNamed: false, ...over }
}

const allDone = status({ hermesInstalled: true, providerConnected: true, agentNamed: true })

describe('RUNGS', () => {
  it('is the ordered 4-rung sequence detect → connect → identity → chat', () => {
    expect(RUNGS).toEqual(['detect', 'connect', 'identity', 'chat'])
  })
})

describe('isRungComplete', () => {
  it('detect maps to hermesInstalled', () => {
    expect(isRungComplete('detect', status({ hermesInstalled: true }))).toBe(true)
    expect(isRungComplete('detect', status({ hermesInstalled: false }))).toBe(false)
  })

  it('connect maps to providerConnected', () => {
    expect(isRungComplete('connect', status({ providerConnected: true }))).toBe(true)
    expect(isRungComplete('connect', status({ providerConnected: false }))).toBe(false)
  })

  it('identity maps to agentNamed', () => {
    expect(isRungComplete('identity', status({ agentNamed: true }))).toBe(true)
    expect(isRungComplete('identity', status({ agentNamed: false }))).toBe(false)
  })

  it('chat is never "complete" from the probe — it completes only by a real first token', () => {
    // Even a fully-set probe leaves the chat rung open; markOnboarded (not the
    // probe) is what closes the wizard, so the probe must NOT auto-complete it.
    expect(isRungComplete('chat', allDone)).toBe(false)
  })
})

describe('firstUnfinishedRung — resume point', () => {
  it('returns detect when nothing is set up', () => {
    expect(firstUnfinishedRung(status())).toBe('detect')
  })

  it('skips to connect once hermes is installed', () => {
    expect(firstUnfinishedRung(status({ hermesInstalled: true }))).toBe('connect')
  })

  it('skips to identity once hermes + provider are ready', () => {
    expect(firstUnfinishedRung(status({ hermesInstalled: true, providerConnected: true }))).toBe(
      'identity',
    )
  })

  it('lands on the chat rung once the agent is named (the last, probe-incomplete rung)', () => {
    expect(firstUnfinishedRung(allDone)).toBe('chat')
  })

  it('does not skip a later-true rung when an earlier one is false (resume on the FIRST gap)', () => {
    // hermes missing but provider somehow reported: still resume at detect.
    const s = status({ hermesInstalled: false, providerConnected: true, agentNamed: true })
    expect(firstUnfinishedRung(s)).toBe('detect')
  })
})

describe('shouldShowWizard — the probe-driven gate (fail-open)', () => {
  it('shows the wizard when setup is incomplete and the user is not onboarded', () => {
    expect(shouldShowWizard({ status: status(), onboarded: false })).toBe(true)
    expect(shouldShowWizard({ status: status({ hermesInstalled: true }), onboarded: false })).toBe(
      true,
    )
  })

  it('does NOT show once every probe rung is complete (returning, fully-set-up user)', () => {
    expect(shouldShowWizard({ status: allDone, onboarded: false })).toBe(false)
  })

  it('the onboarded bit suppresses the wizard after true completion', () => {
    // After a completed first chat, markOnboarded() flips the bit; the gate then
    // stays closed regardless of the probe. "Skip setup for now" is intentionally
    // handled by OnboardingGate as a temporary dismissal, not this persistent bit.
    expect(shouldShowWizard({ status: status(), onboarded: true })).toBe(false)
    expect(shouldShowWizard({ status: status({ hermesInstalled: true }), onboarded: true })).toBe(
      false,
    )
  })

  it('FAILS OPEN: a null status (probe unreachable) never traps the user', () => {
    expect(shouldShowWizard({ status: null, onboarded: false })).toBe(false)
    expect(shouldShowWizard({ status: null, onboarded: true })).toBe(false)
  })

  it('a loading (undefined) status holds the gate closed so the shell renders, not a flash of wizard', () => {
    expect(shouldShowWizard({ status: undefined, onboarded: false })).toBe(false)
  })
})

const _exhaustive: Rung[] = [...RUNGS]
void _exhaustive

import { describe, it, expect } from 'vitest'
import { composeGreeting, staticGreeting } from './homeGreeting'
import type { TendingSummary } from './tendingSummary'

function tending(facts: string[], overrides: Partial<TendingSummary> = {}): TendingSummary {
  return {
    connection: { label: 'Connected', tone: 'ok' },
    facts,
    idle: facts.length === 0,
    ...overrides,
  }
}

describe('composeGreeting — first-person, real facts only', () => {
  it('folds completed jobs into a first-person "while you were away" line', () => {
    const line = composeGreeting('Sol', tending(['watching 2 schedules', '3 jobs ran today']))
    expect(line).toMatch(/^While you were away/i)
    // The headline already says "Welcome back"; the subhead must not repeat it.
    expect(line).not.toMatch(/welcome back/i)
    // Prefers the most "while you were away" relevant fact (finished work).
    expect(line).toContain('I finished 3 jobs')
  })

  it('stays STATIC for a first-run (not-onboarded) user even when a cron job already ran', () => {
    // Regression: a genuine first-run hero shows "Meet {name}", so its subhead must
    // not say "While you were away I finished N jobs" just because the agent ran a
    // cron job before first open. onboarded=false forces the intro copy.
    const line = composeGreeting('Sol', tending(['3 jobs ran today']), false)
    expect(line).toBe(staticGreeting('Sol'))
    expect(line).not.toMatch(/while you were away/i)
  })

  it('still speaks first-person for an onboarded user with the same real fact', () => {
    const line = composeGreeting('Sol', tending(['3 jobs ran today']), true)
    expect(line).toContain('I finished 3 jobs')
  })

  it('singularizes a single finished job', () => {
    expect(composeGreeting('Sol', tending(['1 job ran today']))).toContain('I finished 1 job')
  })

  it('speaks tasks-in-progress when that is the leading real fact', () => {
    const line = composeGreeting('Sol', tending(['2 tasks in progress']))
    expect(line).toContain('I have 2 tasks in progress')
  })

  it('speaks active sessions when that is the leading real fact', () => {
    const line = composeGreeting('Sol', tending(['1 active session']))
    expect(line).toContain('I have 1 active session going')
  })

  it('speaks watched schedules when that is the only real fact', () => {
    const line = composeGreeting('Sol', tending(['watching 1 schedule']))
    expect(line).toContain("I'm watching 1 schedule")
  })

  it('NEVER fabricates — degrades to calm static copy when there is nothing real (idle)', () => {
    const line = composeGreeting('Sol', tending([]))
    expect(line).toBe(staticGreeting('Sol'))
    expect(line).not.toMatch(/while you were away/i)
  })

  it('degrades to static copy when Hermes is offline (no facts)', () => {
    const line = composeGreeting(
      'Sol',
      tending([], { connection: { label: 'Hermes is offline', tone: 'idle' } }),
    )
    expect(line).toBe(staticGreeting('Sol'))
  })

  it('degrades to static copy when there is no summary yet (loading)', () => {
    expect(composeGreeting('Sol', undefined)).toBe(staticGreeting('Sol'))
  })

  it('uses the unnamed default static copy when there is no friendly name', () => {
    expect(composeGreeting(null, undefined)).toBe(staticGreeting(null))
    expect(staticGreeting(null)).toMatch(/your Hermes agent/i)
  })
})

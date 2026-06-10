import { describe, it, expect } from 'vitest'
import type { AgentDeckStatus } from '@agent-deck/protocol'
import type { UsageSummary } from '@/features/usage/types'
import { summarizeFleet, summarizeUsageLine, formatVersion } from './statusSummary'

function status(overrides: Partial<AgentDeckStatus> = {}): AgentDeckStatus {
  return {
    gatewayRunning: true,
    gatewayState: 'running',
    platforms: [
      { name: 'telegram', state: 'connected', error: null },
      { name: 'cron', state: 'connected', error: null },
      { name: 'cli', state: 'down', error: 'not started' },
    ],
    activeSessions: 1,
    version: '0.15.2',
    configUpdateAvailable: false,
    ...overrides,
  }
}

function usage(overrides: Partial<UsageSummary['totals']> = {}): UsageSummary {
  return {
    periodDays: 7,
    totals: {
      inputTokens: 20000,
      outputTokens: 5500,
      cacheReadTokens: 0,
      reasoningTokens: 0,
      estimatedCost: 0.63,
      actualCost: 0.4,
      sessions: 8,
      ...overrides,
    },
    daily: [],
    byModel: [],
  }
}

describe('summarizeFleet', () => {
  it('counts connected vs troubled platforms', () => {
    expect(summarizeFleet(status())).toEqual({ connected: 2, troubled: 1, total: 3 })
  })

  it('degrades to zeros when status is undefined (dashboard unreachable)', () => {
    expect(summarizeFleet(undefined)).toEqual({ connected: 0, troubled: 0, total: 0 })
  })
})

describe('summarizeUsageLine', () => {
  it('builds a one-line tokens · cost · sessions · window snapshot', () => {
    expect(summarizeUsageLine(usage())).toBe('25.5K tokens · $0.63 · 8 sessions · last 7 days')
  })

  it('omits a zero cost (never a wall of $0.00)', () => {
    expect(summarizeUsageLine(usage({ estimatedCost: 0 }))).toBe(
      '25.5K tokens · 8 sessions · last 7 days',
    )
  })

  it('singularizes a single session and still shows window', () => {
    expect(summarizeUsageLine(usage({ inputTokens: 10, outputTokens: 0, sessions: 1 }))).toMatch(
      /1 session · last 7 days$/,
    )
  })

  it('returns null when there is no usage at all (calm strip)', () => {
    expect(
      summarizeUsageLine(usage({ inputTokens: 0, outputTokens: 0, estimatedCost: 0, sessions: 0 })),
    ).toBeNull()
    expect(summarizeUsageLine(undefined)).toBeNull()
  })

  it('returns null (no crash) when a degraded payload arrives without totals', () => {
    // An error/empty API response can deserialize to {} with no `totals` — must
    // not throw on `totals.inputTokens`.
    expect(summarizeUsageLine({ periodDays: 7 } as never)).toBeNull()
    expect(summarizeUsageLine({} as never)).toBeNull()
  })

  it('adjusts window label for 14-day or 30-day periods', () => {
    const usage14 = {
      periodDays: 14,
      totals: {
        inputTokens: 1000,
        outputTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
        estimatedCost: 0,
        actualCost: 0,
        sessions: 2,
      },
      daily: [],
      byModel: [],
    }
    expect(summarizeUsageLine(usage14)).toBe('1K tokens · 2 sessions · last 14 days')
  })
})

describe('formatVersion', () => {
  it('prefixes a bare version with v', () => {
    expect(formatVersion('0.15.2')).toBe('v0.15.2')
  })
  it('keeps an existing v prefix', () => {
    expect(formatVersion('v0.15.2')).toBe('v0.15.2')
  })
  it('returns null for empty/undefined', () => {
    expect(formatVersion(undefined)).toBeNull()
    expect(formatVersion('  ')).toBeNull()
  })
})

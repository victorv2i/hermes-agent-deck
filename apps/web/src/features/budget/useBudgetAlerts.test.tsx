import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useBudgetAlerts } from './useBudgetAlerts'
import { setBudget } from './budgetStore'
import type { UsageDailyPoint, UsageSummary } from '@/features/usage/types'

const useUsageMock = vi.fn()
vi.mock('@/features/usage/useUsage', () => ({
  useUsage: (...args: unknown[]) => useUsageMock(...args),
}))

const warning = vi.fn()
vi.mock('@/lib/toast', () => ({
  toast: { warning: (...a: unknown[]) => warning(...a) },
}))

function day(over: Partial<UsageDailyPoint> & { day: string }): UsageDailyPoint {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    estimatedCost: 0,
    actualCost: 0,
    sessions: 0,
    ...over,
  }
}

function summary(daily: UsageDailyPoint[]): UsageSummary {
  return {
    periodDays: 1,
    totals: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      reasoningTokens: 0,
      estimatedCost: 0,
      actualCost: 0,
      sessions: 0,
    },
    daily,
    byModel: [],
  }
}

function Harness() {
  useBudgetAlerts()
  return null
}

function renderWatcher() {
  return render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  setBudget({ daily: null, monthly: null })
  localStorage.clear()
  warning.mockClear()
  useUsageMock.mockReturnValue({ data: undefined })
})

afterEach(() => {
  setBudget({ daily: null, monthly: null })
  localStorage.clear()
  vi.clearAllMocks()
})

describe('useBudgetAlerts', () => {
  // Today's UTC row, so the watcher's real-clock `detectBreaches` matches it.
  const todayIso = new Date().toISOString().slice(0, 10)

  it('does nothing when no budget is set', () => {
    useUsageMock.mockReturnValue({ data: summary([day({ day: todayIso, estimatedCost: 99 })]) })
    renderWatcher()
    expect(warning).not.toHaveBeenCalled()
  })

  it('raises one warning toast when today crosses the daily cap', () => {
    setBudget({ daily: 10 })
    useUsageMock.mockReturnValue({ data: summary([day({ day: todayIso, estimatedCost: 12.4 })]) })
    renderWatcher()
    expect(warning).toHaveBeenCalledTimes(1)
    const [message, opts] = warning.mock.calls[0]!
    expect(message).toMatch(/daily budget/i)
    expect(message).toMatch(/\$12\.40/)
    expect(message).toMatch(/cap \$10/)
    // Honest, non-blocking framing + a "Go to Usage" action.
    expect(opts.description).toMatch(/can.?t stop/i)
    expect(opts.action.label).toBe('Go to Usage')
  })

  it('does not re-warn the same breach on a re-render (once-per-session latch)', () => {
    setBudget({ daily: 10 })
    useUsageMock.mockReturnValue({ data: summary([day({ day: todayIso, estimatedCost: 12.4 })]) })
    const { rerender } = renderWatcher()
    rerender(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    )
    expect(warning).toHaveBeenCalledTimes(1)
  })

  it('warns for a monthly breach too', () => {
    setBudget({ monthly: 5 })
    useUsageMock.mockReturnValue({ data: summary([day({ day: todayIso, estimatedCost: 12 })]) })
    renderWatcher()
    expect(warning).toHaveBeenCalledTimes(1)
    expect(warning.mock.calls[0]![0]).toMatch(/monthly budget/i)
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { LiveBurnRate } from './LiveBurnRate'
import { setBudget } from '@/features/budget/budgetStore'
import type { UsageDailyPoint, UsageSummary } from './types'

// Drive the component's data deterministically by stubbing the query hook.
const useUsageMock = vi.fn()
vi.mock('./useUsage', () => ({
  useUsage: (...args: unknown[]) => useUsageMock(...args),
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

const NOW = new Date('2026-05-31T10:00:00Z')

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname}</div>
}

function renderPill() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="*" element={<LiveBurnRate now={NOW} />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  setBudget({ daily: null, monthly: null })
  localStorage.clear()
  useUsageMock.mockReturnValue({ data: undefined })
})

afterEach(() => {
  setBudget({ daily: null, monthly: null })
  localStorage.clear()
  vi.clearAllMocks()
})

describe('LiveBurnRate', () => {
  it("shows today's spend as a calm chip", () => {
    useUsageMock.mockReturnValue({
      data: summary([day({ day: '2026-05-31', estimatedCost: 4.32 })]),
    })
    renderPill()
    const pill = screen.getByTestId('burn-rate-pill')
    expect(pill).toHaveTextContent('$4.32')
    expect(pill).toHaveTextContent('today')
    // Calm at rest — not in the warned state.
    expect(pill).not.toHaveAttribute('data-warned')
  })

  it('renders nothing on an idle / $0 / unloaded day', () => {
    useUsageMock.mockReturnValue({ data: summary([day({ day: '2026-05-31', estimatedCost: 0 })]) })
    renderPill()
    expect(screen.queryByTestId('burn-rate-pill')).not.toBeInTheDocument()

    useUsageMock.mockReturnValue({ data: undefined })
    renderPill()
    expect(screen.queryByTestId('burn-rate-pill')).not.toBeInTheDocument()
  })

  it('enters the warned state when today crosses the daily budget', () => {
    setBudget({ daily: 4 })
    useUsageMock.mockReturnValue({
      data: summary([day({ day: '2026-05-31', estimatedCost: 4.32 })]),
    })
    renderPill()
    const pill = screen.getByTestId('burn-rate-pill')
    expect(pill).toHaveAttribute('data-warned', 'true')
    expect(pill.className).toContain('warning')
    expect(pill.getAttribute('aria-label')).toMatch(/over your budget/i)
  })

  it('stays calm when under budget', () => {
    setBudget({ daily: 10 })
    useUsageMock.mockReturnValue({
      data: summary([day({ day: '2026-05-31', estimatedCost: 4.32 })]),
    })
    renderPill()
    expect(screen.getByTestId('burn-rate-pill')).not.toHaveAttribute('data-warned')
  })

  it('navigates to Usage when clicked', async () => {
    const user = userEvent.setup()
    useUsageMock.mockReturnValue({
      data: summary([day({ day: '2026-05-31', estimatedCost: 4.32 })]),
    })
    renderPill()
    await user.click(screen.getByTestId('burn-rate-pill'))
    expect(screen.getByTestId('location')).toHaveTextContent('/usage')
  })

  it('surfaces an honest approximate hourly rate in the tooltip', () => {
    useUsageMock.mockReturnValue({ data: summary([day({ day: '2026-05-31', estimatedCost: 20 })]) })
    renderPill()
    // 20 over 10 elapsed UTC hours ≈ $2.00/hr, labelled as approximate.
    expect(screen.getByTestId('burn-rate-pill').getAttribute('title')).toMatch(/\$2\.00\/hr/)
  })
})

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { UsageTrend } from './UsageTrend'
import type { UsageDailyPoint } from './types'

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

describe('UsageTrend – accent fidelity', () => {
  // --primary is the reserved ACTION accent; a decorative magnitude series must
  // never spend it. The output token series uses --chart-3 (decorative
  // magnitude), input stays --chart-2.
  it('paints the output token series with --chart-3, never the reserved --primary', () => {
    const { container } = render(
      <UsageTrend daily={[day({ day: '2026-05-31', inputTokens: 1000, outputTokens: 1000 })]} />,
    )
    const html = container.innerHTML
    expect(html).toContain('bg-[var(--chart-3)]')
    // The output bar, its legend dot, and its tooltip dot must NOT use bg-primary.
    expect(html).not.toContain('bg-primary')
  })

  it('keeps the input token series on --chart-2', () => {
    const { container } = render(
      <UsageTrend daily={[day({ day: '2026-05-31', inputTokens: 1000, outputTokens: 1000 })]} />,
    )
    expect(container.innerHTML).toContain('bg-[var(--chart-2)]')
  })
})

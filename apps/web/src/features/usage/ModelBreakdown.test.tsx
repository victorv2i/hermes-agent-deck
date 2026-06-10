import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ModelBreakdown } from './ModelBreakdown'
import type { UsageModelBreakdown } from './types'

const TWO_MODELS: UsageModelBreakdown[] = [
  {
    model: 'claude-opus-4',
    inputTokens: 600_000,
    outputTokens: 400_000,
    estimatedCost: 12.5,
    sessions: 5,
  },
  {
    model: 'claude-sonnet-4',
    inputTokens: 300_000,
    outputTokens: 200_000,
    estimatedCost: 3.5,
    sessions: 3,
  },
]

describe('ModelBreakdown — share-of-total honesty (INFO-ACC-1)', () => {
  it('shows share-of-TOTAL — each % adds up to ≤100% (never >100 as with share-of-peak)', () => {
    render(<ModelBreakdown byModel={TWO_MODELS} />)
    // total tokens: opus=1_000_000, sonnet=500_000, grand total=1_500_000
    // opus share = 1_000_000 / 1_500_000 = 66.7% → rounds to 67
    // sonnet share = 500_000 / 1_500_000 = 33.3% → rounds to 33
    const pcts = screen
      .getAllByTestId('model-share-pct')
      .map((el) => parseInt(el.textContent ?? '0', 10))
    const sum = pcts.reduce((a, b) => a + b, 0)
    expect(sum).toBeLessThanOrEqual(100)

    // The widest bar (opus) is NOT forced to 100% — it shows real share.
    expect(pcts[0]).toBe(67)
    expect(pcts[1]).toBe(33)
  })

  it('shows a legend explaining the % is share of period total', () => {
    render(<ModelBreakdown byModel={TWO_MODELS} />)
    expect(screen.getByTestId('model-breakdown-legend')).toBeInTheDocument()
  })

  it('renders correctly with a single model (100% share, sum=100)', () => {
    const single: UsageModelBreakdown[] = [
      {
        model: 'claude-opus-4',
        inputTokens: 100_000,
        outputTokens: 50_000,
        estimatedCost: 5.0,
        sessions: 2,
      },
    ]
    render(<ModelBreakdown byModel={single} />)
    const pct = parseInt(screen.getByTestId('model-share-pct').textContent ?? '0', 10)
    expect(pct).toBe(100)
  })

  it('renders a provider logo beside each model name row', () => {
    render(<ModelBreakdown byModel={TWO_MODELS} />)
    // Each row should have an svg (provider brand icon) — could be a real mark or monogram
    const rows = screen.getAllByTestId('model-share-pct')
    // We just need at least one model row with a brand icon present in the list
    expect(rows.length).toBeGreaterThan(0)
    const listItems = document.querySelectorAll('[data-testid="model-row-icon"]')
    expect(listItems.length).toBe(TWO_MODELS.length)
  })
})

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProviderBreakdown } from './ProviderBreakdown'
import type { UsageModelBreakdown } from './types'

const model = (over: Partial<UsageModelBreakdown> = {}): UsageModelBreakdown => ({
  model: 'claude-opus-4',
  inputTokens: 0,
  outputTokens: 0,
  estimatedCost: 0,
  sessions: 0,
  ...over,
})

describe('ProviderBreakdown – per-provider rollup view', () => {
  it('shows one row per provider with a brand mark and share %', () => {
    render(
      <ProviderBreakdown
        byModel={[
          model({ billingProvider: 'anthropic', inputTokens: 1_000_000, estimatedCost: 16 }),
          model({ billingProvider: 'openai', inputTokens: 500_000, estimatedCost: 5 }),
        ]}
      />,
    )
    // Provider labels (scoped to the visible row label, not the brand SVG's
    // internal <title> which lobehub icons also render).
    const labels = screen.getAllByTestId('provider-row-label').map((el) => el.textContent)
    expect(labels).toContain('Anthropic')
    expect(labels).toContain('OpenAI')
    const pcts = screen
      .getAllByTestId('provider-share-pct')
      .map((el) => parseInt(el.textContent ?? '0', 10))
    expect(pcts.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(100)
    expect(pcts[0]).toBe(67) // 1M / 1.5M
    // One brand icon per provider row.
    expect(document.querySelectorAll('[data-testid="provider-row-icon"]').length).toBe(2)
  })

  it('shows the cost for a metered provider', () => {
    render(
      <ProviderBreakdown
        byModel={[
          model({ billingProvider: 'anthropic', inputTokens: 100_000, estimatedCost: 12.5 }),
        ]}
      />,
    )
    expect(screen.getByText('$12.50')).toBeInTheDocument()
  })

  it('HONESTY: a subscription provider shows "Included in subscription", never a misleading $0', () => {
    render(
      <ProviderBreakdown
        byModel={[
          model({
            model: 'gpt-5.5-codex',
            billingProvider: 'openai-codex',
            inputTokens: 1_000_000,
            estimatedCost: 0,
            sessions: 4,
          }),
        ]}
      />,
    )
    // The honest plan label is shown…
    expect(screen.getByText(/included in subscription/i)).toBeInTheDocument()
    // …and NO "$0" / "$0.00" cost is rendered for the subscription row.
    expect(screen.queryByText(/\$0(\.00)?\b/)).not.toBeInTheDocument()
  })

  it('renders an empty message when there is no provider usage', () => {
    render(<ProviderBreakdown byModel={[]} />)
    expect(screen.getByText(/no provider usage/i)).toBeInTheDocument()
  })

  it('labels the no-attribution bucket honestly (not a fake provider)', () => {
    render(<ProviderBreakdown byModel={[model({ billingProvider: '', inputTokens: 1000 })]} />)
    expect(screen.getByText(/unattributed/i)).toBeInTheDocument()
  })
})

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CostInsights } from './CostInsights'
import { billingMode } from './billingMode'
import type { UsageDailyPoint, UsageModelBreakdown } from './types'

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

function model(over: Partial<UsageModelBreakdown> & { model: string }): UsageModelBreakdown {
  return { inputTokens: 0, outputTokens: 0, estimatedCost: 0, sessions: 0, ...over }
}

describe('CostInsights', () => {
  it('renders the spend trend with a rolling daily-average label', () => {
    render(
      <CostInsights
        daily={[
          day({ day: '2026-05-30', estimatedCost: 6 }),
          day({ day: '2026-05-31', estimatedCost: 10 }),
        ]}
        byModel={[model({ model: 'opus', estimatedCost: 16 })]}
      />,
    )
    expect(screen.getByText('Spend trend')).toBeInTheDocument()
    // Average of the two spend-bearing days = $8.00.
    expect(screen.getByText('$8.00')).toBeInTheDocument()
  })

  it('orders cost-by-model by spend with each model’s share of the bill', () => {
    render(
      <CostInsights
        daily={[day({ day: '2026-05-31', estimatedCost: 10 })]}
        byModel={[
          model({ model: 'sonnet', estimatedCost: 1 }),
          model({ model: 'opus', estimatedCost: 9 }),
        ]}
      />,
    )
    expect(screen.getByText('Cost by model')).toBeInTheDocument()
    const labels = screen.getAllByText(/opus|sonnet/)
    // opus (the costlier) renders before sonnet in the cost-share list.
    expect(labels[0]).toHaveTextContent('opus')
    expect(screen.getByText(/90% of spend/)).toBeInTheDocument()
  })

  it('shows the efficiency nudge ONLY when one model dominates non-trivial spend', () => {
    render(
      <CostInsights
        daily={[day({ day: '2026-05-31', estimatedCost: 10 })]}
        byModel={[
          model({ model: 'opus', estimatedCost: 9 }),
          model({ model: 'sonnet', estimatedCost: 1 }),
        ]}
      />,
    )
    const nudge = screen.getByTestId('efficiency-nudge')
    expect(nudge).toHaveTextContent(/opus/)
    expect(nudge).toHaveTextContent(/a smaller model/)
  })

  it('hides the nudge on a balanced spread', () => {
    render(
      <CostInsights
        daily={[day({ day: '2026-05-31', estimatedCost: 10 })]}
        byModel={[
          model({ model: 'opus', estimatedCost: 5 }),
          model({ model: 'sonnet', estimatedCost: 5 }),
        ]}
      />,
    )
    expect(screen.queryByTestId('efficiency-nudge')).not.toBeInTheDocument()
  })

  it('hides the nudge and cost-share on a trivial / unbilled window', () => {
    render(
      <CostInsights
        daily={[day({ day: '2026-05-31', estimatedCost: 0 })]}
        byModel={[model({ model: 'local', estimatedCost: 0 })]}
      />,
    )
    expect(screen.queryByTestId('efficiency-nudge')).not.toBeInTheDocument()
    expect(screen.queryByText('Cost by model')).not.toBeInTheDocument()
    // The trend block still renders (with its empty state).
    expect(screen.getByText('Spend trend')).toBeInTheDocument()
  })
})

// The only billing signal stock hermes exposes is the estimated/actual cost
// pair (by_model carries NO billing_provider). This best-effort classifier –
// never ground truth – reads the pair into one of three modes so the UI can
// present cost honestly per how the account is actually billed.
describe('billingMode (best-effort, three branches)', () => {
  it('reads est>0 & actual~=0 as a subscription (priced model, not billed per call)', () => {
    expect(
      billingMode([
        day({ day: '2026-05-30', estimatedCost: 6, actualCost: 0 }),
        day({ day: '2026-05-31', estimatedCost: 4, actualCost: 0 }),
      ]),
    ).toBe('subscription')
  })
  it('reads est>0 & actual>0 as metered (a real per-call bill)', () => {
    expect(billingMode([day({ day: '2026-05-31', estimatedCost: 6, actualCost: 5.2 })])).toBe(
      'metered',
    )
  })
  it('reads est~=0 & actual~=0 as local (no cost signal at all)', () => {
    expect(billingMode([day({ day: '2026-05-31', estimatedCost: 0, actualCost: 0 })])).toBe('local')
  })

  // The live bug: a busy ChatGPT/Codex subscription reports a $0 cost pair, so
  // cost-only inference wrongly reads it as `local`. The active provider is the
  // authoritative signal – token usage on a subscription seat is `subscription`.
  it('reads a subscription provider with $0 cost but real tokens as subscription', () => {
    expect(
      billingMode(
        [day({ day: '2026-05-31', estimatedCost: 0, actualCost: 0, inputTokens: 120_000 })],
        'openai-codex',
      ),
    ).toBe('subscription')
  })
  it('still reads a subscription provider with NO tokens as local (nothing happened)', () => {
    expect(billingMode([day({ day: '2026-05-31' })], 'openai-codex')).toBe('local')
  })
  it('a real per-call bill stays metered even on an OAuth-capable provider', () => {
    expect(
      billingMode(
        [day({ day: '2026-05-31', estimatedCost: 6, actualCost: 5.2, inputTokens: 1000 })],
        'openai-codex',
      ),
    ).toBe('metered')
  })
  it('a metered provider with $0 cost falls back to cost inference (local)', () => {
    expect(
      billingMode(
        [day({ day: '2026-05-31', estimatedCost: 0, actualCost: 0, inputTokens: 5000 })],
        'openrouter',
      ),
    ).toBe('local')
  })
})

describe('CostInsights – billing-mode-aware presentation', () => {
  it('shows a plan token-usage card (not "No spend recorded") on a subscription window', () => {
    render(
      <CostInsights
        daily={[
          day({
            day: '2026-05-31',
            estimatedCost: 8,
            actualCost: 0,
            inputTokens: 120_000,
            outputTokens: 40_000,
          }),
        ]}
        byModel={[
          model({ model: 'opus', estimatedCost: 8, inputTokens: 120_000, outputTokens: 40_000 }),
        ]}
      />,
    )
    const card = screen.getByTestId('plan-usage-card')
    expect(card).toHaveTextContent(/included in your subscription/i)
    expect(card).toHaveTextContent(/not billed per call/i)
    // The misleading "No spend recorded" copy must NOT appear in subscription mode.
    expect(screen.queryByText(/No spend recorded/i)).not.toBeInTheDocument()
  })

  it('hides the cost-share block in local mode (no cost signal)', () => {
    render(
      <CostInsights
        daily={[day({ day: '2026-05-31', estimatedCost: 0, actualCost: 0, inputTokens: 5000 })]}
        byModel={[model({ model: 'local-llm', estimatedCost: 0, inputTokens: 5000 })]}
      />,
    )
    expect(screen.queryByText('Cost by model')).not.toBeInTheDocument()
    expect(screen.queryByTestId('plan-usage-card')).not.toBeInTheDocument()
  })

  it('leaves the metered cost-share block unchanged', () => {
    render(
      <CostInsights
        daily={[day({ day: '2026-05-31', estimatedCost: 10, actualCost: 9 })]}
        byModel={[
          model({ model: 'gpt-5.5', estimatedCost: 9 }),
          model({ model: 'sonnet', estimatedCost: 1 }),
        ]}
      />,
    )
    expect(screen.getByText('Cost by model')).toBeInTheDocument()
    expect(screen.queryByTestId('plan-usage-card')).not.toBeInTheDocument()
  })

  // The live ChatGPT/Codex case: a $0 cost pair + real tokens on a subscription
  // provider must show the honest plan card, NOT the "No spend recorded" trend.
  it('shows the plan card on a subscription provider even with a $0 cost pair', () => {
    render(
      <CostInsights
        daily={[
          day({
            day: '2026-05-31',
            estimatedCost: 0,
            actualCost: 0,
            inputTokens: 200_000,
            outputTokens: 50_000,
          }),
        ]}
        byModel={[model({ model: 'gpt-5.5', estimatedCost: 0, inputTokens: 200_000 })]}
        providerId="openai-codex"
      />,
    )
    const card = screen.getByTestId('plan-usage-card')
    expect(card).toHaveTextContent(/included in your subscription/i)
    expect(card).toHaveTextContent(/250,000/) // the honest total-token headline
    expect(screen.queryByText(/No spend recorded/i)).not.toBeInTheDocument()
    // No misleading $0 cost-share rows on a subscription with no billed cost.
    expect(screen.queryByText('Cost by model')).not.toBeInTheDocument()
  })

  it('labels the plan card as a subscription when the provider is a subscription seat', () => {
    render(
      <CostInsights
        daily={[day({ day: '2026-05-31', estimatedCost: 0, inputTokens: 10_000 })]}
        byModel={[model({ model: 'gpt-5.5', inputTokens: 10_000 })]}
        providerId="openai-codex"
      />,
    )
    expect(screen.getByTestId('plan-usage-card')).toHaveTextContent(/subscription/i)
  })
})

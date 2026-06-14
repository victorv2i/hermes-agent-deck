import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UsagePage } from './UsagePage'
import { PeriodSelector } from './PeriodSelector'
import { ModelBreakdown } from './ModelBreakdown'
import { UsageTrend } from './UsageTrend'
import type { UsageSummary } from './types'

const SUMMARY: UsageSummary = {
  periodDays: 7,
  totals: {
    inputTokens: 20000,
    outputTokens: 5500,
    cacheReadTokens: 800,
    reasoningTokens: 200,
    estimatedCost: 0.63,
    actualCost: 0.4,
    sessions: 8,
  },
  daily: [
    {
      day: '2026-05-23',
      inputTokens: 12000,
      outputTokens: 3400,
      cacheReadTokens: 800,
      reasoningTokens: 200,
      estimatedCost: 0.42,
      actualCost: 0.4,
      sessions: 5,
    },
    {
      day: '2026-05-24',
      inputTokens: 8000,
      outputTokens: 2100,
      cacheReadTokens: 0,
      reasoningTokens: 0,
      estimatedCost: 0.21,
      actualCost: 0,
      sessions: 3,
    },
  ],
  byModel: [
    {
      model: 'anthropic/claude-opus',
      inputTokens: 15000,
      outputTokens: 4500,
      estimatedCost: 0.55,
      sessions: 6,
      billingProvider: 'anthropic',
    },
    {
      model: 'anthropic/claude-sonnet',
      inputTokens: 5000,
      outputTokens: 1000,
      estimatedCost: 0.08,
      sessions: 2,
      billingProvider: 'anthropic',
    },
  ],
  billingMode: 'metered',
}

function noop() {}

describe('PeriodSelector', () => {
  it('marks the active period and fires onChange on click', () => {
    const onChange = vi.fn()
    render(<PeriodSelector value={14} onChange={onChange} />)
    const active = screen.getByRole('radio', { name: '14d' })
    expect(active).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('radio', { name: '30d' }))
    expect(onChange).toHaveBeenCalledWith(30)
  })
})

describe('ModelBreakdown', () => {
  it('renders rows sorted by total tokens', () => {
    render(<ModelBreakdown byModel={SUMMARY.byModel} />)
    const names = screen.getAllByTitle(/claude/).map((n) => n.textContent)
    expect(names[0]).toBe('anthropic/claude-opus')
    expect(names[1]).toBe('anthropic/claude-sonnet')
  })

  it('shows an empty state with no models', () => {
    render(<ModelBreakdown byModel={[]} />)
    expect(screen.getByText(/No model usage recorded/i)).toBeInTheDocument()
  })

  it('shows share-of-TOTAL percentages per model (sum ≤ 100, top model < 100 when multiple models)', () => {
    // INFO-ACC-1: percentages are share of the GRAND TOTAL for the period, not
    // share-of-peak. Share-of-peak forced the widest bar to 100% and could make
    // the sum exceed 100% — an impossible info-accuracy lie.
    render(<ModelBreakdown byModel={SUMMARY.byModel} />)
    // With share-of-total, no single model should show 100% when multiple exist.
    // claude-opus: 19500/25500 ≈ 76%; claude-sonnet: 6000/25500 ≈ 24%
    const pcts = screen
      .getAllByTestId('model-share-pct')
      .map((el) => parseInt(el.textContent ?? '0', 10))
    expect(pcts).toHaveLength(SUMMARY.byModel.length)
    const sum = pcts.reduce((a, b) => a + b, 0)
    expect(sum).toBeLessThanOrEqual(100)
    // Top model is NOT 100% (it used to be with share-of-peak).
    expect(pcts[0]).toBeLessThan(100)
    // The legend is shown.
    expect(screen.getByTestId('model-breakdown-legend')).toBeInTheDocument()
  })
})

describe('UsageTrend', () => {
  it('reveals a tooltip with the day total when a bar is hovered', () => {
    render(<UsageTrend daily={SUMMARY.daily} />)
    const bars = screen.getAllByRole('button')
    expect(bars.length).toBe(SUMMARY.daily.length)
    fireEvent.mouseEnter(bars[0]!)
    // Tooltip shows the full date and the labelled token figures.
    expect(screen.getByText('May 23, 2026')).toBeInTheDocument()
    expect(screen.getByText('Total')).toBeInTheDocument()
  })

  it('exposes each bar as a focusable button with an accessible per-day label', () => {
    render(<UsageTrend daily={SUMMARY.daily} />)
    // Bars are reachable by keyboard/touch — real buttons, not aria-hidden.
    const bars = screen.getAllByRole('button')
    expect(bars).toHaveLength(SUMMARY.daily.length)
    for (const bar of bars) {
      expect(bar).not.toHaveAttribute('tabindex', '-1')
      expect(bar).not.toHaveAttribute('aria-hidden')
    }
    // The label carries the day's figures so SR/keyboard users get the data
    // that was previously hover-only.
    expect(bars[0]).toHaveAccessibleName(/May 23, 2026/)
    expect(bars[0]).toHaveAccessibleName(/12,000 input/)
    expect(bars[0]).toHaveAccessibleName(/3,400 output/)
    expect(bars[0]).toHaveAccessibleName(/5 sessions/)
  })

  it('reveals the tooltip on keyboard focus, not just hover', () => {
    render(<UsageTrend daily={SUMMARY.daily} />)
    const bars = screen.getAllByRole('button')
    fireEvent.focus(bars[1]!)
    expect(screen.getByText('May 24, 2026')).toBeInTheDocument()
  })
})

describe('UsagePage', () => {
  it('renders headline stats and breakdown from data', () => {
    render(
      <UsagePage
        period={7}
        onPeriodChange={noop}
        data={SUMMARY}
        isLoading={false}
        isFetching={false}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Usage' })).toBeInTheDocument()
    // Total tokens = 25.5K
    expect(screen.getByText('25.5K')).toBeInTheDocument()
    // Cost stat (shared formatCost: two-decimal dollars)
    expect(screen.getByText('$0.63')).toBeInTheDocument()
    // Sessions
    expect(screen.getByText('8')).toBeInTheDocument()
    // Trend + breakdown present. "By model" now appears twice (the toggle radio
    // and the default ModelBreakdown card title), so scope to the toggle radio.
    expect(screen.getByText('Token trend')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'By model' })).toBeInTheDocument()
  })

  it('toggles the breakdown between By model (default) and By provider', () => {
    render(
      <UsagePage
        period={7}
        onPeriodChange={noop}
        data={SUMMARY}
        isLoading={false}
        isFetching={false}
      />,
    )
    // Default: the model breakdown card is shown (its legend is present, the
    // provider one is not).
    expect(screen.getByTestId('model-breakdown-legend')).toBeInTheDocument()
    expect(screen.queryByTestId('provider-breakdown-legend')).not.toBeInTheDocument()

    // Switch to By provider → the provider rollup card replaces the model card.
    fireEvent.click(screen.getByRole('radio', { name: 'By provider' }))
    // Both SUMMARY models are billingProvider 'anthropic' → one Anthropic row.
    expect(screen.getByTestId('provider-row-label')).toHaveTextContent('Anthropic')
    expect(screen.getByTestId('provider-breakdown-legend')).toBeInTheDocument()
    expect(screen.queryByTestId('model-breakdown-legend')).not.toBeInTheDocument()
  })

  it('makes the breakdown toggle a roving-tabindex radiogroup with arrow-key selection', async () => {
    // I5 a11y: the By model / By provider toggle is an ARIA radiogroup, so it
    // must be a single Tab stop (only the checked radio tabbable) and move
    // selection with the arrow keys, mirroring PeriodSelector.
    render(
      <UsagePage
        period={7}
        onPeriodChange={noop}
        data={SUMMARY}
        isLoading={false}
        isFetching={false}
      />,
    )
    const byModel = screen.getByRole('radio', { name: 'By model' })
    const byProvider = screen.getByRole('radio', { name: 'By provider' })
    // Roving tabindex: only the checked radio is in the tab order.
    expect(byModel).toHaveAttribute('aria-checked', 'true')
    expect(byModel).toHaveAttribute('tabindex', '0')
    expect(byProvider).toHaveAttribute('tabindex', '-1')

    // ArrowRight moves selection to By provider (and the rollup card replaces
    // the model card).
    byModel.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByTestId('provider-breakdown-legend')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'By provider' })).toHaveAttribute('tabindex', '0')

    // ArrowLeft wraps from the first option back to the last.
    screen.getByRole('radio', { name: 'By model' }).focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByTestId('provider-breakdown-legend')).toBeInTheDocument()
  })

  it('attaches an info explainer to each headline stat', () => {
    render(
      <UsagePage
        period={7}
        onPeriodChange={noop}
        data={SUMMARY}
        isLoading={false}
        isFetching={false}
      />,
    )
    // Each StatCard exposes a keyboard-reachable "About <label>" info affordance
    // explaining the metric / cost basis (T3.9). Labels are short (single line)
    // with the fuller wording living in the explainer text.
    expect(screen.getByRole('button', { name: /about tokens/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /about est\. cost/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /about sessions/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /about cache: cache \+ reasoning/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /about hit rate: cache hit rate/i }),
    ).toBeInTheDocument()
  })

  it('leads with the cost answer: a plain-language sentence and the cost tile first', () => {
    render(
      <UsagePage
        period={7}
        onPeriodChange={noop}
        data={SUMMARY}
        isLoading={false}
        isFetching={false}
      />,
    )
    // Metered spend: the lead sentence carries the dollar figure.
    expect(screen.getByTestId('cost-lead')).toHaveTextContent(
      '$0.63 estimated cost in the last 7 days.',
    )
    // The Est. cost tile is the FIRST stat tile, ahead of the token telemetry.
    const aboutButtons = screen.getAllByRole('button', { name: /^about /i })
    expect(aboutButtons[0]).toHaveAccessibleName(/^About Est\. cost/)
  })

  it('renders a cache-hit-rate tile next to the other usage tiles', () => {
    render(
      <UsagePage
        period={7}
        onPeriodChange={noop}
        data={SUMMARY}
        isLoading={false}
        isFetching={false}
      />,
    )
    // 800 cache-read / (800 + 20000 input) ≈ 4%.
    expect(screen.getByText('Hit rate')).toBeInTheDocument()
    expect(screen.getByText('4%')).toBeInTheDocument()
  })

  it('shows a skeleton while loading', () => {
    const { container } = render(
      <UsagePage period={7} onPeriodChange={noop} isLoading isFetching={false} />,
    )
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    expect(screen.queryByText('Token trend')).not.toBeInTheDocument()
  })

  it('shows a warm, action-oriented empty state when there is no usage yet', () => {
    const noUsage: UsageSummary = {
      ...SUMMARY,
      totals: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
        estimatedCost: 0,
        actualCost: 0,
        sessions: 0,
      },
      daily: [],
      byModel: [],
    }
    const onStartChat = vi.fn()
    render(
      <UsagePage
        period={7}
        onPeriodChange={noop}
        data={noUsage}
        isLoading={false}
        isFetching={false}
        onStartChat={onStartChat}
      />,
    )
    expect(screen.getByText(/no usage yet/i)).toBeInTheDocument()
    // ONE warm action that leads somewhere useful (start a chat). It is a BUTTON
    // that router-navigates (no <a href="/"> hard reload) — the caller owns the
    // navigate, matching Home/History.
    const start = screen.getByRole('button', { name: /start a chat/i })
    expect(start).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /start a chat/i })).not.toBeInTheDocument()
    fireEvent.click(start)
    expect(onStartChat).toHaveBeenCalledTimes(1)
    // The stat grid / trend are not rendered in the empty case.
    expect(screen.queryByText('Token trend')).not.toBeInTheDocument()
  })

  it('renders the empty state (not a blank screen) when no data is available', () => {
    render(<UsagePage period={7} onPeriodChange={noop} isLoading={false} isFetching={false} />)
    expect(screen.getByText(/no usage yet/i)).toBeInTheDocument()
  })

  it('shows an error with a retry action', () => {
    const onRetry = vi.fn()
    render(
      <UsagePage
        period={30}
        onPeriodChange={noop}
        isLoading={false}
        isFetching={false}
        error={new Error('dashboard usage unavailable')}
        onRetry={onRetry}
      />,
    )
    expect(screen.getByText(/Couldn’t load usage/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('renders a calm human sentence on error — never the raw internal plumbing string', () => {
    render(
      <UsagePage
        period={30}
        onPeriodChange={noop}
        isLoading={false}
        isFetching={false}
        error={new Error('dashboard usage unavailable: session-token request failed: fetch failed')}
        onRetry={noop}
      />,
    )
    // The user sees the calm, hardcoded sentence...
    expect(
      screen.getByText('The hermes dashboard may be offline. Usage analytics live there.'),
    ).toBeInTheDocument()
    // ...and never the raw internal error text.
    expect(screen.queryByText(/session-token request failed/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/fetch failed/i)).not.toBeInTheDocument()
  })

  it('explains a zero cost at non-zero token usage instead of reading as broken', () => {
    const zeroSpend: UsageSummary = {
      ...SUMMARY,
      totals: { ...SUMMARY.totals, estimatedCost: 0, actualCost: 0 },
    }
    render(
      <UsagePage
        period={7}
        onPeriodChange={noop}
        data={zeroSpend}
        isLoading={false}
        isFetching={false}
      />,
    )
    // Tokens were used (SUMMARY has 25.5K) but nothing was billed: say so
    // honestly rather than leaving a bare zero that looks like a bug.
    expect(screen.getByText(/no billed cost on this provider/i)).toBeInTheDocument()
    // No broken-looking "$0.00" in the cost tile.
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  })

  it('shows a real actual_cost even with no estimate (never "No billed cost" while money was billed)', () => {
    // A metered provider can report a real actual_cost with no rate-card
    // estimate. That is billed money: the tile must not read "No billed cost" or
    // leave a bare "—" while a positive actual sits in the same window.
    const actualOnly: UsageSummary = {
      ...SUMMARY,
      totals: { ...SUMMARY.totals, estimatedCost: 0, actualCost: 4.2 },
      billingMode: 'metered',
    }
    render(
      <UsagePage
        period={7}
        onPeriodChange={noop}
        data={actualOnly}
        isLoading={false}
        isFetching={false}
      />,
    )
    expect(screen.queryByText(/no billed cost on this provider/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/no spend yet/i)).not.toBeInTheDocument()
    // The lead answers the cost question with the REAL figure, no contradiction.
    expect(screen.getByTestId('cost-lead')).toHaveTextContent('$4.20 billed in the last 7 days.')
  })

  it('labels a busy subscription window honestly from the SERVER billing mode', () => {
    // The live ChatGPT/Codex case: real tokens, $0 cost pair, OAuth seat. The
    // BFF already resolved the authoritative mode from the recorded
    // billing_provider, so the label is honest even WITHOUT an active providerId.
    const subscription: UsageSummary = {
      ...SUMMARY,
      totals: { ...SUMMARY.totals, estimatedCost: 0, actualCost: 0 },
      daily: SUMMARY.daily.map((d) => ({ ...d, estimatedCost: 0, actualCost: 0 })),
      byModel: SUMMARY.byModel.map((m) => ({
        ...m,
        estimatedCost: 0,
        billingProvider: 'openai-codex',
      })),
      billingMode: 'subscription',
    }
    render(
      <UsagePage
        period={7}
        onPeriodChange={noop}
        data={subscription}
        isLoading={false}
        isFetching={false}
      />,
    )
    // The cost tile reads as a flat subscription, NOT "no billed cost / local".
    // The honest "subscription" label shows in both the cost tile and plan card.
    expect(screen.getAllByText(/included in your subscription/i).length).toBeGreaterThan(0)
    expect(screen.queryByText(/no billed cost on this provider/i)).not.toBeInTheDocument()
    // The lead sentence answers the cost question in the same honest terms.
    expect(screen.getByTestId('cost-lead')).toHaveTextContent(
      'Covered by your subscription, no extra cost in the last 7 days.',
    )
    // And the plan card surfaces the honest token figure rather than $0 spend.
    expect(screen.getByTestId('plan-usage-card')).toBeInTheDocument()
  })

  it('still labels subscription via the active-provider fallback when the server mode is unknown', () => {
    // Older payloads / a window the BFF couldn't attribute: billingMode 'unknown'
    // falls back to the active-provider heuristic, so the honest label survives.
    const subscription: UsageSummary = {
      ...SUMMARY,
      totals: { ...SUMMARY.totals, estimatedCost: 0, actualCost: 0 },
      daily: SUMMARY.daily.map((d) => ({ ...d, estimatedCost: 0, actualCost: 0 })),
      byModel: SUMMARY.byModel.map((m) => ({ ...m, estimatedCost: 0, billingProvider: '' })),
      billingMode: 'unknown',
    }
    render(
      <UsagePage
        period={7}
        onPeriodChange={noop}
        data={subscription}
        isLoading={false}
        isFetching={false}
        providerId="openai-codex"
        providerLabel="OpenAI Codex"
      />,
    )
    expect(screen.getAllByText(/included in your subscription/i).length).toBeGreaterThan(0)
    expect(screen.queryByText(/no billed cost on this provider/i)).not.toBeInTheDocument()
  })

  it('shows the calm "No spend yet" copy only when there is also no usage', () => {
    const empty: UsageSummary = {
      ...SUMMARY,
      totals: {
        ...SUMMARY.totals,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        actualCost: 0,
      },
    }
    render(
      <UsagePage
        period={7}
        onPeriodChange={noop}
        data={empty}
        isLoading={false}
        isFetching={false}
      />,
    )
    expect(screen.getByText('No spend yet')).toBeInTheDocument()
    expect(screen.queryByText(/no billed cost on this provider/i)).not.toBeInTheDocument()
  })

  it('renders an empty-period trend without crashing', () => {
    render(
      <UsagePage
        period={7}
        onPeriodChange={noop}
        data={{ ...SUMMARY, daily: [], byModel: [] }}
        isLoading={false}
        isFetching={false}
      />,
    )
    expect(screen.getByText(/No usage recorded in this period/i)).toBeInTheDocument()
  })
})

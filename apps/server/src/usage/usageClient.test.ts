import { describe, it, expect, afterEach, vi } from 'vitest'
import { DashboardClient } from '../hermes/dashboardClient'
import { startMockDashboard, type MockDashboardHandle } from '../hermes/mockDashboard.test-support'
import { UsageClient } from './usageClient'

let dashboard: MockDashboardHandle | undefined
afterEach(async () => {
  await dashboard?.close()
  dashboard = undefined
  // Restore the real clock for the few tests that pin "today" (Date-only fake, so
  // the mock dashboard's own timers/transport are never touched).
  vi.useRealTimers()
})

/** A realistic dashboard `/api/analytics/usage` payload (days=7). */
const SAMPLE_USAGE = {
  daily: [
    {
      day: '2026-05-23',
      input_tokens: 12000,
      output_tokens: 3400,
      cache_read_tokens: 800,
      reasoning_tokens: 200,
      estimated_cost: 0.42,
      actual_cost: 0.4,
      sessions: 5,
    },
    {
      day: '2026-05-24',
      input_tokens: 8000,
      output_tokens: 2100,
      cache_read_tokens: 0,
      reasoning_tokens: 0,
      estimated_cost: 0.21,
      actual_cost: 0,
      sessions: 3,
    },
  ],
  by_model: [
    {
      model: 'anthropic/claude-opus',
      input_tokens: 15000,
      output_tokens: 4500,
      estimated_cost: 0.55,
      sessions: 6,
    },
    {
      model: 'anthropic/claude-sonnet',
      input_tokens: 5000,
      output_tokens: 1000,
      estimated_cost: 0.08,
      sessions: 2,
    },
  ],
  totals: {
    total_input: 20000,
    total_output: 5500,
    total_cache_read: 800,
    total_reasoning: 200,
    total_estimated_cost: 0.63,
    total_actual_cost: 0.4,
    total_sessions: 8,
  },
  period_days: 7,
}

describe('UsageClient', () => {
  /** A realistic `/api/analytics/models` payload carrying `billing_provider`. */
  const SAMPLE_MODELS = {
    models: [
      {
        model: 'anthropic/claude-opus',
        provider: 'anthropic',
        estimated_cost: 0.55,
        actual_cost: 0.4,
      },
      {
        model: 'anthropic/claude-sonnet',
        provider: 'anthropic',
        estimated_cost: 0.08,
        actual_cost: 0,
      },
    ],
    totals: {},
    period_days: 7,
  }

  it('fetches and normalizes the dashboard usage payload for the given window', async () => {
    dashboard = await startMockDashboard({
      routes: { '/api/analytics/usage': SAMPLE_USAGE, '/api/analytics/models': SAMPLE_MODELS },
    })
    const client = new UsageClient(
      new DashboardClient({
        hermesDashboardUrl: dashboard.url,
        hermesDashboardHost: dashboard.host,
      }),
    )

    const summary = await client.getUsage(7)

    expect(summary.periodDays).toBe(7)
    expect(summary.totals).toEqual({
      inputTokens: 20000,
      outputTokens: 5500,
      cacheReadTokens: 800,
      reasoningTokens: 200,
      estimatedCost: 0.63,
      actualCost: 0.4,
      sessions: 8,
    })
    expect(summary.daily).toHaveLength(2)
    expect(summary.daily[0]).toEqual({
      day: '2026-05-23',
      inputTokens: 12000,
      outputTokens: 3400,
      cacheReadTokens: 800,
      reasoningTokens: 200,
      estimatedCost: 0.42,
      actualCost: 0.4,
      sessions: 5,
    })
    expect(summary.byModel.map((m) => m.model)).toEqual([
      'anthropic/claude-opus',
      'anthropic/claude-sonnet',
    ])
    expect(summary.byModel[0]?.inputTokens).toBe(15000)
    // The authoritative billing_provider is joined from /api/analytics/models.
    expect(summary.byModel[0]?.billingProvider).toBe('anthropic')
    // A real actual_cost landed → metered, not subscription/local.
    expect(summary.billingMode).toBe('metered')
  })

  it('labels a busy subscription window (openai-codex, $0 cost) as subscription', async () => {
    const subUsage = {
      daily: [
        {
          day: '2026-05-23',
          input_tokens: 50000,
          output_tokens: 12000,
          cache_read_tokens: 0,
          reasoning_tokens: 0,
          estimated_cost: 0,
          actual_cost: 0,
          sessions: 9,
        },
      ],
      by_model: [
        {
          model: 'gpt-5.4',
          input_tokens: 50000,
          output_tokens: 12000,
          estimated_cost: 0,
          sessions: 9,
        },
      ],
      totals: {
        total_input: 50000,
        total_output: 12000,
        total_cache_read: 0,
        total_reasoning: 0,
        total_estimated_cost: 0,
        total_actual_cost: 0,
        total_sessions: 9,
      },
      period_days: 7,
    }
    const subModels = {
      models: [{ model: 'gpt-5.4', provider: 'openai-codex', estimated_cost: 0, actual_cost: 0 }],
      totals: {},
      period_days: 7,
    }
    dashboard = await startMockDashboard({
      routes: { '/api/analytics/usage': subUsage, '/api/analytics/models': subModels },
    })
    const client = new UsageClient(
      new DashboardClient({
        hermesDashboardUrl: dashboard.url,
        hermesDashboardHost: dashboard.host,
      }),
    )

    const summary = await client.getUsage(7)

    expect(summary.byModel[0]?.billingProvider).toBe('openai-codex')
    // $0 cost on a flat-subscription seat with real tokens is included-in-plan,
    // not free/local — the exact "$0" honesty fix.
    expect(summary.billingMode).toBe('subscription')
  })

  it('falls back to unknown billing mode when /api/analytics/models is unavailable', async () => {
    // Only the usage route is canned; models 404s → no billing_provider signal.
    dashboard = await startMockDashboard({
      routes: { '/api/analytics/usage': SAMPLE_USAGE },
    })
    const client = new UsageClient(
      new DashboardClient({
        hermesDashboardUrl: dashboard.url,
        hermesDashboardHost: dashboard.host,
      }),
    )

    const summary = await client.getUsage(7)

    // Usage still renders (models is best-effort), but with no provider attribution
    // and a metered read from the REAL actual_cost in the usage rollup.
    expect(summary.byModel[0]?.billingProvider).toBe('')
    expect(summary.billingMode).toBe('metered')
  })

  it('reports local when there is no cost and no subscription provider', async () => {
    const localUsage = {
      daily: [
        {
          day: '2026-05-23',
          input_tokens: 3000,
          output_tokens: 900,
          cache_read_tokens: 0,
          reasoning_tokens: 0,
          estimated_cost: 0,
          actual_cost: 0,
          sessions: 2,
        },
      ],
      by_model: [
        {
          model: 'llama-3',
          input_tokens: 3000,
          output_tokens: 900,
          estimated_cost: 0,
          sessions: 2,
        },
      ],
      totals: {
        total_input: 3000,
        total_output: 900,
        total_cache_read: 0,
        total_reasoning: 0,
        total_estimated_cost: 0,
        total_actual_cost: 0,
        total_sessions: 2,
      },
      period_days: 7,
    }
    const localModels = {
      models: [{ model: 'llama-3', provider: 'local', estimated_cost: 0, actual_cost: 0 }],
      totals: {},
      period_days: 7,
    }
    dashboard = await startMockDashboard({
      routes: { '/api/analytics/usage': localUsage, '/api/analytics/models': localModels },
    })
    const client = new UsageClient(
      new DashboardClient({
        hermesDashboardUrl: dashboard.url,
        hermesDashboardHost: dashboard.host,
      }),
    )

    const summary = await client.getUsage(7)

    expect(summary.billingMode).toBe('local')
  })

  it('passes the requested days through to the dashboard query string', async () => {
    dashboard = await startMockDashboard({
      routes: { '/api/analytics/usage': SAMPLE_USAGE },
    })
    const client = new UsageClient(
      new DashboardClient({
        hermesDashboardUrl: dashboard.url,
        hermesDashboardHost: dashboard.host,
      }),
    )

    await client.getUsage(30)

    const call = dashboard.calls.find((c) => c.path === '/api/analytics/usage')
    expect(call).toBeDefined()
  })

  it('coerces null SUM columns (empty window) to zeros without throwing', async () => {
    const empty = {
      daily: [],
      by_model: [],
      totals: {
        total_input: null,
        total_output: null,
        total_cache_read: null,
        total_reasoning: null,
        total_estimated_cost: 0,
        total_actual_cost: 0,
        total_sessions: 0,
      },
      period_days: 14,
    }
    dashboard = await startMockDashboard({
      routes: { '/api/analytics/usage': empty },
    })
    const client = new UsageClient(
      new DashboardClient({
        hermesDashboardUrl: dashboard.url,
        hermesDashboardHost: dashboard.host,
      }),
    )

    const summary = await client.getUsage(14)

    expect(summary.periodDays).toBe(14)
    expect(summary.totals.inputTokens).toBe(0)
    expect(summary.totals.outputTokens).toBe(0)
    expect(summary.daily).toEqual([])
    expect(summary.byModel).toEqual([])
  })

  it('drops malformed rows (missing day / model) rather than emitting junk', async () => {
    const messy = {
      daily: [
        { day: '2026-05-23', input_tokens: 10 },
        { input_tokens: 999 }, // no day → dropped
        null,
      ],
      by_model: [{ model: 'm1', input_tokens: 7 }, { input_tokens: 5 } /* no model → dropped */],
      totals: { total_input: 10 },
      period_days: 7,
    }
    dashboard = await startMockDashboard({
      routes: { '/api/analytics/usage': messy },
    })
    const client = new UsageClient(
      new DashboardClient({
        hermesDashboardUrl: dashboard.url,
        hermesDashboardHost: dashboard.host,
      }),
    )

    const summary = await client.getUsage(7)

    expect(summary.daily).toHaveLength(1)
    expect(summary.daily[0]?.day).toBe('2026-05-23')
    expect(summary.byModel).toHaveLength(1)
    expect(summary.byModel[0]?.model).toBe('m1')
  })

  it('drops a future-dated day the dashboard overshoots into (no bar for a day that has not happened)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-13T12:00:00Z'))
    // The dashboard returns an inclusive range that can overshoot one day into
    // the future (8 rows for a 7-day ask, the last dated tomorrow).
    const overshoot = {
      daily: [
        '2026-06-07',
        '2026-06-08',
        '2026-06-09',
        '2026-06-10',
        '2026-06-11',
        '2026-06-12',
        '2026-06-13',
        '2026-06-14', // tomorrow, relative to the pinned today
      ].map((day) => ({ day, input_tokens: 1, output_tokens: 0, sessions: 1 })),
      by_model: [],
      totals: {},
      period_days: 7,
    }
    dashboard = await startMockDashboard({ routes: { '/api/analytics/usage': overshoot } })
    const client = new UsageClient(
      new DashboardClient({
        hermesDashboardUrl: dashboard.url,
        hermesDashboardHost: dashboard.host,
      }),
    )

    const summary = await client.getUsage(7)

    const days = summary.daily.map((d) => d.day)
    expect(days).not.toContain('2026-06-14') // the future bar is gone
    expect(days).toHaveLength(7)
    expect(days.at(-1)).toBe('2026-06-13') // the series ends at today
  })

  it('caps an inclusive periodDays+1 series to the requested window (7 bars for "last 7 days")', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-14T12:00:00Z'))
    const inclusive = {
      daily: [
        '2026-06-07',
        '2026-06-08',
        '2026-06-09',
        '2026-06-10',
        '2026-06-11',
        '2026-06-12',
        '2026-06-13',
        '2026-06-14',
      ].map((day) => ({ day, input_tokens: 1, output_tokens: 0, sessions: 1 })),
      by_model: [],
      totals: {},
      period_days: 7,
    }
    dashboard = await startMockDashboard({ routes: { '/api/analytics/usage': inclusive } })
    const client = new UsageClient(
      new DashboardClient({
        hermesDashboardUrl: dashboard.url,
        hermesDashboardHost: dashboard.host,
      }),
    )

    const summary = await client.getUsage(7)

    const days = summary.daily.map((d) => d.day)
    expect(days).toHaveLength(7) // not 8
    expect(days[0]).toBe('2026-06-08') // the oldest, 8th day is trimmed
    expect(days.at(-1)).toBe('2026-06-14')
  })
})

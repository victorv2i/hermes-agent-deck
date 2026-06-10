import { describe, it, expect, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { DashboardError } from '../hermes/dashboardClient'
import { usageRoutes, parseDays } from './usageRoutes'
import type { UsageClient, UsageSummary } from './usageClient'

let app: FastifyInstance | undefined
afterEach(async () => {
  await app?.close()
  app = undefined
})

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
  ],
  billingMode: 'metered',
}

/** A fake UsageClient that records the days it was asked for. */
function fakeUsageClient(impl: (days: number) => Promise<UsageSummary>): {
  client: UsageClient
  calls: number[]
} {
  const calls: number[] = []
  const client = {
    getUsage: (days: number) => {
      calls.push(days)
      return impl(days)
    },
  } as unknown as UsageClient
  return { client, calls }
}

async function buildWith(client: UsageClient): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false })
  await instance.register(usageRoutes, { usageClient: client })
  await instance.ready()
  return instance
}

describe('parseDays', () => {
  it('defaults junk / missing to 30', () => {
    expect(parseDays(undefined)).toBe(30)
    expect(parseDays('abc')).toBe(30)
    expect(parseDays('')).toBe(30)
  })

  it('parses a valid string window', () => {
    expect(parseDays('7')).toBe(7)
    expect(parseDays('14')).toBe(14)
  })

  it('clamps below 1 and above 365', () => {
    expect(parseDays('0')).toBe(1)
    expect(parseDays('-5')).toBe(1)
    expect(parseDays('100000')).toBe(365)
  })
})

describe('GET /api/agent-deck/usage', () => {
  it('returns the normalized usage summary for the requested window', async () => {
    const { client, calls } = fakeUsageClient(async () => SUMMARY)
    app = await buildWith(client)

    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/usage?days=7' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(SUMMARY)
    expect(calls).toEqual([7])
  })

  it('defaults to a 30-day window when days is omitted', async () => {
    const { client, calls } = fakeUsageClient(async () => SUMMARY)
    app = await buildWith(client)

    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/usage' })

    expect(res.statusCode).toBe(200)
    expect(calls).toEqual([30])
  })

  it('clamps an out-of-range days param before calling the client', async () => {
    const { client, calls } = fakeUsageClient(async () => SUMMARY)
    app = await buildWith(client)

    await app.inject({ method: 'GET', url: '/api/agent-deck/usage?days=99999' })

    expect(calls).toEqual([365])
  })

  it('maps a dashboard failure to a 502 without leaking internals', async () => {
    const { client } = fakeUsageClient(async () => {
      throw new DashboardError('GET /api/analytics/usage failed: HTTP 401', 401)
    })
    app = await buildWith(client)

    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/usage?days=7' })

    expect(res.statusCode).toBe(502)
    const body = res.json() as { error: string }
    expect(body.error).toContain('dashboard usage unavailable')
    // Never leaks a bearer token shape.
    expect(body.error).not.toMatch(/tok_/)
  })

  it('maps an unexpected error to a generic 502', async () => {
    const { client } = fakeUsageClient(async () => {
      throw new Error('boom')
    })
    app = await buildWith(client)

    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/usage?days=7' })

    expect(res.statusCode).toBe(502)
    expect((res.json() as { error: string }).error).toBe('dashboard usage unavailable')
  })
})

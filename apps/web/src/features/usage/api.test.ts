import { describe, it, expect, afterEach, vi } from 'vitest'
import { fetchUsage } from './api'
import type { UsageSummary } from './types'

const SUMMARY: UsageSummary = {
  periodDays: 7,
  totals: {
    inputTokens: 1,
    outputTokens: 2,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    estimatedCost: 0.01,
    actualCost: 0,
    sessions: 1,
  },
  daily: [],
  byModel: [],
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('fetchUsage', () => {
  it('requests the BFF with the days query and returns the parsed summary', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () =>
      Response.json(SUMMARY),
    )
    vi.stubGlobal('fetch', fetchMock)

    const out = await fetchUsage(14)

    expect(out).toEqual(SUMMARY)
    const url = fetchMock.mock.calls[0]![0] as string
    expect(url).toBe('/api/agent-deck/usage?days=14')
  })

  it('throws including the BFF error detail on a non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'dashboard usage unavailable' }, { status: 502 })),
    )

    // The shared apiFetch surfaces the BFF's error detail as the message and the
    // status on the typed error – a single error shape across every surface.
    await expect(fetchUsage(7)).rejects.toMatchObject({
      status: 502,
      message: 'dashboard usage unavailable',
    })
  })
})

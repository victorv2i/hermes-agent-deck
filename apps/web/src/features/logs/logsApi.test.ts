import { describe, it, expect, afterEach, vi } from 'vitest'
import type { AgentDeckLogs } from '@agent-deck/protocol'
import { fetchLogs } from './logsApi'

const LOGS: AgentDeckLogs = {
  file: 'agent',
  truncated: false,
  entries: [
    {
      id: 0,
      timestamp: '2026-05-30 22:35:00,123',
      level: 'INFO',
      logger: 'hermes.gateway',
      message: 'started',
      raw: '2026-05-30 22:35:00,123 INFO hermes.gateway started',
    },
  ],
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('fetchLogs', () => {
  it('requests the BFF with file + lines and returns the parsed DTO', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(LOGS))
    vi.stubGlobal('fetch', fetchMock)

    const out = await fetchLogs({ file: 'agent', lines: 100 })

    expect(out).toEqual(LOGS)
    expect(fetchMock.mock.calls[0]![0] as string).toBe('/api/agent-deck/logs?file=agent&lines=100')
  })

  it('includes level + url-encoded search when provided', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ ...LOGS, file: 'gateway' }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchLogs({ file: 'gateway', lines: 50, level: 'ERROR', search: 'a b&c' })

    expect(fetchMock.mock.calls[0]![0] as string).toBe(
      '/api/agent-deck/logs?file=gateway&lines=50&level=ERROR&search=a+b%26c',
    )
  })

  it('omits the level param when set to ALL', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(LOGS))
    vi.stubGlobal('fetch', fetchMock)

    await fetchLogs({ file: 'agent', lines: 100, level: 'ALL' })

    expect(fetchMock.mock.calls[0]![0] as string).toBe('/api/agent-deck/logs?file=agent&lines=100')
  })

  it('surfaces the BFF error detail + status on a non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'dashboard logs unavailable' }, { status: 502 })),
    )
    await expect(fetchLogs({ file: 'agent', lines: 100 })).rejects.toMatchObject({
      status: 502,
      message: 'dashboard logs unavailable',
    })
  })
})

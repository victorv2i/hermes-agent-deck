import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchToolsets, toggleToolset, TOOLS_CLI_COMMAND } from './api'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('TOOLS_CLI_COMMAND', () => {
  it('is the exact interactive configurator command', () => {
    expect(TOOLS_CLI_COMMAND).toBe('hermes tools')
  })
})

describe('fetchToolsets', () => {
  it('parses a well-formed toolsets payload', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      Response.json({
        toolsets: [
          {
            name: 'web',
            label: 'Web Search & Scraping',
            description: 'web_search, web_extract',
            enabled: true,
            configured: true,
            tools: ['web_search', 'web_extract'],
          },
          {
            name: 'image_gen',
            label: 'Image Generation',
            description: 'image_generate',
            enabled: false,
            configured: false,
            tools: ['image_generate'],
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const toolsets = await fetchToolsets()
    expect(toolsets).toHaveLength(2)
    expect(toolsets[0]!.name).toBe('web')
    expect(toolsets[0]!.enabled).toBe(true)
    expect(toolsets[1]!.enabled).toBe(false)
    // Hits the agent-deck toolsets route.
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/agent-deck/toolsets'),
      expect.anything(),
    )
  })

  it('throws on a malformed payload (zod guards the contract)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ toolsets: [{ name: 'web', enabled: 'yes' }] })),
    )
    await expect(fetchToolsets()).rejects.toThrow()
  })

  it('throws on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 502 })),
    )
    await expect(fetchToolsets()).rejects.toThrow()
  })
})

describe('toggleToolset', () => {
  it('sends PUT /api/agent-deck/toolsets/:name with { enabled } and parses the result', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      Response.json({ ok: true, name: 'web', enabled: true }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await toggleToolset('web', true)
    expect(result.ok).toBe(true)
    expect(result.name).toBe('web')
    expect(result.enabled).toBe(true)

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/agent-deck/toolsets/web'),
      expect.objectContaining({ method: 'PUT' }),
    )
  })

  it('can disable a toolset', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ok: true, name: 'image_gen', enabled: false })),
    )
    const result = await toggleToolset('image_gen', false)
    expect(result.enabled).toBe(false)
  })

  it('throws on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad request', { status: 400 })),
    )
    await expect(toggleToolset('nonexistent', true)).rejects.toThrow()
  })
})

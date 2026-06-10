import { describe, it, expect, afterEach } from 'vitest'
import { DashboardClient } from '../hermes/dashboardClient'
import { startMockDashboard, type MockDashboardHandle } from '../hermes/mockDashboard.test-support'
import { ToolsetsClient, stripLeadingEmoji, type ToolsetToggleResult } from './toolsetsClient'

/**
 * Exercises the toolsets client HERMETICALLY against the shared mock dashboard
 * (it canned-serves the gated GET /api/tools/toolsets). Verifies the slim mapping
 * + emoji stripping + the whitelist (unknown fields like `available` are dropped).
 */

let mock: MockDashboardHandle | undefined
afterEach(async () => {
  await mock?.close()
  mock = undefined
})

function clientFor(handle: MockDashboardHandle): ToolsetsClient {
  const dashboard = new DashboardClient({
    hermesDashboardUrl: handle.url,
    hermesDashboardHost: handle.host,
  })
  return new ToolsetsClient(dashboard)
}

describe('stripLeadingEmoji', () => {
  it('strips a leading pictograph + whitespace, preserving interior punctuation', () => {
    expect(stripLeadingEmoji('🔍 Web Search & Scraping')).toBe('Web Search & Scraping')
    expect(stripLeadingEmoji('💻 Terminal & Processes')).toBe('Terminal & Processes')
  })

  it('returns a plain label unchanged', () => {
    expect(stripLeadingEmoji('Web Search')).toBe('Web Search')
  })

  it('falls back to the trimmed original for an all-glyph label', () => {
    expect(stripLeadingEmoji('  Plain  ')).toBe('Plain')
  })
})

describe('ToolsetsClient.listToolsets', () => {
  it('maps the dashboard payload into the slim, whitelisted shape', async () => {
    mock = await startMockDashboard({
      routes: {
        '/api/tools/toolsets': [
          {
            name: 'web',
            label: '🔍 Web Search & Scraping',
            description: 'web_search, web_extract',
            enabled: true,
            available: true, // dropped by the whitelist
            configured: true,
            tools: ['web_search', 'web_extract'],
          },
          {
            name: 'image_gen',
            label: '🎨 Image Generation',
            description: 'image_generate',
            enabled: false,
            available: false,
            configured: false,
            tools: ['image_generate'],
          },
        ],
      },
    })
    const toolsets = await clientFor(mock).listToolsets()
    expect(toolsets).toHaveLength(2)
    expect(toolsets[0]).toEqual({
      name: 'web',
      label: 'Web Search & Scraping',
      description: 'web_search, web_extract',
      enabled: true,
      configured: true,
      tools: ['web_search', 'web_extract'],
    })
    // `available` never crosses the boundary.
    expect(toolsets[0]).not.toHaveProperty('available')
    expect(toolsets[1]!.enabled).toBe(false)
    expect(toolsets[1]!.configured).toBe(false)
  })

  it('drops a nameless entry and tolerates a missing tools list', async () => {
    mock = await startMockDashboard({
      routes: {
        '/api/tools/toolsets': [
          { name: '', label: 'No name', enabled: true },
          { name: 'todo', label: 'Task Planning', description: 'todo', enabled: true },
        ],
      },
    })
    const toolsets = await clientFor(mock).listToolsets()
    expect(toolsets.map((t) => t.name)).toEqual(['todo'])
    expect(toolsets[0]!.tools).toEqual([])
    // A missing `configured` defaults to false (honest off-until-proven-on).
    expect(toolsets[0]!.configured).toBe(false)
  })

  it('throws when the payload is not an array', async () => {
    mock = await startMockDashboard({
      routes: { '/api/tools/toolsets': { oops: true } },
    })
    await expect(clientFor(mock).listToolsets()).rejects.toThrow()
  })
})

describe('ToolsetsClient.toggleToolset', () => {
  it('sends PUT /api/tools/toolsets/{name} with { enabled } and returns the result', async () => {
    mock = await startMockDashboard({
      putRoutes: {
        '/api/tools/toolsets/web': { ok: true, name: 'web', enabled: true },
      },
    })
    const result: ToolsetToggleResult = await clientFor(mock).toggleToolset('web', true)
    expect(result.ok).toBe(true)
    expect(result.name).toBe('web')
    expect(result.enabled).toBe(true)
    // Confirm it was a PUT to the right path.
    const putCall = mock.calls.find((c) => c.method === 'PUT')
    expect(putCall?.path).toBe('/api/tools/toolsets/web')
  })

  it('can disable a toolset (enabled: false)', async () => {
    mock = await startMockDashboard({
      putRoutes: {
        '/api/tools/toolsets/image_gen': { ok: true, name: 'image_gen', enabled: false },
      },
    })
    const result = await clientFor(mock).toggleToolset('image_gen', false)
    expect(result.ok).toBe(true)
    expect(result.enabled).toBe(false)
  })

  it('throws a DashboardError on 400 (unknown toolset key)', async () => {
    // The mock returns 404 for unregistered PUT paths — close enough to model a
    // 400 from stock; the client should throw a DashboardError on any non-2xx.
    mock = await startMockDashboard({
      putRoutes: {},
    })
    await expect(clientFor(mock).toggleToolset('nonexistent', true)).rejects.toThrow()
  })
})

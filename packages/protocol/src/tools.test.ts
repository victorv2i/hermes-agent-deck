import { describe, it, expect } from 'vitest'
import { AgentDeckToolset, AgentDeckToolsetsResponse } from './tools'

describe('AgentDeckToolset', () => {
  it('parses a well-formed toolset', () => {
    const ts = AgentDeckToolset.parse({
      name: 'web',
      label: 'Web Search & Scraping',
      description: 'web_search, web_extract',
      enabled: true,
      configured: true,
      tools: ['web_search', 'web_extract'],
    })
    expect(ts.name).toBe('web')
    expect(ts.enabled).toBe(true)
    expect(ts.tools).toEqual(['web_search', 'web_extract'])
  })

  it('drops unknown keys (whitelist) and keeps an empty tools list', () => {
    const ts = AgentDeckToolset.parse({
      name: 'browser',
      label: 'Browser Automation',
      description: 'navigate, click',
      enabled: false,
      configured: false,
      tools: [],
      // not in the contract — must be stripped, never surfaced
      secretPath: '/home/user/.hermes/config.yaml',
    })
    expect(ts).not.toHaveProperty('secretPath')
    expect(ts.tools).toEqual([])
  })

  it('rejects a non-boolean enabled', () => {
    expect(() =>
      AgentDeckToolset.parse({
        name: 'web',
        label: 'Web',
        description: '',
        enabled: 'yes',
        configured: true,
        tools: [],
      }),
    ).toThrow()
  })
})

describe('AgentDeckToolsetsResponse', () => {
  it('parses the list envelope', () => {
    const res = AgentDeckToolsetsResponse.parse({
      toolsets: [
        {
          name: 'terminal',
          label: 'Terminal & Processes',
          description: 'terminal, process',
          enabled: true,
          configured: true,
          tools: ['terminal', 'process'],
        },
      ],
    })
    expect(res.toolsets).toHaveLength(1)
    expect(res.toolsets[0]!.name).toBe('terminal')
  })
})

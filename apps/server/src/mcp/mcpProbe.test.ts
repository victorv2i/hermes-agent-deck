import { describe, it, expect } from 'vitest'
import { parseProbeOutput, oauthCaveat } from './mcpProbe'

// The real `hermes mcp test context7` stdout shape (ANSI already stripped here).
const CONNECTED = `
  Testing 'context7'...
  Transport: HTTP → https://mcp.context7.com/mcp
  Auth: none
  ✓ Connected (1033ms)
  ✓ Tools discovered: 2

    resolve-library-id                   Resolves a package/product name to a Context7-compatibl...
    query-docs                           Retrieves and queries up-to-date documentation and code...
`

const FAILED = `
  Testing 'broken'...
  Transport: HTTP → https://nope.example/mcp
  Auth: none
  ✗ Connection failed (812ms): All connection attempts failed
`

describe('mcpProbe.parseProbeOutput', () => {
  it('parses a successful probe into discovered tools', () => {
    const r = parseProbeOutput('context7', 'none', CONNECTED)
    expect(r.ok).toBe(true)
    expect(r.error).toBeNull()
    expect(r.tools).toEqual([
      {
        name: 'resolve-library-id',
        description: 'Resolves a package/product name to a Context7-compatibl...',
      },
      {
        name: 'query-docs',
        description: 'Retrieves and queries up-to-date documentation and code...',
      },
    ])
  })

  it('parses a failed probe into ok:false with the reason (no fabricated success)', () => {
    const r = parseProbeOutput('broken', 'none', FAILED)
    expect(r.ok).toBe(false)
    expect(r.tools).toEqual([])
    expect(r.error).toBe('All connection attempts failed')
  })

  it('fails closed on unrecognized output rather than guessing connected', () => {
    const r = parseProbeOutput('x', 'none', 'garbage with no markers')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/did not report a successful connection/i)
  })

  it('strips ANSI color codes before parsing', () => {
    const colored = '  [32m✓ Connected[0m (10ms)\n  ✓ Tools discovered: 1\n\n    foo  bar\n'
    const r = parseProbeOutput('x', 'none', colored)
    expect(r.ok).toBe(true)
    expect(r.tools).toEqual([{ name: 'foo', description: 'bar' }])
  })

  it('attaches an OAuth caveat even on a clean probe (probe ≠ auth proof)', () => {
    const r = parseProbeOutput('linear', 'oauth', CONNECTED.replace('context7', 'linear'))
    expect(r.ok).toBe(true)
    expect(r.authCaveat).toBe(oauthCaveat('linear'))
  })

  it('does not attach an OAuth caveat for a non-oauth server', () => {
    expect(parseProbeOutput('context7', 'none', CONNECTED).authCaveat).toBeNull()
  })
})

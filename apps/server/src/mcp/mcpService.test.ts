import { describe, it, expect } from 'vitest'
import {
  projectServer,
  projectServers,
  readAuthKind,
  readEnabled,
  readToolCount,
  readTransport,
  readTransportDetail,
} from './mcpService'

describe('mcpService — config projection', () => {
  it('treats a missing `enabled` as enabled (config default true)', () => {
    expect(readEnabled({})).toBe(true)
    expect(readEnabled({ enabled: false })).toBe(false)
    expect(readEnabled({ enabled: 'no' })).toBe(false)
    expect(readEnabled({ enabled: 'yes' })).toBe(true)
  })

  it('reads transport from shape: a url is http, a command is stdio', () => {
    expect(readTransport({ url: 'https://x/mcp' })).toBe('http')
    expect(readTransport({ command: 'codex', args: ['mcp-server'] })).toBe('stdio')
    expect(readTransport({})).toBe('stdio')
  })

  it('flags oauth from explicit auth, api_key from a key-shaped/env header, else none', () => {
    expect(readAuthKind({ auth: 'oauth' })).toBe('oauth')
    expect(readAuthKind({ headers: { Authorization: '${MY_KEY}' } })).toBe('api_key')
    expect(readAuthKind({ headers: { 'X-Custom': '${SECRET}' } })).toBe('api_key')
    expect(readAuthKind({ url: 'https://x/mcp' })).toBe('none')
  })

  it('builds a short, truncated transport detail and never leaks long values', () => {
    expect(readTransportDetail({ url: 'https://mcp.context7.com/mcp' })).toBe(
      'https://mcp.context7.com/mcp',
    )
    expect(readTransportDetail({ command: 'codex', args: ['mcp-server', '--x', '--y'] })).toBe(
      'codex mcp-server --x',
    )
    const long = 'https://' + 'a'.repeat(80) + '.example.com/mcp'
    expect(readTransportDetail({ url: long }).length).toBeLessThanOrEqual(60)
    expect(readTransportDetail({ url: long }).endsWith('…')).toBe(true)
  })

  it('strips userinfo, query, and fragment from http transport detail', () => {
    expect(
      readTransportDetail({
        url: 'https://user:secret@mcp.example.com:8443/mcp?token=plaintext#debug',
      }),
    ).toBe('https://mcp.example.com:8443/mcp')
  })

  it('redacts secret-like stdio args and flag values from transport detail', () => {
    // args[0] is a value-style assignment (`--api-key=<value>`) — counts as 1 slot.
    // args[1] is a bare secret flag (`--token`) — counts as 1 slot (slot 2 = MAX).
    // The value `second-secret` (args[2]) is consumed+dropped since there is no room
    // in the cap for a REDACTED placeholder. The secret value must NOT appear in output.
    const detail = readTransportDetail({
      command: 'node',
      args: ['--api-key=sk-plaintext-secret', '--token', 'second-secret'],
    })
    expect(detail).not.toContain('sk-plaintext-secret')
    expect(detail).not.toContain('second-secret')
    // The two safe slots are: the redacted assignment + the bare flag.
    expect(detail).toBe('node --api-key=[redacted] --token')
    expect(
      readTransportDetail({
        command: 'node',
        args: ['Authorization: Bearer plaintext-secret', '--mode=stdio'],
      }),
    ).toBe('node Authorization: [redacted] --mode=stdio')
  })

  it('reads toolCount from tools.include, null for all/exclude-only', () => {
    expect(readToolCount({ tools: { include: ['a', 'b'] } })).toBe(2)
    expect(readToolCount({ tools: { exclude: ['c'] } })).toBeNull()
    expect(readToolCount({})).toBeNull()
  })

  it('projects an http oauth server (enabled by default)', () => {
    expect(
      projectServer('context7', {
        url: 'https://mcp.context7.com/mcp',
        auth: 'oauth',
      }),
    ).toEqual({
      name: 'context7',
      transport: 'http',
      transportDetail: 'https://mcp.context7.com/mcp',
      authKind: 'oauth',
      enabled: true,
      toolCount: null,
    })
  })

  it('projects the whole block sorted by name, skipping non-object entries', () => {
    const out = projectServers({
      zeta: { url: 'https://z/mcp' },
      alpha: { command: 'cmd', enabled: false },
      bogus: 'not-an-object',
    })
    expect(out.map((s) => s.name)).toEqual(['alpha', 'zeta'])
    expect(out[0]!.enabled).toBe(false)
  })

  it('returns an empty list for an absent/malformed block', () => {
    expect(projectServers(undefined)).toEqual([])
    expect(projectServers('nope')).toEqual([])
  })

  // sanitizeStdioArgs off-by-one: a bare secret-flag landing in the final
  // MAX_STDIO_ARGS slot must NOT push REDACTED past the cap (safe.length ≤ MAX).
  describe('sanitizeStdioArgs off-by-one (bare secret-flag in final slot)', () => {
    it('does not push REDACTED past MAX_STDIO_ARGS when the secret-flag occupies the last slot', () => {
      // MAX_STDIO_ARGS = 2. args[0]='--opt' (safe), args[1]='--api-key' (secret flag),
      // args[2]='sk-secret' (the secret value). Without the fix: safe = ['--opt',
      // '--api-key', '[redacted]'] (3 items > MAX=2). With the fix: ≤ 2.
      const detail = readTransportDetail({
        command: 'node',
        args: ['--opt', '--api-key', 'sk-actual-secret'],
      })
      // The detail string must not expose the literal secret value.
      expect(detail).not.toContain('sk-actual-secret')
      // The sanitized argv must stay within the MAX_STDIO_ARGS cap (≤ 2 args shown).
      // The detail is "node <arg1> <arg2>…" — at most 3 space-separated tokens
      // (command + MAX_STDIO_ARGS args).
      const tokens = detail.replace(/…$/, '').trim().split(' ')
      // command = 'node' is token[0]; remaining tokens are the sanitized args.
      expect(tokens.length - 1).toBeLessThanOrEqual(2)
    })

    it('still redacts the value arg when the flag fits within the cap', () => {
      // args[0]='--api-key' (secret flag), args[1]='sk-actual-secret' (value).
      // With room in the cap, the flag consumes slot 0, REDACTED consumes slot 1.
      const detail = readTransportDetail({
        command: 'node',
        args: ['--api-key', 'sk-actual-secret'],
      })
      expect(detail).not.toContain('sk-actual-secret')
      expect(detail).toContain('[redacted]')
    })
  })
})

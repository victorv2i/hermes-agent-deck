import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, readFile, mkdir, symlink, rename, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { readConfig, readMcpServers, writeMcpServers, configPathFor } from './mcpConfig'

// Real fs throughout, except `rename`, which is a passthrough spy so a single
// test can simulate a failed atomic move (you can't cause EXDEV on demand).
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: vi.fn(actual.rename) }
})

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'mcp-cfg-'))
})
afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

const SEED = `model: anthropic/claude-opus
API_SERVER_KEY: super-secret-key-value
agent:
  max_turns: 50
mcp_servers:
  context7:
    url: https://mcp.context7.com/mcp
    auth: oauth
timezone: America/New_York
`

describe('mcpConfig — guarded read', () => {
  it('reads the mcp_servers block', async () => {
    await writeFile(configPathFor(home), SEED, 'utf8')
    const servers = await readMcpServers(home)
    expect(Object.keys(servers)).toEqual(['context7'])
  })

  it('returns {} when the config file is absent', async () => {
    expect(await readMcpServers(home)).toEqual({})
    expect(await readConfig(home)).toEqual({})
  })

  it('THROWS a content-free error on malformed YAML — never {} (would overwrite) and never the leaky parser message', async () => {
    // An unterminated quote on a credential-adjacent line: the yaml parser's own
    // error would echo the offending lines (incl. the key). readConfig must throw a
    // FIXED message instead, and must NOT swallow it to {} (which a write would then
    // use to overwrite the whole file).
    const malformed = `API_SERVER_KEY: "super-secret-unterminated\nmodel: anthropic/claude-opus\n`
    await writeFile(configPathFor(home), malformed, 'utf8')
    await expect(readConfig(home)).rejects.toThrow(/could not be parsed/i)
    await expect(readConfig(home)).rejects.not.toThrow(/super-secret/i)
  })

  it('a slice write against a malformed config REFUSES and leaves the file untouched (no data loss)', async () => {
    const malformed = `API_SERVER_KEY: "super-secret-unterminated\nmodel: x\n`
    await writeFile(configPathFor(home), malformed, 'utf8')
    await expect(writeMcpServers(home, { x: { url: 'https://x/mcp' } })).rejects.toThrow()
    // The original (unparseable) file is preserved verbatim — never clobbered.
    expect(await readFile(configPathFor(home), 'utf8')).toBe(malformed)
  })
})

describe('mcpConfig — guarded slice write', () => {
  it('writes atomically (temp+rename) — leaves no leftover temp file', async () => {
    const { readdir } = await import('node:fs/promises')
    await writeFile(configPathFor(home), SEED, 'utf8')
    await writeMcpServers(home, { x: { url: 'https://x/mcp' } })
    const entries = await readdir(home)
    expect(entries).toContain('config.yaml')
    expect(entries.some((e) => e.includes('.tmp'))).toBe(false)
  })

  it('cleans up the temp file when the atomic rename fails (no secrets-bearing tmp left behind)', async () => {
    await writeFile(configPathFor(home), SEED, 'utf8')
    // Simulate a failed atomic move (cross-device, permissions, disk error).
    vi.mocked(rename).mockRejectedValueOnce(new Error('EXDEV: simulated cross-device move'))
    await expect(writeMcpServers(home, { x: { url: 'https://x/mcp' } })).rejects.toThrow()
    // The temp holds the FULL config (model, API_SERVER_KEY, provider key refs); a
    // failed rename must not abandon it on disk for another process to read.
    const entries = await readdir(home)
    expect(entries.some((e) => e.includes('.tmp'))).toBe(false)
    // The original config is preserved verbatim (the rename never happened).
    expect(await readFile(configPathFor(home), 'utf8')).toBe(SEED)
  })

  it('replaces ONLY mcp_servers, round-tripping every other key verbatim', async () => {
    await writeFile(configPathFor(home), SEED, 'utf8')
    await writeMcpServers(home, {
      context7: { url: 'https://mcp.context7.com/mcp', auth: 'oauth' },
      myserver: { command: 'codex', args: ['mcp-server'], enabled: true },
    })
    const raw = await readFile(configPathFor(home), 'utf8')
    const parsed = parseYaml(raw) as Record<string, unknown>
    // Untouched keys (incl. the live credential) survive unchanged.
    expect(parsed.API_SERVER_KEY).toBe('super-secret-key-value')
    expect(parsed.model).toBe('anthropic/claude-opus')
    expect(parsed.timezone).toBe('America/New_York')
    expect((parsed.agent as Record<string, unknown>).max_turns).toBe(50)
    // The slice is the new block.
    expect(Object.keys(parsed.mcp_servers as object).sort()).toEqual(['context7', 'myserver'])
  })

  it('removes the mcp_servers key entirely when the last server is removed', async () => {
    await writeFile(configPathFor(home), SEED, 'utf8')
    await writeMcpServers(home, {})
    const parsed = parseYaml(await readFile(configPathFor(home), 'utf8')) as Record<string, unknown>
    expect('mcp_servers' in parsed).toBe(false)
    expect(parsed.API_SERVER_KEY).toBe('super-secret-key-value')
  })

  it('creates a config with just the slice when none existed', async () => {
    await writeMcpServers(home, { x: { url: 'https://x/mcp' } })
    const parsed = parseYaml(await readFile(configPathFor(home), 'utf8')) as Record<string, unknown>
    expect(Object.keys(parsed.mcp_servers as object)).toEqual(['x'])
  })

  it('refuses a config.yaml that symlinks outside the hermes home', async () => {
    // A config.yaml symlink pointing at a sibling file outside home must be refused.
    const outside = await mkdtemp(join(tmpdir(), 'mcp-outside-'))
    const victim = join(outside, 'victim.yaml')
    await writeFile(victim, 'untouched: true\n', 'utf8')
    await mkdir(join(home), { recursive: true })
    await symlink(victim, configPathFor(home))
    try {
      // The realpath of config.yaml resolves outside home → refuse.
      await expect(writeMcpServers(home, { x: { url: 'https://x/mcp' } })).rejects.toThrow()
      // The victim file is untouched.
      expect(await readFile(victim, 'utf8')).toBe('untouched: true\n')
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })
})

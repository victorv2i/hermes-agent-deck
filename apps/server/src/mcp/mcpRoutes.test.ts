import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { McpState, McpMutationResult, McpTestResult } from '@agent-deck/protocol'
import { DashboardClient } from '../hermes/dashboardClient'
import type { ExecFileLike } from '../system/hermesCli'
import { registerMcpRoutes } from './mcpRoutes'
import { configPathFor } from './mcpConfig'

let app: FastifyInstance | undefined
let home: string
let catalogDir: string

const SEED = `model: anthropic/claude-opus
API_SERVER_KEY: super-secret-key-value
mcp_servers:
  context7:
    url: https://mcp.context7.com/mcp
    auth: oauth
  local-tool:
    command: codex
    args:
      - mcp-server
    enabled: false
timezone: America/New_York
`

const LINEAR = `manifest_version: 1
name: linear
description: Find, create, and update Linear issues.
source: https://linear.app/docs/mcp
transport:
  type: http
  url: https://mcp.linear.app/mcp
auth:
  type: oauth
`

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'mcp-routes-home-'))
  catalogDir = await mkdtemp(join(tmpdir(), 'mcp-routes-cat-'))
  await writeFile(configPathFor(home), SEED, 'utf8')
  await mkdir(join(catalogDir, 'linear'), { recursive: true })
  await writeFile(join(catalogDir, 'linear', 'manifest.yaml'), LINEAR, 'utf8')
})
afterEach(async () => {
  await app?.close()
  app = undefined
  await rm(home, { recursive: true, force: true })
  await rm(catalogDir, { recursive: true, force: true })
})

/** Fake hermes dashboard for the masked key store via PUT /api/env. */
function makeFakeDashboard(): {
  fetchImpl: typeof fetch
  puts: Array<{ key: string; value: string }>
} {
  const puts: Array<{ key: string; value: string }> = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input.toString())
    const method = (init?.method ?? 'GET').toUpperCase()
    const json = (status: number, body: unknown): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    if (method === 'GET' && url.pathname === '/') {
      return new Response(
        `<!doctype html><script>window.__HERMES_SESSION_TOKEN__="tok";</script>`,
        { status: 200, headers: { 'Content-Type': 'text/html' } },
      )
    }
    if (method === 'PUT' && url.pathname === '/api/env') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { key: string; value: string }
      puts.push(body)
      return json(200, { ok: true, key: body.key })
    }
    return json(404, { error: 'not found' })
  }) as unknown as typeof fetch
  return { fetchImpl, puts }
}

/** A stub execFile returning canned stdout for `hermes mcp test <name>`. */
function makeExecFile(stdout: string, opts: { fail?: boolean } = {}): ExecFileLike {
  return ((_file, _args, _options, cb) => {
    if (opts.fail) {
      const err = new Error('spawn ENOENT') as Error & { code?: string }
      err.code = 'ENOENT'
      cb(err, '', '')
      return undefined
    }
    cb(null, stdout, '')
    return undefined
  }) as ExecFileLike
}

async function buildTestApp(
  execFile: ExecFileLike,
): Promise<{ app: FastifyInstance; puts: Array<{ key: string; value: string }> }> {
  const f = Fastify({ logger: false })
  const { fetchImpl, puts } = makeFakeDashboard()
  const dashboard = new DashboardClient({
    hermesDashboardUrl: 'http://127.0.0.1:9123',
    hermesDashboardHost: '127.0.0.1:9123',
    fetchImpl,
  })
  await f.register(registerMcpRoutes, {
    hermesBin: 'hermes',
    hermesHome: home,
    catalogDir,
    dashboard,
    execFile,
  })
  await f.ready()
  return { app: f, puts }
}

const NOOP_EXEC = makeExecFile('')

describe('GET /api/agent-deck/mcp', () => {
  it('lists configured servers (enabled flag, NOT a connected state) + catalog', async () => {
    ;({ app } = await buildTestApp(NOOP_EXEC))
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/mcp' })
    expect(res.statusCode).toBe(200)
    const body = McpState.parse(res.json())
    expect(body.servers.map((s) => s.name)).toEqual(['context7', 'local-tool'])
    const ctx = body.servers.find((s) => s.name === 'context7')!
    expect(ctx.transport).toBe('http')
    expect(ctx.authKind).toBe('oauth')
    expect(ctx.enabled).toBe(true)
    expect(body.servers.find((s) => s.name === 'local-tool')!.enabled).toBe(false)
    // Catalog: linear present, not installed.
    expect(body.catalog.map((c) => c.name)).toEqual(['linear'])
    expect(body.catalog[0]!.installed).toBe(false)
  })

  it('NEVER surfaces the API_SERVER_KEY or any other config secret', async () => {
    ;({ app } = await buildTestApp(NOOP_EXEC))
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/mcp' })
    expect(res.body).not.toContain('super-secret-key-value')
  })
})

describe('POST /api/agent-deck/mcp (add)', () => {
  it('writes a new http server into the mcp_servers slice, restartRequired', async () => {
    ;({ app } = await buildTestApp(NOOP_EXEC))
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/mcp',
      payload: { name: 'my-http', transport: 'http', url: 'https://my.example/mcp' },
    })
    expect(res.statusCode).toBe(200)
    const body = McpMutationResult.parse(res.json())
    expect(body.restartRequired).toBe(true)
    expect(body.state.servers.map((s) => s.name)).toContain('my-http')
    // The config file was written; untouched keys survive.
    const parsed = parseYaml(await readFile(configPathFor(home), 'utf8')) as Record<string, unknown>
    expect(parsed.API_SERVER_KEY).toBe('super-secret-key-value')
    expect(Object.keys(parsed.mcp_servers as object).sort()).toEqual([
      'context7',
      'local-tool',
      'my-http',
    ])
  })

  it('stores a masked key via /api/env (NOT in config.yaml) and references the env var', async () => {
    let puts: Array<{ key: string; value: string }>
    ;({ app, puts } = await buildTestApp(NOOP_EXEC))
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/mcp',
      payload: {
        name: 'keyed',
        transport: 'http',
        url: 'https://keyed.example/mcp',
        apiKeyEnvVar: 'MCP_KEYED_API_KEY',
        apiKeyValue: 'plaintext-secret-123',
      },
    })
    expect(res.statusCode).toBe(200)
    // The masked key went to /api/env, NOT into config.yaml.
    expect(puts).toEqual([{ key: 'MCP_KEYED_API_KEY', value: 'plaintext-secret-123' }])
    const configText = await readFile(configPathFor(home), 'utf8')
    expect(configText).not.toContain('plaintext-secret-123')
    // The entry references the env var via a ${VAR} header.
    expect(configText).toContain('${MCP_KEYED_API_KEY}')
    // And the plaintext never appears in the response body.
    expect(res.body).not.toContain('plaintext-secret-123')
  })

  it('rejects protected env var names before calling /api/env or writing config', async () => {
    let puts: Array<{ key: string; value: string }>
    ;({ app, puts } = await buildTestApp(NOOP_EXEC))

    for (const apiKeyEnvVar of [
      'PATH',
      'NODE_OPTIONS',
      'HERMES_HOME',
      'LD_PRELOAD',
      // PYTHON* = code-injection into the Python Hermes process on next restart.
      'PYTHONSTARTUP',
      'PYTHONPATH',
      // provider/cloud credential names a malicious MCP must not get the user to
      // store (clobbering / harvesting another provider's real key).
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'AWS_SECRET_ACCESS_KEY',
      'GITHUB_TOKEN',
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/agent-deck/mcp',
        payload: {
          name: `blocked-${apiKeyEnvVar.toLowerCase().replaceAll('_', '-')}`,
          transport: 'http',
          url: 'https://blocked.example/mcp',
          apiKeyEnvVar,
          apiKeyValue: 'plaintext-secret-123',
        },
      })
      expect(res.statusCode).toBe(400)
    }

    expect(puts).toEqual([])
    const parsed = parseYaml(await readFile(configPathFor(home), 'utf8')) as Record<string, unknown>
    expect(Object.keys(parsed.mcp_servers as object).sort()).toEqual(['context7', 'local-tool'])
  })

  it('rejects a duplicate name with 409', async () => {
    ;({ app } = await buildTestApp(NOOP_EXEC))
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/mcp',
      payload: { name: 'context7', transport: 'http', url: 'https://x/mcp' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('rejects an http server with no url', async () => {
    ;({ app } = await buildTestApp(NOOP_EXEC))
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/mcp',
      payload: { name: 'bad', transport: 'http' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('PATCH /api/agent-deck/mcp/:name (toggle)', () => {
  it('flips the enabled config flag, restartRequired', async () => {
    ;({ app } = await buildTestApp(NOOP_EXEC))
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/agent-deck/mcp/context7',
      payload: { enabled: false },
    })
    expect(res.statusCode).toBe(200)
    const body = McpMutationResult.parse(res.json())
    expect(body.state.servers.find((s) => s.name === 'context7')!.enabled).toBe(false)
    const parsed = parseYaml(await readFile(configPathFor(home), 'utf8')) as Record<string, unknown>
    expect((parsed.mcp_servers as Record<string, Record<string, unknown>>).context7!.enabled).toBe(
      false,
    )
  })

  it('404s an unknown server', async () => {
    ;({ app } = await buildTestApp(NOOP_EXEC))
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/agent-deck/mcp/nope',
      payload: { enabled: true },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /api/agent-deck/mcp/:name (remove)', () => {
  it('removes the server from the slice, restartRequired', async () => {
    ;({ app } = await buildTestApp(NOOP_EXEC))
    const res = await app.inject({ method: 'DELETE', url: '/api/agent-deck/mcp/local-tool' })
    expect(res.statusCode).toBe(200)
    const body = McpMutationResult.parse(res.json())
    expect(body.state.servers.map((s) => s.name)).toEqual(['context7'])
    const parsed = parseYaml(await readFile(configPathFor(home), 'utf8')) as Record<string, unknown>
    expect(Object.keys(parsed.mcp_servers as object)).toEqual(['context7'])
  })

  it('404s an unknown server', async () => {
    ;({ app } = await buildTestApp(NOOP_EXEC))
    const res = await app.inject({ method: 'DELETE', url: '/api/agent-deck/mcp/nope' })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/agent-deck/mcp/:name/test (real probe)', () => {
  const CONNECTED = `  Testing 'context7'...\n  ✓ Connected (10ms)\n  ✓ Tools discovered: 1\n\n    foo  does a thing\n`

  it('parses a successful probe into discovered tools + an OAuth caveat (oauth server)', async () => {
    ;({ app } = await buildTestApp(makeExecFile(CONNECTED)))
    const res = await app.inject({ method: 'POST', url: '/api/agent-deck/mcp/context7/test' })
    expect(res.statusCode).toBe(200)
    const body = McpTestResult.parse(res.json())
    expect(body.ok).toBe(true)
    expect(body.tools).toEqual([{ name: 'foo', description: 'does a thing' }])
    // context7 is oauth → a clean probe is NOT proof of auth.
    expect(body.authCaveat).toMatch(/hermes mcp login context7/i)
  })

  it('returns an honest failed probe (not a 500) when the CLI cannot run', async () => {
    ;({ app } = await buildTestApp(makeExecFile('', { fail: true })))
    const res = await app.inject({ method: 'POST', url: '/api/agent-deck/mcp/context7/test' })
    expect(res.statusCode).toBe(200)
    const body = McpTestResult.parse(res.json())
    expect(body.ok).toBe(false)
    expect(body.tools).toEqual([])
  })

  it('404s a probe for an unknown server', async () => {
    ;({ app } = await buildTestApp(NOOP_EXEC))
    const res = await app.inject({ method: 'POST', url: '/api/agent-deck/mcp/nope/test' })
    expect(res.statusCode).toBe(404)
  })
})

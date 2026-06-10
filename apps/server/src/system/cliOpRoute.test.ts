import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import { CliOpResponse } from '@agent-deck/protocol'
import { registerCliOpRoute, type CliOpRouteDeps } from './cliOpRoute'
import type { ExecFileLike } from './hermesCli'

/**
 * POST /api/agent-deck/cli-op route tests.
 *
 * Pins: 400 on invalid body, 400 on unknown opId, correct argv dispatch,
 * secret scrubbing, schema slim (only whitelisted keys cross the wire).
 */

function scriptedExec(
  responses: Record<string, { stdout?: string; exitErr?: boolean }>,
): ExecFileLike {
  return (_file, args, _opts, cb) => {
    const key = args.join(' ')
    const match =
      responses[key] ?? responses[Object.keys(responses).find((k) => key.startsWith(k)) ?? ''] ?? {}
    if (match.exitErr) {
      cb(Object.assign(new Error('exit 1'), { code: 1 }) as never, match.stdout ?? '', '')
    } else {
      cb(null, match.stdout ?? '', '')
    }
    return undefined as never
  }
}

async function buildApp(over: Partial<CliOpRouteDeps> = {}) {
  const app = Fastify({ logger: false })
  await app.register(registerCliOpRoute, {
    hermesBin: 'hermes',
    execFile: scriptedExec({
      'auth list': { stdout: 'nous (1 credentials):\n  #1  my-cred  oauth  manual  ←\n' },
      'auth status nous': { stdout: 'nous: logged in\n' },
      'auth logout nous': { stdout: 'nous: logged out\n' },
      'tools list --platform cli': { stdout: 'Built-in toolsets (cli):\n' },
      'doctor --fix': { stdout: '✓ Created ~/.hermes/.env\n' },
    }),
    ...over,
  })
  return app
}

describe('POST /api/agent-deck/cli-op', () => {
  it('returns 400 when body is missing opId', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/agent-deck/cli-op', payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when opId is not in the whitelist', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/cli-op',
      payload: { opId: 'rm-rf', params: {} },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when provider has shell metacharacters', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/cli-op',
      payload: { opId: 'auth-status', params: { provider: 'nous; rm -rf ~' } },
    })
    expect(res.statusCode).toBe(400)
  })

  it('dispatches doctor-fix correctly', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/cli-op',
      payload: { opId: 'doctor-fix' },
    })
    expect(res.statusCode).toBe(200)
    const body = CliOpResponse.parse(res.json())
    expect(body.ok).toBe(true)
    expect(body.exitCode).toBe(0)
  })

  it('dispatches auth-list correctly', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/cli-op',
      payload: { opId: 'auth-list' },
    })
    expect(res.statusCode).toBe(200)
    const body = CliOpResponse.parse(res.json())
    expect(body.ok).toBe(true)
    expect(body.stdout).toBeTruthy()
  })

  it('dispatches auth-status with valid provider', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/cli-op',
      payload: { opId: 'auth-status', params: { provider: 'nous' } },
    })
    expect(res.statusCode).toBe(200)
    const body = CliOpResponse.parse(res.json())
    expect(body.ok).toBe(true)
    const parsed = body.parsed as { logged_in: boolean }
    expect(parsed.logged_in).toBe(true)
  })

  it('returns ok:false with body when op exits non-zero (stdout still captured)', async () => {
    const app = await buildApp({
      execFile: scriptedExec({
        'doctor --fix': { stdout: 'Could not fix\n', exitErr: true },
      }),
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/cli-op',
      payload: { opId: 'doctor-fix' },
    })
    // Route should still return 200 (the op ran — it's the op's result that failed)
    expect(res.statusCode).toBe(200)
    const body = CliOpResponse.parse(res.json())
    expect(body.ok).toBe(false)
    expect(body.stdout.length).toBeGreaterThan(0)
  })

  it('response body contains only whitelisted CliOpResponse keys', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/cli-op',
      payload: { opId: 'auth-list' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as Record<string, unknown>
    // The parse through CliOpResponse.parse strips extra keys in the schema
    const allowedKeys = new Set(['ok', 'stdout', 'summary', 'exitCode', 'parsed'])
    for (const key of Object.keys(body)) {
      expect(allowedKeys.has(key)).toBe(true)
    }
  })

  it('scrubs token-shaped strings from the response stdout', async () => {
    const secret = 'sk-abcdef1234567890abcdef1234567890'
    const app = await buildApp({
      execFile: scriptedExec({
        'auth list': { stdout: `nous (1 credentials):\n  #1  ${secret}  oauth  manual\n` },
      }),
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/cli-op',
      payload: { opId: 'auth-list' },
    })
    const body = res.json() as Record<string, unknown>
    expect(JSON.stringify(body)).not.toContain(secret)
  })
})

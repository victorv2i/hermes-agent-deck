import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SetupStatus, AgentDeckProviderKeyResponse } from '@agent-deck/protocol'
import { registerSetupRoutes, type SetupRouteDeps } from './setupRoute'
import type { ExecFileLike } from '../system/hermesCli'

/**
 * GET /api/agent-deck/setup-status — a SEPARATE low-level readiness probe (NOT a
 * proxy of /api/status, which presupposes the dashboard is up):
 *   hermesInstalled  ← which/`hermes version` resolves
 *   providerConnected ← a usable model is reported (injected probe)
 *   agentNamed       ← the default profile has identity.json
 *
 * POST /api/agent-deck/setup/provider-key — guarded `hermes auth add <provider>
 * --type api-key --api-key <key>`. The key is a LIVE SECRET: it is masked, NEVER
 * echoed in the response, and NEVER written to any log/argv sink. The
 * secret-scrub test is the load-bearing assertion.
 */

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'setup-route-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

function okExec(): ExecFileLike {
  return (_file, _args, _opts, cb) => {
    cb(null, 'Hermes Agent v0.15.1 (2026.5.29)\n', '')
    return undefined as never
  }
}

function buildDeps(over: Partial<SetupRouteDeps> = {}): SetupRouteDeps {
  return {
    hermesHome: home,
    hermesBin: 'hermes',
    execFile: okExec(),
    probeProviderConnected: async () => true,
    ...over,
  }
}

async function mount(deps: SetupRouteDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(registerSetupRoutes, deps)
  await app.ready()
  return app
}

describe('GET /api/agent-deck/setup-status', () => {
  it('reports hermesInstalled true when `hermes version` resolves', async () => {
    const app = await mount(buildDeps())
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/setup-status' })
    expect(res.statusCode).toBe(200)
    const body = SetupStatus.parse(res.json())
    expect(body.hermesInstalled).toBe(true)
    await app.close()
  })

  it('reports hermesInstalled false when hermes cannot spawn (ENOENT)', async () => {
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      cb(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }), '', '')
      return undefined as never
    }
    const app = await mount(buildDeps({ execFile: exec }))
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/setup-status' })
    const body = SetupStatus.parse(res.json())
    expect(body.hermesInstalled).toBe(false)
    await app.close()
  })

  it('reports agentNamed true only when the default profile has identity.json', async () => {
    const before = await mount(buildDeps())
    expect(
      SetupStatus.parse((await before.inject({ url: '/api/agent-deck/setup-status' })).json())
        .agentNamed,
    ).toBe(false)
    await before.close()

    mkdirSync(join(home, '.agent-deck'), { recursive: true })
    writeFileSync(join(home, '.agent-deck', 'identity.json'), JSON.stringify({ avatar: 'v1' }))
    const after = await mount(buildDeps())
    const body = SetupStatus.parse(
      (await after.inject({ url: '/api/agent-deck/setup-status' })).json(),
    )
    expect(body.agentNamed).toBe(true)
    await after.close()
  })

  it('reflects the injected providerConnected probe', async () => {
    const app = await mount(buildDeps({ probeProviderConnected: async () => false }))
    const body = SetupStatus.parse(
      (await app.inject({ url: '/api/agent-deck/setup-status' })).json(),
    )
    expect(body.providerConnected).toBe(false)
    await app.close()
  })

  it('fails closed (providerConnected false) when the probe throws', async () => {
    const app = await mount(
      buildDeps({
        probeProviderConnected: async () => {
          throw new Error('dashboard down')
        },
      }),
    )
    const body = SetupStatus.parse(
      (await app.inject({ url: '/api/agent-deck/setup-status' })).json(),
    )
    expect(body.providerConnected).toBe(false)
    await app.close()
  })
})

describe('POST /api/agent-deck/setup/provider-key', () => {
  const SECRET = 'sk-or-v1-LIVE-DO-NOT-LEAK-0123456789'

  it('runs `hermes auth add <provider> --type api-key --api-key <key>` with argv (no shell) and echoes NO key', async () => {
    const calls: Array<{ file: string; args: string[]; opts: Record<string, unknown> }> = []
    const exec: ExecFileLike = (file, args, opts, cb) => {
      calls.push({ file, args, opts: opts as Record<string, unknown> })
      cb(null, 'Credential added.', '')
      return undefined as never
    }
    const app = await mount(buildDeps({ execFile: exec, probeProviderConnected: async () => true }))
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/setup/provider-key',
      payload: { provider: 'openrouter', apiKey: SECRET },
    })
    expect(res.statusCode).toBe(200)
    const body = AgentDeckProviderKeyResponse.parse(res.json())
    expect(body.provider).toBe('openrouter')
    expect(body.connected).toBe(true)

    // The auth-add invocation used argv, never a shell, and carried the secret as
    // a discrete argument (inert data) — provider is a positional, credential
    // kind is explicit, and the key is a flag value.
    const addCall = calls.find((c) => c.args.includes('add'))!
    expect(addCall.args).toEqual([
      'auth',
      'add',
      'openrouter',
      '--type',
      'api-key',
      '--api-key',
      SECRET,
    ])
    expect(addCall.opts.shell ?? false).toBeFalsy()

    // The RESPONSE never carries the key.
    expect(res.payload).not.toContain(SECRET)
  })

  it('NEVER writes the api key to any log sink (argv is redacted)', async () => {
    const logged: string[] = []
    const consoleSpy = vi.spyOn(console, 'log')
    const consoleErrSpy = vi.spyOn(console, 'error')
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      cb(null, 'Credential added.', '')
      return undefined as never
    }
    const app = await mount(buildDeps({ execFile: exec, log: (line) => logged.push(line) }))
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/setup/provider-key',
      payload: { provider: 'openrouter', apiKey: SECRET },
    })
    expect(res.statusCode).toBe(200)

    const everything = [
      logged.join('\n'),
      JSON.stringify(consoleSpy.mock.calls),
      JSON.stringify(consoleErrSpy.mock.calls),
      res.payload,
    ].join('\n')
    expect(everything).not.toContain(SECRET)
    // But the route DID record an audit line — with the value redacted.
    expect(logged.join('\n')).toContain('[redacted]')
    expect(logged.join('\n')).toContain('openrouter')

    consoleSpy.mockRestore()
    consoleErrSpy.mockRestore()
    await app.close()
  })

  it('rejects a missing/empty provider or apiKey with 400 (no exec)', async () => {
    let execCalls = 0
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      execCalls += 1
      cb(null, '', '')
      return undefined as never
    }
    const app = await mount(buildDeps({ execFile: exec }))
    for (const payload of [
      { provider: '', apiKey: SECRET },
      { provider: 'openrouter', apiKey: '' },
      { provider: 'openrouter' },
      {},
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/agent-deck/setup/provider-key',
        payload,
      })
      expect(res.statusCode).toBe(400)
    }
    expect(execCalls).toBe(0)
    await app.close()
  })

  it('returns connected:false when the key is added but no usable model is reported', async () => {
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      cb(null, 'Credential added.', '')
      return undefined as never
    }
    const app = await mount(
      buildDeps({ execFile: exec, probeProviderConnected: async () => false }),
    )
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/setup/provider-key',
      payload: { provider: 'openrouter', apiKey: SECRET },
    })
    const body = AgentDeckProviderKeyResponse.parse(res.json())
    expect(body.connected).toBe(false)
    await app.close()
  })

  it('returns 502 (no key echoed) when `hermes auth add` itself fails', async () => {
    const exec: ExecFileLike = (_file, args, _opts, cb) => {
      if (args.includes('add')) {
        cb(Object.assign(new Error('auth failed'), { code: 1 }), '', 'invalid key')
      } else {
        cb(null, '', '')
      }
      return undefined as never
    }
    const app = await mount(buildDeps({ execFile: exec }))
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/setup/provider-key',
      payload: { provider: 'openrouter', apiKey: SECRET },
    })
    expect(res.statusCode).toBe(502)
    expect(res.payload).not.toContain(SECRET)
    await app.close()
  })
})

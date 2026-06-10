import { describe, it, expect } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  SystemState,
  GatewayRestartResponse,
  HermesUpdateApplyResult,
  HermesDoctorReport,
} from '@agent-deck/protocol'
import { registerSystemRoutes, type SystemRouteDeps } from './systemRoutes'
import type { ExecFileLike } from './hermesCli'

/**
 * GET /api/agent-deck/system → SystemState (gateway + hermes update + agent-deck
 * self-update). POST .../gateway/restart restarts then re-probes. These tests pin:
 *   - SLIM: the response carries ONLY the whitelisted SystemState keys (no PID,
 *     no path, no log tail) even when the raw `hermes gateway status` block is
 *     stuffed with internals.
 *   - FAIL CLOSED: unrecognized status/update output degrades to unknown/up-to-date.
 *   - no-channel: an empty `git remote` reports the self-update as gated-off.
 */

const GATEWAY_STATUS_BLOCK =
  '● hermes-gateway.service - Hermes Agent Gateway\n' +
  '     Loaded: loaded (/home/u/.config/systemd/user/hermes-gateway.service; enabled)\n' +
  '     Active: active (running) since Sat 2026-05-30 17:04:20 EDT; 23h ago\n' +
  '   Main PID: 767833 (hermes)\n' +
  '     Memory: 13.6G (peak: 17.4G)\n' +
  '     CGroup: /user.slice/.../hermes-gateway.service\n' +
  '             └─767833 /usr/bin/python3 -m hermes_cli.main gateway run\n' +
  '     SECRET_TOKEN_IN_LOG=sk-should-never-cross-the-wire\n'

/** A scripted execFile that answers per (subcommand) so routes can be exercised. */
function scriptedExec(
  responses: Record<string, { stdout?: string; stderr?: string; err?: Error }>,
): ExecFileLike {
  return (_file, args, _opts, cb) => {
    const key = args.join(' ')
    const match =
      responses[key] ?? responses[Object.keys(responses).find((k) => key.startsWith(k)) ?? ''] ?? {}
    if (match.err) cb(match.err, match.stdout ?? '', match.stderr ?? '')
    else cb(null, match.stdout ?? '', match.stderr ?? '')
    return undefined as never
  }
}

function buildDeps(over: Partial<SystemRouteDeps> = {}): SystemRouteDeps {
  return {
    hermesBin: 'hermes',
    execFile: scriptedExec({
      'gateway status': { stdout: GATEWAY_STATUS_BLOCK },
      'gateway restart': { stdout: 'restarted' },
      version: { stdout: 'Hermes Agent v0.15.1 (2026.5.29)\n' },
      'update --check': { stdout: '✓ Already up to date.\n' },
    }),
    agentDeckVersion: '0.1.0',
    listGitRemotes: async () => [],
    ...over,
  }
}

async function mount(deps: SystemRouteDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(registerSystemRoutes, deps)
  await app.ready()
  return app
}

describe('GET /api/agent-deck/system', () => {
  it('returns a SystemState with running gateway, up-to-date hermes, no-channel self-update', async () => {
    const app = await mount(buildDeps())
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/system' })
    expect(res.statusCode).toBe(200)
    const body = SystemState.parse(res.json())
    expect(body.gateway.status).toBe('running')
    expect(body.hermes.status).toBe('up-to-date')
    expect(body.hermes.currentVersion).toBe('0.15.1')
    expect(body.agentDeck.status).toBe('no-channel')
    expect(body.agentDeck.currentVersion).toBe('0.1.0')
    await app.close()
  })

  it('NEVER leaks PID / path / memory / log tail from the raw status block', async () => {
    const app = await mount(buildDeps())
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/system' })
    const payload = res.payload
    expect(payload).not.toContain('767833') // Main PID
    expect(payload).not.toContain('hermes-gateway.service') // unit path
    expect(payload).not.toContain('13.6G') // memory
    expect(payload).not.toContain('SECRET_TOKEN_IN_LOG')
    expect(payload).not.toContain('sk-should-never-cross-the-wire')
    // The whitelisted DTO key-set is exactly gateway/hermes/agentDeck.
    expect(Object.keys(res.json()).sort()).toEqual(['agentDeck', 'gateway', 'hermes'])
    await app.close()
  })

  it('FAILS CLOSED to unknown/up-to-date on unrecognized CLI output', async () => {
    const app = await mount(
      buildDeps({
        execFile: scriptedExec({
          'gateway status': { stdout: 'garbage banner with the word running in it' },
          version: { stdout: 'no version here' },
          'update --check': { stdout: 'network error, who knows' },
        }),
      }),
    )
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/system' })
    const body = SystemState.parse(res.json())
    expect(body.gateway.status).toBe('unknown')
    expect(body.hermes.status).toBe('up-to-date')
    expect(body.hermes.currentVersion).toBeNull()
    await app.close()
  })

  it('reports update-available when hermes update --check announces one', async () => {
    const app = await mount(
      buildDeps({
        execFile: scriptedExec({
          'gateway status': { stdout: GATEWAY_STATUS_BLOCK },
          version: { stdout: 'Hermes Agent v0.15.1 (2026.5.29)\n' },
          'update --check': { stdout: '✓ An update is available (v0.15.1 → v0.16.0)\n' },
        }),
      }),
    )
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/system' })
    const body = SystemState.parse(res.json())
    expect(body.hermes.status).toBe('update-available')
    await app.close()
  })

  it('probes BOTH channels and includes per-channel reads (stable default, latest-commit --branch main)', async () => {
    const seen: string[] = []
    const app = await mount(
      buildDeps({
        execFile: (file, args, opts, cb) => {
          void file
          void opts
          const key = args.join(' ')
          seen.push(key)
          if (key === 'gateway status') cb(null, GATEWAY_STATUS_BLOCK, '')
          else if (key === 'version') cb(null, 'Hermes Agent v0.15.1 (2026.5.29)\n', '')
          // stable channel: the default check (no --branch) is up to date.
          else if (key === 'update --check') cb(null, '✓ Already up to date.\n', '')
          // latest-commit channel: the branch-tip check reports an update.
          else if (key === 'update --check --branch main')
            cb(null, '✓ An update is available (v0.15.1 → v0.16.0)\n', '')
          else cb(null, '', '')
          return undefined as never
        },
      }),
    )
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/system' })
    const body = SystemState.parse(res.json())
    // Both real CLI invocations happened — the stable default AND the branch tip.
    expect(seen).toContain('update --check')
    expect(seen).toContain('update --check --branch main')
    const channels = body.hermes.channels ?? []
    expect(channels.map((c) => c.channel).sort()).toEqual(['latest-commit', 'stable'])
    expect(channels.find((c) => c.channel === 'stable')!.status).toBe('up-to-date')
    expect(channels.find((c) => c.channel === 'latest-commit')!.status).toBe('update-available')
    await app.close()
  })

  it('reports the self-update as idle (not no-channel) when a git remote exists', async () => {
    const app = await mount(buildDeps({ listGitRemotes: async () => ['origin'] }))
    const res = await app.inject({ method: 'GET', url: '/api/agent-deck/system' })
    const body = SystemState.parse(res.json())
    // A configured remote means the channel exists; v1 still ships the apply gated
    // off, but the STATUS is no longer "no-channel".
    expect(body.agentDeck.status).not.toBe('no-channel')
    await app.close()
  })
})

describe('POST /api/agent-deck/system/gateway/restart', () => {
  it('restarts then returns the re-probed (running) gateway state', async () => {
    const app = await mount(buildDeps())
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/system/gateway/restart',
    })
    expect(res.statusCode).toBe(200)
    const body = GatewayRestartResponse.parse(res.json())
    expect(body.status).toBe('running')
    // Only the slim status key crosses the wire.
    expect(Object.keys(res.json())).toEqual(['status'])
    await app.close()
  })

  it('still returns a re-probed state (unknown) when the restart command fails', async () => {
    const app = await mount(
      buildDeps({
        execFile: scriptedExec({
          'gateway restart': { err: Object.assign(new Error('boom'), { code: 1 }), stderr: 'x' },
          'gateway status': { stdout: '     Active: failed (Result: exit-code)\n' },
        }),
      }),
    )
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/system/gateway/restart',
    })
    expect(res.statusCode).toBe(200)
    const body = GatewayRestartResponse.parse(res.json())
    expect(body.status).toBe('failed')
    await app.close()
  })
})

describe('POST /api/agent-deck/system/hermes/update', () => {
  it('runs `hermes update --backup --yes`, returns the scrubbed log + re-probed version', async () => {
    let applyArgs: string[] | null = null
    const app = await mount(
      buildDeps({
        execFile: (file, args, opts, cb) => {
          const key = args.join(' ')
          if (key === 'update --backup --yes') {
            applyArgs = args
            cb(null, 'Backed up. Updated to v0.16.0.\n', '')
          } else if (key === 'version') {
            cb(null, 'Hermes Agent v0.16.0 (2026.6.1)\n', '')
          } else if (key === 'gateway status') {
            cb(null, GATEWAY_STATUS_BLOCK, '')
          } else if (key === 'update --check') {
            cb(null, '✓ Already up to date.\n', '')
          } else {
            cb(null, '', '')
          }
          void opts
          void file
          return undefined as never
        },
      }),
    )
    const res = await app.inject({ method: 'POST', url: '/api/agent-deck/system/hermes/update' })
    expect(res.statusCode).toBe(200)
    // The apply ran the EXACT --backup --yes argv (never a shell string).
    expect(applyArgs).toEqual(['update', '--backup', '--yes'])
    const body = HermesUpdateApplyResult.parse(res.json())
    expect(body.status).toBe('up-to-date')
    expect(body.currentVersion).toBe('0.16.0')
    expect(body.log.join('\n')).toContain('Updated to v0.16.0')
    await app.close()
  })

  it('reports failed (with the captured log) when the update command exits non-zero', async () => {
    const app = await mount(
      buildDeps({
        execFile: scriptedExec({
          'update --backup --yes': {
            err: Object.assign(new Error('exit 1'), { code: 1 }),
            stdout: 'Fetching...\n',
            stderr: 'fatal: could not update\n',
          },
          version: { stdout: 'Hermes Agent v0.15.1 (2026.5.29)\n' },
        }),
      }),
    )
    const res = await app.inject({ method: 'POST', url: '/api/agent-deck/system/hermes/update' })
    expect(res.statusCode).toBe(200)
    const body = HermesUpdateApplyResult.parse(res.json())
    expect(body.status).toBe('failed')
    // The failure log still surfaces (honest), and the re-probe shows the version
    // is unchanged (the apply did not land).
    expect(body.log.join('\n')).toMatch(/could not update/)
    expect(body.currentVersion).toBe('0.15.1')
    await app.close()
  })

  it('SCRUBS token-shaped strings from the streamed log before it crosses the wire', async () => {
    const app = await mount(
      buildDeps({
        execFile: scriptedExec({
          'update --backup --yes': {
            stdout:
              'Cloning https://x-access-token:sk-LIVE0123456789abcdefSECRET@github.com/x.git\n' +
              'Done.\n',
          },
          version: { stdout: 'Hermes Agent v0.16.0\n' },
        }),
      }),
    )
    const res = await app.inject({ method: 'POST', url: '/api/agent-deck/system/hermes/update' })
    const payload = res.payload
    expect(payload).not.toContain('sk-LIVE0123456789abcdefSECRET')
    expect(payload).toContain('[redacted]')
    await app.close()
  })

  it('reports failed (not a 500) when the update command cannot spawn at all', async () => {
    const app = await mount(
      buildDeps({
        execFile: scriptedExec({
          'update --backup --yes': {
            err: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
          },
          version: { err: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) },
        }),
      }),
    )
    const res = await app.inject({ method: 'POST', url: '/api/agent-deck/system/hermes/update' })
    expect(res.statusCode).toBe(200)
    const body = HermesUpdateApplyResult.parse(res.json())
    expect(body.status).toBe('failed')
    expect(body.currentVersion).toBeNull()
    await app.close()
  })

  it('defaults to the STABLE channel argv (no --branch) when no channel is given', async () => {
    let applyArgs: string[] | null = null
    const app = await mount(
      buildDeps({
        execFile: (file, args, opts, cb) => {
          void file
          void opts
          const key = args.join(' ')
          if (key.startsWith('update --backup')) {
            applyArgs = args
            cb(null, 'Updated.\n', '')
          } else if (key === 'version') cb(null, 'Hermes Agent v0.16.0\n', '')
          else cb(null, '', '')
          return undefined as never
        },
      }),
    )
    const res = await app.inject({ method: 'POST', url: '/api/agent-deck/system/hermes/update' })
    expect(res.statusCode).toBe(200)
    // Stable = the default channel: NO --branch flag.
    expect(applyArgs).toEqual(['update', '--backup', '--yes'])
    const body = HermesUpdateApplyResult.parse(res.json())
    expect(body.channel).toBe('stable')
    await app.close()
  })

  it('targets the LATEST-COMMIT branch tip (--branch main) when channel=latest-commit', async () => {
    let applyArgs: string[] | null = null
    const app = await mount(
      buildDeps({
        execFile: (file, args, opts, cb) => {
          void file
          void opts
          const key = args.join(' ')
          if (key.startsWith('update --branch')) {
            applyArgs = args
            cb(null, 'Updated to branch tip.\n', '')
          } else if (key === 'version') cb(null, 'Hermes Agent v0.16.0\n', '')
          else cb(null, '', '')
          return undefined as never
        },
      }),
    )
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/system/hermes/update',
      payload: { channel: 'latest-commit' },
    })
    expect(res.statusCode).toBe(200)
    // Latest commit = the branch tip: --branch main, still backed up + non-interactive.
    expect(applyArgs).toEqual(['update', '--branch', 'main', '--backup', '--yes'])
    const body = HermesUpdateApplyResult.parse(res.json())
    expect(body.channel).toBe('latest-commit')
    await app.close()
  })

  it('rejects an unknown channel value (no fabricated channel)', async () => {
    const app = await mount(buildDeps())
    const res = await app.inject({
      method: 'POST',
      url: '/api/agent-deck/system/hermes/update',
      payload: { channel: 'nightly-tag' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})

describe('POST /api/agent-deck/system/doctor', () => {
  const DOCTOR_OUTPUT = [
    '◆ Python Environment',
    '  ✓ Python 3.14.3',
    '  ⚠ Not in virtual environment (recommended)',
    '◆ Auth Providers',
    '  ✓ OpenAI Codex auth (logged in)',
    '────────────────────────────────────────────',
    '  Found 1 issue(s) to address:',
    "  1. Run 'hermes setup' to configure API keys",
  ].join('\n')

  it('runs `hermes doctor` and returns the slim health rollup', async () => {
    let doctorArgs: string[] | null = null
    const app = await mount(
      buildDeps({
        execFile: (file, args, opts, cb) => {
          void file
          void opts
          if (args.join(' ') === 'doctor') {
            doctorArgs = args
            cb(null, DOCTOR_OUTPUT, '')
          } else cb(null, '', '')
          return undefined as never
        },
      }),
    )
    const res = await app.inject({ method: 'POST', url: '/api/agent-deck/system/doctor' })
    expect(res.statusCode).toBe(200)
    // The exact argv was `hermes doctor` (no --fix; this is a read-only health check).
    expect(doctorArgs).toEqual(['doctor'])
    const body = HermesDoctorReport.parse(res.json())
    expect(body.status).toBe('warnings')
    expect(body.counts).toEqual({ ok: 2, warning: 1, error: 0 })
    expect(body.summary[0]).toMatch(/hermes setup/)
    // SLIM: only the whitelisted keys cross the wire.
    expect(Object.keys(res.json()).sort()).toEqual(['counts', 'sections', 'status', 'summary'])
    await app.close()
  })

  it('SCRUBS token-shaped strings from the doctor summary before it crosses the wire', async () => {
    const app = await mount(
      buildDeps({
        execFile: (file, args, opts, cb) => {
          void file
          void opts
          if (args.join(' ') === 'doctor') {
            cb(
              null,
              [
                '◆ Auth',
                '  ⚠ Token looks wrong',
                '  Found 1 issue(s) to address:',
                '  1. Re-auth with sk-LIVE0123456789abcdefSECRET in your env',
              ].join('\n'),
              '',
            )
          } else cb(null, '', '')
          return undefined as never
        },
      }),
    )
    const res = await app.inject({ method: 'POST', url: '/api/agent-deck/system/doctor' })
    const payload = res.payload
    expect(payload).not.toContain('sk-LIVE0123456789abcdefSECRET')
    expect(payload).toContain('[redacted]')
    await app.close()
  })

  it('reports the honest unavailable state when doctor cannot run', async () => {
    const app = await mount(
      buildDeps({
        execFile: scriptedExec({
          doctor: { err: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) },
        }),
      }),
    )
    const res = await app.inject({ method: 'POST', url: '/api/agent-deck/system/doctor' })
    expect(res.statusCode).toBe(200)
    const body = HermesDoctorReport.parse(res.json())
    expect(body.status).toBe('unavailable')
    await app.close()
  })
})

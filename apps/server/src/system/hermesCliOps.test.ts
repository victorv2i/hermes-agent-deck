import { describe, it, expect } from 'vitest'
import {
  ALLOWED_OPS,
  dispatchHermesOp,
  parseAuthList,
  parseAuthStatus,
  parseToolsList,
  parseDoctorFix,
  KNOWN_PROVIDERS,
  type HermesCliOpParams,
} from './hermesCliOps'
import type { ExecFileLike } from './hermesCli'

/**
 * hermesCliOps — the "Do It For Me" whitelist layer.
 *
 * SECURITY INVARIANTS TESTED:
 *  1. Unknown opId → rejected before execFile is ever called.
 *  2. Provider param not in KNOWN_PROVIDERS → rejected before execFile.
 *  3. Secret args (API keys) never appear in stdout/summary response.
 *  4. Exit-code handling: non-zero → ok:false, zero → ok:true.
 *  5. stdout parsers fail-closed on empty/garbage output.
 *  6. dispatchHermesOp always goes through the whitelist — raw user strings
 *     are never passed as argv fragments.
 */

/** A scripted execFile that records calls and returns preset outputs. */
function scriptedExec(
  responses: Record<string, { stdout?: string; stderr?: string; exitErr?: boolean }>,
  calls: string[][] = [],
): ExecFileLike {
  return (_file, args, _opts, cb) => {
    calls.push(args)
    const key = args.join(' ')
    const match =
      responses[key] ?? responses[Object.keys(responses).find((k) => key.startsWith(k)) ?? ''] ?? {}
    if (match.exitErr) {
      const err = Object.assign(new Error('exit 1'), { code: 1 })
      cb(err as never, match.stdout ?? '', match.stderr ?? '')
    } else {
      cb(null, match.stdout ?? '', match.stderr ?? '')
    }
    return undefined as never
  }
}

// ─── Whitelist rejection ───────────────────────────────────────────────────────

describe('dispatchHermesOp — whitelist rejection', () => {
  it('rejects an unknown opId without ever calling execFile', async () => {
    const calls: string[][] = []
    const exec = scriptedExec({}, calls)
    const result = await dispatchHermesOp(
      'not-a-real-op' as never,
      {},
      { hermesBin: 'hermes', execFile: exec },
    )
    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/unknown op/i)
    expect(calls).toHaveLength(0) // execFile was never called
  })

  it('rejects an empty string opId', async () => {
    const calls: string[][] = []
    const exec = scriptedExec({}, calls)
    const result = await dispatchHermesOp('' as never, {}, { hermesBin: 'hermes', execFile: exec })
    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('ALLOWED_OPS is a non-empty registry of known operations', () => {
    expect(Object.keys(ALLOWED_OPS).length).toBeGreaterThan(0)
    // Every op has an id that matches its key
    for (const [key, op] of Object.entries(ALLOWED_OPS)) {
      expect(op.id).toBe(key)
    }
  })
})

// ─── Param validation (provider enum) ─────────────────────────────────────────

describe('dispatchHermesOp — provider param validation', () => {
  it('rejects auth-status with a provider slug not in KNOWN_PROVIDERS', async () => {
    const calls: string[][] = []
    const exec = scriptedExec({}, calls)
    const result = await dispatchHermesOp(
      'auth-status',
      { provider: '../../../../etc/passwd' } as HermesCliOpParams<'auth-status'>,
      { hermesBin: 'hermes', execFile: exec },
    )
    expect(result.ok).toBe(false)
    expect(result.summary).toMatch(/invalid provider/i)
    expect(calls).toHaveLength(0)
  })

  it('rejects auth-logout with a shell-injection attempt in provider', async () => {
    const calls: string[][] = []
    const exec = scriptedExec({}, calls)
    const result = await dispatchHermesOp(
      'auth-logout',
      { provider: 'nous; rm -rf ~' } as HermesCliOpParams<'auth-logout'>,
      { hermesBin: 'hermes', execFile: exec },
    )
    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('rejects auth-status with an empty provider', async () => {
    const calls: string[][] = []
    const exec = scriptedExec({}, calls)
    const result = await dispatchHermesOp(
      'auth-status',
      { provider: '' } as HermesCliOpParams<'auth-status'>,
      { hermesBin: 'hermes', execFile: exec },
    )
    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('accepts a valid provider slug from KNOWN_PROVIDERS', async () => {
    const exec = scriptedExec({
      'auth status nous': { stdout: 'nous: logged in\n' },
    })
    const result = await dispatchHermesOp(
      'auth-status',
      { provider: 'nous' } as HermesCliOpParams<'auth-status'>,
      { hermesBin: 'hermes', execFile: exec },
    )
    expect(result.ok).toBe(true)
  })
})

// ─── Secret scrubbing ─────────────────────────────────────────────────────────

describe('dispatchHermesOp — secrets never leak in response', () => {
  it('scrubs API-key shaped strings from stdout before they reach the response', async () => {
    const fakeKey = 'sk-abcdef1234567890abcdef1234567890'
    const exec = scriptedExec({
      'auth status nous': {
        stdout: `nous: logged in\n  api_key: ${fakeKey}\n`,
      },
    })
    const result = await dispatchHermesOp(
      'auth-status',
      { provider: 'nous' } as HermesCliOpParams<'auth-status'>,
      { hermesBin: 'hermes', execFile: exec },
    )
    expect(result.stdout).not.toContain(fakeKey)
    expect(result.summary).not.toContain(fakeKey)
  })

  it('scrubs JWT-shaped strings from stdout', async () => {
    const fakeJwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyMTIzIn0.SomeSignaturePart'
    const exec = scriptedExec({
      'auth list': { stdout: `nous: 1 credential\n  #1 my-cred api_key ${fakeJwt} ←\n` },
    })
    const result = await dispatchHermesOp('auth-list', {}, { hermesBin: 'hermes', execFile: exec })
    expect(result.stdout).not.toContain(fakeJwt)
  })
})

// ─── Exit-code handling ────────────────────────────────────────────────────────

describe('dispatchHermesOp — exit-code handling', () => {
  it('returns ok:true on zero exit', async () => {
    const exec = scriptedExec({
      'doctor --fix': { stdout: '✓ All checks passed\n' },
    })
    const result = await dispatchHermesOp('doctor-fix', {}, { hermesBin: 'hermes', execFile: exec })
    expect(result.ok).toBe(true)
    expect(result.exitCode).toBe(0)
  })

  it('returns ok:false on non-zero exit (still captures stdout)', async () => {
    const exec = scriptedExec({
      'doctor --fix': { stdout: '✗ Could not fix some issues\n', exitErr: true },
    })
    const result = await dispatchHermesOp('doctor-fix', {}, { hermesBin: 'hermes', execFile: exec })
    expect(result.ok).toBe(false)
    expect(result.exitCode).not.toBe(0)
    // stdout is still captured (not discarded on failure)
    expect(result.stdout.length).toBeGreaterThan(0)
  })

  it('returns ok:false and a spawn-error summary when execFile rejects (hermes missing)', async () => {
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      cb(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }), '', '')
      return undefined as never
    }
    const result = await dispatchHermesOp('doctor-fix', {}, { hermesBin: 'hermes', execFile: exec })
    expect(result.ok).toBe(false)
    expect(result.summary.length).toBeGreaterThan(0)
  })
})

// ─── argv building (no raw user strings) ─────────────────────────────────────

describe('dispatchHermesOp — argv building', () => {
  it('auth-list calls hermes with only fixed whitelist args', async () => {
    const calls: string[][] = []
    const exec = scriptedExec({ 'auth list': { stdout: '' } }, calls)
    await dispatchHermesOp('auth-list', {}, { hermesBin: 'hermes', execFile: exec })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(['auth', 'list'])
  })

  it('auth-status appends the enum-validated provider slug', async () => {
    const calls: string[][] = []
    const exec = scriptedExec({ 'auth status nous': { stdout: '' } }, calls)
    await dispatchHermesOp(
      'auth-status',
      { provider: 'nous' } as HermesCliOpParams<'auth-status'>,
      { hermesBin: 'hermes', execFile: exec },
    )
    expect(calls[0]).toEqual(['auth', 'status', 'nous'])
  })

  it('auth-logout appends the enum-validated provider slug', async () => {
    const calls: string[][] = []
    const exec = scriptedExec({ 'auth logout nous': { stdout: '' } }, calls)
    await dispatchHermesOp(
      'auth-logout',
      { provider: 'nous' } as HermesCliOpParams<'auth-logout'>,
      { hermesBin: 'hermes', execFile: exec },
    )
    expect(calls[0]).toEqual(['auth', 'logout', 'nous'])
  })

  it('tools-list calls hermes with fixed --platform cli args', async () => {
    const calls: string[][] = []
    const exec = scriptedExec({ 'tools list --platform cli': { stdout: '' } }, calls)
    await dispatchHermesOp('tools-list', {}, { hermesBin: 'hermes', execFile: exec })
    expect(calls[0]).toEqual(['tools', 'list', '--platform', 'cli'])
  })

  it('doctor-fix calls hermes doctor --fix', async () => {
    const calls: string[][] = []
    const exec = scriptedExec({ 'doctor --fix': { stdout: '' } }, calls)
    await dispatchHermesOp('doctor-fix', {}, { hermesBin: 'hermes', execFile: exec })
    expect(calls[0]).toEqual(['doctor', '--fix'])
  })
})

// ─── Stdout parsers (fail-closed) ─────────────────────────────────────────────

describe('parseAuthList', () => {
  it('summarises credential counts from a normal auth list output', () => {
    const stdout = [
      'nous (2 credentials):',
      '  #1  my-cred              oauth   manual             ← ',
      '  #2  backup-cred          oauth   manual             ',
      '',
      'openai-api (1 credentials):',
      '  #1  work-key             api_key manual             ← ',
      '',
    ].join('\n')
    const result = parseAuthList(stdout)
    expect(result.providers).toHaveLength(2)
    expect(result.providers[0]!.provider).toBe('nous')
    expect(result.providers[0]!.count).toBe(2)
  })

  it('returns empty providers on empty stdout (fail-closed)', () => {
    const result = parseAuthList('')
    expect(result.providers).toHaveLength(0)
    expect(result.total).toBe(0)
  })

  it('never surfaces individual token values (credential labels only)', () => {
    const secret = 'sk-abcdef1234567890abcdef1234567890'
    const stdout = `nous (1 credentials):\n  #1  ${secret}  oauth  manual  ←\n`
    const result = parseAuthList(stdout)
    // provider-level summary doesn't echo any token-shaped label
    const json = JSON.stringify(result)
    expect(json).not.toContain(secret)
  })
})

describe('parseAuthStatus', () => {
  it('returns logged_in:true when the status line says "logged in"', () => {
    const result = parseAuthStatus('nous: logged in\n  auth_type: oauth\n')
    expect(result.logged_in).toBe(true)
  })

  it('returns logged_in:false on "logged out"', () => {
    const result = parseAuthStatus('nous: logged out\n')
    expect(result.logged_in).toBe(false)
  })

  it('fails closed to logged_in:false on empty stdout', () => {
    const result = parseAuthStatus('')
    expect(result.logged_in).toBe(false)
  })
})

describe('parseToolsList', () => {
  it('parses enabled/disabled toolsets from a normal tools list output', () => {
    const stdout = [
      'Built-in toolsets (cli):',
      '  [32m✓ enabled[0m  web  [2m🔍 Web Search & Scraping[0m',
      '  [31m✗ disabled[0m  browser  [2m🌐 Browser Automation[0m',
      '  [32m✓ enabled[0m  file  [2m📁 File Operations[0m',
    ].join('\n')
    const result = parseToolsList(stdout)
    expect(result.enabled).toContain('web')
    expect(result.enabled).toContain('file')
    expect(result.disabled).toContain('browser')
  })

  it('returns empty lists on empty stdout (fail-closed)', () => {
    const result = parseToolsList('')
    expect(result.enabled).toHaveLength(0)
    expect(result.disabled).toHaveLength(0)
  })
})

describe('parseDoctorFix', () => {
  it('summarises fixed/remaining counts from a doctor --fix run', () => {
    const stdout = [
      '',
      '◆ Configuration Files',
      '  ✓ ~/.hermes/.env file exists',
      '  ✓ API key or custom endpoint configured',
      '  ✓ Created ~/.hermes/config.yaml from defaults',
      '◆ Directory Structure',
      '  ✓ Created ~/.hermes directory',
      '  ✗ Could not create ~/.hermes/memories/',
      '',
      'Found 1 issue(s) that could not be auto-fixed:',
      '  1. Manually create the memories directory',
    ].join('\n')
    const result = parseDoctorFix(stdout)
    expect(result.fixed).toBeGreaterThan(0)
    expect(result.remaining).toBeGreaterThanOrEqual(0)
  })

  it('returns zeros on empty stdout (fail-closed, never fabricates success)', () => {
    const result = parseDoctorFix('')
    expect(result.fixed).toBe(0)
    expect(result.remaining).toBe(0)
  })
})

// ─── KNOWN_PROVIDERS completeness ─────────────────────────────────────────────

describe('KNOWN_PROVIDERS', () => {
  it('is a non-empty set of slug strings', () => {
    expect(KNOWN_PROVIDERS.size).toBeGreaterThan(0)
  })

  it('contains the most common provider slugs', () => {
    // These are the top-shelf providers every install has available
    expect(KNOWN_PROVIDERS.has('nous')).toBe(true)
    expect(KNOWN_PROVIDERS.has('openai-api')).toBe(true)
    expect(KNOWN_PROVIDERS.has('gemini')).toBe(true)
  })

  it('contains only safe alphanumeric/dash/underscore slugs (no shell chars)', () => {
    for (const slug of KNOWN_PROVIDERS) {
      expect(slug).toMatch(/^[a-z0-9][a-z0-9_-]*$/)
    }
  })
})

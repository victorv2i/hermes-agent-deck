import { describe, it, expect, vi } from 'vitest'
import {
  parseGatewayActive,
  parseUpdateCheck,
  parseVersion,
  parseDoctor,
  runHermes,
  scrubSecrets,
  type ExecFileLike,
} from './hermesCli'

/**
 * The CLI parsers are the security/honesty core of the System surface: they read
 * UNTRUSTED stdout from `hermes` and must (1) WHITELIST recognized substrings and
 * (2) FAIL CLOSED to the conservative value on anything else — never guessing a
 * gateway is running or an update is available. These tests pin both behaviors
 * against the real live-verified output formats.
 */

describe('parseGatewayActive', () => {
  it('reports running when the systemd block shows Active: active (running)', () => {
    const out =
      '● hermes-gateway.service - Hermes Agent Gateway\n' +
      '     Loaded: loaded (...; enabled; preset: disabled)\n' +
      '     Active: active (running) since Sat 2026-05-30 17:04:20 EDT; 23h ago\n' +
      '   Main PID: 767833 (hermes)\n'
    expect(parseGatewayActive(out)).toBe('running')
  })

  it('reports stopped on Active: inactive (dead)', () => {
    expect(parseGatewayActive('     Active: inactive (dead)\n')).toBe('stopped')
  })

  it('reports failed on Active: failed', () => {
    expect(parseGatewayActive('     Active: failed (Result: exit-code)\n')).toBe('failed')
  })

  it('FAILS CLOSED to unknown on unrecognized / empty output', () => {
    expect(parseGatewayActive('')).toBe('unknown')
    expect(parseGatewayActive('some unrelated banner text')).toBe('unknown')
    expect(parseGatewayActive('Active: reloading (something)')).toBe('unknown')
  })

  it('never infers running from a stray "running" word outside the Active line', () => {
    // A log tail mentioning "running" must NOT flip the verdict to running.
    expect(parseGatewayActive('May 31 ... gateway is running fine in the logs\n')).toBe('unknown')
  })
})

describe('parseUpdateCheck', () => {
  it('reports up-to-date on the "Already up to date" line', () => {
    const out = '→ Fetching from upstream...\n→ Fetching from origin...\n✓ Already up to date.\n'
    expect(parseUpdateCheck(out)).toBe('up-to-date')
  })

  it('reports update-available when an update is announced', () => {
    expect(parseUpdateCheck('✓ An update is available (v0.15.1 → v0.16.0)\n')).toBe(
      'update-available',
    )
    expect(parseUpdateCheck('Update available: 3 commits behind origin/main\n')).toBe(
      'update-available',
    )
  })

  it('FAILS CLOSED to up-to-date on unrecognized / empty output', () => {
    expect(parseUpdateCheck('')).toBe('up-to-date')
    expect(parseUpdateCheck('→ Fetching from upstream...\nnetwork error, who knows\n')).toBe(
      'up-to-date',
    )
  })
})

describe('parseVersion', () => {
  it('extracts the semver from the version banner', () => {
    const out = 'Hermes Agent v0.15.1 (2026.5.29)\nProject: /home/u/hermes-agent\nPython: 3.14.3\n'
    expect(parseVersion(out)).toBe('0.15.1')
  })

  it('returns null when no version is present (never guesses)', () => {
    expect(parseVersion('')).toBeNull()
    expect(parseVersion('Project: /home/u/hermes-agent\n')).toBeNull()
  })
})

describe('parseDoctor', () => {
  // A trimmed but faithful capture of real `hermes doctor` output (v0.15.1):
  // `◆ ` section headers, `  ✓/⚠/✗` status lines, optional `  → ` detail lines,
  // and the footer "Found N issue(s)" block.
  const DOCTOR_OUTPUT = [
    '┌─────────────────────────────────────────────────────────┐',
    '│                 🩺 Hermes Doctor                        │',
    '└─────────────────────────────────────────────────────────┘',
    '',
    '◆ Security Advisories',
    '  ✓ No active security advisories',
    '',
    '◆ Python Environment',
    '  ✓ Python 3.14.3',
    '  ⚠ Not in virtual environment (recommended)',
    '  ✓ Version files consistent (0.15.1)',
    '',
    '◆ Auth Providers',
    '  ⚠ Nous Portal auth (not logged in)',
    '  ✓ OpenAI Codex auth (logged in)',
    '  ✗ Something is broken here',
    '    → A sub-detail line that should not be counted as a status',
    '',
    '────────────────────────────────────────────────────────────',
    '  Found 2 issue(s) to address:',
    '',
    "  1. Run 'hermes setup' to configure API keys",
    "  2. Reinstall entry point: pip install -e '.[all]'",
    '',
    "  Tip: run 'hermes doctor --fix' to auto-fix what's possible.",
    '',
  ].join('\n')

  it('rolls up section counts (ok / warning / error) and overall counts', () => {
    const report = parseDoctor(DOCTOR_OUTPUT)
    expect(report.sections.map((s) => s.title)).toEqual([
      'Security Advisories',
      'Python Environment',
      'Auth Providers',
    ])
    const python = report.sections.find((s) => s.title === 'Python Environment')!
    expect(python).toMatchObject({ ok: 2, warning: 1, error: 0 })
    const auth = report.sections.find((s) => s.title === 'Auth Providers')!
    expect(auth).toMatchObject({ ok: 1, warning: 1, error: 1 })
    // Aggregate counts sum every status line (the `→` detail line is NOT a status).
    expect(report.counts).toEqual({ ok: 4, warning: 2, error: 1 })
  })

  it('derives status=issues when any error is present', () => {
    expect(parseDoctor(DOCTOR_OUTPUT).status).toBe('issues')
  })

  it('derives status=warnings when only warnings (no errors)', () => {
    const out = ['◆ Env', '  ✓ ok thing', '  ⚠ a warning'].join('\n')
    expect(parseDoctor(out).status).toBe('warnings')
  })

  it('derives status=ok when every check passes', () => {
    const out = ['◆ Env', '  ✓ ok one', '  ✓ ok two'].join('\n')
    const r = parseDoctor(out)
    expect(r.status).toBe('ok')
    expect(r.counts).toEqual({ ok: 2, warning: 0, error: 0 })
  })

  it('captures the footer "Found N issue(s)" summary lines (numbered actions only)', () => {
    const report = parseDoctor(DOCTOR_OUTPUT)
    expect(report.summary).toHaveLength(2)
    expect(report.summary[0]).toMatch(/hermes setup/)
    // The Tip line and the rule line are not action items.
    expect(report.summary.join('\n')).not.toMatch(/Tip:/)
  })

  it('FAILS CLOSED to unavailable on empty / unparseable output (no fake healthy)', () => {
    expect(parseDoctor('').status).toBe('unavailable')
    expect(parseDoctor('command not found: hermes\n').status).toBe('unavailable')
  })
})

describe('scrubSecrets (token-shaped redaction for streamed output)', () => {
  it('masks an sk- prefixed key embedded in a log line', () => {
    const line = scrubSecrets('Authenticating with key sk-ABCDEF0123456789abcdef0123 now')
    expect(line).not.toContain('sk-ABCDEF0123456789abcdef0123')
    expect(line).toContain('[redacted]')
    // The surrounding words survive — only the token is masked.
    expect(line).toContain('Authenticating with key')
  })

  it('masks a Bearer token and a long hex/base64-ish blob', () => {
    expect(scrubSecrets('Authorization: Bearer abcdef0123456789abcdef0123456789')).not.toContain(
      'abcdef0123456789abcdef0123456789',
    )
    const long = scrubSecrets('token=AKIA9f8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0')
    expect(long).toContain('[redacted]')
  })

  it('masks an underscore-prefixed token whose body is only 16–31 chars', () => {
    // e.g. a `ghp_…` PAT whose unbroken body is shorter than the 32-char blob
    // floor and lacks an `xx-`/`Bearer` prefix — would otherwise slip the net.
    const line = scrubSecrets('cloning https://ghp_AbC123dEf456GhI789@github.com/x.git')
    expect(line).not.toContain('ghp_AbC123dEf456GhI789')
    expect(line).toContain('[redacted]')
  })

  it('masks the literal secretArgs values regardless of shape', () => {
    const line = scrubSecrets('using value hunter2 to connect', ['hunter2'])
    expect(line).not.toContain('hunter2')
    expect(line).toContain('[redacted]')
  })

  it('leaves ordinary output (incl. version strings + paths) untouched', () => {
    const line = 'Backed up to ~/.hermes/backups. Updated to v0.16.0 on branch main.'
    expect(scrubSecrets(line)).toBe(line)
  })

  // Extended SECRET_PATTERNS coverage (load-bearing for logsClient scrub)
  it('masks an Authorization header value', () => {
    // e.g. in a git/curl verbose trace: "Authorization: Bearer <token>"
    const line = scrubSecrets('Authorization: eyJhbGciOiJIUzI1NiJ9.payload.sig')
    expect(line).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(line).toContain('[redacted]')
  })

  it('masks a cookie header value containing a session token', () => {
    const line = scrubSecrets('Cookie: session=AbcDef0123456789GhIjKl0123456789')
    expect(line).not.toContain('AbcDef0123456789GhIjKl0123456789')
    expect(line).toContain('[redacted]')
  })

  it('masks a DSN (Sentry/DB connection string) with credentials in userinfo', () => {
    // A PostgreSQL DSN with password embedded.
    const line = scrubSecrets(
      'Connecting via postgresql://user:super-secret-password-1234@db.example.com:5432/mydb',
    )
    expect(line).not.toContain('super-secret-password-1234')
  })

  it('masks a refresh_token value in an OAuth response log line', () => {
    const line = scrubSecrets('refresh_token=AbCdEf0123456789AbCdEf0123456789XY')
    expect(line).not.toContain('AbCdEf0123456789AbCdEf0123456789XY')
    expect(line).toContain('[redacted]')
  })

  it('masks a PAT (personal access token) with an underscore prefix', () => {
    // GitHub PAT shape: ghp_<body> — already covered, but also plain pat= assignments.
    const line = scrubSecrets('pat=AbCdEf0123456789AbCdEf0123456789XY')
    expect(line).not.toContain('AbCdEf0123456789AbCdEf0123456789XY')
    expect(line).toContain('[redacted]')
  })
})

describe('runHermes (guarded execFile wrapper)', () => {
  it('invokes execFile with argv (NOT a shell string) and never sets shell', async () => {
    const calls: Array<{ file: string; args: string[]; opts: unknown }> = []
    const exec: ExecFileLike = (file, args, opts, cb) => {
      calls.push({ file, args: args ?? [], opts })
      cb(null, 'ok', '')
      return undefined as never
    }
    const res = await runHermes(['gateway', 'status'], { hermesBin: '/bin/hermes', execFile: exec })
    expect(res.stdout).toBe('ok')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.file).toBe('/bin/hermes')
    expect(calls[0]!.args).toEqual(['gateway', 'status'])
    // The options object must never carry shell:true (argv-only, no shell parsing).
    expect((calls[0]!.opts as Record<string, unknown>).shell ?? false).toBeFalsy()
  })

  it('resolves stdout/stderr/exit even when the command exits non-zero', async () => {
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      const err = Object.assign(new Error('exited'), { code: 1 })
      cb(err, 'partial out', 'some err')
      return undefined as never
    }
    const res = await runHermes(['update', '--check'], { hermesBin: 'hermes', execFile: exec })
    // STDOUT-driven parsers must still get the captured output (exit code is not
    // load-bearing for availability), and ok reflects the non-zero exit honestly.
    expect(res.stdout).toBe('partial out')
    expect(res.stderr).toBe('some err')
    expect(res.ok).toBe(false)
  })

  it('rejects when execFile cannot spawn at all (binary missing)', async () => {
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      cb(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }), '', '')
      return undefined as never
    }
    // A spawn failure (no stdout/stderr, errno code) is a real error: reject so
    // the route reports a probe failure instead of fabricating a verdict.
    await expect(runHermes(['version'], { hermesBin: 'nope', execFile: exec })).rejects.toThrow()
  })

  it('passes a redacted argv to a logger spy that NEVER carries a secret', async () => {
    const logged: string[] = []
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      cb(null, 'ok', '')
      return undefined as never
    }
    await runHermes(['auth', 'add', 'openrouter', '--api-key', 'sk-LIVE-SECRET'], {
      hermesBin: 'hermes',
      execFile: exec,
      secretArgs: ['sk-LIVE-SECRET'],
      log: (line) => logged.push(line),
    })
    const all = logged.join('\n')
    expect(all).not.toContain('sk-LIVE-SECRET')
    // The redaction marker stands in for the masked value.
    expect(all).toContain('[redacted]')
  })

  it('never logs argv at all when no logger is supplied (default is silent)', async () => {
    const spy = vi.spyOn(console, 'log')
    const exec: ExecFileLike = (_file, _args, _opts, cb) => {
      cb(null, 'ok', '')
      return undefined as never
    }
    await runHermes(['auth', 'add', 'openrouter', '--api-key', 'sk-LIVE-SECRET'], {
      hermesBin: 'hermes',
      execFile: exec,
      secretArgs: ['sk-LIVE-SECRET'],
    })
    for (const call of spy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('sk-LIVE-SECRET')
    }
    spy.mockRestore()
  })
})

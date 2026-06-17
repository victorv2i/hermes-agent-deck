/**
 * GUARDED hermes-CLI helper — the single place the BFF shells out to `hermes`.
 *
 * SECURITY DISCIPLINE (load-bearing):
 *  - argv ONLY, never a shell string. {@link runHermes} calls `execFile` with an
 *    explicit `string[]`; `shell` is never set, so no value (a provider slug, an
 *    api key) can ever be re-parsed by a shell. A hostile argument is inert data.
 *  - SECRET SCRUB. A caller passes `secretArgs` (the live values that must never
 *    leak — e.g. an API key); the optional `log` only ever receives a REDACTED
 *    argv with those values replaced by `[redacted]`. With no `log` supplied the
 *    wrapper is silent — argv is never written anywhere by default.
 *  - HONEST EXIT. A non-zero exit still RESOLVES with the captured stdout/stderr
 *    (availability is read from STDOUT, not the exit code — `hermes update
 *    --check` exits 0 whether or not an update exists). A true spawn failure
 *    (ENOENT etc., no output) REJECTS so the route reports a probe failure rather
 *    than fabricating a verdict.
 *
 * PARSERS: each reads UNTRUSTED stdout, WHITELISTS the recognized substrings, and
 * FAILS CLOSED to the conservative value on anything else (gateway → `unknown`,
 * update → `up-to-date`) — never guessing a gateway is up or an update exists.
 * Verified against live hermes v0.16.0 output (`hermes gateway status`,
 * `hermes update --check`, `hermes version`).
 */
import { execFile as nodeExecFile } from 'node:child_process'
import type { GatewayStatus, HermesUpdateStatus, HermesDoctorReport } from '@agent-deck/protocol'

/** The subset of node's `execFile` signature the wrapper depends on (injectable). */
export type ExecFileLike = (
  file: string,
  args: string[],
  options: { timeout?: number; maxBuffer?: number },
  callback: (
    error: (Error & { code?: string | number }) | null,
    stdout: string,
    stderr: string,
  ) => void,
) => unknown

/** Captured result of a `hermes` invocation. `ok` mirrors a zero exit. */
export interface HermesResult {
  stdout: string
  stderr: string
  ok: boolean
}

export interface RunHermesOptions {
  /** Absolute path (or PATH name) of the `hermes` binary. */
  hermesBin: string
  /** Injectable execFile (tests). Defaults to node's child_process.execFile. */
  execFile?: ExecFileLike
  /** Per-call timeout (ms). Defaults to 60s — `hermes update --check` hits git. */
  timeoutMs?: number
  /**
   * Literal argument values to REDACT from any logged argv (e.g. an API key).
   * The values themselves are never used for anything but masking.
   */
  secretArgs?: readonly string[]
  /** Optional sink for the (redacted) argv line. Omitted → nothing is logged. */
  log?: (line: string) => void
}

const DEFAULT_TIMEOUT_MS = 60_000
// hermes can emit a large systemd status block + log tail; allow headroom but cap.
const MAX_BUFFER = 4 * 1024 * 1024

/**
 * Run `hermes <args>` via execFile (argv-only, no shell). Resolves with the
 * captured stdout/stderr even on a non-zero exit; rejects only on a true spawn
 * failure (the process never ran). Secrets in `secretArgs` are scrubbed from the
 * (optional) log line; the raw argv is passed to execFile verbatim so the command
 * still works — only the LOG is redacted, never the actual call.
 */
export function runHermes(args: string[], opts: RunHermesOptions): Promise<HermesResult> {
  const exec = opts.execFile ?? (nodeExecFile as unknown as ExecFileLike)
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  if (opts.log) {
    opts.log(`hermes ${redactArgv(args, opts.secretArgs).join(' ')}`)
  }

  return new Promise<HermesResult>((resolve, reject) => {
    exec(opts.hermesBin, args, { timeout, maxBuffer: MAX_BUFFER }, (error, stdout, stderr) => {
      if (error) {
        // A spawn failure (ENOENT/EACCES/timeout) carries no captured output and
        // an errno-style code: that is a real error → reject. A normal non-zero
        // EXIT carries a numeric `.code` AND output → resolve with ok:false so
        // STDOUT-driven parsers still run.
        const code = (error as { code?: string | number }).code
        const spawnFailed = typeof code === 'string' || stdout === undefined
        if (spawnFailed && !stdout && !stderr) {
          reject(error)
          return
        }
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '', ok: false })
        return
      }
      resolve({ stdout: stdout ?? '', stderr: stderr ?? '', ok: true })
    })
  })
}

/** Replace any argument whose value is a known secret with `[redacted]`. */
export function redactArgv(args: readonly string[], secretArgs?: readonly string[]): string[] {
  if (!secretArgs || secretArgs.length === 0) return [...args]
  const secrets = new Set(secretArgs.filter((s) => s.length > 0))
  return args.map((a) => (secrets.has(a) ? '[redacted]' : a))
}

/** The marker substituted for a redacted token in streamed output. */
const SECRET_MARKER = '[redacted]'

/**
 * Token-shaped patterns redacted from the streamed update LOG before it crosses
 * the wire. `hermes update --backup --yes` shells out to git (which may echo a
 * credential-bearing remote URL) and can print auth headers; we mask anything
 * that LOOKS like a credential. Deliberately broad — over-redaction is safe in a
 * human-read log, leaking a token is not. Anchored to obvious secret shapes so a
 * version string (`v0.16.0`) or a path is never touched.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  // Provider-style keys: an `sk-`/`pk-`/`rk-` prefix + a long body.
  /\b[a-z]{2,4}-[A-Za-z0-9_-]{16,}\b/g,
  // Underscore-prefixed tokens (`ghp_…`, `github_pat_…`, `token=abc_…`) whose
  // unbroken body is 16–31 chars — below the blob floor and without an `xx-`
  // prefix, these would otherwise slip. The body excludes `_` so ordinary
  // snake_case log words (which break at each underscore) are never touched.
  /\b[a-z]{2,8}_[A-Za-z0-9-]{16,}\b/gi,
  // A `Bearer <token>` header value (with explicit prefix).
  /\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi,
  // A JWT-shaped token (three base64url segments separated by dots, starts with
  // `eyJ` — the base64-encoding of `{"` which opens every JSON JWT header).
  // Matches with or without a `Bearer`/`Authorization:` prefix.
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?\b/g,
  // URL userinfo passwords: `://user:password@` — strip the password segment
  // (everything between the last `:` before `@` and the `@`).
  // Deliberately narrow: requires `://`, a colon, at least 8 chars, then `@`.
  /:\/\/[^:/?#\s]+:[^@/?#\s]{8,}@/g,
  // An `Authorization:` or `Cookie:` / `Set-Cookie:` header line value — the
  // whole value after the colon+whitespace. Covers cases where neither Bearer
  // nor the blob pattern catches it (short tokens, custom schemes, etc.).
  /\b(?:Authorization|Cookie|Set-Cookie)\s*:\s*\S{8,}/gi,
  // A bare long high-entropy blob (hex/base64-ish, 32+ chars). A version string
  // or word is far shorter, so this won't catch ordinary output.
  /\b[A-Za-z0-9+/_-]{32,}\b/g,
]

/**
 * Redact secrets from a single line of (untrusted) CLI output. Masks any literal
 * value in `secretArgs` (e.g. a key the BFF itself passed) AND any token-shaped
 * substring (the {@link SECRET_PATTERNS}). Returns the line with each match
 * replaced by {@link SECRET_MARKER}. Pure + idempotent — safe to apply per line.
 */
export function scrubSecrets(line: string, secretArgs?: readonly string[]): string {
  let out = line
  // Exact known-secret values first (covers anything the patterns might miss).
  for (const secret of secretArgs ?? []) {
    if (secret.length > 0) out = out.split(secret).join(SECRET_MARKER)
  }
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, SECRET_MARKER)
  }
  return out
}

/**
 * Parse `hermes gateway status` (systemd `show`-style block). WHITELIST the
 * `Active:` line's run-state; FAIL CLOSED to `unknown` on anything unrecognized
 * so a log tail mentioning "running" can never flip the verdict.
 */
export function parseGatewayActive(stdout: string): GatewayStatus {
  // Anchor on the systemd "Active:" line only — never a stray word elsewhere.
  const line = stdout.split('\n').find((l) => /^\s*Active:/.test(l))
  if (!line) return 'unknown'
  const value = line.replace(/^\s*Active:\s*/, '').toLowerCase()
  if (value.startsWith('active (running)') || value.startsWith('active (')) return 'running'
  if (value.startsWith('inactive') || value.startsWith('deactivating')) return 'stopped'
  if (value.startsWith('failed')) return 'failed'
  return 'unknown'
}

/**
 * Parse `hermes update --check` STDOUT (exit code is 0 either way). WHITELIST the
 * two recognized outcomes; FAIL CLOSED to `up-to-date` on anything else so a
 * network hiccup never fabricates an "update available".
 */
export function parseUpdateCheck(stdout: string): HermesUpdateStatus {
  const text = stdout.toLowerCase()
  if (text.includes('already up to date') || text.includes('up to date')) return 'up-to-date'
  if (text.includes('update available') || text.includes('an update is available'))
    return 'update-available'
  return 'up-to-date'
}

/**
 * Parse the installed version from `hermes version` (`Hermes Agent v0.16.0 ...`).
 * Returns the bare semver, or null when no version line is present (never guesses).
 */
export function parseVersion(stdout: string): string | null {
  const match = /\bv?(\d+\.\d+\.\d+(?:[-.\w]*)?)/.exec(stdout)
  return match ? match[1]! : null
}

/* -------------------------------------------------------------------------- */
/* Doctor (hermes doctor)                                                     */
/* -------------------------------------------------------------------------- */

/** A `◆ <Section>` header. Anchored to the leading diamond so prose never matches. */
const DOCTOR_SECTION_RE = /^◆\s+(.+?)\s*$/
/** A status line: leading whitespace, a status glyph, then text. */
const DOCTOR_OK_RE = /^\s*✓/
const DOCTOR_WARN_RE = /^\s*⚠/
// `✗`/`✘`/`×` all appear as "error" glyphs across hermes versions — whitelist all.
const DOCTOR_ERROR_RE = /^\s*[✗✘×]/
/** A numbered footer action line ("  1. Run 'hermes setup' …"). */
const DOCTOR_SUMMARY_RE = /^\s*\d+\.\s+(.+?)\s*$/

/**
 * Parse `hermes doctor` STDOUT into the slim {@link HermesDoctorReport}. WHITELISTS
 * the recognized line shapes (`◆ Section`, `✓/⚠/✗` status lines, numbered footer
 * actions) and FAILS CLOSED to `unavailable` when nothing parseable is present — so
 * a missing/garbled doctor run can never fabricate a "healthy" verdict. Sub-detail
 * lines (`  → …`) are deliberately ignored: they annotate the status above, they are
 * not a status of their own.
 *
 * SECURITY: the caller is responsible for scrubbing the `summary` lines before they
 * cross the wire (doctor footer text can echo a path/value); the COUNTS carry no raw
 * text. The protocol `.parse()` then strips any non-whitelisted key.
 */
export function parseDoctor(stdout: string): HermesDoctorReport {
  const lines = stdout.split('\n')
  const sections: HermesDoctorReport['sections'] = []
  const summary: string[] = []
  let current: HermesDoctorReport['sections'][number] | null = null
  let inFooter = false

  for (const line of lines) {
    const sectionMatch = DOCTOR_SECTION_RE.exec(line)
    if (sectionMatch) {
      current = { title: sectionMatch[1]!, ok: 0, warning: 0, error: 0 }
      sections.push(current)
      inFooter = false
      continue
    }
    // The footer block begins at "Found N issue(s)"; from there we only collect the
    // numbered action lines (a Tip line / rule line is not an action item).
    if (/Found\s+\d+\s+issue/i.test(line)) {
      inFooter = true
      continue
    }
    if (inFooter) {
      const m = DOCTOR_SUMMARY_RE.exec(line)
      if (m) summary.push(m[1]!)
      continue
    }
    if (!current) continue
    if (DOCTOR_ERROR_RE.test(line)) current.error += 1
    else if (DOCTOR_WARN_RE.test(line)) current.warning += 1
    else if (DOCTOR_OK_RE.test(line)) current.ok += 1
  }

  const counts = sections.reduce(
    (acc, s) => ({
      ok: acc.ok + s.ok,
      warning: acc.warning + s.warning,
      error: acc.error + s.error,
    }),
    { ok: 0, warning: 0, error: 0 },
  )

  // Fail closed: no sections AND no status lines → the run produced nothing we can
  // trust, so report the honest unavailable state rather than a green "ok".
  const total = counts.ok + counts.warning + counts.error
  if (sections.length === 0 || total === 0) {
    return {
      status: 'unavailable',
      counts: { ok: 0, warning: 0, error: 0 },
      sections: [],
      summary: [],
    }
  }

  const status: HermesDoctorReport['status'] =
    counts.error > 0 ? 'issues' : counts.warning > 0 ? 'warnings' : 'ok'

  return { status, counts, sections, summary }
}

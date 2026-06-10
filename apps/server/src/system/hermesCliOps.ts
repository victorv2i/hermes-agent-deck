/**
 * HERMES CLI OPS — the "Do It For Me" whitelist module.
 *
 * SECURITY DISCIPLINE (load-bearing):
 *  - WHITELIST-ONLY. Only ops listed in {@link ALLOWED_OPS} can be dispatched.
 *    Unknown opIds are rejected before execFile is ever called.
 *  - ENUM-VALIDATED PARAMS. Any param that maps to an argv fragment (e.g. a
 *    provider slug) is validated against a typed allow-list ({@link KNOWN_PROVIDERS})
 *    before being passed to execFile. A raw user string is NEVER passed as argv.
 *  - NO SHELL. All dispatch goes through {@link runHermes} which calls execFile
 *    with an explicit string[]. No shell = no shell injection possible.
 *  - SECRET SCRUB. Every stdout line is passed through {@link scrubSecrets}
 *    before it reaches the response body, matching the existing hermesCli.ts pattern.
 *  - FAIL CLOSED. Parsers whitelist recognized patterns and fall back to zero/empty
 *    on anything unrecognized — never fabricating success.
 *
 * CLI INVESTIGATION RESULTS:
 *  Category A (SCRIPTABLE — real non-interactive flags, safe to BFF):
 *    - hermes doctor --fix          → writes missing files/dirs; exits 0 on full fix
 *    - hermes auth list             → reads credential pool; no TTY needed
 *    - hermes auth status <p>       → reads auth state for a single provider
 *    - hermes auth logout <p>       → clears stored auth for a provider (mutating)
 *    - hermes tools list --platform cli → prints enabled/disabled toolsets; no TUI
 *
 *  Category B (INTERACTIVE-TUI — requires TTY, _require_tty guards the CLI gate):
 *    - hermes tools (bare)          → curses TUI toggle, cannot be scripted
 *    - hermes setup                 → full interactive wizard
 *    - hermes model                 → model-picker TUI
 *    The Tools surface provides an embedded-terminal pre-typed with `hermes tools`
 *    as the honest one-click affordance for Category B.
 */
import { runHermes, scrubSecrets, type ExecFileLike } from './hermesCli'

/** The set of known provider slugs accepted as the `provider` param. */
export const KNOWN_PROVIDERS: ReadonlySet<string> = new Set([
  'nous',
  'openai-codex',
  'openai-api',
  'xai-oauth',
  'qwen-oauth',
  'google-gemini-cli',
  'lmstudio',
  'copilot',
  'copilot-acp',
  'gemini',
  'zai',
  'kimi-coding',
  'kimi-coding-cn',
  'stepfun',
  'arcee',
  'gmi',
  'deepseek',
  'huggingface',
  'nvidia',
  'alibaba',
  'minimax',
  'minimax-cn',
  'minimax-oauth',
  'kilocode',
  'opencode-zen',
  'opencode-go',
  'openrouter',
  'anthropic',
  'azure-foundry',
  'bedrock',
  'spotify',
])

/* -------------------------------------------------------------------------- */
/* Result type                                                                 */
/* -------------------------------------------------------------------------- */

export interface HermesCliOpResult {
  /** true when the command exited 0 */
  ok: boolean
  /** Secret-scrubbed stdout, safe to render verbatim */
  stdout: string
  /** Human-readable one-sentence outcome (no raw output; just category) */
  summary: string
  /** The real exit code (0 for ok, non-zero for failure, -1 for spawn failure) */
  exitCode: number
  /** Structured parse result (op-specific, defined per op below) */
  parsed?: unknown
}

/* -------------------------------------------------------------------------- */
/* Op registry                                                                 */
/* -------------------------------------------------------------------------- */

type OpId = keyof typeof ALLOWED_OPS

// Typed params per op — only the param that maps to argv; never a raw user string.
export type HermesCliOpParams<T extends OpId> = T extends 'auth-status' | 'auth-logout'
  ? { provider: string }
  : Record<string, never>

interface OpDef {
  id: string
  /** Fixed argv fragments that never change (no user input in this array) */
  fixedArgs: readonly string[]
  /**
   * Build the user-param argv extension AFTER enum validation.
   * Returns null if params fail validation (caller converts to rejection).
   */
  buildParamArgs?: (params: Record<string, unknown>) => string[] | null
  /** Which argv values contain secrets (scrubbed from logged argv) */
  secretArgs?: readonly string[]
  /** Whether this op mutates state (used for documentation; no runtime gate) */
  mutating: boolean
  /** Fail-closed parser for the op's stdout. Always returns a typed result. */
  parseOutput: (stdout: string) => unknown
  /** Timeout in ms (default 60 000) */
  timeoutMs?: number
}

/* -------------------------------------------------------------------------- */
/* Stdout parsers (fail-closed)                                                */
/* -------------------------------------------------------------------------- */

export interface AuthListResult {
  providers: Array<{ provider: string; count: number }>
  total: number
}

/**
 * Parse `hermes auth list` stdout.
 * Lines like `nous (2 credentials):` define provider + count.
 * SECURITY: we extract only the provider name (whitelisted) and count (number) —
 * credential labels, token-shaped strings, etc. are never returned.
 */
export function parseAuthList(stdout: string): AuthListResult {
  const providers: Array<{ provider: string; count: number }> = []
  // Match: "<provider> (N credentials):" — whitelist only lines with this exact shape
  const lineRe = /^([a-z0-9][a-z0-9_:-]*)\s+\(\s*(\d+)\s+credentials?\s*\)\s*:/im
  for (const line of stdout.split('\n')) {
    const m = lineRe.exec(line)
    if (!m) continue
    const provider = m[1]!.trim()
    const count = parseInt(m[2]!, 10)
    if (!isNaN(count)) providers.push({ provider, count })
  }
  const total = providers.reduce((s, p) => s + p.count, 0)
  return { providers, total }
}

export interface AuthStatusResult {
  logged_in: boolean
}

/**
 * Parse `hermes auth status <provider>` stdout.
 * Whitelists the "logged in" / "logged out" lines only. Fails closed to logged_in:false.
 */
export function parseAuthStatus(stdout: string): AuthStatusResult {
  const lower = stdout.toLowerCase()
  if (lower.includes('logged in')) return { logged_in: true }
  return { logged_in: false }
}

export interface ToolsListResult {
  enabled: string[]
  disabled: string[]
}

/**
 * Parse `hermes tools list --platform cli` stdout.
 * Whitelist lines that match `✓ enabled  <name>` or `✗ disabled  <name>`.
 * ANSI escape codes are stripped before matching (the CLI emits color codes).
 */
export function parseToolsList(stdout: string): ToolsListResult {
  const enabled: string[] = []
  const disabled: string[] = []
  // Strip ANSI codes
  // eslint-disable-next-line no-control-regex
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')
  const toolsetRe = /^\s*[✓✗✘×]\s+(enabled|disabled)\s+([a-z0-9_]+)\s/i
  for (const raw of stdout.split('\n')) {
    const line = strip(raw)
    const m = toolsetRe.exec(line)
    if (!m) continue
    const status = m[1]!.toLowerCase()
    const name = m[2]!
    if (status === 'enabled') enabled.push(name)
    else disabled.push(name)
  }
  return { enabled, disabled }
}

export interface DoctorFixResult {
  /** Count of items that were created/fixed */
  fixed: number
  /** Count of items in the "Found N issue(s)" footer (remaining manual work) */
  remaining: number
}

/**
 * Parse `hermes doctor --fix` stdout.
 * WHITELIST: lines starting with `✓ Created` are "fixed" items; the
 * "Found N issue(s)" footer line gives the remaining count.
 * Fails closed to zeros on unrecognized output.
 */
export function parseDoctorFix(stdout: string): DoctorFixResult {
  let fixed = 0
  let remaining = 0
  // eslint-disable-next-line no-control-regex
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')
  for (const raw of stdout.split('\n')) {
    const line = strip(raw)
    // A fix line: "  ✓ Created …"
    if (/^\s*✓\s+Created\b/i.test(line)) fixed += 1
    // The footer summary line: "Found N issue(s)…"
    const footerM = /Found\s+(\d+)\s+issue/i.exec(line)
    if (footerM) remaining = parseInt(footerM[1]!, 10)
  }
  return { fixed, remaining }
}

/* -------------------------------------------------------------------------- */
/* ALLOWED_OPS registry                                                        */
/* -------------------------------------------------------------------------- */

export const ALLOWED_OPS = {
  'doctor-fix': {
    id: 'doctor-fix',
    fixedArgs: ['doctor', '--fix'],
    mutating: true,
    parseOutput: parseDoctorFix,
    // doctor --fix runs parallel connectivity checks; give it generous headroom
    timeoutMs: 120_000,
  },
  'auth-list': {
    id: 'auth-list',
    fixedArgs: ['auth', 'list'],
    mutating: false,
    parseOutput: parseAuthList,
  },
  'auth-status': {
    id: 'auth-status',
    fixedArgs: ['auth', 'status'],
    buildParamArgs(params: Record<string, unknown>): string[] | null {
      const provider = typeof params.provider === 'string' ? params.provider.trim() : ''
      if (!provider || !KNOWN_PROVIDERS.has(provider)) return null
      return [provider]
    },
    mutating: false,
    parseOutput: parseAuthStatus,
  },
  'auth-logout': {
    id: 'auth-logout',
    fixedArgs: ['auth', 'logout'],
    buildParamArgs(params: Record<string, unknown>): string[] | null {
      const provider = typeof params.provider === 'string' ? params.provider.trim() : ''
      if (!provider || !KNOWN_PROVIDERS.has(provider)) return null
      return [provider]
    },
    mutating: true,
    parseOutput: parseAuthStatus,
  },
  'tools-list': {
    id: 'tools-list',
    fixedArgs: ['tools', 'list', '--platform', 'cli'],
    mutating: false,
    parseOutput: parseToolsList,
  },
} as const satisfies Record<string, OpDef>

/* -------------------------------------------------------------------------- */
/* Dispatch                                                                    */
/* -------------------------------------------------------------------------- */

export interface DispatchOpts {
  hermesBin: string
  execFile?: ExecFileLike
}

/**
 * Dispatch a hermes CLI op by its whitelisted ID.
 *
 * SECURITY CHAIN:
 *  1. opId is validated against ALLOWED_OPS (reject before execFile if unknown).
 *  2. Params are validated by the op's `buildParamArgs` (provider must be in
 *     KNOWN_PROVIDERS; rejects with an InvalidProvider summary if not).
 *  3. Final argv = op.fixedArgs + paramArgs — no raw user string ever enters.
 *  4. runHermes is called (execFile, no shell).
 *  5. stdout is scrubbed through scrubSecrets before returning.
 */
export async function dispatchHermesOp<T extends OpId>(
  opId: T,
  params: Record<string, unknown>,
  opts: DispatchOpts,
): Promise<HermesCliOpResult> {
  // 1. Whitelist check
  const op = ALLOWED_OPS[opId as keyof typeof ALLOWED_OPS]
  if (!op) {
    return { ok: false, stdout: '', summary: `Unknown op: "${opId}"`, exitCode: -1 }
  }

  // 2. Param validation (only ops with `buildParamArgs` need it). Cast to OpDef
  //    (where buildParamArgs is optional) — the op union's narrower members don't
  //    all declare it, so access it through the common shape.
  let paramArgs: string[] = []
  const opDef = op as OpDef
  if (opDef.buildParamArgs) {
    const result = opDef.buildParamArgs(params)
    if (result === null) {
      const provider = typeof params.provider === 'string' ? params.provider : '(empty)'
      return {
        ok: false,
        stdout: '',
        summary: `Invalid provider: "${provider}". Must be one of the known provider slugs.`,
        exitCode: -1,
      }
    }
    paramArgs = result
  }

  // 3. Build argv from FIXED strings + enum-validated params
  const args = [...op.fixedArgs, ...paramArgs]

  // 4. Execute via runHermes (no shell)
  let rawResult: { stdout: string; stderr: string; ok: boolean }
  try {
    rawResult = await runHermes(args, {
      hermesBin: opts.hermesBin,
      execFile: opts.execFile,
      timeoutMs: (op as OpDef).timeoutMs,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Command could not start.'
    return { ok: false, stdout: '', summary: msg, exitCode: -1 }
  }

  // 5. Scrub stdout before it leaves the BFF
  const scrubbedLines = rawResult.stdout.split('\n').map((l) => scrubSecrets(l))
  const scrubbedStdout = scrubbedLines.join('\n')

  // 6. Parse the scrubbed output
  const parsed = (op as OpDef).parseOutput(scrubbedStdout)

  const summary = rawResult.ok ? `${op.id} completed successfully` : `${op.id} exited with errors`

  return {
    ok: rawResult.ok,
    stdout: scrubbedStdout,
    summary,
    exitCode: rawResult.ok ? 0 : 1,
    parsed,
  }
}

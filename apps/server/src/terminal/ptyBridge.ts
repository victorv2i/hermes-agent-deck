/**
 * node-pty bridge — the loopback terminal's process layer.
 *
 * The hermes dashboard exposes NO PTY route (per the M0 spike), so Agent Deck's
 * BFF owns the terminal: it spawns a real shell with `node-pty` in a workspace
 * cwd and streams bytes both ways over a Socket.IO namespace
 * (see {@link ./terminalNamespace}).
 *
 * node-pty is a NATIVE addon. If it failed to build/install on this host we must
 * degrade honestly rather than crash the whole BFF — so it is loaded *lazily*
 * via {@link loadNodePty}, and {@link terminalAvailability} reports whether the
 * terminal is usable. Callers (the namespace + a REST status route) surface that
 * to the UI as a calm "terminal unavailable" state.
 *
 * SECURITY: this spawns an interactive shell with the server process's full
 * privileges. It is gated to loopback / Tailscale origins by the namespace and
 * MUST NEVER be exposed publicly. Sessions are capped and every pty is killed on
 * socket disconnect / teardown.
 */
import { homedir } from 'node:os'
import { existsSync, statSync } from 'node:fs'
import { isPathInsideRoot } from '../files/pathGuard'

/** The shape of a spawned pty we depend on (subset of node-pty's IPty). */
export interface PtyProcess {
  readonly pid: number
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}

/** The slice of node-pty's module surface we use. Injectable for tests. */
export interface NodePtyLike {
  spawn(
    file: string,
    args: string[] | string,
    options: {
      name?: string
      cols?: number
      rows?: number
      cwd?: string
      env?: Record<string, string | undefined>
    },
  ): PtyProcess
}

/** Cached lazy import of node-pty. `false` = a previous load attempt failed. */
let cachedNodePty: NodePtyLike | false | null = null

/**
 * Lazily import the native `node-pty` module. Returns the module on success, or
 * `null` if it could not be loaded (native binding missing / failed to build).
 * The result is cached so repeated calls are cheap and the failure is sticky.
 */
export async function loadNodePty(): Promise<NodePtyLike | null> {
  if (cachedNodePty === false) return null
  if (cachedNodePty) return cachedNodePty
  try {
    // Dynamic import keeps a missing/broken native addon from taking down the
    // whole server at module-eval time.
    const mod = (await import('node-pty')) as unknown as NodePtyLike
    if (typeof mod.spawn !== 'function') {
      cachedNodePty = false
      return null
    }
    cachedNodePty = mod
    return mod
  } catch {
    cachedNodePty = false
    return null
  }
}

/** Reset the cached node-pty load result. Test-only seam. */
export function __resetNodePtyCache(): void {
  cachedNodePty = null
}

export interface TerminalAvailability {
  /** Whether a pty can be spawned on this host right now. */
  available: boolean
  /** Honest, user-facing reason when unavailable (never leaks internals). */
  reason?: string
}

export interface TerminalAvailabilityOptions {
  /** Inject a node-pty loader for tests; defaults to the real lazy loader. */
  load?: () => Promise<NodePtyLike | null>
  /**
   * Whether the terminal is enabled on this bind. When false (a remote bind
   * without AGENT_DECK_ENABLE_TERMINAL=1) we report unavailable with an honest
   * reason BEFORE even probing node-pty, so the UI shows a calm gated panel.
   */
  enabled?: boolean
}

/**
 * Report whether the terminal backend is usable on this host. Used by the REST
 * status route and the namespace's connection guard so the UI can show a calm
 * "terminal unavailable" state instead of a dead socket. Reports unavailable when
 * the terminal is gated off (remote bind, opt-in not set) OR node-pty is missing.
 */
export async function terminalAvailability(
  options: TerminalAvailabilityOptions | (() => Promise<NodePtyLike | null>) = {},
): Promise<TerminalAvailability> {
  // Back-compat: a bare loader function may be passed in place of options.
  const opts: TerminalAvailabilityOptions =
    typeof options === 'function' ? { load: options } : options
  if (opts.enabled === false) {
    return {
      available: false,
      reason:
        'The terminal is disabled on this remote bind. Set AGENT_DECK_ENABLE_TERMINAL=1 on the server to enable it.',
    }
  }
  const load = opts.load ?? loadNodePty
  const pty = await load()
  if (!pty) {
    return {
      available: false,
      reason: 'The terminal backend (node-pty) is not available on this host.',
    }
  }
  return { available: true }
}

/**
 * Resolve the login shell. Honors `$SHELL` when it points at an existing
 * executable; otherwise falls back to a sane platform default. Never returns a
 * non-existent path on POSIX (so the spawn fails loudly only on real misconfig).
 */
export function resolveShell(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === 'win32') {
    return env.COMSPEC ?? 'cmd.exe'
  }
  const shell = env.SHELL?.trim()
  if (shell && existsSync(shell)) return shell
  // Common fallbacks, in order of preference.
  for (const candidate of ['/bin/bash', '/usr/bin/bash', '/bin/sh']) {
    if (existsSync(candidate)) return candidate
  }
  return '/bin/sh'
}

/**
 * Resolve a safe cwd for a new pty, or `null` when none can be safely chosen.
 *
 * Preference order: a caller-requested `requested` dir — honored ONLY when it
 * exists, is a directory, AND is contained within an allowlisted workspace
 * `root` (CONTAINMENT GUARD: a client must not be able to anchor the shell at an
 * arbitrary path like `/` or `~/.ssh`). Otherwise fall back to the first existing
 * allowlisted root.
 *
 * NO SILENT $HOME FALLBACK: when no allowlisted workspace root exists, we return
 * `null` rather than quietly opening the shell at `$HOME` (which would defeat the
 * containment guard and drop the user into their whole home dir). The caller
 * refuses to spawn. Pass `allowHome: true` (operator opt-in,
 * AGENT_DECK_TERMINAL_ALLOW_HOME=1) to fall back to `$HOME` as a last resort.
 */
export function resolveCwd(
  requested: string | undefined,
  roots: string[] = [],
  home = homedir(),
  allowHome = false,
): string | null {
  const isDir = (p: string | undefined): p is string => {
    if (!p) return false
    try {
      return statSync(p).isDirectory()
    } catch {
      return false
    }
  }
  // Honor the requested cwd only if it is an existing directory AND sits inside
  // one of the allowlisted roots. With no roots, nothing can be contained, so a
  // requested cwd is never honored.
  if (isDir(requested) && roots.some((root) => isPathInsideRoot(root, requested))) {
    return requested
  }
  for (const root of roots) {
    if (isDir(root)) return root
  }
  // No allowlisted root resolved. Refuse (null) unless $HOME is explicitly allowed.
  return allowHome && isDir(home) ? home : null
}

/**
 * Curated allowlist of env vars copied from the SERVER process into the child
 * shell. We do NOT spread `process.env`: the BFF's environment may hold secrets
 * (API_SERVER_KEY, AGENT_DECK_TOKEN, cloud creds, …) and a real interactive
 * shell would otherwise inherit them all, leaking them into `env`, subprocesses,
 * and shell history. Only the vars a login shell genuinely needs to behave
 * normally are passed through; everything else is dropped. TERM/COLORTERM are
 * forced below regardless of the inherited value.
 */
export const PTY_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SHELL',
  'TERM',
  'COLORTERM',
  'TZ',
  'TMPDIR',
] as const

/**
 * Build the child shell's environment from a CURATED allowlist (not a spread of
 * the server env), then force a color-capable TERM/COLORTERM. This keeps secrets
 * in the server process environment from leaking into the spawned shell.
 */
export function ptyEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const key of PTY_ENV_ALLOWLIST) {
    const value = env[key]
    if (typeof value === 'string') out[key] = value
  }
  // A capable, color-aware terminal type so prompts/TUIs render well in xterm.
  out.TERM = 'xterm-256color'
  out.COLORTERM = 'truecolor'
  return out
}

export interface SpawnTerminalOptions {
  cols?: number
  rows?: number
  cwd?: string
  /** Allowlisted workspace roots, used as the cwd fallback. */
  roots?: string[]
  /** Permit a last-resort $HOME cwd when no root resolves (operator opt-in). */
  allowHome?: boolean
  env?: NodeJS.ProcessEnv
}

/** Thrown when no safe cwd can be resolved (no workspace root + $HOME not allowed). */
export class NoWorkspaceRootError extends Error {
  constructor() {
    super(
      'terminal unavailable: no allowlisted workspace root to open the shell in. ' +
        'Set AGENT_DECK_TERMINAL_ALLOW_HOME=1 to allow falling back to $HOME.',
    )
    this.name = 'NoWorkspaceRootError'
  }
}

export const DEFAULT_COLS = 80
export const DEFAULT_ROWS = 24

/** A spawned shell plus the (resolved, trusted) cwd it was opened in. */
export interface SpawnedTerminal {
  pty: PtyProcess
  /** The resolved absolute cwd — surfaced so the caller can audit-log it. */
  cwd: string
}

/**
 * Spawn an interactive login shell pty. Returns the {@link SpawnedTerminal} (pty
 * + the resolved cwd) or throws a "terminal unavailable" error if node-pty cannot
 * be loaded (callers should check {@link terminalAvailability} first and degrade)
 * or if no safe cwd resolves ({@link NoWorkspaceRootError}). `nodePty` can be a
 * module (injected for tests) or a loader function; defaults to {@link loadNodePty}.
 */
export async function spawnTerminal(
  options: SpawnTerminalOptions = {},
  nodePty: NodePtyLike | (() => Promise<NodePtyLike | null>) = loadNodePty,
): Promise<SpawnedTerminal> {
  const pty = typeof nodePty === 'function' ? await nodePty() : nodePty
  if (!pty) {
    throw new Error('terminal unavailable: node-pty could not be loaded')
  }
  const env = options.env ?? process.env
  const shell = resolveShell(env)
  // No silent $HOME fallback: refuse to spawn if no allowlisted root resolves
  // (unless $HOME is explicitly permitted) rather than dropping into the home dir.
  const cwd = resolveCwd(options.cwd, options.roots ?? [], homedir(), options.allowHome ?? false)
  if (cwd === null) {
    throw new NoWorkspaceRootError()
  }
  const proc = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: clampDim(options.cols, DEFAULT_COLS),
    rows: clampDim(options.rows, DEFAULT_ROWS),
    cwd,
    env: ptyEnv(env),
  })
  return { pty: proc, cwd }
}

/** Clamp a requested terminal dimension to a sane, bounded integer. */
export function clampDim(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const n = Math.floor(value)
  if (n < 1) return 1
  if (n > 1000) return 1000
  return n
}

/**
 * CLI detector — probes which agent CLIs the user actually has, so the Terminal
 * launcher can offer ONLY what's installed (honest, never assumed).
 *
 * WHY AN INTERACTIVE SHELL (load-bearing): the user's `claude` is a shell ALIAS
 * (and the same is true of shell functions and version-manager shims — nvm/asdf/
 * volta). An alias lives in the interactive shell's rc and is INVISIBLE to a bare
 * PATH / `which` scan from the Node server. So we probe through the user's
 * interactive login shell — `$SHELL -ic 'command -v <name>'` — exactly where the
 * alias resolves. A bare PATH lookup would report `claude` as missing.
 *
 * SECURITY: the probe is argv-only via the injected {@link ProbeExec} (the real
 * runner is execFile, no shell-string for the OUTER call). The probed names come
 * from the FIXED internal {@link CLI_PRESETS} list — never a user-supplied string
 * — so the `-ic` script substitutes only a constant `command -v hermes|claude|codex`.
 *
 * FAIL CLOSED: a probe that throws / times out, or any non-zero exit, resolves to
 * NOT-available — we never offer to launch a CLI we could not confirm. The raw
 * shell is always available (it needs no probe). The result is cached per process
 * (the probe is the one slightly-costly bit); pass `fresh` to bypass the cache.
 */
import { execFile as nodeExecFile } from 'node:child_process'
import { resolveShell } from './ptyBridge'

/** A detectable preset id (the four the OSS default ships). */
export type CliId = 'hermes' | 'claude' | 'codex' | 'shell'

/** A launcher preset: id, label, the command seeded into the shell, install URL. */
export interface CliPreset {
  id: CliId
  /** Human label for the launcher card / session title. */
  label: string
  /**
   * The command line seeded into the freshly-spawned shell (e.g. `hermes`). A
   * fixed internal constant — never user-supplied. Absent for the raw shell
   * (which seeds nothing).
   */
  command?: string
  /** The `command -v` name we probe (defaults to {@link CliPreset.command}). */
  probe?: string
  /** Official docs/install URL surfaced when the CLI is missing. */
  installUrl?: string
}

/**
 * The FIXED preset list. Adding a CLI later is a one-line change here. The OSS
 * default ships the widely-known presets only (no "not installed" noise for niche
 * tools the user has never heard of; the raw shell covers it).
 */
export const CLI_PRESETS: readonly CliPreset[] = [
  {
    id: 'hermes',
    label: 'Hermes CLI',
    command: 'hermes',
    installUrl: 'https://github.com/NousResearch/hermes-agent',
  },
  {
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
    installUrl: 'https://docs.anthropic.com/en/docs/claude-code/overview',
  },
  {
    id: 'codex',
    label: 'Codex',
    command: 'codex',
    installUrl: 'https://developers.openai.com/codex/cli',
  },
  {
    id: 'shell',
    label: 'Raw shell',
    // No seed command — the raw interactive shell, exactly as today.
    installUrl: undefined,
  },
] as const

/** A detected CLI as reported to the route/UI (server-local, no protocol DTO). */
export interface DetectedCli {
  id: CliId
  label: string
  available: boolean
  /** Present when the CLI is missing, so the UI can render a real "Install →" link. */
  installUrl?: string
}

/**
 * The argv-only exec the detector uses (injectable for hermetic tests). The real
 * runner is execFile($SHELL, ['-ic', script]) with a timeout. Resolves with the
 * captured stdout + the exit code; a non-zero/clean exit is the caller's signal.
 */
export type ProbeExec = (shell: string, args: string[]) => Promise<{ stdout: string; code: number }>

export interface DetectClisOptions {
  /** Inject the probe exec (tests); defaults to the real interactive-shell exec. */
  exec?: ProbeExec
  /** Override the shell ($SHELL); defaults to {@link resolveShell}. */
  shell?: string
  /** Per-probe timeout (ms). Default 3000 — a `command -v` is instant. */
  timeoutMs?: number
  /** Bypass the per-process cache and re-probe. */
  fresh?: boolean
}

const DEFAULT_TIMEOUT_MS = 3_000
const MAX_BUFFER = 256 * 1024

/** Cached detection result (the probe is the costly bit). `null` = not yet run. */
let cached: DetectedCli[] | null = null

/** Reset the cached detection. Test-only seam. */
export function __resetCliDetectorCache(): void {
  cached = null
}

/** The real interactive-shell probe: `$SHELL -ic 'command -v <name>'` via execFile. */
const realProbe: ProbeExec = (shell, args) =>
  new Promise((resolve, reject) => {
    nodeExecFile(
      shell,
      args,
      { timeout: DEFAULT_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
      (error, stdout) => {
        if (error) {
          // A non-zero EXIT (command not found) carries a numeric `.code` — that
          // is a clean "not found", not a spawn failure: resolve with that code.
          const code = (error as { code?: string | number }).code
          if (typeof code === 'number') {
            resolve({ stdout: stdout ?? '', code })
            return
          }
          // A real spawn failure (ENOENT/timeout, string code) → reject; the
          // caller fails closed (not-available).
          reject(error)
          return
        }
        resolve({ stdout: stdout ?? '', code: 0 })
      },
    )
  })

/**
 * Probe one preset through the interactive shell. Available iff the shell exits 0
 * AND prints a resolution. FAILS CLOSED to not-available on any throw/timeout.
 */
async function probeOne(preset: CliPreset, shell: string, exec: ProbeExec): Promise<boolean> {
  const name = preset.probe ?? preset.command
  if (!name) return false
  try {
    // A constant script over a FIXED preset name — no user input is interpolated.
    const { stdout, code } = await exec(shell, ['-ic', `command -v ${name}`])
    return code === 0 && stdout.trim().length > 0
  } catch {
    // spawn failure / timeout → unknown → fail closed.
    return false
  }
}

/**
 * Detect the available CLIs. Returns one {@link DetectedCli} per preset (raw shell
 * always available; the others gated on the interactive-shell probe). Cached per
 * process unless `fresh` is set.
 */
export async function detectClis(options: DetectClisOptions = {}): Promise<DetectedCli[]> {
  if (!options.fresh && cached) return cached
  const exec = options.exec ?? realProbe
  const shell = options.shell ?? resolveShell()

  const detected = await Promise.all(
    CLI_PRESETS.map(async (preset): Promise<DetectedCli> => {
      // The raw shell needs no probe — it is the universal fallback.
      const available = preset.id === 'shell' ? true : await probeOne(preset, shell, exec)
      return {
        id: preset.id,
        label: preset.label,
        available,
        // Only surface the install hint for a MISSING, probeable CLI.
        ...(!available && preset.installUrl ? { installUrl: preset.installUrl } : {}),
      }
    }),
  )

  cached = detected
  return detected
}

/** A resolved launch preset: a seed command (null = raw shell) + a friendly label. */
export interface ResolvedCliPreset {
  /** The command seeded into the new shell, or `null` for the raw shell (no seed). */
  command: string | null
  /** Friendly label, used for the session title. */
  label: string
}

/**
 * Resolve the seed command for a preset id, asserting it is currently available.
 * Returns `{ command, label }` for an available, seedable preset (`command: null`
 * for the raw shell — no seed). THROWS {@link UnavailableCliError} for an
 * unavailable / unknown preset so the caller REJECTS before spawning (never types
 * a command into a "command not found").
 */
export async function resolveCliPreset(
  id: string,
  options: DetectClisOptions = {},
): Promise<ResolvedCliPreset> {
  const preset = CLI_PRESETS.find((p) => p.id === id)
  if (!preset) {
    throw new UnavailableCliError(id)
  }
  // Raw shell: always allowed, no seed command, no probe.
  if (preset.id === 'shell') {
    return { command: null, label: preset.label }
  }
  const detected = await detectClis(options)
  const hit = detected.find((c) => c.id === id)
  if (!hit?.available) {
    throw new UnavailableCliError(id)
  }
  return { command: preset.command ?? null, label: preset.label }
}

/** Thrown when a launch preset is unknown or not installed — reject BEFORE spawn. */
export class UnavailableCliError extends Error {
  constructor(public readonly id: string) {
    super(`CLI preset "${id}" is not available on this host.`)
    this.name = 'UnavailableCliError'
  }
}

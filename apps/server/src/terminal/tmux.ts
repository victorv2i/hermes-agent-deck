/**
 * tmux helpers — the terminal's PERSISTENCE layer.
 *
 * When tmux is installed, the deck backs each stable terminal session with a
 * tmux session on the user's tmux server instead of a bare shell, so the shell
 * survives BFF restarts and arbitrarily long disconnects, and is shareable
 * across devices (including the user's own `tmux attach` from any terminal).
 *
 * OWNERSHIP: deck-created sessions are namespaced with the `adk_` prefix
 * ({@link deckSessionName}); anything else visible on the server is a FOREIGN
 * session the user made themselves. The deck may attach to foreign sessions but
 * never creates or kills them ({@link killDeckSession} hard-refuses non-`adk_`
 * names).
 *
 * Every helper accepts optional extra socket args (e.g. `['-L', 'adk_test_x']`)
 * so tests run against a THROWAWAY tmux server and never touch the user's
 * default one. Production passes nothing (the default server), which is exactly
 * what makes the sessions shareable with the user's own tmux.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Prefix marking a tmux session as deck-owned (safe to create/kill). */
export const DECK_SESSION_PREFIX = 'adk_'

/** Hard bound on generated session-name length (tmux has no strict limit; this
 * keeps targets readable and shell-safe). Client session ids are <= 128 chars. */
const MAX_SESSION_NAME_LEN = 100

/** One tmux session as reported by `list-sessions`. */
export interface TmuxSessionInfo {
  name: string
  /** Session creation time, in epoch SECONDS (tmux's #{session_created}). */
  createdEpoch: number
  /** Last pane activity, in epoch SECONDS (tmux's #{session_activity}). */
  lastActivityEpoch: number
  /** How many clients are currently attached. */
  attachedCount: number
  /** True when the name carries the deck's `adk_` ownership prefix. */
  deckOwned: boolean
}

/** Cached host probe (`tmux -V`). Sticky per process; reset seam for tests. */
let availableCache: Promise<boolean> | null = null

/**
 * Whether tmux can back persistent terminal sessions on this host. The probe
 * (`tmux -V`) is cached per process. AGENT_DECK_DISABLE_TMUX=1 forces false
 * (checked on every call, BEFORE the cache, so tests/operators can flip it) and
 * drops the deck back to the bare-shell + park/reattach path.
 */
export function tmuxAvailable(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (env.AGENT_DECK_DISABLE_TMUX === '1') return Promise.resolve(false)
  if (!availableCache) {
    availableCache = run('tmux', ['-V']).then(
      () => true,
      () => false,
    )
  }
  return availableCache
}

/** Reset the cached tmux availability probe. Test-only seam. */
export function __resetTmuxAvailableCache(): void {
  availableCache = null
}

/**
 * Map a stable deck session id to its tmux session name: `adk_` + the id with
 * every character outside [A-Za-z0-9_-] replaced by `-`.
 *
 * SANITATION: tmux target syntax reserves `.` (window/pane separator) and `:`
 * (session separator), and unusual characters make `-t` targets ambiguous or
 * shell-hostile, so only [A-Za-z0-9_-] survives. The mapping can collide for
 * ids that differ only in punctuation, but deck ids carry a random token so
 * this never matters in practice. Bounded to {@link MAX_SESSION_NAME_LEN}.
 */
export function deckSessionName(stableId: string): string {
  const sanitized = stableId.replace(/[^A-Za-z0-9_-]/g, '-')
  return (DECK_SESSION_PREFIX + sanitized).slice(0, MAX_SESSION_NAME_LEN)
}

/**
 * List the sessions on the tmux server. A host with tmux but NO running server
 * exits 1 ("no server running" / "error connecting") — that is the normal empty
 * state, reported as `[]`, not an error. Malformed lines are skipped.
 */
export async function listTmuxSessions(socketArgs: string[] = []): Promise<TmuxSessionInfo[]> {
  let stdout: string
  try {
    const result = await run('tmux', [
      ...socketArgs,
      'list-sessions',
      '-F',
      '#{session_name}\t#{session_created}\t#{session_attached}\t#{session_activity}',
    ])
    stdout = result.stdout
  } catch {
    // tmux exits 1 when no server is running on the socket — an empty server
    // list, not a failure. (Any rarer failure also honestly reads as "none".)
    return []
  }
  const sessions: TmuxSessionInfo[] = []
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    const [name, created, attached, activity] = line.split('\t')
    if (!name) continue
    sessions.push({
      name,
      createdEpoch: Number.parseInt(created ?? '', 10) || 0,
      lastActivityEpoch: Number.parseInt(activity ?? '', 10) || 0,
      attachedCount: Number.parseInt(attached ?? '', 10) || 0,
      deckOwned: name.startsWith(DECK_SESSION_PREFIX),
    })
  }
  return sessions
}

/**
 * Whether a session with EXACTLY this name exists. Uses tmux's `=name` exact
 * target form — a bare `-t name` would happily prefix-match another session.
 */
export async function hasTmuxSession(name: string, socketArgs: string[] = []): Promise<boolean> {
  try {
    await run('tmux', [...socketArgs, 'has-session', '-t', `=${name}`])
    return true
  } catch {
    return false
  }
}

/**
 * Kill a DECK-OWNED tmux session. Throws (before any tmux command runs) for a
 * name without the `adk_` prefix: the deck must never be able to kill a session
 * the user created themselves.
 */
export async function killDeckSession(name: string, socketArgs: string[] = []): Promise<void> {
  if (!name.startsWith(DECK_SESSION_PREFIX)) {
    throw new Error(
      `refusing to kill tmux session "${name}": only deck-owned (${DECK_SESSION_PREFIX}*) sessions may be killed`,
    )
  }
  await run('tmux', [...socketArgs, 'kill-session', '-t', `=${name}`])
}

/**
 * Capture the most recent `lines` of a session's active pane (with escape
 * sequences, so colors survive): `capture-pane -e -p -S -<lines>`. The pane
 * target is `=name:` — exact session match, current window's active pane.
 */
export async function capturePane(
  name: string,
  lines: number,
  socketArgs: string[] = [],
): Promise<string> {
  const back = Math.max(1, Math.floor(lines))
  const { stdout } = await run('tmux', [
    ...socketArgs,
    'capture-pane',
    '-e',
    '-p',
    '-S',
    `-${back}`,
    '-t',
    `=${name}:`,
  ])
  return stdout
}

/**
 * Type a line into a session's active pane THROUGH THE TMUX SERVER (`send-keys
 * -l` literal text, then Enter). Unlike writing to the tmux client's pty, this
 * cannot be eaten by the client's line discipline while it is still entering
 * raw mode — the keystrokes queue on the pane's pty and the user still SEES the
 * command typed into their own shell.
 */
export async function sendKeys(
  name: string,
  text: string,
  socketArgs: string[] = [],
): Promise<void> {
  await run('tmux', [...socketArgs, 'send-keys', '-t', `=${name}:`, '-l', text])
  await run('tmux', [...socketArgs, 'send-keys', '-t', `=${name}:`, 'Enter'])
}

/**
 * Best-effort per-session options for a DECK-OWNED session (never applied to a
 * foreign one — those are the user's, options included):
 *  - `aggressive-resize on` (window): the pane tracks the size of the
 *    most-recently-active client instead of shrinking to the smallest one,
 *  - `mouse on`: the wheel scrolls tmux's own history (tmux holds the
 *    scrollback, so without this the deck's xterm has ~nothing to scroll),
 *  - `status off`: no green status bar eating a row and exposing the internal
 *    adk_ session name inside the deck's chrome.
 * Each option is independently best-effort. Never throws — comfort, not a gate.
 */
export async function applyDeckSessionOptions(
  name: string,
  socketArgs: string[] = [],
): Promise<void> {
  const options: { flags: string[]; option: string; value: string }[] = [
    { flags: ['-w'], option: 'aggressive-resize', value: 'on' },
    { flags: [], option: 'mouse', value: 'on' },
    { flags: [], option: 'status', value: 'off' },
  ]
  for (const { flags, option, value } of options) {
    try {
      await run('tmux', [...socketArgs, 'set-option', ...flags, '-t', `=${name}:`, option, value])
    } catch {
      // best effort only
    }
  }
}

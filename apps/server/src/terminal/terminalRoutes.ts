/**
 * Terminal REST route plugin — a single honest status probe the UI hits before
 * opening the (lazy-loaded) xterm socket, so it can render a calm "terminal
 * unavailable" panel instead of a dead WebSocket when node-pty failed to build.
 *
 * Mounted by the integrator at base `/api/agent-deck/terminal`:
 *   GET /api/agent-deck/terminal/status   → { available, cwd_available, reason? }
 *   GET /api/agent-deck/terminal/clis     → { clis }
 *   GET /api/agent-deck/terminal/sessions → TerminalSessionsResponse (tmux list)
 *
 * `cwd_available` reports whether a workspace cwd resolves (or $HOME is opted in)
 * BEFORE the shell is spawned, so the UI can render a calm "no workspace" panel
 * instead of putting the scary real-shell consent in front of a DOOMED spawn.
 *
 * The interactive stream itself is the Socket.IO namespace in
 * {@link ./terminalNamespace}, not a REST route.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify'
import {
  CliIdSchema,
  type CliId,
  type PaneRuntimeState,
  type TerminalSessionsResponse,
} from '@agent-deck/protocol'
import { terminalAvailability, type NodePtyLike } from './ptyBridge'
import { readPaneState as defaultReadPaneState } from './paneAwareness'
import { detectClis as defaultDetectClis, type DetectedCli } from './cliDetector'
import {
  tmuxAvailable as defaultTmuxAvailable,
  listTmuxSessions as defaultListTmuxSessions,
  type TmuxSessionInfo,
} from './tmux'

export interface TerminalRoutesOptions extends FastifyPluginOptions {
  /** Inject a node-pty loader for tests; defaults to the real lazy loader. */
  loadNodePty?: () => Promise<NodePtyLike | null>
  /**
   * Whether the terminal is enabled on this bind. Default true (loopback). When
   * false (remote bind without AGENT_DECK_ENABLE_TERMINAL=1) the status probe
   * reports unavailable with an honest "disabled" reason.
   */
  enabled?: boolean
  /**
   * Resolver for whether a workspace cwd can be chosen (a root resolves, or
   * $HOME is opted in). Wired to `resolveTerminalCwdAvailable(filesService)` by
   * the integrator; injectable for tests. Defaults to always-true so the probe
   * never regresses when the integrator doesn't supply it.
   */
  cwdAvailable?: () => Promise<boolean>
  /**
   * Detector for which agent CLIs are installed (probed via the user's
   * interactive shell so a `claude` ALIAS is visible). Injectable for tests;
   * defaults to the real {@link detectClis}. Powers `GET /clis` so the launcher
   * offers ONLY installed CLIs (honest, never assumed).
   */
  detectClis?: () => Promise<DetectedCli[]>
  /** Probe for tmux (persistent sessions). Injectable for tests. */
  tmuxAvailable?: () => Promise<boolean>
  /** Lister for the tmux server's sessions. Injectable for tests. */
  listTmuxSessions?: () => Promise<TmuxSessionInfo[]>
  /**
   * Reader for a pane's live runtime state (run state / active file / last tool),
   * read from the CLI's own session transcript on disk. Injectable for tests;
   * defaults to the real {@link readPaneState}.
   */
  readPaneState?: (cli: CliId, cwd: string | undefined) => PaneRuntimeState
}

/** Probe payload the UI consumes (snake_case `cwd_available` per the wire shape). */
interface TerminalStatusResponse {
  available: boolean
  cwd_available: boolean
  reason?: string
}

/**
 * Fastify plugin exposing the terminal status probe. Register with a prefix:
 *   app.register(terminalRoutes, { prefix: '/api/agent-deck/terminal' })
 */
export async function terminalRoutes(
  app: FastifyInstance,
  options: TerminalRoutesOptions = {},
): Promise<void> {
  app.get('/status', async (): Promise<TerminalStatusResponse> => {
    const avail = await terminalAvailability({
      load: options.loadNodePty,
      enabled: options.enabled ?? true,
    })
    const cwdAvailable = options.cwdAvailable ? await options.cwdAvailable() : true
    if (!avail.available) {
      // node-pty missing / gated-off dominates: surface its reason as-is and
      // report cwd as unavailable too (no shell to anchor).
      return { available: false, cwd_available: false, reason: avail.reason }
    }
    if (!cwdAvailable) {
      return {
        available: true,
        cwd_available: false,
        reason:
          'No workspace directory to open the terminal in. Create a profile workspace, ' +
          'or set AGENT_DECK_TERMINAL_ALLOW_HOME=1 on the server to allow $HOME.',
      }
    }
    return { available: true, cwd_available: true }
  })

  // The launcher's preset list: which agent CLIs are installed (so the UI offers
  // ONLY what's actually here, with an install hint for the rest). Probed through
  // the user's interactive shell so a `claude` ALIAS is detected. Cached per
  // process inside the detector — the probe is the slightly-costly bit.
  const detect = options.detectClis ?? defaultDetectClis
  app.get('/clis', async (): Promise<{ clis: DetectedCli[] }> => {
    return { clis: await detect() }
  })

  // The persistent-session list: every tmux session on the user's server, both
  // deck-owned (adk_*, resumable/killable from the deck) and foreign (the
  // user's own, attachable only). Without tmux this is HONESTLY empty —
  // terminals still work via the in-process park/reattach fallback.
  const canTmux = options.tmuxAvailable ?? (() => defaultTmuxAvailable())
  const listSessions = options.listTmuxSessions ?? (() => defaultListTmuxSessions())
  app.get('/sessions', async (): Promise<TerminalSessionsResponse> => {
    if (!(await canTmux())) {
      return { tmuxAvailable: false, sessions: [] }
    }
    const sessions = (await listSessions()).map((s) => ({
      name: s.name,
      deckOwned: s.deckOwned,
      attachedCount: s.attachedCount,
      createdEpoch: s.createdEpoch,
      lastActivityEpoch: s.lastActivityEpoch,
      // Every tmux-backed session outlives deck restarts and disconnects.
      persistent: true,
    }))
    return { tmuxAvailable: true, sessions }
  })

  // Pane awareness: what the agent CLI running in a pane is doing right now, read
  // from the CLI's OWN session transcript (Claude Code today). Polled by the pane
  // header. A bad cli is a 400; any unreadable/unknown pane is the honest
  // `unknown` snapshot (never a fabricated activity).
  const readState = options.readPaneState ?? defaultReadPaneState
  app.get<{ Querystring: { cli?: string; cwd?: string } }>(
    '/pane-state',
    async (req, reply): Promise<PaneRuntimeState | undefined> => {
      const cli = CliIdSchema.safeParse(req.query.cli)
      if (!cli.success) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: 'cli must be one of hermes|claude|codex|shell' })
      }
      const cwd =
        typeof req.query.cwd === 'string' && req.query.cwd.length > 0 ? req.query.cwd : undefined
      return readState(cli.data, cwd)
    },
  )
}

export default terminalRoutes

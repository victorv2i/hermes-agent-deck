import { Suspense, lazy, useCallback, useState, type ComponentType } from 'react'
import { Eraser, RotateCcw, SquareTerminal, TriangleAlert } from 'lucide-react'
import { ConnectionDot, type ConnectionStatus } from '@/components/layout/ConnectionDot'
import { Button } from '@/components/ui/button'
import { SurfaceHeader } from '@/components/ui/surface-header'
import { useVisualViewportInset } from '@/lib/useVisualViewportInset'
import { useTerminalStatus, type TerminalStatusState } from './useTerminalStatus'
import { useTerminalClis, type CliId } from './useTerminalClis'
import { useTerminalTmuxSessions } from './useTerminalTmuxSessions'
import { useTerminalAcknowledged, type AckStorage } from './useTerminalAcknowledged'
import { TerminalStatusIndicator } from './terminalStatus'
import { TerminalLauncher } from './TerminalLauncher'
import { TerminalMultiView } from './TerminalMultiView'
import { readPersistedSessions } from './terminalSessions'
import type { TerminalViewProps } from './TerminalView'
import type { TerminalStatus } from './terminalSocket'

/**
 * The Terminal surface, mounted at `/terminal`. Probes the BFF for terminal
 * availability first (so a host without a working node-pty shows a calm panel
 * instead of a dead socket), then lazily mounts the xterm.js terminal — keeping
 * the heavy terminal engine out of the initial bundle until this route opens.
 *
 * The body is the MULTI-TERMINAL view ({@link TerminalMultiView}): many live
 * shells with a tab/grid toggle, capped at 12. Each session = its own socket =
 * its own server pty. The route keeps the single SurfaceHeader (whose
 * Clear/Restart/status act on the ACTIVE session), the consent gate, and the
 * launcher (which seeds the FIRST terminal's preset).
 *
 * `fetchImpl` and `viewComponent` are injectable so the route is testable in
 * jsdom without the real xterm engine or a live BFF.
 */

// React.lazy keeps @xterm/* and the TerminalView chunk out of the main bundle.
const LazyTerminalView = lazy(() =>
  import('./TerminalView').then((m) => ({ default: m.TerminalView })),
)

export interface TerminalRouteProps {
  /** Inject fetch for tests. */
  fetchImpl?: typeof fetch
  /** Inject the view (tests) to bypass the real lazy xterm import. */
  viewComponent?: ComponentType<TerminalViewProps>
  /** Inject acknowledge storage (tests); defaults to localStorage. */
  ackStorage?: AckStorage | null
}

export function TerminalRoute({ fetchImpl, viewComponent, ackStorage }: TerminalRouteProps = {}) {
  const state = useTerminalStatus(fetchImpl ?? fetch)
  const View = viewComponent ?? LazyTerminalView
  // First-open safety gate: the user must acknowledge that this is a REAL shell
  // on the host before we ever connect a socket / spawn a pty.
  const [acknowledged, acknowledge] = useTerminalAcknowledged(ackStorage)

  // The launcher's CLI list (only fetched once the surface is mounted). The query
  // is always called (hooks rule) but its data is only consumed below the gates.
  const clisState = useTerminalClis(fetchImpl ?? fetch)

  // The server's tmux session list — the SOURCE OF TRUTH for which shells
  // actually exist. The multi-view waits for it to SETTLE (ready or failed)
  // before mounting, so restored localStorage sessions are reconciled against
  // reality (dead entries cleaned, forgotten deck shells recovered) instead of
  // silently respawning fresh shells under old names.
  const tmuxState = useTerminalTmuxSessions(fetchImpl ?? fetch)

  // Active-session state lifted up from the multi-view so the ONE SurfaceHeader
  // can own the connection status + controls (T1.8 + T2.3), bound to whichever
  // terminal is active. `clear`/`restart` are handles for the ACTIVE session (null
  // until a session is live). `launchCli` is the launcher preset chosen for the
  // FIRST terminal (null = the launcher is still showing, no live session yet).
  //
  // RESUME ON RELOAD: `launchCli` is NOT persisted, so on a plain refresh it seeds
  // from any sessions parked in localStorage (the same key the multi-view restores
  // from). When persisted sessions exist we treat the surface as already-live and
  // mount the multi-view straight away — it reattaches each parked pty and replays
  // its scrollback — instead of falling back to the launcher (which would orphan
  // the parked shells). The seed `cli` is only a first-open fallback; on resume the
  // multi-view restores the FULL persisted session list and ignores `initialCli`.
  const [launchCli, setLaunchCli] = useState<CliId | null>(
    () => readPersistedSessions()?.sessions[0]?.cli ?? null,
  )
  // A foreign tmux session chosen at the launcher to attach to (opens its tab).
  const [attachTarget, setAttachTarget] = useState<string | null>(null)
  // Entered via the launcher's "Reattach" (recover the running deck shells
  // without opening a fresh one).
  const [recoverOnly, setRecoverOnly] = useState(false)
  const [liveStatus, setLiveStatus] = useState<TerminalStatus | null>(null)
  const [clear, setClear] = useState<(() => void) | null>(null)
  const [restartActive, setRestartActive] = useState<(() => void) | null>(null)

  // The pty backend is usable (node-pty loaded + not gated off).
  const backendAvailable = state.phase === 'ready' && state.status.available
  // A workspace cwd resolves (or $HOME is opted in). When the backend is up but
  // no cwd resolves, a spawn would be DOOMED — we show a calm panel BEFORE the
  // real-shell consent gate rather than letting the scary acknowledge precede it.
  const cwdAvailable = state.phase === 'ready' && state.status.cwdAvailable
  // Only fully available (gate + live view) when BOTH hold.
  const available = backendAvailable && cwdAvailable

  // A live session exists once a launcher preset has been chosen OR sessions were
  // restored from localStorage on reload (both seed `launchCli`), so a refresh
  // mounts the multi-view (which reattaches the parked shells) instead of the launcher.
  const sessionLive = launchCli != null

  const launch = useCallback((id: CliId) => {
    setClear(null)
    setLiveStatus('connecting')
    setLaunchCli(id)
  }, [])

  // Attach to a FOREIGN tmux session from the launcher (the seed cli is only
  // the multi-view's fallback; the attach tab itself sends `attach`).
  const attach = useCallback((name: string) => {
    setClear(null)
    setLiveStatus('connecting')
    setAttachTarget(name)
    setLaunchCli((cli) => cli ?? 'shell')
  }, [])

  // Reattach the deck shells the server still holds (no fresh shell opened).
  const resume = useCallback(() => {
    setClear(null)
    setLiveStatus('connecting')
    setRecoverOnly(true)
    setLaunchCli((cli) => cli ?? 'shell')
  }, [])

  // iOS never resizes the layout viewport for the on-screen keyboard, so without
  // this the bottom of the terminal — the line you're typing on — sits behind it.
  // Padding the surface by the keyboard's overlap shrinks the host; the view's
  // ResizeObserver then refits the pty rows so the cursor stays visible.
  const keyboardInset = useVisualViewportInset()

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      style={keyboardInset > 0 ? { paddingBottom: keyboardInset } : undefined}
    >
      <Header
        probe={probeStatus(state)}
        live={available && sessionLive ? liveStatus : null}
        onClear={clear}
        onRestart={available && sessionLive ? restartActive : null}
      />
      {state.phase === 'loading' && <CenteredNote>Checking the terminal…</CenteredNote>}

      {state.phase === 'failed' && (
        <Panel
          title="Terminal unavailable"
          body="Couldn't reach the terminal backend. Make sure the Agent Deck server is running."
          tone="error"
        />
      )}

      {state.phase === 'ready' && !state.status.available && (
        <Panel
          title="Terminal unavailable"
          body={
            state.status.reason ?? 'The terminal backend (node-pty) is not available on this host.'
          }
          tone="error"
        />
      )}

      {/* DOOMED-SPAWN GUARD: backend is up but no workspace cwd resolves. Render
          the calm panel BEFORE the real-shell consent gate so the scary
          acknowledge never precedes a spawn that would fail anyway. */}
      {backendAvailable && !cwdAvailable && (
        <Panel
          title="Terminal unavailable"
          body={
            state.status.reason ?? 'There is no workspace directory to open the terminal in yet.'
          }
          tone="error"
        />
      )}

      {/* First-open acknowledge gate: this is a REAL shell on the host. We do not
          connect the socket / spawn a pty until the user acknowledges. */}
      {available && !acknowledged && <AcknowledgeGate onAcknowledge={acknowledge} />}

      {/* The "choose your agent" launcher — the calm first screen after the
          consent gate. Only installed CLIs are actionable; selecting one opens a
          pty with that preset. No socket/pty exists until a choice is made. */}
      {available && acknowledged && !sessionLive && (
        <TerminalLauncher
          clis={clisState.phase === 'ready' ? clisState.clis : undefined}
          // Thread the probe's FAILED phase through so the launcher renders the
          // presets (raw shell always actionable) + a Retry instead of hanging on
          // the "Checking…" placeholder forever.
          failed={clisState.phase === 'failed'}
          onRetry={clisState.phase !== 'loading' ? clisState.refetch : undefined}
          onLaunch={launch}
          tmux={tmuxState.phase === 'ready' ? tmuxState.data : undefined}
          onAttach={attach}
          onResume={resume}
        />
      )}

      {/* The multi-view waits for the tmux list to SETTLE (ready or failed) so
          restored sessions reconcile against the server's reality up front. */}
      {available &&
        acknowledged &&
        sessionLive &&
        launchCli != null &&
        (tmuxState.phase === 'loading' ? (
          <CenteredNote>Loading terminal…</CenteredNote>
        ) : (
          <Suspense fallback={<CenteredNote>Loading terminal…</CenteredNote>}>
            <TerminalMultiView
              initialCli={launchCli}
              initialAttach={attachTarget ?? undefined}
              recoverOnly={recoverOnly}
              serverSessions={tmuxState.phase === 'ready' ? tmuxState.data : undefined}
              clis={clisState.phase === 'ready' ? clisState.clis : undefined}
              viewComponent={View}
              // The active session's status/clear/restart flow into the single header.
              // useState setters that store a function need the updater form so the
              // handle isn't called as a reducer.
              onActiveStatusChange={(s) => setLiveStatus(s)}
              onActiveClearReady={(fn) => setClear(() => fn)}
              onActiveRestartReady={(fn) => setRestartActive(() => fn)}
            />
          </Suspense>
        ))}
    </div>
  )
}

/**
 * First-open acknowledge gate. Softened to a calm, plain-language tone for
 * newcomers (most people never need the Terminal — they just chat) while still
 * keeping the one honest fact unmissable BEFORE a shell exists: commands here run
 * for real on the host, with no sandbox. We keep the acknowledgment itself (the
 * gate is intentional), just warmer. Uses the warning semantic (not the amber
 * accent), matching the remote-mode banner's honest tone.
 */
function AcknowledgeGate({ onAcknowledge }: { onAcknowledge: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
      <div
        className="ad-surface max-w-md rounded-xl bg-card p-6 text-center"
        role="alertdialog"
        aria-label="Real shell warning"
      >
        <TriangleAlert className="mx-auto size-6 text-warning" aria-hidden />
        <p className="mt-3 text-sm font-medium text-foreground">A quick heads-up first</p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          This is a real shell on the host. Commands you run here execute on the server with your
          own account, just like a terminal on that machine. There&apos;s no sandbox, so take the
          same care you would there. Most people never need this and can just chat.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4 min-h-11 md:min-h-7"
          onClick={onAcknowledge}
        >
          Got it, open the terminal
        </Button>
      </div>
    </div>
  )
}

/**
 * Map the route-level availability probe to the shared connection-dot state:
 * probing = connecting, terminal actually available = online, anything else
 * (probe failed, or backend reachable but node-pty unavailable) = offline.
 */
function probeStatus(state: TerminalStatusState): ConnectionStatus {
  if (state.phase === 'loading') return 'connecting'
  if (state.phase === 'ready' && state.status.available) return 'online'
  return 'offline'
}

function Header({
  probe,
  live,
  onClear,
  onRestart,
}: {
  /** Backend-availability probe (used before the live session exists). */
  probe: ConnectionStatus
  /** Live socket/shell status once the terminal is mounted (else null). */
  live: TerminalStatus | null
  /** Engine clear handle (null until the engine is live). */
  onClear: (() => void) | null
  /** In-place reconnect (null until the backend is available). */
  onRestart: (() => void) | null
}) {
  // The single, canonical header for the surface — the slim SurfaceHeader shared
  // byte-for-byte with the sibling Files surface (the two-tier tool-surface
  // header; see design-language.md). There is NO second inner bar anymore
  // (T1.8): the live connection status is folded into this actions slot, next to
  // the in-place Clear + Restart controls (T2.3). Before a live session exists,
  // the slot shows the backend-availability probe dot.
  const actions =
    onRestart != null ? (
      <>
        {live != null ? <TerminalStatusIndicator status={live} /> : null}
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11 md:min-h-7"
          onClick={() => onClear?.()}
          disabled={onClear == null}
          title="Clear the terminal"
        >
          <Eraser />
          Clear
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 md:min-h-7"
          onClick={onRestart}
          title="Restart the session"
        >
          <RotateCcw />
          Restart
        </Button>
      </>
    ) : (
      <ConnectionDot status={probe} />
    )

  return (
    <SurfaceHeader
      icon={SquareTerminal}
      title="Terminal"
      subtitle="A real shell on the host"
      actions={actions}
    />
  )
}

function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  )
}

function Panel({ title, body, tone }: { title: string; body: string; tone: 'error' | 'muted' }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
      <div className="ad-surface max-w-sm rounded-xl bg-card p-6 text-center">
        <p
          className={`text-sm font-medium ${
            tone === 'error' ? 'text-destructive' : 'text-foreground'
          }`}
        >
          {title}
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  )
}

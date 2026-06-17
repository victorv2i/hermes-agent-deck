import { Suspense, lazy, useCallback, useState, type ComponentType, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Eraser, ExternalLink, RotateCcw, SquareTerminal, TriangleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTerminalStatus, type TerminalStatusState } from './useTerminalStatus'
import { useTerminalAcknowledged, type AckStorage } from './useTerminalAcknowledged'
import { TerminalStatusIndicator } from './terminalStatus'
import { useTerminalPanelStore } from './terminalPanelStore'
import type { TerminalViewProps } from './TerminalView'
import type { TerminalStatus } from './terminalSocket'

/**
 * The TERMINAL DOCK — a SINGLE-session terminal that lives in the right side
 * panel, the same slot the Preview + Work panels share (App.tsx switches between
 * the three; the dock store keeps them mutually exclusive). It is the calm
 * one-shell companion to the `/terminal` surface, which stays the multi-terminal
 * power tool — an "Open full Terminal" link bridges to it.
 *
 * It REUSES the surface's infra wholesale rather than duplicating the pty/socket
 * stack: the same `useTerminalStatus` availability probe, the same real-shell
 * `useTerminalAcknowledged` consent gate, and the same lazy `TerminalView` (xterm
 * + `TerminalSocket`). The one shell PARKS/REATTACHES via the dock's persisted
 * stable session id (terminalPanelStore.dockSessionId), so a browser refresh
 * resumes the SAME shell. Honesty is preserved: on a host where node-pty is
 * unavailable / no workspace cwd resolves / the probe fails (the same gating as
 * remote AGENT_DECK_REMOTE binds), the dock shows the honest "Terminal
 * unavailable" panel and never dials a dead socket.
 */

// React.lazy keeps @xterm/* + the TerminalView chunk out of the main bundle —
// the dock only pulls the heavy engine when a live session actually mounts.
const LazyTerminalView = lazy(() =>
  import('./TerminalView').then((m) => ({ default: m.TerminalView })),
)

export interface TerminalPanelProps {
  /** Inject fetch for tests (the availability probe). */
  fetchImpl?: typeof fetch
  /** Inject the view (tests) to bypass the real lazy xterm import. */
  viewComponent?: ComponentType<TerminalViewProps>
  /** Inject acknowledge storage (tests); defaults to localStorage. */
  ackStorage?: AckStorage | null
}

export function TerminalPanel({ fetchImpl, viewComponent, ackStorage }: TerminalPanelProps = {}) {
  const state = useTerminalStatus(fetchImpl ?? fetch)
  const View = viewComponent ?? LazyTerminalView
  const close = useTerminalPanelStore((s) => s.close)
  // The stable dock session id (resolved once at store creation), read as a plain
  // slice — no method call, so render stays pure (no set()-during-render).
  const dockSessionId = useTerminalPanelStore((s) => s.sessionId)

  // Same first-open safety gate as the surface: this is a REAL shell on the host,
  // so we never connect a socket / spawn a pty until the user acknowledges once.
  const [acknowledged, acknowledge] = useTerminalAcknowledged(ackStorage)

  // The live socket/shell status, surfaced in the dock header next to its controls.
  const [liveStatus, setLiveStatus] = useState<TerminalStatus | null>(null)
  // The engine `clear` handle (null until the xterm engine is live).
  const [clear, setClear] = useState<(() => void) | null>(null)
  // Restart = a fresh shell. We fold a bumping epoch into BOTH the view's React
  // key (forcing a clean remount) and its wire session id, so a refresh (epoch 0)
  // reattaches the parked shell while a Restart yields a brand-new one.
  const [restartEpoch, setRestartEpoch] = useState(0)

  const backendAvailable = state.phase === 'ready' && state.status.available
  const cwdAvailable = state.phase === 'ready' && state.status.cwdAvailable
  const available = backendAvailable && cwdAvailable

  const restart = useCallback(() => {
    setClear(null)
    setLiveStatus('connecting')
    setRestartEpoch((e) => e + 1)
  }, [])

  // The wire session id the dock forwards to `terminal.start`: the stable dock id,
  // suffixed with the restart epoch so a Restart spawns a new shell (epoch 0 = the
  // refresh-reattach key). Only computed when a live session will actually mount.
  const wireSessionId = available && acknowledged ? `${dockSessionId}:${restartEpoch}` : null

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-surface-1"
      role="region"
      aria-label="Terminal dock"
    >
      <DockHeader
        live={available && acknowledged ? liveStatus : null}
        onClear={clear}
        onRestart={available && acknowledged ? restart : null}
        onClose={close}
      />

      {state.phase === 'loading' && <CenteredNote>Checking the terminal…</CenteredNote>}

      {state.phase === 'failed' && (
        <Panel
          title="Terminal unavailable"
          body="Couldn't reach the terminal backend. Make sure the Agent Deck server is running."
        />
      )}

      {state.phase === 'ready' && !state.status.available && (
        <Panel
          title="Terminal unavailable"
          body={
            state.status.reason ?? 'The terminal backend (node-pty) is not available on this host.'
          }
        />
      )}

      {/* Doomed-spawn guard: backend is up but no workspace cwd resolves. Show the
          calm panel BEFORE the real-shell consent gate (the same order as the
          surface), so the scary acknowledge never precedes a spawn that would fail. */}
      {backendAvailable && !cwdAvailable && (
        <Panel
          title="Terminal unavailable"
          body={
            state.status.reason ?? 'There is no workspace directory to open the terminal in yet.'
          }
        />
      )}

      {/* First-open real-shell consent gate. No socket/pty exists until acknowledged. */}
      {available && !acknowledged && <AcknowledgeGate onAcknowledge={acknowledge} />}

      {available && acknowledged && wireSessionId != null && (
        <Suspense fallback={<CenteredNote>Loading terminal…</CenteredNote>}>
          <div className="flex min-h-0 flex-1 flex-col p-3">
            <View
              // Bump the key on Restart so the view remounts a clean engine + socket.
              key={wireSessionId}
              sessionId={wireSessionId}
              onStatusChange={setLiveStatus}
              // useState setters storing a function need the updater form so the
              // handle isn't invoked as a reducer.
              onClearReady={(fn) => setClear(() => fn)}
              onRestart={restart}
            />
          </div>
        </Suspense>
      )}
    </div>
  )
}

function DockHeader({
  live,
  onClear,
  onRestart,
  onClose,
}: {
  live: TerminalStatus | null
  onClear: (() => void) | null
  onRestart: (() => void) | null
  onClose: () => void
}) {
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <span
        aria-hidden
        className="ad-surface grid size-7 shrink-0 place-items-center rounded-[8px] bg-muted text-foreground-tertiary"
      >
        <SquareTerminal className="size-4" />
      </span>
      <h2 className="shrink-0 truncate font-heading text-sm font-medium tracking-tight text-foreground">
        Terminal
      </h2>
      {live != null ? (
        <span className="ml-1 hidden sm:inline">
          <TerminalStatusIndicator status={live} />
        </span>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {onRestart != null ? (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-10 text-muted-foreground hover:text-foreground sm:size-8"
              onClick={() => onClear?.()}
              disabled={onClear == null}
              aria-label="Clear the terminal"
              title="Clear the terminal"
            >
              <Eraser className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-10 text-muted-foreground hover:text-foreground sm:size-8"
              onClick={onRestart}
              aria-label="Restart the session"
              title="Restart the session"
            >
              <RotateCcw className="size-4" />
            </Button>
          </>
        ) : null}
        {/* Bridge to the multi-terminal power tool. A real route link, not a fake. */}
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          className="size-10 text-muted-foreground hover:text-foreground sm:size-8"
        >
          <Link to="/terminal" aria-label="Open full Terminal" title="Open full Terminal">
            <ExternalLink className="size-4" />
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-10 shrink-0 text-muted-foreground hover:text-foreground sm:size-8"
          onClick={onClose}
          aria-label="Close terminal"
          title="Close terminal"
        >
          <X className="size-4" />
        </Button>
      </div>
    </header>
  )
}

/**
 * The first-open real-shell consent gate (the dock's compact twin of the
 * surface's gate). The one honest fact stays unmissable BEFORE a shell exists:
 * commands here run for real on the host, with no sandbox.
 */
function AcknowledgeGate({ onAcknowledge }: { onAcknowledge: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
      <div
        className="ad-surface max-w-sm rounded-xl bg-card p-5 text-center"
        role="alertdialog"
        aria-label="Real shell warning"
      >
        <TriangleAlert className="mx-auto size-6 text-warning" aria-hidden />
        <p className="mt-3 text-sm font-medium text-foreground">A quick heads-up first</p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          This is a real shell on the host. Commands you run here execute on the server with your
          own account. There&apos;s no sandbox, so take the same care you would in a terminal on
          that machine.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4 min-h-11 md:min-h-9"
          onClick={onAcknowledge}
        >
          Got it, open the terminal
        </Button>
      </div>
    </div>
  )
}

function CenteredNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  )
}

/** The honest "unavailable" panel — never a dead socket, never a blank dock. */
function Panel({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
      <div className="ad-surface max-w-xs rounded-xl bg-card p-5 text-center">
        <p className="text-sm font-medium text-destructive">{title}</p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  )
}

/** Re-exported so a host can read the probe state for its toggle gating if needed. */
export type { TerminalStatusState }

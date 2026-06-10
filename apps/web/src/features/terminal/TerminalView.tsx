import { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TerminalSocket, type TerminalSocketLike, type TerminalStatus } from './terminalSocket'
import { buildTerminalTheme } from './terminalTheme'
import { handleTerminalLink } from '@/features/preview/terminalLinkHandler'

/**
 * The interactive xterm.js terminal. Mounts an xterm instance, fits it to its
 * container, and bridges it to the BFF `/agent-deck-terminal` namespace via
 * {@link TerminalSocket}. Warm-void themed.
 *
 * xterm + its addons are imported DYNAMICALLY (and the CSS too) so the heavy
 * terminal engine is only pulled when this surface is actually opened — the
 * route already lazy-loads this component, and this keeps that chunk lean.
 *
 * The xterm engine + socket are injectable so the component is testable in jsdom
 * (which has no real canvas): tests pass a fake engine and a pre-connected socket.
 */

/** The slice of xterm's Terminal we use (lets tests supply a fake). */
export interface TerminalEngine {
  open(el: HTMLElement): void
  write(data: string): void
  onData(cb: (data: string) => void): void
  focus(): void
  /** Clear the scrollback + viewport (xterm's `Terminal.clear`). */
  clear(): void
  dispose(): void
  readonly cols: number
  readonly rows: number
  /** Fit the viewport to the container; returns the new geometry. */
  fit(): { cols: number; rows: number }
}

export interface TerminalEngineFactory {
  (theme: ReturnType<typeof buildTerminalTheme>): Promise<TerminalEngine>
}

/**
 * Default engine factory: dynamically imports @xterm/xterm + fit/web-links
 * addons and its CSS, then adapts them to {@link TerminalEngine}. Only runs in
 * the browser when the terminal is actually opened.
 */
async function defaultEngineFactory(
  theme: ReturnType<typeof buildTerminalTheme>,
): Promise<TerminalEngine> {
  const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
    import('@xterm/xterm'),
    import('@xterm/addon-fit'),
    import('@xterm/addon-web-links'),
    import('@xterm/xterm/css/xterm.css'),
  ])
  const term = new Terminal({
    cursorBlink: true,
    fontFamily: "'JetBrains Mono Variable', ui-monospace, 'SFMono-Regular', Menlo, monospace",
    fontSize: 13,
    lineHeight: 1.2,
    theme,
    allowProposedApi: true,
    scrollback: 5000,
    // a11y: render an off-screen live region of the terminal output so screen
    // readers can announce shell output (xterm's canvas is otherwise opaque).
    screenReaderMode: true,
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  // Wire URL clicks in the terminal output to the in-app Preview panel (#116)
  // instead of a new tab; a modifier-click still opens a real new tab. (Link
  // handler only — the terminal's own multi-view/tab logic is untouched.)
  term.loadAddon(new WebLinksAddon(handleTerminalLink))
  return {
    open: (el) => term.open(el),
    write: (d) => term.write(d),
    onData: (cb) => term.onData(cb),
    focus: () => term.focus(),
    clear: () => term.clear(),
    dispose: () => term.dispose(),
    get cols() {
      return term.cols
    },
    get rows() {
      return term.rows
    },
    fit: () => {
      fit.fit()
      return { cols: term.cols, rows: term.rows }
    },
  }
}

export interface TerminalViewProps {
  /** Inject an xterm engine factory (tests). Defaults to the real lazy loader. */
  engineFactory?: TerminalEngineFactory
  /** Inject a pre-connected socket transport (tests). */
  socket?: TerminalSocketLike
  /** Override the namespace URL. */
  url?: string
  /**
   * Optional launcher preset id (e.g. `hermes`/`claude`/`codex`). Forwarded to
   * `terminal.start` so the server seeds the preset's command into the new shell.
   * Absent = today's raw shell.
   */
  cli?: string
  /**
   * Stable session id. Forwarded to `terminal.start` so the server parks this
   * shell on disconnect and reattaches (replaying scrollback) on a refresh /
   * another machine — the SAME shell resumes. Absent = a non-resumable shell.
   */
  sessionId?: string
  /**
   * Report the live socket/shell status up so the single SurfaceHeader (owned by
   * the route) can show it — there is no inner header bar anymore (T1.8).
   */
  onStatusChange?: (status: TerminalStatus) => void
  /**
   * Report an imperative `clear` handle up when the engine is live (and `null`
   * on teardown), so the route can mount a Clear button in the header actions
   * (T2.3) without reaching into the xterm engine itself.
   */
  onClearReady?: (clear: (() => void) | null) => void
  /**
   * Restart = an in-place reconnect (T2.3). The route owns this (it remounts the
   * view via a key bump for a deterministic fresh shell), so the header button
   * and the exit-overlay button both call back to the same handler.
   */
  onRestart?: () => void
}

export function TerminalView({
  engineFactory,
  socket,
  url,
  cli,
  sessionId,
  onStatusChange,
  onClearReady,
  onRestart,
}: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<TerminalStatus>('connecting')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [exitCode, setExitCode] = useState<number | null>(null)
  // The connection dropped and reconnected: the server force-killed the pty, so
  // the prior shell is gone. We show an honest overlay rather than silently
  // swapping in a fresh shell that looks like the same session.
  const [dropped, setDropped] = useState(false)

  // Keep the latest callbacks in refs so the mount-once effect never needs them
  // in its deps (they may be fresh closures each render from the route). Synced in
  // an effect, not during render (refs must not be mutated while rendering).
  const onStatusChangeRef = useRef(onStatusChange)
  const onClearReadyRef = useRef(onClearReady)
  // `cli` + `sessionId` are read once on mount (the route remounts to switch
  // presets). Refs keep them out of the mount-once effect's deps without going stale.
  const cliRef = useRef(cli)
  const sessionIdRef = useRef(sessionId)
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange
    onClearReadyRef.current = onClearReady
    cliRef.current = cli
    sessionIdRef.current = sessionId
  })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let engine: TerminalEngine | null = null
    let resizeObserver: ResizeObserver | null = null
    let initialFitFrame: number | null = null

    const reportStatus = (next: TerminalStatus) => {
      setStatus(next)
      onStatusChangeRef.current?.(next)
    }

    const factory = engineFactory ?? defaultEngineFactory
    const term = new TerminalSocket(
      {
        onData: (data) => engine?.write(data),
        onExit: ({ exitCode: code }) => setExitCode(code),
        onError: ({ message }) => setErrorMessage(message),
        onStatusChange: reportStatus,
        // The transport reconnected after an established session dropped with NO
        // stable id to reattach to. The server force-killed the pty, so the prior
        // shell is gone — flag it so the overlay offers an explicit restart instead
        // of pretending the session resumed (the 'dropped' status drives the
        // overlay below).
        onReconnectDropped: () => setDropped(true),
        // The server reattached to our parked shell (a refresh / reconnect resumed
        // the SAME shell, scrollback replayed) — clear any stale dropped overlay.
        onResumed: () => setDropped(false),
      },
      { socket, url },
    )

    void (async () => {
      let created: TerminalEngine
      try {
        created = await factory(buildTerminalTheme())
      } catch {
        setErrorMessage('Failed to load the terminal.')
        reportStatus('error')
        return
      }
      if (disposed) {
        created.dispose()
        return
      }
      engine = created
      engine.open(host)
      // Keystrokes / paste → wire.
      engine.onData((data) => term.input(data))
      engine.focus()
      // Expose Clear to the header now that the engine is live.
      onClearReadyRef.current?.(() => engine?.clear())

      term.connect()

      // Defer the INITIAL fit + start to the next frame. Fitting synchronously on
      // mount measures the container BEFORE the browser's layout pass has given it
      // real dimensions, so xterm computes a mis-sized grid (and the pty spawns at
      // the wrong cols/rows). A requestAnimationFrame waits until the host has been
      // laid out, so the first fit reads its true size. The ResizeObserver below
      // then keeps it in sync on every later container change.
      const startWithFit = () => {
        initialFitFrame = null
        if (disposed || !engine) return
        const geo = engine.fit()
        // `cli` (a launcher preset) is forwarded only when set; absent = raw shell.
        // It is captured from the mount-time prop (stable per view instance — the
        // route remounts via a key to switch presets).
        term.start({
          cols: geo.cols,
          rows: geo.rows,
          ...(cliRef.current ? { cli: cliRef.current } : {}),
          ...(sessionIdRef.current ? { sessionId: sessionIdRef.current } : {}),
        })

        // Keep the pty geometry in sync with the container from here on.
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            if (!engine) return
            const next = engine.fit()
            term.resize(next.cols, next.rows)
          })
          resizeObserver.observe(host)
        }
      }

      if (typeof requestAnimationFrame === 'function') {
        initialFitFrame = requestAnimationFrame(startWithFit)
      } else {
        // No rAF (non-browser env): start immediately so the shell still spawns.
        startWithFit()
      }
    })()

    return () => {
      disposed = true
      if (initialFitFrame !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(initialFitFrame)
      }
      onClearReadyRef.current?.(null)
      resizeObserver?.disconnect()
      term.dispose()
      engine?.dispose()
    }
    // Mount once; the injected props are stable for a given surface instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const overlay =
    errorMessage != null ? (
      <TerminalOverlay title="Terminal unavailable" body={errorMessage} tone="error" />
    ) : exitCode != null ? (
      <TerminalOverlay
        title="Session ended"
        body={`The shell exited (code ${exitCode}).`}
        tone="muted"
        onRestart={onRestart}
      />
    ) : dropped ? (
      // Honest "connection dropped" state: the prior shell (scrollback + running
      // processes) was lost when the socket dropped — Restart opens a fresh shell.
      <TerminalOverlay
        title="Connection dropped"
        body="The connection to this shell was lost, so its scrollback and any running processes are gone. Restart to open a fresh shell."
        tone="error"
        onRestart={onRestart}
      />
    ) : null

  return (
    // A single framed instrument: a lifted hairline border + top highlight
    // (.ad-surface) wrapping the warm-void xterm viewport, so the terminal reads
    // as a designed surface, not raw xterm. There is no inner header bar — the
    // live status + controls live in the route's single SurfaceHeader (T1.8).
    <div
      data-status={status}
      className="ad-surface flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-surface-1"
    >
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          ref={hostRef}
          data-testid="terminal-host"
          className="h-full w-full p-3"
          role="group"
          aria-label="Interactive terminal"
        />
        {overlay}
      </div>
    </div>
  )
}

function TerminalOverlay({
  title,
  body,
  tone,
  onRestart,
}: {
  title: string
  body: string
  tone: 'error' | 'muted'
  /** When set, show a Restart button (the calm way back to a live shell). */
  onRestart?: () => void
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-surface-1 p-6">
      <div className="max-w-sm text-center">
        <p
          className={`text-sm font-medium ${
            tone === 'error' ? 'text-destructive' : 'text-foreground'
          }`}
        >
          {title}
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
        {onRestart ? (
          <Button variant="outline" size="sm" className="mt-4" onClick={onRestart}>
            <RotateCcw />
            Restart session
          </Button>
        ) : null}
      </div>
    </div>
  )
}

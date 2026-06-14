import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from 'react'
import { Columns2, Plus, RotateCcw, Square, X } from 'lucide-react'
import { Popover } from 'radix-ui'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CliBrandMark } from './cliBrandIcons'
import { TerminalStatusIndicator } from './terminalStatus'
import type { DetectedCli } from './useTerminalClis'
import {
  MAX_TERMINALS,
  closeSession,
  emptySessions,
  expectsResume,
  isAtCap,
  markRestored,
  openAttachSession,
  openSession,
  readPersistedSessions,
  readViewMode,
  reconcileSessions,
  renameSession,
  restartSession,
  sessionKey,
  setActive,
  setViewMode,
  writeSessions,
  writeViewMode,
  type ServerTmuxSnapshot,
  type SessionsState,
  type TerminalSession,
  type ViewMode,
} from './terminalSessions'
import type { TerminalViewProps } from './TerminalView'
import type { CliId } from './useTerminalClis'
import type { TerminalStatus } from './terminalSocket'

/**
 * The MULTI-TERMINAL surface body: many live shells with a TAB view (one active
 * at a time, "+" to open up to {@link MAX_TERMINALS}) and a GRID view (several at
 * once, the focused one sanctioned-amber). A calm toggle switches modes.
 *
 * Each session is ONE mounted {@link TerminalView} → one socket → one server pty.
 * Inactive tabs stay MOUNTED (hidden, not unmounted) so their shells keep running
 * in the background; switching tabs is instant and lossless. The view component is
 * injectable so tests bypass the heavy xterm engine.
 *
 * SPINE: the single amber accent marks the LIVE/focused terminal (active tab, grid
 * cell ring) and the primary action; brand marks are IDENTITY (their own colors),
 * never the accent. Touch-first targets are ≥44px where controls are dense; full
 * keyboard nav.
 */

export interface TerminalMultiViewProps {
  /** The preset chosen at the launcher for the FIRST terminal. */
  initialCli: CliId
  /**
   * A FOREIGN tmux session name chosen at the launcher: open an attach tab for
   * it (alongside any restored sessions) instead of a fresh preset shell.
   */
  initialAttach?: string
  /**
   * Enter WITHOUT opening a fresh shell: only restored + server-recovered
   * sessions mount (the launcher's "resume the running shells" path).
   */
  recoverOnly?: boolean
  /**
   * The server's tmux session list (the source of truth), fetched by the route
   * BEFORE this mounts. Restored localStorage sessions are reconciled against
   * it: entries whose tmux session is gone are cleaned, and deck-owned (`adk_*`)
   * sessions this browser forgot are recovered as tabs. Undefined (no tmux, or
   * the probe failed) = no reconcile, today's behavior.
   */
  serverSessions?: ServerTmuxSnapshot
  /**
   * The detected CLIs (same list the launcher uses), so the "+" preset menu only
   * offers what's actually installed. Undefined while loading → the menu falls
   * back to the always-available raw shell.
   */
  clis?: DetectedCli[]
  /** Inject the terminal view (tests) to bypass the real lazy xterm import. */
  viewComponent: ComponentType<TerminalViewProps>
  /**
   * Report the ACTIVE session's live status up so the route's single
   * SurfaceHeader can show it (and its Clear/Restart act on the active terminal).
   * Null = no session (all closed).
   */
  onActiveStatusChange?: (status: TerminalStatus | null) => void
  /** Report the active session's engine `clear` handle up (null on teardown). */
  onActiveClearReady?: (clear: (() => void) | null) => void
  /** Report a Restart handle bound to the ACTIVE session (null = no session). */
  onActiveRestartReady?: (restart: (() => void) | null) => void
}

type Action =
  | { type: 'open'; cli: CliId }
  | { type: 'close'; id: string }
  | { type: 'rename'; id: string; title: string }
  | { type: 'restart'; id: string }
  | { type: 'activate'; id: string }
  | { type: 'viewMode'; mode: ViewMode }

function reducer(state: SessionsState, action: Action): SessionsState {
  switch (action.type) {
    case 'open':
      return openSession(state, action.cli)
    case 'close':
      return closeSession(state, action.id)
    case 'rename':
      return renameSession(state, action.id, action.title)
    case 'restart':
      return restartSession(state, action.id)
    case 'activate':
      return setActive(state, action.id)
    case 'viewMode':
      return setViewMode(state, action.mode)
  }
}

/** The init arguments folded into one object (useReducer takes one init arg). */
interface InitArgs {
  initialCli: CliId
  initialAttach?: string
  recoverOnly?: boolean
  serverSessions?: ServerTmuxSnapshot
}

/**
 * Seed the reducer. A browser refresh RESTORES the previously-open sessions (same
 * stable ids) so the server can REATTACH each — and when the server's tmux list
 * is known, it is the SOURCE OF TRUTH: dead entries are cleaned and forgotten
 * deck sessions are recovered as tabs ({@link reconcileSessions}). Then the
 * launcher's intent applies: an attach target opens its tab, recover-only adds
 * nothing, and otherwise a fresh session opens for the chosen preset when none
 * survived.
 */
function init({ initialCli, initialAttach, recoverOnly, serverSessions }: InitArgs): SessionsState {
  const persisted = readPersistedSessions()
  // Restored sessions are EXPECTED to reattach their previous shells — mark
  // them so a ready frame without `resumed` can say honestly that the old
  // shell ended and this is a fresh one (a brand-new open never says that).
  let state = persisted ? markRestored(persisted) : emptySessions(readViewMode())
  if (serverSessions) state = reconcileSessions(state, serverSessions)
  if (initialAttach) return openAttachSession(state, initialAttach)
  if (recoverOnly || state.sessions.length > 0) return state
  return openSession(state, initialCli)
}

export function TerminalMultiView({
  initialCli,
  initialAttach,
  recoverOnly,
  serverSessions,
  clis,
  viewComponent: View,
  onActiveStatusChange,
  onActiveClearReady,
  onActiveRestartReady,
}: TerminalMultiViewProps) {
  const [state, dispatch] = useReducer(
    reducer,
    { initialCli, initialAttach, recoverOnly, serverSessions },
    init,
  )
  // Per-session live status, so each tab/cell shows its own honest connection dot.
  const [statuses, setStatuses] = useState<Record<string, TerminalStatus>>({})
  // Per-session persistence (tmux-backed vs volatile), from terminal.ready.
  const [persistence, setPersistence] = useState<Record<string, boolean>>({})
  // Per-session engine `clear` handles, so the header's Clear acts on the ACTIVE one.
  const clearHandles = useRef<Record<string, (() => void) | null>>({})
  // Per-session explicit end-session handles (terminal.close on the wire).
  const closeHandles = useRef<Record<string, (() => void) | null>>({})
  // A deck-owned PERSISTENT session awaiting the close confirm (dialog open).
  const [pendingClose, setPendingClose] = useState<string | null>(null)
  // A deck-owned PERSISTENT session awaiting the restart confirm (dialog open).
  const [pendingRestart, setPendingRestart] = useState<string | null>(null)

  const setStatus = useCallback((id: string, status: TerminalStatus) => {
    setStatuses((prev) => (prev[id] === status ? prev : { ...prev, [id]: status }))
  }, [])
  const setPersistent = useCallback((id: string, persistent: boolean) => {
    setPersistence((prev) => (prev[id] === persistent ? prev : { ...prev, [id]: persistent }))
  }, [])
  const setClearHandle = useCallback((id: string, clear: (() => void) | null) => {
    // A null report is the view's teardown: drop the entry instead of keeping a
    // null forever for a session that may be gone.
    if (clear) clearHandles.current[id] = clear
    else delete clearHandles.current[id]
  }, [])
  const setCloseHandle = useCallback((id: string, close: (() => void) | null) => {
    if (close) closeHandles.current[id] = close
    else delete closeHandles.current[id]
  }, [])

  // Forget a CLOSED session's per-session records (status, persistence, handles)
  // so they do not accumulate as stale entries across many open/close cycles.
  const forgetSession = useCallback((id: string) => {
    const drop = <T,>(prev: Record<string, T>): Record<string, T> => {
      if (!(id in prev)) return prev
      const { [id]: _dropped, ...rest } = prev
      return rest
    }
    setStatuses(drop)
    setPersistence(drop)
    delete clearHandles.current[id]
    delete closeHandles.current[id]
  }, [])

  const atCap = isAtCap(state)

  // Persist the tab ⇄ grid layout so it survives a reload (seeded back in `init`).
  const viewMode = state.viewMode
  useEffect(() => {
    writeViewMode(viewMode)
  }, [viewMode])

  // Persist the OPEN sessions (ids/clis/titles/active) so a browser refresh
  // remounts the SAME sessions and the server reattaches each to its parked shell.
  useEffect(() => {
    writeSessions(state)
  }, [state])

  // The "+" opens a new terminal for the chosen preset (defaults to raw shell).
  const openNew = useCallback((cli: CliId) => dispatch({ type: 'open', cli }), [])

  // Closing a tab is HONEST about what it ends:
  //  - a FOREIGN attach tab DETACHES (terminal.close on the wire detaches; the
  //    user's session keeps running in their own tmux),
  //  - a deck-owned PERSISTENT shell asks first (its whole point is surviving
  //    disconnects; an explicit close kills it in the tmux server for real),
  //  - a shell whose persistence is still UNKNOWN (no ready frame yet) also
  //    asks first: silently treating it as volatile would skip terminal.close
  //    and orphan an adk_ tmux session the user thought they closed,
  //  - a known-VOLATILE shell closes as before (the socket teardown ends it).
  const requestClose = (id: string) => {
    const session = state.sessions.find((s) => s.id === id)
    if (!session) return
    if (session.attach) {
      closeHandles.current[id]?.()
      dispatch({ type: 'close', id })
      forgetSession(id)
      return
    }
    if (persistence[id] !== false) {
      setPendingClose(id)
      return
    }
    dispatch({ type: 'close', id })
    forgetSession(id)
  }
  const confirmClose = () => {
    if (!pendingClose) return
    closeHandles.current[pendingClose]?.()
    dispatch({ type: 'close', id: pendingClose })
    forgetSession(pendingClose)
    setPendingClose(null)
  }

  // Restarting is honest about the shell it replaces. Bumping the epoch alone
  // would leave a deck-owned PERSISTENT (tmux-backed) shell alive under its old
  // adk_ name — recoverable cruft the user thought was replaced — so a session
  // currently known persistent ASKS FIRST (a restart ends it for real, like
  // Close), then gets a real kill (terminal.close) before the epoch bump
  // remounts a fresh shell under the new key. Volatile shells (their socket
  // teardown ends them) and foreign attach tabs (the deck never kills a user's
  // own session; their restart is just a detach + reattach) keep the plain,
  // confirm-free epoch bump.
  const requestRestart = (id: string) => {
    const session = state.sessions.find((s) => s.id === id)
    if (!session) return
    if (!session.attach && persistence[id] === true) {
      setPendingRestart(id)
      return
    }
    dispatch({ type: 'restart', id })
  }
  const confirmRestart = () => {
    if (!pendingRestart) return
    closeHandles.current[pendingRestart]?.()
    dispatch({ type: 'restart', id: pendingRestart })
    setPendingRestart(null)
  }
  // The header's Restart handle is bound in an [activeId]-only effect below, so
  // it reads the LATEST sessions/persistence through this ref.
  const requestRestartRef = useRef(requestRestart)
  useEffect(() => {
    requestRestartRef.current = requestRestart
  })

  // Surface the ACTIVE session's status/clear/restart up to the route header. Kept
  // in refs+effect so the callbacks (fresh closures from the route) never need to
  // re-run the effect. Clear/restart are bound to whatever is active right now.
  const activeId = state.activeId
  const activeStatus = activeId ? (statuses[activeId] ?? 'connecting') : null
  const reportRef = useRef({ onActiveStatusChange, onActiveClearReady, onActiveRestartReady })
  useEffect(() => {
    reportRef.current = { onActiveStatusChange, onActiveClearReady, onActiveRestartReady }
  })
  useEffect(() => {
    reportRef.current.onActiveStatusChange?.(activeStatus)
  }, [activeStatus])
  useEffect(() => {
    const r = reportRef.current
    r.onActiveClearReady?.(activeId ? () => clearHandles.current[activeId]?.() : null)
    r.onActiveRestartReady?.(activeId ? () => requestRestartRef.current(activeId) : null)
  }, [activeId])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SessionBar
        state={state}
        atCap={atCap}
        statuses={statuses}
        persistence={persistence}
        clis={clis}
        onOpen={openNew}
        onActivate={(id) => dispatch({ type: 'activate', id })}
        onClose={requestClose}
        onRename={(id, title) => dispatch({ type: 'rename', id, title })}
        onSetView={(mode) => dispatch({ type: 'viewMode', mode })}
      />
      {atCap ? (
        <p
          role="status"
          className="border-b border-border bg-surface-1 px-4 py-1.5 text-xs text-foreground-tertiary"
        >
          You have all {MAX_TERMINALS} terminals open (the maximum). Close one to open another.
        </p>
      ) : null}

      {state.viewMode === 'tab' ? (
        <TabPanels
          state={state}
          View={View}
          onStatus={setStatus}
          onPersistent={setPersistent}
          onClearReady={setClearHandle}
          onCloseReady={setCloseHandle}
          onRestart={requestRestart}
        />
      ) : (
        <GridPanels
          state={state}
          View={View}
          statuses={statuses}
          persistence={persistence}
          onStatus={setStatus}
          onPersistent={setPersistent}
          onClearReady={setClearHandle}
          onCloseReady={setCloseHandle}
          onActivate={(id) => dispatch({ type: 'activate', id })}
          onRestart={requestRestart}
        />
      )}

      <ClosePersistentDialog
        title={state.sessions.find((s) => s.id === pendingClose)?.title ?? null}
        persistenceKnown={pendingClose !== null && persistence[pendingClose] !== undefined}
        open={pendingClose !== null}
        onConfirm={confirmClose}
        onCancel={() => setPendingClose(null)}
      />

      <RestartPersistentDialog
        title={state.sessions.find((s) => s.id === pendingRestart)?.title ?? null}
        open={pendingRestart !== null}
        onConfirm={confirmRestart}
        onCancel={() => setPendingRestart(null)}
      />
    </div>
  )
}

/**
 * The restart confirm for a deck-owned PERSISTENT shell: a restart KILLS the
 * current shell in the tmux server (Close's twin, see {@link requestRestart})
 * and starts a fresh one, so it deserves the same honest question Close asks.
 * Cancel is the default-focused action.
 */
function RestartPersistentDialog({
  title,
  open,
  onConfirm,
  onCancel,
}: {
  title: string | null
  open: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Restart this terminal?</DialogTitle>
          <DialogDescription>
            This restarts the persistent shell{title ? <> &ldquo;{title}&rdquo;</> : null}: the
            current shell ends for real (anything still running in it stops) and a fresh one starts
            in its place.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onCancel} autoFocus>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Restart terminal
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The close confirm for a deck-owned PERSISTENT shell: its whole point is
 * surviving disconnects, so an explicit close (which kills it in the tmux
 * server) deserves one honest question. Also shown while persistence is still
 * UNKNOWN (no ready frame yet): the shell may be persistent, and confirming
 * sends a real terminal.close so no tmux session is silently orphaned. Cancel
 * is the default-focused action.
 */
function ClosePersistentDialog({
  title,
  persistenceKnown,
  open,
  onConfirm,
  onCancel,
}: {
  title: string | null
  /** False while the session has not reported persistent/volatile yet. */
  persistenceKnown: boolean
  open: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Close this terminal?</DialogTitle>
          <DialogDescription>
            {persistenceKnown ? (
              <>
                This ends the persistent shell{title ? <> &ldquo;{title}&rdquo;</> : null}. Anything
                still running in it stops, and it will no longer be there to reattach from another
                device.
              </>
            ) : (
              <>
                This shell{title ? <> &ldquo;{title}&rdquo;</> : null} has not connected yet, so it
                may be persistent. Closing ends it for real; anything still running in it stops.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onCancel} autoFocus>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Close terminal
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ── The tab strip + view-mode toggle ───────────────────────────────────────── */

function SessionBar({
  state,
  atCap,
  statuses,
  persistence,
  clis,
  onOpen,
  onActivate,
  onClose,
  onRename,
  onSetView,
}: {
  state: SessionsState
  atCap: boolean
  statuses: Record<string, TerminalStatus>
  persistence: Record<string, boolean>
  clis: DetectedCli[] | undefined
  onOpen: (cli: CliId) => void
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onRename: (id: string, title: string) => void
  onSetView: (mode: ViewMode) => void
}) {
  // Roving arrow-key nav across the tabs (a real tablist).
  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const ids = state.sessions.map((s) => s.id)
    const i = ids.indexOf(state.activeId ?? '')
    if (i === -1) return
    e.preventDefault()
    const next = e.key === 'ArrowRight' ? (i + 1) % ids.length : (i - 1 + ids.length) % ids.length
    const target = ids[next]
    if (target) onActivate(target)
  }

  return (
    <div className="flex items-center gap-2 border-b border-border bg-surface-1 px-2.5 py-1.5">
      <div
        role="tablist"
        aria-label="Terminals"
        aria-orientation="horizontal"
        onKeyDown={onTabKeyDown}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      >
        {state.sessions.map((session) => (
          <Tab
            key={session.id}
            session={session}
            active={session.id === state.activeId}
            status={statuses[session.id]}
            persistent={persistence[session.id]}
            onActivate={() => onActivate(session.id)}
            onClose={() => onClose(session.id)}
            onRename={(title) => onRename(session.id, title)}
          />
        ))}
        <NewTerminalMenu atCap={atCap} clis={clis} onOpen={onOpen} />
      </div>

      <ViewModeToggle mode={state.viewMode} onSetView={onSetView} />
    </div>
  )
}

/* ── The "+" new-terminal preset menu ───────────────────────────────────────── */

/** Stable preset order (matches the launcher): Hermes → Claude → Codex → shell. */
const PRESET_ORDER: readonly CliId[] = ['hermes', 'claude', 'codex', 'shell']
/** Fallback labels if the detected-CLI list hasn't loaded yet. */
const PRESET_LABEL: Record<CliId, string> = {
  hermes: 'Hermes CLI',
  claude: 'Claude Code',
  codex: 'Codex',
  shell: 'Raw shell',
}

/**
 * The "+" button now opens a small preset menu (reusing the launcher's CLI list)
 * instead of being hardwired to the raw shell — so a second/third terminal can be
 * any installed agent, not just `shell`. HONEST: only installed CLIs are
 * actionable; the raw shell is ALWAYS available (the universal fallback + the
 * default). Closes on Escape, on outside click, and after a choice.
 */
function NewTerminalMenu({
  atCap,
  clis,
  onOpen,
}: {
  atCap: boolean
  clis: DetectedCli[] | undefined
  onOpen: (cli: CliId) => void
}) {
  const [open, setOpen] = useState(false)

  // Whether a preset is actionable: the raw shell ALWAYS is; the rest only when
  // detected as installed (or, before the list loads, optimistically allowed —
  // the server still gates/rejects an unavailable preset before spawning).
  const byId = clis ? new Map(clis.map((c) => [c.id, c])) : null
  const isAvailable = (id: CliId): boolean => {
    if (id === 'shell') return true
    if (!byId) return false
    return byId.get(id)?.available ?? false
  }
  const labelFor = (id: CliId): string => byId?.get(id)?.label ?? PRESET_LABEL[id]

  const choose = (id: CliId) => {
    setOpen(false)
    onOpen(id)
  }

  return (
    // radix Popover + Portal: the menu renders in a portal at the document body, so
    // it ESCAPES the tablist's `overflow-x-auto` clip (overflow on one axis computes
    // to `auto` on BOTH, which hid the old absolute child inside the bar) and stacks
    // above it. radix also owns Escape + outside-click dismissal and focus return.
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 shrink-0 md:size-10"
          disabled={atCap}
          aria-label="New terminal"
          title={atCap ? `Maximum of ${MAX_TERMINALS} terminals reached` : 'New terminal'}
        >
          <Plus className="size-4" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          side="bottom"
          sideOffset={6}
          className="ad-surface z-50 w-52 rounded-lg bg-popover p-1 shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div role="menu" aria-label="New terminal preset" className="flex flex-col gap-0.5">
            {PRESET_ORDER.map((id) => {
              const available = isAvailable(id)
              return (
                <button
                  key={id}
                  type="button"
                  role="menuitem"
                  disabled={!available}
                  onClick={() => choose(id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring md:py-1.5 ${
                    available
                      ? 'text-foreground hover:bg-muted'
                      : 'cursor-not-allowed text-muted-foreground'
                  }`}
                >
                  <CliMark cli={id} />
                  <span className="min-w-0 flex-1 truncate">{labelFor(id)}</span>
                  {!available ? (
                    <span className="shrink-0 text-xs text-muted-foreground">Not installed</span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function ViewModeToggle({ mode, onSetView }: { mode: ViewMode; onSetView: (m: ViewMode) => void }) {
  // A calm two-segment toggle. The selected segment carries the faint amber
  // active treatment (LIVE/selected state); the other is a neutral ghost.
  return (
    <div
      role="group"
      aria-label="Terminal layout"
      className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border p-0.5"
    >
      <SegmentButton
        selected={mode === 'tab'}
        label="Tab view"
        onClick={() => onSetView('tab')}
        icon={<Square className="size-4" />}
      />
      <SegmentButton
        selected={mode === 'grid'}
        label="Grid view"
        onClick={() => onSetView('grid')}
        icon={<Columns2 className="size-4" />}
      />
    </div>
  )
}

function SegmentButton({
  selected,
  label,
  onClick,
  icon,
}: {
  selected: boolean
  label: string
  onClick: () => void
  icon: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      className={`flex h-11 min-w-11 items-center justify-center rounded-md px-2.5 transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring md:h-10 md:min-w-10 ${
        selected
          ? 'bg-primary/10 text-primary'
          : 'text-foreground-tertiary hover:bg-muted hover:text-foreground'
      }`}
    >
      {icon}
    </button>
  )
}

/* ── A single tab (brand mark + status + label + close, double-click to rename) ─ */

function Tab({
  session,
  active,
  status,
  persistent,
  onActivate,
  onClose,
  onRename,
}: {
  session: TerminalSession
  active: boolean
  status: TerminalStatus | undefined
  /** tmux-backed (true) vs volatile (false); undefined until the shell is ready. */
  persistent: boolean | undefined
  onActivate: () => void
  onClose: () => void
  onRename: (title: string) => void
}) {
  const [editing, setEditing] = useState(false)
  // A foreign attach tab never kills the user's session: its close affordance
  // is honestly a DETACH (the session keeps running in their own tmux).
  const foreign = session.attach !== undefined

  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onClick={onActivate}
      onDoubleClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onActivate()
        }
      }}
      // Active tab = the sanctioned faint amber LIVE/active treatment + amber
      // left marker. Inactive tabs are quiet and neutral. Min height is touch-sized
      // on narrow screens while preserving the dense desktop tab strip.
      className={`group/tab relative flex h-11 min-w-0 shrink-0 cursor-pointer items-center gap-2 rounded-lg pr-1 pl-2.5 text-sm transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring md:h-10 md:pr-1.5 ${
        active
          ? 'bg-primary/10 text-foreground'
          : 'text-foreground-tertiary hover:bg-muted hover:text-foreground'
      }`}
    >
      <CliMark cli={session.cli} />
      <StatusPip status={status} />
      {editing ? (
        <RenameInput
          initial={session.title}
          onCommit={(value) => {
            onRename(value)
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <span className="min-w-0 max-w-40 truncate">{session.title}</span>
      )}
      <PersistenceBadge persistent={persistent} foreign={foreign} />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        aria-label={foreign ? `Detach ${session.title}` : `Close ${session.title}`}
        title={foreign ? 'Detach (the session keeps running in your tmux)' : 'Close terminal'}
        className="flex size-11 shrink-0 items-center justify-center rounded-md text-foreground-tertiary opacity-70 transition-colors duration-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring group-hover/tab:opacity-100 md:size-7"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

/**
 * The honest persistence chip: `persistent` for a tmux-backed shell (survives
 * deck restarts and disconnects; a foreign one is the user's own session) vs
 * `volatile` for a plain shell. Hidden until the server's ready frame says which.
 */
function PersistenceBadge({
  persistent,
  foreign,
}: {
  persistent: boolean | undefined
  foreign: boolean
}) {
  if (persistent === undefined) return null
  return (
    <span
      title={
        persistent
          ? foreign
            ? 'Attached to your own tmux session; it keeps running when you detach.'
            : 'Backed by tmux: this shell survives restarts and disconnects, from any device.'
          : 'Not tmux-backed: this shell ends when its connection does.'
      }
      className={`shrink-0 rounded-sm px-1 py-px text-[10px] leading-4 ${
        persistent ? 'bg-success/10 text-success' : 'bg-muted text-foreground-tertiary'
      }`}
    >
      {persistent ? 'persistent' : 'volatile'}
    </span>
  )
}

/** Inline rename field. Commits on Enter/blur, cancels on Escape. */
function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement | null>(null)
  return (
    <input
      ref={ref}
      autoFocus
      defaultValue={initial}
      aria-label="Rename terminal"
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => onCommit(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') onCommit(e.currentTarget.value)
        else if (e.key === 'Escape') onCancel()
      }}
      className="w-32 min-w-0 rounded-sm bg-transparent text-sm text-foreground outline-none ring-1 ring-[var(--border-strong)] focus-visible:ring-2 focus-visible:ring-ring"
    />
  )
}

/** The CLI's BRAND mark (own color, identity) or the neutral shell glyph. */
function CliMark({ cli }: { cli: CliId }) {
  // The shell glyph + the monochrome Codex mark use currentColor → tint them to a
  // theme-safe neutral; the colored brand marks (hermes/claude) ignore it.
  const tint = cli === 'shell' || cli === 'codex' ? ' text-foreground' : ''
  return <CliBrandMark cli={cli} className={`size-4 shrink-0${tint}`} />
}

/** A tiny semantic status dot (re-using the route's status semantics). */
function StatusPip({ status }: { status: TerminalStatus | undefined }) {
  if (!status) return null
  const color =
    status === 'connected'
      ? 'bg-success'
      : status === 'error' || status === 'dropped'
        ? 'bg-destructive'
        : status === 'exited' || status === 'disconnected'
          ? 'bg-foreground-tertiary'
          : 'bg-info'
  return (
    <span
      aria-hidden
      className={`size-1.5 shrink-0 rounded-full ${color} ${status === 'connecting' ? 'motion-safe:animate-pulse' : ''}`}
    />
  )
}

/* ── Tab view: all sessions mounted; only the active one is visible ──────────── */

function TabPanels({
  state,
  View,
  onStatus,
  onPersistent,
  onClearReady,
  onCloseReady,
  onRestart,
}: {
  state: SessionsState
  View: ComponentType<TerminalViewProps>
  onStatus: (id: string, status: TerminalStatus) => void
  onPersistent: (id: string, persistent: boolean) => void
  onClearReady: (id: string, clear: (() => void) | null) => void
  onCloseReady: (id: string, close: (() => void) | null) => void
  onRestart: (id: string) => void
}) {
  return (
    <div className="relative min-h-0 flex-1 p-2">
      {state.sessions.map((session) => {
        const active = session.id === state.activeId
        return (
          <div
            key={session.id}
            role="tabpanel"
            aria-label={session.title}
            // Inactive panels stay MOUNTED (shell keeps running) but hidden.
            hidden={!active}
            className={active ? 'flex h-full min-h-0 flex-col' : 'hidden'}
          >
            <View
              key={sessionKey(session)}
              cli={session.cli}
              // The stable wire id → server park/reattach (refresh-resume). It folds
              // in the epoch so a Restart (epoch bump) becomes a NEW server session
              // (fresh shell), while a plain refresh keeps the same key → reattach.
              sessionId={sessionKey(session)}
              // A foreign tab joins the user's own tmux session instead.
              attach={session.attach}
              // A restored/recovered session expects a reattach; a ready frame
              // without `resumed` then shows the honest fresh-shell notice.
              expectResume={expectsResume(session)}
              onStatusChange={(s) => onStatus(session.id, s)}
              onPersistentChange={(p) => onPersistent(session.id, p)}
              onClearReady={(clear) => onClearReady(session.id, clear)}
              onCloseSessionReady={(close) => onCloseReady(session.id, close)}
              onRestart={() => onRestart(session.id)}
            />
          </div>
        )
      })}
    </div>
  )
}

/* ── Grid view: every session visible at once; focused one is amber-ringed ───── */

/** Responsive column count by terminal count (1/2/3/4-up). */
function gridColsClass(count: number): string {
  if (count <= 1) return 'grid-cols-1'
  if (count === 2) return 'grid-cols-1 sm:grid-cols-2'
  if (count <= 4) return 'grid-cols-1 sm:grid-cols-2'
  if (count <= 9) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
  return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
}

function GridPanels({
  state,
  View,
  statuses,
  persistence,
  onStatus,
  onPersistent,
  onClearReady,
  onCloseReady,
  onActivate,
  onRestart,
}: {
  state: SessionsState
  View: ComponentType<TerminalViewProps>
  statuses: Record<string, TerminalStatus>
  persistence: Record<string, boolean>
  onStatus: (id: string, status: TerminalStatus) => void
  onPersistent: (id: string, persistent: boolean) => void
  onClearReady: (id: string, clear: (() => void) | null) => void
  onCloseReady: (id: string, close: (() => void) | null) => void
  onActivate: (id: string) => void
  onRestart: (id: string) => void
}) {
  return (
    <div
      role="group"
      aria-label="Terminal grid"
      // Rows are minmax(0,1fr) and the container clips: an `auto-rows-fr` grid
      // with `overflow-auto` let each cell's content set the row height, and the
      // fit observer then refit the taller pane in a feedback loop (panes grew
      // forever). Bounding the rows at the grid (like the tab view's
      // `h-full min-h-0`) keeps every pane stable at its share of the surface.
      className={`grid min-h-0 flex-1 auto-rows-[minmax(0,1fr)] gap-2 overflow-hidden p-2 ${gridColsClass(
        state.sessions.length,
      )}`}
    >
      {state.sessions.map((session) => {
        const focused = session.id === state.activeId
        const status = statuses[session.id]
        return (
          <div
            key={session.id}
            role="group"
            aria-label={session.title}
            aria-current={focused ? 'true' : undefined}
            tabIndex={0}
            onClick={() => onActivate(session.id)}
            onFocus={() => onActivate(session.id)}
            // The focused/live cell gets the sanctioned amber active ring; others a
            // neutral hairline. (Persistent identity rings would use border-strong;
            // this ring marks the LIVE/focused terminal, which IS a sanctioned amber use.)
            className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg outline-none transition-shadow duration-100 ${
              focused
                ? 'ring-2 ring-primary'
                : 'ring-1 ring-border hover:ring-[var(--border-strong)] focus-visible:ring-2 focus-visible:ring-ring'
            }`}
          >
            <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5">
              <CliMark cli={session.cli} />
              <span className="min-w-0 flex-1 truncate text-xs text-foreground-tertiary">
                {session.title}
              </span>
              <PersistenceBadge
                persistent={persistence[session.id]}
                foreign={session.attach !== undefined}
              />
              {status ? <TerminalStatusIndicator status={status} /> : null}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onRestart(session.id)
                }}
                aria-label={`Restart ${session.title}`}
                title="Restart this terminal"
                className="flex size-11 items-center justify-center rounded-md text-foreground-tertiary hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring md:size-7"
              >
                <RotateCcw className="size-3.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <View
                key={sessionKey(session)}
                cli={session.cli}
                // Stable wire id (id+epoch): refresh → reattach; Restart → fresh shell.
                sessionId={sessionKey(session)}
                attach={session.attach}
                expectResume={expectsResume(session)}
                onStatusChange={(s) => onStatus(session.id, s)}
                onPersistentChange={(p) => onPersistent(session.id, p)}
                onClearReady={(clear) => onClearReady(session.id, clear)}
                onCloseSessionReady={(close) => onCloseReady(session.id, close)}
                onRestart={() => onRestart(session.id)}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

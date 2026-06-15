import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from 'react'
import { Columns2, LayoutGrid, Plus, RotateCcw, Square, X } from 'lucide-react'
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
import { MAX_TERMINALS, WORKSPACE_LAYOUT_PRESETS, type ViewMode } from './terminalWorkspaces'
import type { TerminalViewProps } from './TerminalView'
import type { CliId } from './useTerminalClis'
import type { TerminalStatus } from './terminalSocket'

/**
 * The SINGLE multi-pane grid for the unified Terminal surface: the one engine
 * rendering BOTH the ephemeral Scratch session and saved workspaces, so the two
 * look and behave identically. It mounts one {@link TerminalView} per pane and
 * offers a TAB view (one pane visible, the rest kept MOUNTED so their shells keep
 * running), a GRID view (several at once, the focused one amber-ringed), and the
 * 1/2/3/4/6 layout PRESETS. Each pane can be added / renamed (double-click its
 * tab) / restarted / removed.
 *
 * This component is CONTROLLED: its caller (the Scratch or saved-workspace
 * controller) owns the normalized {@link GridPane} list + the active id + view
 * mode, and applies the durable mutation behind each action callback. The grid
 * keeps only the EPHEMERAL runtime state every pane reports over its socket:
 * per-pane live status, tmux persistence, the engine `clear` handle, and the
 * `terminal.close` handle. It owns the honest CLOSE/RESTART confirm dialogs for a
 * persistent shell (whose kill must ask first), and surfaces the ACTIVE pane's
 * status/clear/restart up so the surface's single header can drive them.
 *
 * The caller precomputes each pane's `wireId` (the `terminal.start` `sessionId`):
 * Scratch uses {@link ./terminalSessions} `sessionKey`, saved workspaces use
 * {@link ./terminalWorkspaces} `paneSessionId`. The grid keys the {@link TerminalView}
 * by `wireId`, so a restart (which changes the wireId) remounts a fresh shell
 * while a plain re-render reattaches the same one.
 *
 * SPINE: the single amber accent marks the LIVE/focused pane (active tab, grid
 * cell ring) and the primary action; brand marks are IDENTITY (their own colors),
 * never the accent. Touch-first targets are >=44px where controls are dense.
 */

/** A pane's honest connection state, derived from the socket status frames. */
export type PaneStatus = 'connecting' | 'live' | 'exited' | 'error'

/**
 * One pane in the grid, normalized from either backing model. `wireId` is the
 * `terminal.start` `sessionId` the caller derives (folding in the restart epoch),
 * so the grid stays agnostic to which model produced it.
 */
export interface GridPane {
  /** Stable pane id: the React key + the per-pane runtime-state map key. */
  id: string
  /** Human label shown in the tab / grid cell header. */
  label: string
  /** The launcher CLI; absent when the pane attaches a foreign tmux session. */
  cli?: CliId
  /** Working directory the pane launches in (server-validated before use). */
  cwd?: string
  /** A foreign tmux session this pane attaches to; mutually exclusive with cli. */
  attach?: string
  /** The precomputed `terminal.start` sessionId (folds the restart epoch in). */
  wireId: string
  /**
   * The host EXPECTS this pane to REATTACH an existing shell (restored from
   * storage or recovered from the server's tmux list). A ready frame WITHOUT
   * `resumed` then shows the honest fresh-shell notice. Saved-workspace panes
   * leave this unset (they reattach by deterministic id, no false notice).
   */
  expectResume?: boolean
}

export interface PaneGridProps {
  /** The normalized panes, OWNED by the caller. */
  panes: GridPane[]
  /** The focused pane id (null only when there are zero panes). */
  activeId: string | null
  /** The tab/grid view mode. */
  viewMode: ViewMode
  /** Add a pane running `cli` (the caller applies its reducer + persists). */
  onAddPane: (cli: CliId) => void
  /**
   * Remove a pane by id. Called AFTER the grid clears a persistent/foreign shell
   * (the grid owns the kill); the caller just drops it from its model.
   */
  onRemovePane: (id: string) => void
  /** Rename a pane. */
  onRenamePane: (id: string, label: string) => void
  /**
   * Restart a pane in place (the caller bumps its epoch -> a new wireId -> a
   * fresh shell). Called AFTER the grid kills a persistent shell's old session.
   */
  onRestartPane: (id: string) => void
  /** Focus a pane. */
  onActivatePane: (id: string) => void
  /** Switch the tab/grid view mode. */
  onSetViewMode: (mode: ViewMode) => void
  /** Apply a 1/2/3/4/6 layout preset (only when {@link showLayoutPresets}). */
  onApplyLayout?: (count: number) => void
  /** Show the layout-preset menu (saved workspaces). Default false. */
  showLayoutPresets?: boolean
  /**
   * The detected CLIs (same list the launcher uses), so the "+" preset menu only
   * offers what is actually installed. Undefined while loading -> the menu falls
   * back to the always-available raw shell.
   */
  clis?: DetectedCli[]
  /** Inject the terminal view (tests) to bypass the real lazy xterm import. */
  viewComponent: ComponentType<TerminalViewProps>
  /** The accessible label for the tablist (e.g. "Terminals" / "Workspace panes"). */
  tablistLabel?: string
  /** The accessible label for the grid group (e.g. "Terminal grid" / "Pane grid"). */
  gridLabel?: string
  /** The "+" button label/title (e.g. "New terminal" / "Add pane"). */
  addLabel?: string
  /** The accessible label for the "+" preset menu. */
  addMenuLabel?: string
  /** The noun used in the cap note (e.g. "terminals" / "panes"). */
  capNoun?: string
  /**
   * Report the ACTIVE pane's live status up so the surface's single header can
   * show it (and drive Clear/Restart). Null = no pane.
   */
  onActiveStatusChange?: (status: TerminalStatus | null) => void
  /** Report the active pane's engine `clear` handle up (null on teardown). */
  onActiveClearReady?: (clear: (() => void) | null) => void
  /** Report a Restart handle bound to the ACTIVE pane (null = no pane). */
  onActiveRestartReady?: (restart: (() => void) | null) => void
}

export function PaneGrid({
  panes,
  activeId,
  viewMode,
  onAddPane,
  onRemovePane,
  onRenamePane,
  onRestartPane,
  onActivatePane,
  onSetViewMode,
  onApplyLayout,
  showLayoutPresets = false,
  clis,
  viewComponent: View,
  tablistLabel = 'Panes',
  gridLabel = 'Pane grid',
  addLabel = 'Add pane',
  addMenuLabel = 'Add pane preset',
  capNoun = 'panes',
  onActiveStatusChange,
  onActiveClearReady,
  onActiveRestartReady,
}: PaneGridProps) {
  // Per-pane live status, so each tab/cell shows its own honest connection dot.
  const [statuses, setStatuses] = useState<Record<string, TerminalStatus>>({})
  // Per-pane persistence (tmux-backed vs volatile), from terminal.ready. Drives
  // the restart/close-kills-the-old-tmux-session handling below.
  const [persistence, setPersistence] = useState<Record<string, boolean>>({})
  // Per-pane engine `clear` handles, so the header's Clear acts on the ACTIVE one.
  const clearHandles = useRef<Record<string, (() => void) | null>>({})
  // Per-pane explicit end-session handles (terminal.close on the wire), captured
  // from each view so a restart/close can kill a persistent pane's old shell.
  const closeHandles = useRef<Record<string, (() => void) | null>>({})
  // A deck-owned PERSISTENT pane awaiting the close confirm (dialog open).
  const [pendingClose, setPendingClose] = useState<string | null>(null)
  // A deck-owned PERSISTENT pane awaiting the restart confirm (dialog open).
  const [pendingRestart, setPendingRestart] = useState<string | null>(null)

  const setStatus = useCallback((id: string, status: TerminalStatus) => {
    setStatuses((prev) => (prev[id] === status ? prev : { ...prev, [id]: status }))
  }, [])
  const setPersistent = useCallback((id: string, persistent: boolean) => {
    setPersistence((prev) => (prev[id] === persistent ? prev : { ...prev, [id]: persistent }))
  }, [])
  const setClearHandle = useCallback((id: string, clear: (() => void) | null) => {
    // A null report is the view's teardown: drop the entry instead of keeping a
    // null forever for a pane whose shell may be gone.
    if (clear) clearHandles.current[id] = clear
    else delete clearHandles.current[id]
  }, [])
  const setCloseHandle = useCallback((id: string, close: (() => void) | null) => {
    if (close) closeHandles.current[id] = close
    else delete closeHandles.current[id]
  }, [])

  // Forget a REMOVED pane's per-pane runtime records (status, persistence,
  // handles) so stale entries don't accumulate across many open/close cycles.
  const forgetPane = useCallback((id: string) => {
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

  // Closing a pane is HONEST about what it ends:
  //  - a FOREIGN attach pane DETACHES (terminal.close on the wire detaches; the
  //    user's session keeps running in their own tmux),
  //  - a deck-owned PERSISTENT shell asks first (its whole point is surviving
  //    disconnects; an explicit close kills it in the tmux server for real),
  //  - a shell whose persistence is still UNKNOWN (no ready frame yet) also asks
  //    first: silently treating it as volatile would skip terminal.close and
  //    orphan an adk_ tmux session the user thought they closed,
  //  - a known-VOLATILE shell closes as before (the socket teardown ends it).
  const requestRemove = (id: string) => {
    const pane = panes.find((p) => p.id === id)
    if (!pane) return
    if (pane.attach !== undefined) {
      closeHandles.current[id]?.()
      onRemovePane(id)
      forgetPane(id)
      return
    }
    if (persistence[id] !== false) {
      setPendingClose(id)
      return
    }
    onRemovePane(id)
    forgetPane(id)
  }
  const confirmClose = () => {
    if (!pendingClose) return
    closeHandles.current[pendingClose]?.()
    onRemovePane(pendingClose)
    forgetPane(pendingClose)
    setPendingClose(null)
  }

  // Restarting is honest about the shell it replaces. Bumping the epoch alone
  // would leave a deck-owned PERSISTENT (tmux-backed) shell alive under its old
  // adk_ name (recoverable cruft the user thought was replaced), so a pane
  // currently known persistent ASKS FIRST (a restart ends it for real, like
  // Close), then gets a real kill (terminal.close) before the epoch bump remounts
  // a fresh shell under the new wireId. Volatile shells (their socket teardown
  // ends them) and foreign attach panes (the deck never kills a user's own
  // session) keep the plain, confirm-free epoch bump.
  const requestRestart = (id: string) => {
    const pane = panes.find((p) => p.id === id)
    if (!pane) return
    if (pane.attach === undefined && persistence[id] === true) {
      setPendingRestart(id)
      return
    }
    onRestartPane(id)
  }
  const confirmRestart = () => {
    if (!pendingRestart) return
    closeHandles.current[pendingRestart]?.()
    onRestartPane(pendingRestart)
    setPendingRestart(null)
  }
  // The header's Restart handle is bound in an [activeId]-only effect below, so it
  // reads the LATEST panes/persistence through this ref.
  const requestRestartRef = useRef(requestRestart)
  useEffect(() => {
    requestRestartRef.current = requestRestart
  })

  // Surface the ACTIVE pane's status/clear/restart up to the surface header. Kept
  // in refs+effect so the callbacks (fresh closures from the surface) never need
  // to re-run the effect. Clear/restart bind to whatever is active right now.
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

  const atCap = panes.length >= MAX_TERMINALS

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PaneBar
        panes={panes}
        activeId={activeId}
        viewMode={viewMode}
        atCap={atCap}
        statuses={statuses}
        persistence={persistence}
        clis={clis}
        showLayoutPresets={showLayoutPresets}
        tablistLabel={tablistLabel}
        addLabel={addLabel}
        addMenuLabel={addMenuLabel}
        onAdd={onAddPane}
        onActivate={onActivatePane}
        onRemove={requestRemove}
        onRename={onRenamePane}
        onSetView={onSetViewMode}
        onLayout={onApplyLayout}
      />
      {atCap ? (
        <p
          role="status"
          className="border-b border-border bg-surface-1 px-4 py-1.5 text-xs text-foreground-tertiary"
        >
          You have all {MAX_TERMINALS} {capNoun} open (the maximum). Close one to open another.
        </p>
      ) : null}

      {panes.length === 0 ? (
        <EmptyPanes
          atCap={atCap}
          clis={clis}
          addLabel={addLabel}
          addMenuLabel={addMenuLabel}
          onAdd={onAddPane}
        />
      ) : viewMode === 'tab' ? (
        <TabPanels
          panes={panes}
          activeId={activeId}
          View={View}
          onStatus={setStatus}
          onPersistent={setPersistent}
          onClearReady={setClearHandle}
          onCloseReady={setCloseHandle}
          onRestart={requestRestart}
        />
      ) : (
        <GridPanels
          panes={panes}
          activeId={activeId}
          gridLabel={gridLabel}
          View={View}
          statuses={statuses}
          persistence={persistence}
          onStatus={setStatus}
          onPersistent={setPersistent}
          onClearReady={setClearHandle}
          onCloseReady={setCloseHandle}
          onActivate={onActivatePane}
          onRestart={requestRestart}
        />
      )}

      <ClosePersistentDialog
        label={panes.find((p) => p.id === pendingClose)?.label ?? null}
        persistenceKnown={pendingClose !== null && persistence[pendingClose] !== undefined}
        open={pendingClose !== null}
        onConfirm={confirmClose}
        onCancel={() => setPendingClose(null)}
      />

      <RestartPersistentDialog
        label={panes.find((p) => p.id === pendingRestart)?.label ?? null}
        open={pendingRestart !== null}
        onConfirm={confirmRestart}
        onCancel={() => setPendingRestart(null)}
      />
    </div>
  )
}

/**
 * The restart confirm for a deck-owned PERSISTENT shell: a restart KILLS the
 * current shell in the tmux server (Close's twin, see {@link requestRestart}) and
 * starts a fresh one, so it deserves the same honest question Close asks. Cancel
 * is the default-focused action.
 */
function RestartPersistentDialog({
  label,
  open,
  onConfirm,
  onCancel,
}: {
  label: string | null
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
            This restarts the persistent shell{label ? <> &ldquo;{label}&rdquo;</> : null}: the
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
 * surviving disconnects, so an explicit close (which kills it in the tmux server)
 * deserves one honest question. Also shown while persistence is still UNKNOWN (no
 * ready frame yet): the shell may be persistent, and confirming sends a real
 * terminal.close so no tmux session is silently orphaned. Cancel is the
 * default-focused action.
 */
function ClosePersistentDialog({
  label,
  persistenceKnown,
  open,
  onConfirm,
  onCancel,
}: {
  label: string | null
  /** False while the pane has not reported persistent/volatile yet. */
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
                This ends the persistent shell{label ? <> &ldquo;{label}&rdquo;</> : null}. Anything
                still running in it stops, and it will no longer be there to reattach from another
                device.
              </>
            ) : (
              <>
                This shell{label ? <> &ldquo;{label}&rdquo;</> : null} has not connected yet, so it
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

/* -- The pane strip + layout presets + view-mode toggle -------------------- */

function PaneBar({
  panes,
  activeId,
  viewMode,
  atCap,
  statuses,
  persistence,
  clis,
  showLayoutPresets,
  tablistLabel,
  addLabel,
  addMenuLabel,
  onAdd,
  onActivate,
  onRemove,
  onRename,
  onSetView,
  onLayout,
}: {
  panes: GridPane[]
  activeId: string | null
  viewMode: ViewMode
  atCap: boolean
  statuses: Record<string, TerminalStatus>
  persistence: Record<string, boolean>
  clis: DetectedCli[] | undefined
  showLayoutPresets: boolean
  tablistLabel: string
  addLabel: string
  addMenuLabel: string
  onAdd: (cli: CliId) => void
  onActivate: (id: string) => void
  onRemove: (id: string) => void
  onRename: (id: string, label: string) => void
  onSetView: (mode: ViewMode) => void
  onLayout: ((count: number) => void) | undefined
}) {
  // Roving arrow-key nav across the tabs (a real tablist).
  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const ids = panes.map((p) => p.id)
    const i = ids.indexOf(activeId ?? '')
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
        aria-label={tablistLabel}
        aria-orientation="horizontal"
        onKeyDown={onTabKeyDown}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      >
        {panes.map((pane) => (
          <Tab
            key={pane.id}
            pane={pane}
            active={pane.id === activeId}
            status={statuses[pane.id]}
            persistent={persistence[pane.id]}
            onActivate={() => onActivate(pane.id)}
            onRemove={() => onRemove(pane.id)}
            onRename={(label) => onRename(pane.id, label)}
          />
        ))}
        <AddPaneMenu
          atCap={atCap}
          clis={clis}
          addLabel={addLabel}
          addMenuLabel={addMenuLabel}
          onAdd={onAdd}
        />
      </div>

      {showLayoutPresets && onLayout ? <LayoutPresetMenu onLayout={onLayout} /> : null}
      <ViewModeToggle mode={viewMode} onSetView={onSetView} />
    </div>
  )
}

/* -- The "+" add-pane preset menu ------------------------------------------ */

/** Stable preset order (matches the launcher): Hermes -> Claude -> Codex -> shell. */
const PRESET_ORDER: readonly CliId[] = ['hermes', 'claude', 'codex', 'shell']
/** Fallback labels if the detected-CLI list hasn't loaded yet. */
const PRESET_LABEL: Record<CliId, string> = {
  hermes: 'Hermes CLI',
  claude: 'Claude Code',
  codex: 'Codex',
  shell: 'Raw shell',
}

/**
 * The "+" opens a small preset menu (reusing the launcher's CLI list), so a new
 * pane can be any installed agent, not just `shell`. HONEST: only installed CLIs
 * are actionable; the raw shell is ALWAYS available (the universal fallback + the
 * default). Closes on Escape, on outside click, and after a choice.
 */
function AddPaneMenu({
  atCap,
  clis,
  addLabel,
  addMenuLabel,
  onAdd,
}: {
  atCap: boolean
  clis: DetectedCli[] | undefined
  addLabel: string
  addMenuLabel: string
  onAdd: (cli: CliId) => void
}) {
  const [open, setOpen] = useState(false)
  const byId = clis ? new Map(clis.map((c) => [c.id, c])) : null
  const isAvailable = (id: CliId): boolean => {
    if (id === 'shell') return true
    if (!byId) return false
    return byId.get(id)?.available ?? false
  }
  const labelFor = (id: CliId): string => byId?.get(id)?.label ?? PRESET_LABEL[id]
  const choose = (id: CliId) => {
    setOpen(false)
    onAdd(id)
  }

  return (
    // radix Popover + Portal: the menu renders in a portal so it ESCAPES the
    // tablist's overflow-x clip and stacks above it; radix owns Escape +
    // outside-click dismissal and focus return.
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 shrink-0 md:size-10"
          disabled={atCap}
          aria-label={addLabel}
          title={atCap ? `Maximum of ${MAX_TERMINALS} reached` : addLabel}
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
          <div role="menu" aria-label={addMenuLabel} className="flex flex-col gap-0.5">
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

/**
 * The layout-preset menu: resize the grid to exactly 1/2/3/4/6 panes (the
 * caller's reducer grows with neutral `shell` panes up to {@link MAX_TERMINALS},
 * shrinks by keeping the first N, and switches to grid view so the new cells are
 * visible).
 */
function LayoutPresetMenu({ onLayout }: { onLayout: (count: number) => void }) {
  const [open, setOpen] = useState(false)
  const choose = (count: number) => {
    setOpen(false)
    onLayout(count)
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 shrink-0 md:size-10"
          aria-label="Layout"
          title="Arrange panes into a layout"
        >
          <LayoutGrid className="size-4" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          side="bottom"
          sideOffset={6}
          className="ad-surface z-50 w-44 rounded-lg bg-popover p-1 shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div role="menu" aria-label="Layout presets" className="flex flex-col gap-0.5">
            {WORKSPACE_LAYOUT_PRESETS.map((count) => (
              <button
                key={count}
                type="button"
                role="menuitem"
                onClick={() => choose(count)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground transition-colors duration-100 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring md:py-1.5"
              >
                <span className="min-w-0 flex-1 truncate">
                  {count} {count === 1 ? 'pane' : 'panes'}
                </span>
              </button>
            ))}
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
      aria-label="Pane layout"
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

/* -- A single tab (brand mark + status + label + remove, dbl-click to rename) - */

function Tab({
  pane,
  active,
  status,
  persistent,
  onActivate,
  onRemove,
  onRename,
}: {
  pane: GridPane
  active: boolean
  status: TerminalStatus | undefined
  /** tmux-backed (true) vs volatile (false); undefined until the shell is ready. */
  persistent: boolean | undefined
  onActivate: () => void
  onRemove: () => void
  onRename: (label: string) => void
}) {
  const [editing, setEditing] = useState(false)
  // A foreign attach pane never kills the user's session: its close affordance is
  // honestly a DETACH (the session keeps running in their own tmux).
  const foreign = pane.attach !== undefined

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
      // Active tab = the sanctioned faint amber LIVE/active treatment. Inactive
      // tabs are quiet and neutral. Min height is touch-sized on narrow screens.
      className={`group/tab relative flex h-11 min-w-0 shrink-0 cursor-pointer items-center gap-2 rounded-lg pr-1 pl-2.5 text-sm transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring md:h-10 md:pr-1.5 ${
        active
          ? 'bg-primary/10 text-foreground'
          : 'text-foreground-tertiary hover:bg-muted hover:text-foreground'
      }`}
    >
      <CliMark cli={pane.cli} />
      <StatusPip status={status} />
      {editing ? (
        <RenameInput
          initial={pane.label}
          onCommit={(value) => {
            onRename(value)
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <span className="min-w-0 max-w-40 truncate">{pane.label}</span>
      )}
      <PersistenceBadge persistent={persistent} foreign={foreign} />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        aria-label={foreign ? `Detach ${pane.label}` : `Close ${pane.label}`}
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

/** Inline rename field. Commits on Enter/blur, cancels on Escape. The 16px font
 * on mobile (md:text-sm restores the dense desktop size) stops iOS zooming in on
 * focus. */
function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  return (
    <input
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
      className="w-32 min-w-0 rounded-sm bg-transparent text-base text-foreground outline-none ring-1 ring-[var(--border-strong)] focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
    />
  )
}

/** The CLI's BRAND mark (own color, identity) or the neutral shell glyph. A pane
 * that attaches a foreign tmux session has no cli -> the neutral shell glyph. */
function CliMark({ cli }: { cli: CliId | undefined }) {
  const id: CliId = cli ?? 'shell'
  // The shell glyph + the monochrome Codex mark use currentColor -> tint them to a
  // theme-safe neutral; the colored brand marks (hermes/claude) ignore it.
  const tint = id === 'shell' || id === 'codex' ? ' text-foreground' : ''
  return <CliBrandMark cli={id} className={`size-4 shrink-0${tint}`} />
}

/** A tiny semantic status dot driven by the socket status. */
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

/* -- The empty state: a surface with zero panes ---------------------------- */

function EmptyPanes({
  atCap,
  clis,
  addLabel,
  addMenuLabel,
  onAdd,
}: {
  atCap: boolean
  clis: DetectedCli[] | undefined
  addLabel: string
  addMenuLabel: string
  onAdd: (cli: CliId) => void
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="ad-surface max-w-sm rounded-xl bg-card p-6 text-center">
        <p className="text-sm font-medium text-foreground">No panes yet</p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Add a pane to open a shell here. Each pane runs its own CLI in its own directory.
        </p>
        <div className="mt-4 flex justify-center">
          <AddPaneMenu
            atCap={atCap}
            clis={clis}
            addLabel={addLabel}
            addMenuLabel={addMenuLabel}
            onAdd={onAdd}
          />
        </div>
      </div>
    </div>
  )
}

/* -- Tab view: all panes mounted; only the active one is visible ----------- */

function TabPanels({
  panes,
  activeId,
  View,
  onStatus,
  onPersistent,
  onClearReady,
  onCloseReady,
  onRestart,
}: {
  panes: GridPane[]
  activeId: string | null
  View: ComponentType<TerminalViewProps>
  onStatus: (id: string, status: TerminalStatus) => void
  onPersistent: (id: string, persistent: boolean) => void
  onClearReady: (id: string, clear: (() => void) | null) => void
  onCloseReady: (id: string, close: (() => void) | null) => void
  onRestart: (id: string) => void
}) {
  return (
    <div className="relative min-h-0 flex-1 p-2">
      {panes.map((pane) => {
        const active = pane.id === activeId
        return (
          <div
            key={pane.id}
            role="tabpanel"
            aria-label={pane.label}
            // Inactive panels stay MOUNTED (shell keeps running) but hidden.
            hidden={!active}
            className={active ? 'flex h-full min-h-0 flex-col' : 'hidden'}
          >
            <View
              // Remount on a Restart (the wireId changed -> a fresh shell); a plain
              // re-render keeps the same key -> reattach.
              key={pane.wireId}
              cli={pane.cli}
              cwd={pane.cwd}
              sessionId={pane.wireId}
              attach={pane.attach}
              expectResume={pane.expectResume}
              onStatusChange={(s) => onStatus(pane.id, s)}
              onPersistentChange={(p) => onPersistent(pane.id, p)}
              onClearReady={(clear) => onClearReady(pane.id, clear)}
              onCloseSessionReady={(close) => onCloseReady(pane.id, close)}
              onRestart={() => onRestart(pane.id)}
            />
          </div>
        )
      })}
    </div>
  )
}

/* -- Grid view: every pane visible at once; focused one is amber-ringed ----- */

/** Responsive column count by pane count (1/2/3/4-up). */
function gridColsClass(count: number): string {
  if (count <= 1) return 'grid-cols-1'
  if (count === 2) return 'grid-cols-1 sm:grid-cols-2'
  if (count <= 4) return 'grid-cols-1 sm:grid-cols-2'
  if (count <= 9) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
  return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
}

function GridPanels({
  panes,
  activeId,
  gridLabel,
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
  panes: GridPane[]
  activeId: string | null
  gridLabel: string
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
      aria-label={gridLabel}
      // Rows are minmax(0,1fr) and the container clips, so each cell stays stable
      // at its share of the surface (no content-driven growth feedback loop).
      className={`grid min-h-0 flex-1 auto-rows-[minmax(0,1fr)] gap-2 overflow-hidden p-2 ${gridColsClass(
        panes.length,
      )}`}
    >
      {panes.map((pane) => {
        const focused = pane.id === activeId
        const status = statuses[pane.id]
        return (
          <div
            key={pane.id}
            role="group"
            aria-label={pane.label}
            aria-current={focused ? 'true' : undefined}
            tabIndex={0}
            onClick={() => onActivate(pane.id)}
            onFocus={() => onActivate(pane.id)}
            // The focused/live cell gets the sanctioned amber active ring; others a
            // neutral hairline.
            className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg outline-none transition-shadow duration-100 ${
              focused
                ? 'ring-2 ring-primary'
                : 'ring-1 ring-border hover:ring-[var(--border-strong)] focus-visible:ring-2 focus-visible:ring-ring'
            }`}
          >
            <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5">
              <CliMark cli={pane.cli} />
              <span className="min-w-0 flex-1 truncate text-xs text-foreground-tertiary">
                {pane.label}
              </span>
              <PersistenceBadge
                persistent={persistence[pane.id]}
                foreign={pane.attach !== undefined}
              />
              {status ? <TerminalStatusIndicator status={status} /> : null}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onRestart(pane.id)
                }}
                aria-label={`Restart ${pane.label}`}
                title="Restart this terminal"
                className="flex size-11 items-center justify-center rounded-md text-foreground-tertiary hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring md:size-7"
              >
                <RotateCcw className="size-3.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <View
                key={pane.wireId}
                cli={pane.cli}
                cwd={pane.cwd}
                sessionId={pane.wireId}
                attach={pane.attach}
                expectResume={pane.expectResume}
                onStatusChange={(s) => onStatus(pane.id, s)}
                onPersistentChange={(p) => onPersistent(pane.id, p)}
                onClearReady={(clear) => onClearReady(pane.id, clear)}
                onCloseSessionReady={(close) => onCloseReady(pane.id, close)}
                onRestart={() => onRestart(pane.id)}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

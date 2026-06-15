import { useCallback, useRef, useState, type ComponentType, type KeyboardEvent } from 'react'
import { Columns2, LayoutGrid, Plus, RotateCcw, Square, X } from 'lucide-react'
import { Popover } from 'radix-ui'
import { Button } from '@/components/ui/button'
import { CliBrandMark } from './cliBrandIcons'
import type { DetectedCli } from './useTerminalClis'
import {
  MAX_TERMINALS,
  WORKSPACE_LAYOUT_PRESETS,
  isAtCap,
  paneSessionId,
  type ViewMode,
  type WorkspacePane,
  type WorkspaceState,
} from './terminalWorkspaces'
import type { TerminalViewProps } from './TerminalView'
import type { CliId } from './useTerminalClis'
import type { TerminalStatus } from './terminalSocket'

/**
 * The MULTI-PANE body of a WORKSPACE, the workspace twin of
 * {@link ./TerminalMultiView}. It mounts one {@link TerminalView} per pane (with a
 * stable `key={pane.id}`) and offers a TAB view (one pane visible, the rest kept
 * MOUNTED so their shells keep running) and a GRID view (several at once, the
 * focused one amber-ringed), plus 1/2/3/4/6 layout PRESETS. The "+" adds a pane,
 * each pane can be renamed (double-click its tab) / restarted / removed.
 *
 * This component is CONTROLLED: the route owns the {@link WorkspaceState} (it came
 * from the server-persisted definition + the localStorage view cache) and the
 * pure reducers in {@link ./terminalWorkspaces}; the view renders that state and
 * calls back the action props so the route can apply the reducer, PATCH the
 * durable definition, and refresh its cache. The view keeps only EPHEMERAL UI
 * state (per-pane live status, which tab is being renamed).
 *
 * Each pane mounts with its `cli`, its `cwd`, and the deterministic `sessionId`
 * (`ws_<workspaceId>_<paneId>` (+epoch)) on `terminal.start`, so opening the same
 * workspace on any device REATTACHES the same parked / tmux-backed shells in the
 * directory the pane was given. A pane's `cwd` is persisted in the workspace
 * definition and re-validated server-side against the allowlist roots; this view
 * forwards it to {@link ./TerminalView} via the `cwd` prop.
 *
 * SPINE: the single amber accent marks the LIVE/focused pane (active tab, grid
 * cell ring) and the primary action; brand marks are IDENTITY (their own colors),
 * never the accent. Touch-first targets are >=44px where controls are dense.
 */

/** A pane's honest connection state, derived from the socket status frames. */
export type PaneStatus = 'connecting' | 'live' | 'exited' | 'error'

/**
 * Fold the socket's {@link TerminalStatus} into the four honest pane states.
 * `connected` is LIVE; `exited`/`disconnected` are EXITED (the shell is gone /
 * the link is down); `error`/`dropped` are ERROR; anything transient is
 * CONNECTING. We deliberately do NOT infer "busy"/"needs input" (that is the
 * deferred push feature, and claiming it from byte traffic would be dishonest).
 */
function paneStatusFor(status: TerminalStatus | undefined): PaneStatus {
  switch (status) {
    case 'connected':
      return 'live'
    case 'exited':
    case 'disconnected':
      return 'exited'
    case 'error':
    case 'dropped':
      return 'error'
    default:
      return 'connecting'
  }
}

export interface WorkspaceMultiViewProps {
  /** The workspace view state (panes + active + view), OWNED by the route. */
  state: WorkspaceState
  /** Add a pane running `cli` (the route applies {@link addPane} + persists). */
  onAddPane: (cli: CliId) => void
  /** Remove a pane by id. */
  onRemovePane: (id: string) => void
  /** Rename a pane. */
  onRenamePane: (id: string, label: string) => void
  /** Restart a pane in place (the route bumps its epoch -> a fresh shell). */
  onRestartPane: (id: string) => void
  /** Focus a pane. */
  onActivatePane: (id: string) => void
  /** Switch the tab/grid view mode. */
  onSetViewMode: (mode: ViewMode) => void
  /** Apply a 1/2/3/4/6 layout preset. */
  onApplyLayout: (count: number) => void
  /**
   * The detected CLIs (same list the launcher uses), so the "+" preset menu only
   * offers what is actually installed. Undefined while loading -> the menu falls
   * back to the always-available raw shell.
   */
  clis?: DetectedCli[]
  /** Inject the terminal view (tests) to bypass the real lazy xterm import. */
  viewComponent: ComponentType<TerminalViewProps>
}

export function WorkspaceMultiView({
  state,
  onAddPane,
  onRemovePane,
  onRenamePane,
  onRestartPane,
  onActivatePane,
  onSetViewMode,
  onApplyLayout,
  clis,
  viewComponent: View,
}: WorkspaceMultiViewProps) {
  // Per-pane live status, so each tab/cell shows its own honest connection dot.
  const [statuses, setStatuses] = useState<Record<string, TerminalStatus>>({})
  // Per-pane persistence (tmux-backed vs volatile), from terminal.ready. Drives
  // the restart-kills-the-old-tmux-session handling below.
  const [persistence, setPersistence] = useState<Record<string, boolean>>({})
  // Per-pane explicit end-session handles (terminal.close on the wire), captured
  // from each view so a restart can kill a persistent pane's old shell first.
  const closeHandles = useRef<Record<string, (() => void) | null>>({})

  const setStatus = useCallback((id: string, status: TerminalStatus) => {
    setStatuses((prev) => (prev[id] === status ? prev : { ...prev, [id]: status }))
  }, [])
  const setPersistent = useCallback((id: string, persistent: boolean) => {
    setPersistence((prev) => (prev[id] === persistent ? prev : { ...prev, [id]: persistent }))
  }, [])
  const setCloseHandle = useCallback((id: string, close: (() => void) | null) => {
    // A null report is the view's teardown: drop the entry instead of keeping a
    // null forever for a pane whose shell may be gone.
    if (close) closeHandles.current[id] = close
    else delete closeHandles.current[id]
  }, [])

  // Forget a REMOVED pane's per-pane records (status, persistence, close handle)
  // so stale entries don't accumulate, then delegate the actual removal to the
  // route.
  const removePane = useCallback(
    (id: string) => {
      setStatuses((prev) => {
        if (!(id in prev)) return prev
        const { [id]: _dropped, ...rest } = prev
        return rest
      })
      setPersistence((prev) => {
        if (!(id in prev)) return prev
        const { [id]: _dropped, ...rest } = prev
        return rest
      })
      delete closeHandles.current[id]
      onRemovePane(id)
    },
    [onRemovePane],
  )

  // Restarting bumps the pane's epoch -> a NEW deterministic sessionId -> a fresh
  // adk_ tmux session. A bare epoch bump would leave a deck-owned PERSISTENT
  // (tmux-backed) shell alive under its OLD adk_ name, recoverable cruft the user
  // thought was replaced (see terminalSessions.ts sessionKey). So a pane currently
  // known persistent gets a real kill (terminal.close) of the old shell BEFORE the
  // epoch-bumping restart, mirroring TerminalMultiView. Volatile panes (their
  // socket teardown ends them) and foreign attach panes (the deck never kills a
  // user's own session) keep the plain epoch bump.
  const restartPane = useCallback(
    (id: string) => {
      const pane = state.panes.find((p) => p.id === id)
      if (pane && !pane.attach && persistence[id] === true) {
        closeHandles.current[id]?.()
      }
      onRestartPane(id)
    },
    [state.panes, persistence, onRestartPane],
  )

  const atCap = isAtCap(state)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PaneBar
        state={state}
        atCap={atCap}
        statuses={statuses}
        clis={clis}
        onAdd={onAddPane}
        onActivate={onActivatePane}
        onRemove={removePane}
        onRename={onRenamePane}
        onSetView={onSetViewMode}
        onLayout={onApplyLayout}
      />
      {atCap ? (
        <p
          role="status"
          className="border-b border-border bg-surface-1 px-4 py-1.5 text-xs text-foreground-tertiary"
        >
          You have all {MAX_TERMINALS} panes open (the maximum). Remove one to add another.
        </p>
      ) : null}

      {state.panes.length === 0 ? (
        <EmptyPanes atCap={atCap} clis={clis} onAdd={onAddPane} />
      ) : state.viewMode === 'tab' ? (
        <TabPanels
          state={state}
          workspaceId={state.id}
          View={View}
          onStatus={setStatus}
          onPersistent={setPersistent}
          onCloseReady={setCloseHandle}
          onRestart={restartPane}
        />
      ) : (
        <GridPanels
          state={state}
          workspaceId={state.id}
          View={View}
          statuses={statuses}
          onStatus={setStatus}
          onPersistent={setPersistent}
          onCloseReady={setCloseHandle}
          onActivate={onActivatePane}
          onRestart={restartPane}
        />
      )}
    </div>
  )
}

/* -- The pane strip + layout presets + view-mode toggle -------------------- */

function PaneBar({
  state,
  atCap,
  statuses,
  clis,
  onAdd,
  onActivate,
  onRemove,
  onRename,
  onSetView,
  onLayout,
}: {
  state: WorkspaceState
  atCap: boolean
  statuses: Record<string, TerminalStatus>
  clis: DetectedCli[] | undefined
  onAdd: (cli: CliId) => void
  onActivate: (id: string) => void
  onRemove: (id: string) => void
  onRename: (id: string, label: string) => void
  onSetView: (mode: ViewMode) => void
  onLayout: (count: number) => void
}) {
  // Roving arrow-key nav across the tabs (a real tablist).
  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const ids = state.panes.map((p) => p.id)
    const i = ids.indexOf(state.activePane ?? '')
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
        aria-label="Workspace panes"
        aria-orientation="horizontal"
        onKeyDown={onTabKeyDown}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      >
        {state.panes.map((pane) => (
          <Tab
            key={pane.id}
            pane={pane}
            active={pane.id === state.activePane}
            status={statuses[pane.id]}
            onActivate={() => onActivate(pane.id)}
            onRemove={() => onRemove(pane.id)}
            onRename={(label) => onRename(pane.id, label)}
          />
        ))}
        <AddPaneMenu atCap={atCap} clis={clis} onAdd={onAdd} />
      </div>

      <LayoutPresetMenu onLayout={onLayout} />
      <ViewModeToggle mode={state.viewMode} onSetView={onSetView} />
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
  onAdd,
}: {
  atCap: boolean
  clis: DetectedCli[] | undefined
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
          aria-label="Add pane"
          title={atCap ? `Maximum of ${MAX_TERMINALS} panes reached` : 'Add pane'}
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
          <div role="menu" aria-label="Add pane preset" className="flex flex-col gap-0.5">
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
 * The layout-preset menu: resize the grid to exactly 1/2/3/4/6 panes (the route's
 * {@link applyLayoutPreset} grows with neutral `shell` panes up to the
 * {@link MAX_TERMINALS} cap, shrinks by keeping the first N, and switches to grid
 * view so the new cells are visible).
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
  onActivate,
  onRemove,
  onRename,
}: {
  pane: WorkspacePane
  active: boolean
  status: TerminalStatus | undefined
  onActivate: () => void
  onRemove: () => void
  onRename: (label: string) => void
}) {
  const [editing, setEditing] = useState(false)

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
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        aria-label={`Remove ${pane.label}`}
        title="Remove pane"
        className="flex size-11 shrink-0 items-center justify-center rounded-md text-foreground-tertiary opacity-70 transition-colors duration-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring group-hover/tab:opacity-100 md:size-7"
      >
        <X className="size-3.5" />
      </button>
    </div>
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
      aria-label="Rename pane"
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

/** A tiny semantic status dot driven by the four honest pane states. */
function StatusPip({ status }: { status: TerminalStatus | undefined }) {
  if (!status) return null
  const pane = paneStatusFor(status)
  const color =
    pane === 'live'
      ? 'bg-success'
      : pane === 'error'
        ? 'bg-destructive'
        : pane === 'exited'
          ? 'bg-foreground-tertiary'
          : 'bg-info'
  return (
    <span
      aria-hidden
      className={`size-1.5 shrink-0 rounded-full ${color} ${pane === 'connecting' ? 'motion-safe:animate-pulse' : ''}`}
    />
  )
}

/** The bigger semantic dot + label for a grid cell header. */
function PaneStatusIndicator({ status }: { status: TerminalStatus }) {
  const pane = paneStatusFor(status)
  const color =
    pane === 'live'
      ? 'bg-success'
      : pane === 'error'
        ? 'bg-destructive'
        : pane === 'exited'
          ? 'bg-foreground-tertiary'
          : 'bg-info'
  const label =
    pane === 'live'
      ? 'Live'
      : pane === 'error'
        ? 'Unavailable'
        : pane === 'exited'
          ? 'Ended'
          : 'Connecting'
  return (
    <span role="status" className="flex items-center gap-1.5 text-xs text-foreground-tertiary">
      <span
        aria-hidden
        className={`size-2 rounded-full ${color} ${pane === 'connecting' ? 'motion-safe:animate-pulse' : ''}`}
      />
      {label}
    </span>
  )
}

/* -- The empty state: a workspace with zero panes -------------------------- */

function EmptyPanes({
  atCap,
  clis,
  onAdd,
}: {
  atCap: boolean
  clis: DetectedCli[] | undefined
  onAdd: (cli: CliId) => void
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="ad-surface max-w-sm rounded-xl bg-card p-6 text-center">
        <p className="text-sm font-medium text-foreground">No panes yet</p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Add a pane to open a shell in this workspace. Each pane runs its own CLI in its own
          directory.
        </p>
        <div className="mt-4 flex justify-center">
          <AddPaneMenu atCap={atCap} clis={clis} onAdd={onAdd} />
        </div>
      </div>
    </div>
  )
}

/* -- Tab view: all panes mounted; only the active one is visible ----------- */

function TabPanels({
  state,
  workspaceId,
  View,
  onStatus,
  onPersistent,
  onCloseReady,
  onRestart,
}: {
  state: WorkspaceState
  workspaceId: string
  View: ComponentType<TerminalViewProps>
  onStatus: (id: string, status: TerminalStatus) => void
  onPersistent: (id: string, persistent: boolean) => void
  onCloseReady: (id: string, close: (() => void) | null) => void
  onRestart: (id: string) => void
}) {
  return (
    <div className="relative min-h-0 flex-1 p-2">
      {state.panes.map((pane) => {
        const active = pane.id === state.activePane
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
              // Remount on a Restart (epoch bump -> a new deterministic sessionId
              // -> a fresh shell); a plain re-render keeps the same key -> reattach.
              key={paneSessionId(workspaceId, pane.id, pane.epoch)}
              cli={pane.cli}
              cwd={pane.cwd}
              sessionId={paneSessionId(workspaceId, pane.id, pane.epoch)}
              attach={pane.attach}
              onStatusChange={(s) => onStatus(pane.id, s)}
              onPersistentChange={(p) => onPersistent(pane.id, p)}
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
  state,
  workspaceId,
  View,
  statuses,
  onStatus,
  onPersistent,
  onCloseReady,
  onActivate,
  onRestart,
}: {
  state: WorkspaceState
  workspaceId: string
  View: ComponentType<TerminalViewProps>
  statuses: Record<string, TerminalStatus>
  onStatus: (id: string, status: TerminalStatus) => void
  onPersistent: (id: string, persistent: boolean) => void
  onCloseReady: (id: string, close: (() => void) | null) => void
  onActivate: (id: string) => void
  onRestart: (id: string) => void
}) {
  return (
    <div
      role="group"
      aria-label="Pane grid"
      // Rows are minmax(0,1fr) and the container clips, so each cell stays stable
      // at its share of the surface (no content-driven growth feedback loop).
      className={`grid min-h-0 flex-1 auto-rows-[minmax(0,1fr)] gap-2 overflow-hidden p-2 ${gridColsClass(
        state.panes.length,
      )}`}
    >
      {state.panes.map((pane) => {
        const focused = pane.id === state.activePane
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
              {status ? <PaneStatusIndicator status={status} /> : null}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onRestart(pane.id)
                }}
                aria-label={`Restart ${pane.label}`}
                title="Restart this pane"
                className="flex size-11 items-center justify-center rounded-md text-foreground-tertiary hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring md:size-7"
              >
                <RotateCcw className="size-3.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <View
                key={paneSessionId(workspaceId, pane.id, pane.epoch)}
                cli={pane.cli}
                cwd={pane.cwd}
                sessionId={paneSessionId(workspaceId, pane.id, pane.epoch)}
                attach={pane.attach}
                onStatusChange={(s) => onStatus(pane.id, s)}
                onPersistentChange={(p) => onPersistent(pane.id, p)}
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

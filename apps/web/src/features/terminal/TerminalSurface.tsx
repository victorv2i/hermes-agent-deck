import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
} from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Eraser, Plus, RotateCcw, Save, SquareTerminal, Trash2, TriangleAlert } from 'lucide-react'
import { Popover } from 'radix-ui'
import type {
  CreateWorkspaceRequest,
  ListWorkspacesResponse,
  WorkspaceDefinition,
  WorkspaceSummary,
} from '@agent-deck/protocol'
import { ConnectionDot, type ConnectionStatus } from '@/components/layout/ConnectionDot'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { SurfaceHeader } from '@/components/ui/surface-header'
import { apiDelete, apiFetch, apiPost } from '@/lib/apiFetch'
import { useVisualViewportInset } from '@/lib/useVisualViewportInset'
import { MOBILE_QUERY, useMediaQuery } from '@/lib/useMediaQuery'
import { useTerminalStatus, type TerminalStatusState } from './useTerminalStatus'
import { useTerminalClis, type CliId, type DetectedCli } from './useTerminalClis'
import { useTerminalTmuxSessions } from './useTerminalTmuxSessions'
import { useTerminalAcknowledged, type AckStorage } from './useTerminalAcknowledged'
import { TerminalStatusIndicator } from './terminalStatus'
import { TerminalLauncher } from './TerminalLauncher'
import { ScratchPaneController } from './ScratchPaneController'
import { WorkspacePaneController } from './WorkspacePaneController'
import { readPersistedSessions, type SessionsState } from './terminalSessions'
import {
  panesFromSessions,
  readWorkspacesCache,
  writeLastWorkspaceId,
  writeWorkspacesCache,
} from './terminalWorkspaces'
import type { TerminalViewProps } from './TerminalView'
import type { TerminalStatus } from './terminalSocket'

/**
 * The UNIFIED Terminal surface: ONE page for the ephemeral quick terminal AND
 * the named, server-saved workspaces. Mounted at `/terminal`, `/workspaces`, and
 * `/workspaces/:id`: the `:id` selects a saved workspace (a cross-device deep
 * link); the bare paths select SCRATCH (the quick terminal). A compact workspace
 * switcher pins Scratch first, then the saved workspaces, then New + Save.
 *
 * Mental model: a terminal page is just an unnamed workspace. SCRATCH is exactly
 * today's quick terminal: ephemeral, per-device, zero setup, its panes persisted
 * in the existing terminal localStorage (see {@link ScratchPaneController}). A
 * saved workspace shows its panes and reattaches its tmux sessions cross-device
 * (see {@link WorkspacePaneController}). BOTH render the SAME {@link ./PaneGrid}, so
 * they look and behave identically.
 *
 * The surface owns: the switcher (its list comes from `GET /workspaces`), the
 * backend/cwd availability probe + the first-open real-shell consent gate, the
 * single header (whose status/Clear/Restart act on the ACTIVE pane), the SCRATCH
 * launcher first-screen, and the Save action that promotes the current Scratch
 * panes into a new server workspace.
 *
 * `fetchImpl`, `viewComponent`, and `ackStorage` are injectable so the surface is
 * testable in jsdom without a live BFF or the real xterm engine.
 */

// React.lazy keeps @xterm/* and the TerminalView chunk out of the main bundle.
const LazyTerminalView = lazy(() =>
  import('./TerminalView').then((m) => ({ default: m.TerminalView })),
)

export interface TerminalSurfaceProps {
  /** Inject fetch (tests); used for the status probe, the workspaces list/create,
   * and the workspace definition fetch + PATCH. */
  fetchImpl?: typeof fetch
  /** Inject the terminal view (tests) to bypass the real lazy xterm import. */
  viewComponent?: ComponentType<TerminalViewProps>
  /** Inject acknowledge storage (tests); defaults to localStorage. */
  ackStorage?: AckStorage | null
}

export function TerminalSurface({ fetchImpl, viewComponent, ackStorage }: TerminalSurfaceProps = {}) {
  const navigate = useNavigate()
  // The selected workspace id from the route (`/workspaces/:id`). Absent on the
  // bare `/terminal` and `/workspaces` paths -> SCRATCH is active.
  const { id: routeId } = useParams<{ id: string }>()
  const selectedId = routeId ?? null

  const View = viewComponent ?? LazyTerminalView
  const probe = useTerminalStatus(fetchImpl ?? fetch)
  const clisState = useTerminalClis(fetchImpl ?? fetch)
  const [acknowledged, acknowledge] = useTerminalAcknowledged(ackStorage)

  // The pty backend is usable (node-pty loaded + not gated off).
  const backendAvailable = probe.phase === 'ready' && probe.status.available
  // A workspace cwd resolves (or $HOME is opted in). When the backend is up but no
  // cwd resolves, a spawn would be DOOMED, so show a calm panel BEFORE the consent.
  const cwdAvailable = probe.phase === 'ready' && probe.status.cwdAvailable
  const available = backendAvailable && cwdAvailable

  // The switcher's saved-workspace list (the server is authoritative; the
  // localStorage cache paints instantly, then the fetch revalidates).
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>(() => readWorkspacesCache() ?? [])
  const getJson = useCallback(
    <T,>(path: string): Promise<T> =>
      fetchImpl
        ? (fetchImpl(`/api/agent-deck${path}`).then((r) => {
            if (!r.ok) throw new Error(`request failed (${r.status})`)
            return r.json() as Promise<T>
          }) as Promise<T>)
        : apiFetch<T>(path),
    [fetchImpl],
  )
  const refreshWorkspaces = useCallback(() => {
    let cancelled = false
    void getJson<ListWorkspacesResponse>('/terminal/workspaces')
      .then((res) => {
        if (cancelled) return
        setWorkspaces(res.workspaces)
        writeWorkspacesCache(res.workspaces)
      })
      .catch(() => {
        // Keep the cached list visible; the switcher still works for Scratch +
        // any workspace the user deep-links into.
      })
    return () => {
      cancelled = true
    }
  }, [getJson])
  useEffect(() => refreshWorkspaces(), [refreshWorkspaces])

  // Remember a selected workspace as the last-opened pointer (a UX nicety).
  useEffect(() => {
    if (selectedId) writeLastWorkspaceId(selectedId)
  }, [selectedId])

  // The ACTIVE pane's status/clear/restart, lifted from whichever controller is
  // mounted so the ONE header owns the connection dot + the Clear/Restart actions.
  const [liveStatus, setLiveStatus] = useState<TerminalStatus | null>(null)
  const [clear, setClear] = useState<(() => void) | null>(null)
  const [restartActive, setRestartActive] = useState<(() => void) | null>(null)
  // Reset the lifted handles the instant the selection changes (the old controller
  // unmounts; the new one re-reports), via React's adjust-state-during-render
  // pattern (no effect -> no cascading render). Avoids a stale Clear/Restart from
  // the previous workspace flashing in the header during a switch.
  const [lastSelectedId, setLastSelectedId] = useState(selectedId)
  if (selectedId !== lastSelectedId) {
    setLastSelectedId(selectedId)
    setLiveStatus(null)
    setClear(null)
    setRestartActive(null)
  }

  // The create + save dialog open states.
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  // The confirm-gated delete: the workspace pending removal (null = no dialog).
  const [pendingDelete, setPendingDelete] = useState<WorkspaceSummary | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  // The latest Scratch sessions, captured for the Save action (Save promotes the
  // CURRENT Scratch panes into a server workspace).
  const scratchSessionsRef = useRef<SessionsState | null>(null)
  const [scratchPaneCount, setScratchPaneCount] = useState(0)
  const onScratchSessions = useCallback((sessions: SessionsState) => {
    scratchSessionsRef.current = sessions
    setScratchPaneCount(sessions.sessions.length)
  }, [])

  // iOS never resizes the layout viewport for the on-screen keyboard, so pad the
  // surface by the keyboard's overlap; the view's ResizeObserver refits the rows.
  const keyboardInset = useVisualViewportInset()

  const onSelectScratch = useCallback(() => navigate('/terminal'), [navigate])
  const onSelectWorkspace = useCallback(
    (id: string) => navigate(`/workspaces/${id}`),
    [navigate],
  )

  // Save: promote the current Scratch panes into a new server workspace, then
  // switch to it. Scratch is left intact (we navigate by id; the Scratch
  // localStorage is untouched).
  const createWorkspace = useCallback(
    async (req: CreateWorkspaceRequest): Promise<WorkspaceDefinition> => {
      const path = '/terminal/workspaces'
      if (fetchImpl) {
        const res = await fetchImpl(`/api/agent-deck${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
        })
        if (!res.ok) throw new Error(`create failed (${res.status})`)
        return (await res.json()) as WorkspaceDefinition
      }
      return apiPost<WorkspaceDefinition>(path, req)
    },
    [fetchImpl],
  )
  const onSave = useCallback(
    async (name: string): Promise<WorkspaceDefinition> => {
      const sessions = scratchSessionsRef.current?.sessions ?? []
      const def = await createWorkspace({ name, panes: panesFromSessions(sessions) })
      refreshWorkspaces()
      navigate(`/workspaces/${def.id}`)
      return def
    },
    [createWorkspace, navigate, refreshWorkspaces],
  )

  // Delete a saved workspace (confirm-gated). On deleting the ACTIVE workspace we
  // fall back to Scratch so the surface never sits on a workspace that is gone.
  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return
    const target = pendingDelete
    setDeleteBusy(true)
    const path = `/terminal/workspaces/${encodeURIComponent(target.id)}`
    try {
      if (fetchImpl) {
        const res = await fetchImpl(`/api/agent-deck${path}`, { method: 'DELETE' })
        if (!res.ok) throw new Error(`delete failed (${res.status})`)
      } else {
        await apiDelete(path)
      }
      setPendingDelete(null)
      if (selectedId === target.id) navigate('/terminal')
      refreshWorkspaces()
    } catch {
      // Leave the dialog open so the user can retry; the list is unchanged.
    } finally {
      setDeleteBusy(false)
    }
  }, [pendingDelete, fetchImpl, selectedId, navigate, refreshWorkspaces])

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      style={{
        // Carry the iOS safe-area at the bottom (a no-op where env() resolves to
        // 0), plus the keyboard overlap so the typed line never hides behind it.
        paddingBottom: keyboardInset > 0 ? keyboardInset : 'env(safe-area-inset-bottom)',
      }}
    >
      <Header
        probe={probeStatus(probe)}
        live={available ? liveStatus : null}
        onClear={clear}
        onRestart={available ? restartActive : null}
      />

      {available && acknowledged ? (
        <SwitcherBar
          selectedId={selectedId}
          workspaces={workspaces}
          onSelectScratch={onSelectScratch}
          onSelectWorkspace={onSelectWorkspace}
          onDeleteWorkspace={(ws) => setPendingDelete(ws)}
          onNew={() => setCreating(true)}
          // Save is only meaningful from Scratch with at least one pane.
          canSave={selectedId === null && scratchPaneCount > 0}
          onSave={() => setSaving(true)}
        />
      ) : null}

      {probe.phase === 'loading' && <CenteredNote>Checking the terminal…</CenteredNote>}

      {probe.phase === 'failed' && (
        <Panel
          title="Terminal unavailable"
          body="Couldn't reach the terminal backend. Make sure the Agent Deck server is running."
          tone="error"
        />
      )}

      {probe.phase === 'ready' && !probe.status.available && (
        <Panel
          title="Terminal unavailable"
          body={
            probe.status.reason ?? 'The terminal backend (node-pty) is not available on this host.'
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
            probe.status.reason ?? 'There is no workspace directory to open the terminal in yet.'
          }
          tone="error"
        />
      )}

      {/* First-open acknowledge gate: this is a REAL shell on the host. We do not
          connect the socket / spawn a pty until the user acknowledges. */}
      {available && !acknowledged && <AcknowledgeGate onAcknowledge={acknowledge} />}

      {available && acknowledged ? (
        selectedId === null ? (
          <ScratchBody
            clisState={clisState}
            fetchImpl={fetchImpl}
            View={View}
            onActiveStatusChange={setLiveStatus}
            onActiveClearReady={(fn) => setClear(() => fn)}
            onActiveRestartReady={(fn) => setRestartActive(() => fn)}
            onSessionsChange={onScratchSessions}
          />
        ) : (
          <WorkspaceBody
            key={selectedId}
            id={selectedId}
            clis={clisState.phase === 'ready' ? clisState.clis : undefined}
            fetchImpl={fetchImpl}
            View={View}
            onActiveStatusChange={setLiveStatus}
            onActiveClearReady={(fn) => setClear(() => fn)}
            onActiveRestartReady={(fn) => setRestartActive(() => fn)}
          />
        )
      ) : null}

      <CreateWorkspaceDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={createWorkspace}
        onCreated={(def) => {
          setCreating(false)
          refreshWorkspaces()
          navigate(`/workspaces/${def.id}`)
        }}
      />

      <SaveWorkspaceDialog
        open={saving}
        paneCount={scratchPaneCount}
        onClose={() => setSaving(false)}
        onSave={onSave}
        onSaved={() => setSaving(false)}
      />

      <DeleteWorkspaceDialog
        workspace={pendingDelete}
        busy={deleteBusy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  )
}

/* -- The workspace switcher ------------------------------------------------ */

/**
 * The compact switcher: `[Scratch] [<saved workspaces...>] [+ New] [Save]`.
 * SCRATCH is pinned first and is the zero-setup quick terminal; the saved
 * workspaces follow; New creates one; Save promotes the current Scratch panes.
 * On phones the pills collapse to a dropdown (a long pill row is unusable narrow).
 */
function SwitcherBar({
  selectedId,
  workspaces,
  onSelectScratch,
  onSelectWorkspace,
  onDeleteWorkspace,
  onNew,
  canSave,
  onSave,
}: {
  selectedId: string | null
  workspaces: WorkspaceSummary[]
  onSelectScratch: () => void
  onSelectWorkspace: (id: string) => void
  onDeleteWorkspace: (workspace: WorkspaceSummary) => void
  onNew: () => void
  canSave: boolean
  onSave: () => void
}) {
  const phone = useMediaQuery(MOBILE_QUERY)
  const activeName =
    selectedId === null
      ? 'Scratch'
      : (workspaces.find((w) => w.id === selectedId)?.name ?? 'Workspace')

  return (
    <div className="flex items-center gap-2 border-b border-border bg-surface-1 px-2.5 py-1.5">
      {phone ? (
        <WorkspaceDropdown
          selectedId={selectedId}
          activeName={activeName}
          workspaces={workspaces}
          onSelectScratch={onSelectScratch}
          onSelectWorkspace={onSelectWorkspace}
          onDeleteWorkspace={onDeleteWorkspace}
        />
      ) : (
        <div
          role="tablist"
          aria-label="Workspaces"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        >
          <SwitcherPill
            label="Scratch"
            selected={selectedId === null}
            onClick={onSelectScratch}
          />
          {workspaces.map((ws) => (
            <SwitcherPill
              key={ws.id}
              label={ws.name}
              selected={ws.id === selectedId}
              onClick={() => onSelectWorkspace(ws.id)}
              onDelete={() => onDeleteWorkspace(ws)}
            />
          ))}
        </div>
      )}

      <div className="flex shrink-0 items-center gap-1.5">
        {canSave ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 md:min-h-8"
            onClick={onSave}
          >
            <Save className="size-4" />
            Save
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11 md:min-h-8"
          aria-label="New workspace"
          title="New workspace"
          onClick={onNew}
        >
          <Plus className="size-4" />
          New
        </Button>
      </div>
    </div>
  )
}

function SwitcherPill({
  label,
  selected,
  onClick,
  onDelete,
}: {
  label: string
  selected: boolean
  onClick: () => void
  /** Saved workspaces get a confirm-gated delete; Scratch (no handler) does not. */
  onDelete?: () => void
}) {
  const tab = (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={`flex h-11 min-w-0 shrink-0 cursor-pointer items-center rounded-lg px-3 text-sm transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring md:h-8 ${
        selected
          ? 'bg-primary/10 text-foreground'
          : 'text-foreground-tertiary hover:bg-muted hover:text-foreground'
      }`}
    >
      <span className="min-w-0 max-w-40 truncate">{label}</span>
    </button>
  )

  if (!onDelete) return tab

  // A grouped pill + trash. The trash is a sibling (not nested) so the markup stays
  // valid, and it stays visible on touch where hover does not exist (sm:opacity).
  return (
    <div className="group/pill flex shrink-0 items-center">
      {tab}
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${label}`}
        title={`Delete ${label}`}
        className="-ml-1 flex h-11 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground-tertiary transition-colors duration-100 hover:text-destructive focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring md:h-8 md:opacity-0 md:group-hover/pill:opacity-100 md:focus-visible:opacity-100"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  )
}

/** The phone switcher: one dropdown listing Scratch + every saved workspace. */
function WorkspaceDropdown({
  selectedId,
  activeName,
  workspaces,
  onSelectScratch,
  onSelectWorkspace,
  onDeleteWorkspace,
}: {
  selectedId: string | null
  activeName: string
  workspaces: WorkspaceSummary[]
  onSelectScratch: () => void
  onSelectWorkspace: (id: string) => void
  onDeleteWorkspace: (workspace: WorkspaceSummary) => void
}) {
  const [open, setOpen] = useState(false)
  const pick = (fn: () => void) => {
    setOpen(false)
    fn()
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 min-w-0 flex-1 justify-start"
          aria-label="Switch workspace"
        >
          <span className="min-w-0 truncate">{activeName}</span>
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          side="bottom"
          sideOffset={6}
          className="ad-surface z-50 max-h-[min(60vh,22rem)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-lg bg-popover p-1 shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div role="menu" aria-label="Workspaces" className="flex flex-col gap-0.5">
            <DropdownItem label="Scratch" selected={selectedId === null} onClick={() => pick(onSelectScratch)} />
            {workspaces.map((ws) => (
              <DropdownItem
                key={ws.id}
                label={ws.name}
                selected={ws.id === selectedId}
                onClick={() => pick(() => onSelectWorkspace(ws.id))}
                onDelete={() => pick(() => onDeleteWorkspace(ws))}
              />
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function DropdownItem({
  label,
  selected,
  onClick,
  onDelete,
}: {
  label: string
  selected: boolean
  onClick: () => void
  /** Saved workspaces get a confirm-gated delete; Scratch (no handler) does not. */
  onDelete?: () => void
}) {
  const item = (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2.5 text-left text-sm transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring ${
        selected ? 'bg-primary/10 text-foreground' : 'text-foreground hover:bg-muted'
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )

  if (!onDelete) return item

  return (
    <div className="flex items-center gap-1">
      {item}
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${label}`}
        title={`Delete ${label}`}
        className="flex size-9 shrink-0 items-center justify-center rounded-md text-foreground-tertiary transition-colors duration-100 hover:bg-muted hover:text-destructive focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  )
}

/* -- SCRATCH body: launcher first-screen, then the controller -------------- */

function ScratchBody({
  clisState,
  fetchImpl,
  View,
  onActiveStatusChange,
  onActiveClearReady,
  onActiveRestartReady,
  onSessionsChange,
}: {
  clisState: ReturnType<typeof useTerminalClis>
  fetchImpl?: typeof fetch
  View: ComponentType<TerminalViewProps>
  onActiveStatusChange: (status: TerminalStatus | null) => void
  onActiveClearReady: (clear: (() => void) | null) => void
  onActiveRestartReady: (restart: (() => void) | null) => void
  onSessionsChange: (sessions: SessionsState) => void
}) {
  // The server's tmux session list: the SOURCE OF TRUTH for which shells exist.
  // The controller waits for it to SETTLE before mounting, so restored sessions
  // reconcile against reality (dead cleaned, forgotten deck shells recovered).
  const tmuxState = useTerminalTmuxSessions(fetchImpl ?? fetch)

  // A live Scratch session exists once a launcher preset is chosen OR sessions
  // were restored from localStorage on reload (seeds launchCli). On a refresh the
  // controller restores the FULL persisted list and reattaches the parked shells.
  const [launchCli, setLaunchCli] = useState<CliId | null>(
    () => readPersistedSessions()?.sessions[0]?.cli ?? null,
  )
  const [attachTarget, setAttachTarget] = useState<string | null>(null)
  const [recoverOnly, setRecoverOnly] = useState(false)
  const sessionLive = launchCli != null

  const launch = useCallback((id: CliId) => {
    onActiveStatusChange('connecting')
    setLaunchCli(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const attach = useCallback((name: string) => {
    onActiveStatusChange('connecting')
    setAttachTarget(name)
    setLaunchCli((cli) => cli ?? 'shell')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const resume = useCallback(() => {
    onActiveStatusChange('connecting')
    setRecoverOnly(true)
    setLaunchCli((cli) => cli ?? 'shell')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!sessionLive) {
    return (
      <TerminalLauncher
        clis={clisState.phase === 'ready' ? clisState.clis : undefined}
        failed={clisState.phase === 'failed'}
        onRetry={clisState.phase !== 'loading' ? clisState.refetch : undefined}
        onLaunch={launch}
        tmux={tmuxState.phase === 'ready' ? tmuxState.data : undefined}
        onAttach={attach}
        onResume={resume}
      />
    )
  }

  // Wait for the tmux list to SETTLE before mounting so restored sessions
  // reconcile against the server's reality up front.
  if (tmuxState.phase === 'loading') return <CenteredNote>Loading terminal…</CenteredNote>

  return (
    <Suspense fallback={<CenteredNote>Loading terminal…</CenteredNote>}>
      <ScratchPaneController
        initialCli={launchCli}
        initialAttach={attachTarget ?? undefined}
        recoverOnly={recoverOnly}
        serverSessions={tmuxState.phase === 'ready' ? tmuxState.data : undefined}
        clis={clisState.phase === 'ready' ? clisState.clis : undefined}
        viewComponent={View}
        onActiveStatusChange={onActiveStatusChange}
        onActiveClearReady={onActiveClearReady}
        onActiveRestartReady={onActiveRestartReady}
        onSessionsChange={onSessionsChange}
      />
    </Suspense>
  )
}

/* -- WORKSPACE body: fetch the definition, then the controller ------------- */

function WorkspaceBody({
  id,
  clis,
  fetchImpl,
  View,
  onActiveStatusChange,
  onActiveClearReady,
  onActiveRestartReady,
}: {
  id: string
  clis: DetectedCli[] | undefined
  fetchImpl?: typeof fetch
  View: ComponentType<TerminalViewProps>
  onActiveStatusChange: (status: TerminalStatus | null) => void
  onActiveClearReady: (clear: (() => void) | null) => void
  onActiveRestartReady: (restart: (() => void) | null) => void
}) {
  const [load, setLoad] = useState<
    | { phase: 'loading' }
    | { phase: 'failed'; error: string }
    | { phase: 'ready'; def: WorkspaceDefinition }
  >({ phase: 'loading' })

  const doFetch = useCallback(
    (path: string): Promise<WorkspaceDefinition> =>
      fetchImpl
        ? (fetchImpl(`/api/agent-deck${path}`).then((r) => {
            if (!r.ok) throw new Error(`request failed (${r.status})`)
            return r.json() as Promise<WorkspaceDefinition>
          }) as Promise<WorkspaceDefinition>)
        : apiFetch<WorkspaceDefinition>(path),
    [fetchImpl],
  )

  useEffect(() => {
    let cancelled = false
    void doFetch(`/terminal/workspaces/${encodeURIComponent(id)}`)
      .then((def) => {
        if (!cancelled) setLoad({ phase: 'ready', def })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoad({ phase: 'failed', error: err instanceof Error ? err.message : 'Not found.' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [id, doFetch])

  if (load.phase === 'loading') return <CenteredNote>Loading workspace…</CenteredNote>
  if (load.phase === 'failed') {
    return (
      <Panel
        title="Workspace not found"
        body="This workspace could not be loaded. It may have been deleted."
        tone="error"
      />
    )
  }

  return (
    <Suspense fallback={<CenteredNote>Loading terminal…</CenteredNote>}>
      <WorkspacePaneController
        def={load.def}
        clis={clis}
        fetchImpl={fetchImpl}
        viewComponent={View}
        onActiveStatusChange={onActiveStatusChange}
        onActiveClearReady={onActiveClearReady}
        onActiveRestartReady={onActiveRestartReady}
      />
    </Suspense>
  )
}

/* -- Create + Save dialogs ------------------------------------------------- */

function CreateWorkspaceDialog({
  open,
  onClose,
  onCreate,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreate: (req: CreateWorkspaceRequest) => Promise<WorkspaceDefinition>
  onCreated: (def: WorkspaceDefinition) => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameId = useId()

  // Reset on the closed -> open edge (no effect needed; adjust-during-render).
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName('')
      setBusy(false)
      setError(null)
    }
  }

  const trimmed = name.trim()
  const canSubmit = trimmed.length > 0 && trimmed.length <= 80 && !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      // A brand-new workspace starts with one neutral shell pane, ready to use.
      const def = await onCreate({
        name: trimmed,
        panes: [{ id: `shell-1-${Math.random().toString(36).slice(2, 10)}`, label: 'Shell 1', cli: 'shell' }],
      })
      onCreated(def)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the workspace.')
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
    >
      <DialogContent className="max-w-sm" showClose={!busy}>
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
          <DialogDescription>
            Give it a name. It starts with one shell pane; add, rename, or remove panes any time.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={nameId} className="text-sm font-medium text-foreground">
              Name
            </label>
            <Input
              id={nameId}
              autoFocus
              value={name}
              maxLength={80}
              placeholder="e.g. Client project"
              className="text-base md:text-sm"
              onChange={(e) => setName(e.target.value)}
              aria-invalid={error != null || undefined}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SaveWorkspaceDialog({
  open,
  paneCount,
  onClose,
  onSave,
  onSaved,
}: {
  open: boolean
  paneCount: number
  onClose: () => void
  onSave: (name: string) => Promise<WorkspaceDefinition>
  onSaved: (def: WorkspaceDefinition) => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameId = useId()

  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName('')
      setBusy(false)
      setError(null)
    }
  }

  const trimmed = name.trim()
  const canSubmit = trimmed.length > 0 && trimmed.length <= 80 && !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      const def = await onSave(trimmed)
      onSaved(def)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the workspace.')
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
    >
      <DialogContent className="max-w-sm" showClose={!busy}>
        <DialogHeader>
          <DialogTitle>Save as a workspace</DialogTitle>
          <DialogDescription>
            Save these {paneCount} {paneCount === 1 ? 'pane' : 'panes'} as a named workspace that
            reattaches the same shells from any device. Your Scratch terminal stays as it is.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={nameId} className="text-sm font-medium text-foreground">
              Name
            </label>
            <Input
              id={nameId}
              autoFocus
              value={name}
              maxLength={80}
              placeholder="e.g. Client project"
              className="text-base md:text-sm"
              onChange={(e) => setName(e.target.value)}
              aria-invalid={error != null || undefined}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              Save workspace
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* -- Delete confirm -------------------------------------------------------- */

/**
 * Confirm-gated delete (a destructive action is never one click): the house
 * pattern shared with the rest of the app. Deleting a workspace removes its saved
 * pane layout; any running shells are not killed and can still be reattached from
 * Scratch.
 */
function DeleteWorkspaceDialog({
  workspace,
  busy,
  onCancel,
  onConfirm,
}: {
  workspace: WorkspaceSummary | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog
      open={workspace !== null}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel()
      }}
    >
      <DialogContent className="max-w-sm" showClose={!busy}>
        <DialogHeader>
          <DialogTitle>Delete workspace?</DialogTitle>
          <DialogDescription>
            {workspace ? (
              <>
                &ldquo;{workspace.name}&rdquo; will be removed. Its pane layout is deleted; any
                running shells are not killed here and can still be reattached from Scratch.
              </>
            ) : (
              <>This workspace will be removed.</>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy} autoFocus>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* -- Shared chrome (header, gate, panels) ---------------------------------- */

/**
 * Map the route-level availability probe to the shared connection-dot state:
 * probing = connecting, terminal available = online, anything else = offline.
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
  probe: ConnectionStatus
  live: TerminalStatus | null
  onClear: (() => void) | null
  onRestart: (() => void) | null
}) {
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

/**
 * First-open acknowledge gate. The one honest fact before a shell exists:
 * commands here run for real on the host, with no sandbox. Warmer tone for
 * newcomers (most people never need the Terminal), the acknowledgment kept.
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
        <Button variant="outline" size="sm" className="mt-4 min-h-11 md:min-h-7" onClick={onAcknowledge}>
          Got it, open the terminal
        </Button>
      </div>
    </div>
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
        <p className={`text-sm font-medium ${tone === 'error' ? 'text-destructive' : 'text-foreground'}`}>
          {title}
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  )
}

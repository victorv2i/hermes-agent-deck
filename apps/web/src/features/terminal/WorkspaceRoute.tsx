import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ComponentType,
} from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, LayoutGrid, SlidersHorizontal, TriangleAlert } from 'lucide-react'
import type { CliId, UpdateWorkspaceRequest, WorkspaceDefinition } from '@agent-deck/protocol'
import { Button } from '@/components/ui/button'
import { SurfaceHeader } from '@/components/ui/surface-header'
import { apiFetch, apiPatch } from '@/lib/apiFetch'
import { useVisualViewportInset } from '@/lib/useVisualViewportInset'
import { MOBILE_QUERY, useMediaQuery } from '@/lib/useMediaQuery'
import { useTerminalStatus, type TerminalStatusState } from './useTerminalStatus'
import { useTerminalClis, type DetectedCli } from './useTerminalClis'
import { useTerminalAcknowledged, type AckStorage } from './useTerminalAcknowledged'
import { WorkspaceMultiView } from './WorkspaceMultiView'
import { CliPicker, CwdPicker } from './WorkspacePanePickers'
import {
  addPane,
  applyLayoutPreset,
  fromDefinition,
  readWorkspaceState,
  removePane,
  renamePane,
  restartPane,
  setActivePane,
  setPaneCli,
  setPaneCwd,
  setViewMode,
  toPaneDefinitions,
  writeLastWorkspaceId,
  writeWorkspaceState,
  type ViewMode,
  type WorkspaceState,
} from './terminalWorkspaces'
import type { TerminalViewProps } from './TerminalView'

/**
 * The single WORKSPACE surface, mounted at `/workspaces/:id`. It fetches the
 * server-persisted definition (the source of truth), hydrates the pure
 * {@link WorkspaceState}, and mounts the controlled {@link WorkspaceMultiView}:
 * the freeform pane grid (tab/grid, layout presets, add/remove/rename/restart).
 * The route OWNS the state (the reducer over the pure helpers in
 * {@link ./terminalWorkspaces}) and PATCHes durable pane edits back, debounced.
 *
 * Mirrors {@link ./TerminalRoute}: it gates on the terminal backend probe + the
 * real-shell consent (these are real shells on the host), lazy-loads the heavy
 * xterm {@link ./TerminalView}, and carries the mobile affordances (keyboard
 * inset, iOS safe-area, touch sizing). On phones it defaults to TAB view (a grid
 * of many panes is unusable on a small screen).
 *
 * `fetchImpl` + `viewComponent` are injectable so the route is testable in jsdom
 * without a live BFF or the real xterm engine.
 */

// React.lazy keeps @xterm/* and the TerminalView chunk out of the main bundle.
const LazyTerminalView = lazy(() =>
  import('./TerminalView').then((m) => ({ default: m.TerminalView })),
)

/** How long after the last durable edit to PATCH the server (coalesces bursts). */
const PATCH_DEBOUNCE_MS = 600

type Action =
  | { type: 'add'; cli: CliId }
  | { type: 'remove'; id: string }
  | { type: 'rename'; id: string; label: string }
  | { type: 'restart'; id: string }
  | { type: 'activate'; id: string }
  | { type: 'viewMode'; mode: ViewMode }
  | { type: 'layout'; count: number }
  | { type: 'setCli'; id: string; cli: CliId }
  | { type: 'setCwd'; id: string; cwd: string | null }

function reducer(state: WorkspaceState, action: Action): WorkspaceState {
  switch (action.type) {
    case 'add':
      return addPane(state, action.cli)
    case 'remove':
      return removePane(state, action.id)
    case 'rename':
      return renamePane(state, action.id, action.label)
    case 'restart':
      return restartPane(state, action.id)
    case 'activate':
      return setActivePane(state, action.id)
    case 'viewMode':
      return setViewMode(state, action.mode)
    case 'layout':
      return applyLayoutPreset(state, action.count)
    case 'setCli':
      return setPaneCli(state, action.id, action.cli)
    case 'setCwd':
      // A null/empty value clears the cwd back to the server default.
      return setPaneCwd(state, action.id, action.cwd ?? '')
  }
}

export interface WorkspaceRouteProps {
  /** Inject fetch (tests); used for the definition fetch + PATCH. */
  fetchImpl?: typeof fetch
  /** Inject the terminal view (tests) to bypass the real lazy xterm import. */
  viewComponent?: ComponentType<TerminalViewProps>
  /** Inject acknowledge storage (tests); defaults to localStorage. */
  ackStorage?: AckStorage | null
}

export function WorkspaceRoute({ fetchImpl, viewComponent, ackStorage }: WorkspaceRouteProps = {}) {
  const { id = '' } = useParams<{ id: string }>()
  const View = viewComponent ?? LazyTerminalView
  const probe = useTerminalStatus(fetchImpl ?? fetch)
  const clisState = useTerminalClis(fetchImpl ?? fetch)
  const [acknowledged, acknowledge] = useTerminalAcknowledged(ackStorage)

  // The definition fetch lifecycle (the server is authoritative for panes).
  const [load, setLoad] = useState<
    | { phase: 'loading' }
    | { phase: 'failed'; error: string }
    | { phase: 'ready'; def: WorkspaceDefinition }
  >({ phase: 'loading' })

  // Reset to LOADING the instant the workspace id changes, via React's
  // adjust-state-during-render pattern (no effect -> no cascading render); the
  // fetch effect below then only writes state inside its async callbacks.
  const [loadedId, setLoadedId] = useState(id)
  if (id !== loadedId) {
    setLoadedId(id)
    setLoad({ phase: 'loading' })
  }

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
    if (!id) return
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

  // Remember this as the last-opened workspace (a UX pointer for the list).
  useEffect(() => {
    if (id) writeLastWorkspaceId(id)
  }, [id])

  // iOS never resizes the layout viewport for the on-screen keyboard, so pad the
  // surface by the keyboard's overlap; the view's ResizeObserver refits the rows.
  const keyboardInset = useVisualViewportInset()

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      style={{
        // Carry the iOS safe-area at the bottom (a no-op where env() resolves to
        // 0), plus the keyboard overlap so the typed line never hides behind it.
        paddingBottom: keyboardInset > 0 ? keyboardInset : 'env(safe-area-inset-bottom)',
      }}
    >
      {load.phase === 'loading' && (
        <>
          <SurfaceHeader icon={LayoutGrid} title="Workspace" actions={<BackLink />} />
          <CenteredNote>Loading workspace…</CenteredNote>
        </>
      )}

      {load.phase === 'failed' && (
        <>
          <SurfaceHeader icon={LayoutGrid} title="Workspace" actions={<BackLink />} />
          <Panel
            title="Workspace not found"
            body="This workspace could not be loaded. It may have been deleted."
          />
        </>
      )}

      {load.phase === 'ready' && (
        <LoadedWorkspace
          // Key by id so navigating to a DIFFERENT workspace remounts the body,
          // re-seeding the reducer from the new definition (the lazy useReducer
          // initializer otherwise runs only once).
          key={load.def.id}
          def={load.def}
          probe={probe}
          acknowledged={acknowledged}
          onAcknowledge={acknowledge}
          clis={clisState.phase === 'ready' ? clisState.clis : undefined}
          fetchImpl={fetchImpl}
          View={View}
        />
      )}
    </div>
  )
}

/**
 * The loaded surface: owns the {@link WorkspaceState}, the durable PATCH, and the
 * gates (backend probe + real-shell consent), then mounts the controlled view +
 * the per-pane CLI/cwd editor for whichever pane is active.
 */
function LoadedWorkspace({
  def,
  probe,
  acknowledged,
  onAcknowledge,
  clis,
  fetchImpl,
  View,
}: {
  def: WorkspaceDefinition
  probe: TerminalStatusState
  acknowledged: boolean
  onAcknowledge: () => void
  clis: DetectedCli[] | undefined
  fetchImpl?: typeof fetch
  View: ComponentType<TerminalViewProps>
}) {
  // Seed from the server definition (authoritative for panes), then restore only
  // the LOCAL view shape (which pane is focused, tab vs grid) from the cache.
  const phone = useMediaQuery(MOBILE_QUERY)
  const [state, dispatch] = useReducer(reducer, def, (d) => {
    const base = fromDefinition(d)
    const cached = readWorkspaceState(d.id)
    const ids = new Set(base.panes.map((p) => p.id))
    const activePane =
      cached && cached.activePane && ids.has(cached.activePane)
        ? cached.activePane
        : base.activePane
    // Phones default to tab view; otherwise honor the cached preference.
    const viewMode: ViewMode = phone ? 'tab' : (cached?.viewMode ?? base.viewMode)
    return { ...base, activePane, viewMode }
  })

  // Cache the local view shape so a reload restores focus + tab/grid instantly.
  useEffect(() => {
    writeWorkspaceState(state)
  }, [state])

  // PATCH the DURABLE pane set back, debounced + coalesced. The view-only bits
  // (active pane, view mode, restart epoch) are NOT durable, so the effect keys on
  // a signature of JUST the persisted shape: focusing a tab or switching view
  // never re-runs it (and so never cancels a pending save). The latest panes / id
  // / fetch are read through refs when the timer fires.
  const paneDefs = toPaneDefinitions(state)
  const paneSignature = JSON.stringify(paneDefs)
  const seededSignatureRef = useRef<string | null>(null)
  const patchRef = useRef({ panes: paneDefs, id: state.id, fetchImpl })
  useEffect(() => {
    patchRef.current = { panes: paneDefs, id: state.id, fetchImpl }
  })
  useEffect(() => {
    // Skip the very first signature (it equals the freshly-fetched definition).
    if (seededSignatureRef.current === null) {
      seededSignatureRef.current = paneSignature
      return
    }
    if (seededSignatureRef.current === paneSignature) return
    seededSignatureRef.current = paneSignature
    const handle = setTimeout(() => {
      const { panes, id: wsId, fetchImpl: impl } = patchRef.current
      const body: UpdateWorkspaceRequest = { panes }
      const path = `/terminal/workspaces/${encodeURIComponent(wsId)}`
      const send = impl
        ? impl(`/api/agent-deck${path}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }).then((r) => {
            if (!r.ok) throw new Error(`patch failed (${r.status})`)
          })
        : apiPatch<WorkspaceDefinition>(path, body)
      // Best-effort: a failed PATCH leaves the local + cached state intact; the
      // next edit retries. We never crash the live shells over a save blip.
      void Promise.resolve(send).catch(() => {})
    }, PATCH_DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [paneSignature])

  const backendAvailable = probe.phase === 'ready' && probe.status.available
  const cwdAvailable = probe.phase === 'ready' && probe.status.cwdAvailable
  const available = backendAvailable && cwdAvailable

  const activePane = state.panes.find((p) => p.id === state.activePane) ?? null

  return (
    <>
      <SurfaceHeader
        icon={LayoutGrid}
        title={def.name}
        subtitle={def.description}
        actions={<BackLink />}
      />

      {probe.phase === 'loading' && <CenteredNote>Checking the terminal…</CenteredNote>}

      {probe.phase === 'failed' && (
        <Panel
          title="Terminal unavailable"
          body="Couldn't reach the terminal backend. Make sure the Agent Deck server is running."
        />
      )}

      {probe.phase === 'ready' && !probe.status.available && (
        <Panel
          title="Terminal unavailable"
          body={probe.status.reason ?? 'The terminal backend (node-pty) is not available on this host.'}
        />
      )}

      {/* DOOMED-SPAWN GUARD: backend up but no workspace cwd resolves. */}
      {backendAvailable && !cwdAvailable && (
        <Panel
          title="Terminal unavailable"
          body={probe.status.reason ?? 'There is no workspace directory to open the terminal in yet.'}
        />
      )}

      {/* First-open consent: these are REAL shells on the host. */}
      {available && !acknowledged && <AcknowledgeGate onAcknowledge={onAcknowledge} />}

      {available && acknowledged && (
        <>
          {activePane ? (
            <PaneSettingsBar
              key={activePane.id}
              label={activePane.label}
              cli={activePane.cli}
              cwd={activePane.cwd}
              clis={clis}
              fetchImpl={fetchImpl}
              onCli={(cli) => dispatch({ type: 'setCli', id: activePane.id, cli })}
              onCwd={(cwd) => dispatch({ type: 'setCwd', id: activePane.id, cwd })}
            />
          ) : null}
          <Suspense fallback={<CenteredNote>Loading terminal…</CenteredNote>}>
            <WorkspaceMultiView
              state={state}
              clis={clis}
              viewComponent={View}
              onAddPane={(cli) => dispatch({ type: 'add', cli })}
              onRemovePane={(paneId) => dispatch({ type: 'remove', id: paneId })}
              onRenamePane={(paneId, label) => dispatch({ type: 'rename', id: paneId, label })}
              onRestartPane={(paneId) => dispatch({ type: 'restart', id: paneId })}
              onActivatePane={(paneId) => dispatch({ type: 'activate', id: paneId })}
              onSetViewMode={(mode) => dispatch({ type: 'viewMode', mode })}
              onApplyLayout={(count) => dispatch({ type: 'layout', count })}
            />
          </Suspense>
        </>
      )}
    </>
  )
}

/**
 * The per-pane settings row for the ACTIVE pane: the CLI picker + the cwd picker.
 * Editing here PATCHes back through the route's debounced save. Keyed by pane id
 * by the caller so switching panes resets the pickers' open state cleanly.
 */
function PaneSettingsBar({
  label,
  cli,
  cwd,
  clis,
  fetchImpl,
  onCli,
  onCwd,
}: {
  label: string
  cli: CliId | undefined
  cwd: string | undefined
  clis: DetectedCli[] | undefined
  fetchImpl?: typeof fetch
  onCli: (cli: CliId) => void
  onCwd: (cwd: string | null) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-1 px-2.5 py-1.5">
      <span className="flex items-center gap-1.5 text-xs text-foreground-tertiary">
        <SlidersHorizontal className="size-3.5" aria-hidden />
        <span className="min-w-0 max-w-40 truncate" title={label}>
          {label}
        </span>
      </span>
      <CliPicker value={cli} clis={clis} onChange={onCli} />
      <CwdPicker value={cwd} fetchImpl={fetchImpl} onChange={onCwd} />
    </div>
  )
}

function BackLink() {
  return (
    <Button asChild variant="ghost" size="sm" className="min-h-11 md:min-h-7">
      <Link to="/workspaces">
        <ArrowLeft />
        Workspaces
      </Link>
    </Button>
  )
}

/**
 * First-open acknowledge gate (shared semantics with the Terminal surface): the
 * one honest fact before a shell exists: commands here run for real on the host,
 * no sandbox. Uses the warning semantic, not the amber accent.
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
          Workspace panes are real shells on the host. Commands you run execute on the server with
          your own account, just like a terminal on that machine. There&apos;s no sandbox, so take
          the same care you would there.
        </p>
        <Button variant="outline" size="sm" className="mt-4 min-h-11 md:min-h-7" onClick={onAcknowledge}>
          Got it, open the workspace
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

function Panel({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
      <div className="ad-surface max-w-sm rounded-xl bg-card p-6 text-center">
        <p className="text-sm font-medium text-destructive">{title}</p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  )
}

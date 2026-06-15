import { useEffect, useReducer, useRef, type ComponentType } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import type { CliId, UpdateWorkspaceRequest, WorkspaceDefinition } from '@agent-deck/protocol'
import { apiPatch } from '@/lib/apiFetch'
import { MOBILE_QUERY, useMediaQuery } from '@/lib/useMediaQuery'
import { PaneGrid, type GridPane } from './PaneGrid'
import { CliPicker, CwdPicker } from './WorkspacePanePickers'
import {
  addPane,
  applyLayoutPreset,
  fromDefinition,
  paneSessionId,
  readWorkspaceState,
  removePane,
  renamePane,
  restartPane,
  setActivePane,
  setPaneCli,
  setPaneCwd,
  setViewMode,
  toPaneDefinitions,
  writeWorkspaceState,
  type ViewMode,
  type WorkspaceState,
} from './terminalWorkspaces'
import type { DetectedCli } from './useTerminalClis'
import type { TerminalViewProps } from './TerminalView'
import type { TerminalStatus } from './terminalSocket'

/**
 * The SAVED-WORKSPACE controller: a named, server-persisted grid of panes. It
 * owns the pure {@link ./terminalWorkspaces} reducer (add/remove/rename/restart +
 * the tab/grid toggle + 1/2/3/4/6 layout presets + per-pane cli/cwd), seeds from
 * the server's authoritative definition (restoring only the LOCAL view shape from
 * the cache), PATCHes the durable pane set back debounced, and feeds the unified
 * {@link PaneGrid} a normalized pane list with {@link paneSessionId} wire ids so
 * the same shells reattach cross-device.
 *
 * This is the LoadedWorkspace body that backed the old WorkspaceRoute, now
 * rendering the shared grid + the per-pane CLI/cwd settings row for the active
 * pane. Mount it KEYED by workspace id so switching workspaces re-seeds cleanly.
 */

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

export interface WorkspacePaneControllerProps {
  /** The server's authoritative workspace definition (seeds the reducer). */
  def: WorkspaceDefinition
  /** The detected CLIs, so the "+" preset menu + the CLI picker honor installs. */
  clis: DetectedCli[] | undefined
  /** Inject fetch (tests); used for the durable PATCH. */
  fetchImpl?: typeof fetch
  /** Inject the terminal view (tests) to bypass the real lazy xterm import. */
  viewComponent: ComponentType<TerminalViewProps>
  /** Report the ACTIVE pane's live status up to the surface header. */
  onActiveStatusChange?: (status: TerminalStatus | null) => void
  /** Report the active pane's engine `clear` handle up (null on teardown). */
  onActiveClearReady?: (clear: (() => void) | null) => void
  /** Report a Restart handle bound to the ACTIVE pane (null = no pane). */
  onActiveRestartReady?: (restart: (() => void) | null) => void
}

export function WorkspacePaneController({
  def,
  clis,
  fetchImpl,
  viewComponent,
  onActiveStatusChange,
  onActiveClearReady,
  onActiveRestartReady,
}: WorkspacePaneControllerProps) {
  // Seed from the server definition (authoritative for panes), then restore only
  // the LOCAL view shape (which pane is focused, tab vs grid) from the cache.
  const phone = useMediaQuery(MOBILE_QUERY)
  const [state, dispatch] = useReducer(reducer, def, (d) => {
    const base = fromDefinition(d)
    const cached = readWorkspaceState(d.id)
    const ids = new Set(base.panes.map((p) => p.id))
    const activePane =
      cached && cached.activePane && ids.has(cached.activePane) ? cached.activePane : base.activePane
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

  const activePane = state.panes.find((p) => p.id === state.activePane) ?? null

  // Normalize each pane into a grid pane: the wire id folds the workspace id, pane
  // id, and epoch so any device opening this workspace reattaches the SAME shells.
  const panes: GridPane[] = state.panes.map((p) => ({
    id: p.id,
    label: p.label,
    wireId: paneSessionId(state.id, p.id, p.epoch),
    ...(p.cli !== undefined ? { cli: p.cli } : {}),
    ...(p.cwd !== undefined ? { cwd: p.cwd } : {}),
    ...(p.attach !== undefined ? { attach: p.attach } : {}),
  }))

  return (
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
      <PaneGrid
        panes={panes}
        activeId={state.activePane}
        viewMode={state.viewMode}
        clis={clis}
        viewComponent={viewComponent}
        showLayoutPresets
        tablistLabel="Workspace panes"
        gridLabel="Pane grid"
        addLabel="Add pane"
        addMenuLabel="Add pane preset"
        capNoun="panes"
        onAddPane={(cli) => dispatch({ type: 'add', cli })}
        onRemovePane={(paneId) => dispatch({ type: 'remove', id: paneId })}
        onRenamePane={(paneId, label) => dispatch({ type: 'rename', id: paneId, label })}
        onRestartPane={(paneId) => dispatch({ type: 'restart', id: paneId })}
        onActivatePane={(paneId) => dispatch({ type: 'activate', id: paneId })}
        onSetViewMode={(mode) => dispatch({ type: 'viewMode', mode })}
        onApplyLayout={(count) => dispatch({ type: 'layout', count })}
        onActiveStatusChange={onActiveStatusChange}
        onActiveClearReady={onActiveClearReady}
        onActiveRestartReady={onActiveRestartReady}
      />
    </>
  )
}

/**
 * The per-pane settings row for the ACTIVE pane: the CLI picker + the cwd picker.
 * Editing here PATCHes back through the debounced save. Keyed by pane id by the
 * caller so switching panes resets the pickers' open state cleanly.
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

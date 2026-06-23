import { useCallback, useEffect, useReducer, type ComponentType } from 'react'
import {
  closeSession,
  emptySessions,
  expectsResume,
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
  type ViewMode,
} from './terminalSessions'
import { PaneGrid, type GridPane } from './PaneGrid'
import { PaneAwarenessChip } from './PaneAwarenessChip'
import { isAwareCli } from './usePaneState'
import type { DetectedCli } from './useTerminalClis'
import type { CliId } from './useTerminalClis'
import type { TerminalViewProps } from './TerminalView'
import type { TerminalStatus } from './terminalSocket'

/**
 * The SCRATCH controller: the ephemeral, per-device quick terminal modeled as a
 * local-only pseudo-workspace. It owns the EXISTING pure {@link ./terminalSessions}
 * reducer + localStorage layer (so Scratch behaves byte-for-byte like the prior
 * quick terminal: open/close/rename/restart, the tab/grid toggle + 12 cap, the
 * refresh-resume persistence, the server reconcile/recover, and the fresh-shell
 * `expectResume` notice), then feeds the unified {@link PaneGrid} a normalized
 * pane list with {@link sessionKey} wire ids.
 *
 * This is the same state machine that backed the old TerminalMultiView; only the
 * presentation is now the shared grid. Nothing about how a Scratch shell starts
 * (its `cli`, its deterministic-vs-ad-hoc id, its reattach key) changed.
 */

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
 * stable ids) so the server can REATTACH each, and when the server's tmux list
 * is known, it is the SOURCE OF TRUTH: dead entries are cleaned and forgotten
 * deck sessions are recovered as tabs ({@link reconcileSessions}). Then the
 * launcher's intent applies: an attach target opens its tab, recover-only adds
 * nothing, and otherwise a fresh session opens for the chosen preset when none
 * survived.
 */
function init({ initialCli, initialAttach, recoverOnly, serverSessions }: InitArgs): SessionsState {
  const persisted = readPersistedSessions()
  // Restored sessions are EXPECTED to reattach their previous shells, so mark them
  // so a ready frame without `resumed` can say honestly that the old shell ended
  // and this is a fresh one (a brand-new open never says that).
  let state = persisted ? markRestored(persisted) : emptySessions(readViewMode())
  if (serverSessions) state = reconcileSessions(state, serverSessions)
  if (initialAttach) return openAttachSession(state, initialAttach)
  if (recoverOnly || state.sessions.length > 0) return state
  return openSession(state, initialCli)
}

export interface ScratchPaneControllerProps {
  /** The preset chosen at the launcher for the FIRST terminal. */
  initialCli: CliId
  /** A FOREIGN tmux session chosen at the launcher: open an attach tab for it. */
  initialAttach?: string
  /** Enter WITHOUT opening a fresh shell: only restored/recovered sessions mount. */
  recoverOnly?: boolean
  /** The server's tmux session list (source of truth), fetched before this mounts. */
  serverSessions?: ServerTmuxSnapshot
  /** The detected CLIs, so the "+" preset menu only offers what is installed. */
  clis?: DetectedCli[]
  /** Inject the terminal view (tests) to bypass the real lazy xterm import. */
  viewComponent: ComponentType<TerminalViewProps>
  /** Report the ACTIVE session's live status up to the surface header. */
  onActiveStatusChange?: (status: TerminalStatus | null) => void
  /** Report the active session's engine `clear` handle up (null on teardown). */
  onActiveClearReady?: (clear: (() => void) | null) => void
  /** Report a Restart handle bound to the ACTIVE session (null = no session). */
  onActiveRestartReady?: (restart: (() => void) | null) => void
  /**
   * Report the current sessions (cli + cwd-less, since Scratch panes have no
   * per-pane cwd) up so the surface's Save action can build a workspace from them.
   * Fires whenever the session list changes.
   */
  onSessionsChange?: (sessions: SessionsState) => void
}

export function ScratchPaneController({
  initialCli,
  initialAttach,
  recoverOnly,
  serverSessions,
  clis,
  viewComponent,
  onActiveStatusChange,
  onActiveClearReady,
  onActiveRestartReady,
  onSessionsChange,
}: ScratchPaneControllerProps) {
  const [state, dispatch] = useReducer(
    reducer,
    { initialCli, initialAttach, recoverOnly, serverSessions },
    init,
  )

  // Persist the tab <-> grid layout so it survives a reload (seeded back in init).
  const viewMode = state.viewMode
  useEffect(() => {
    writeViewMode(viewMode)
  }, [viewMode])

  // Persist the OPEN sessions (ids/clis/titles/active) so a browser refresh
  // remounts the SAME sessions and the server reattaches each to its parked shell.
  useEffect(() => {
    writeSessions(state)
  }, [state])

  // Report the session list up for the Save action (kept in an effect so the
  // surface always sees the latest panes when the user hits Save).
  useEffect(() => {
    onSessionsChange?.(state)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const onAddPane = useCallback((cli: CliId) => dispatch({ type: 'open', cli }), [])
  const onRemovePane = useCallback((id: string) => dispatch({ type: 'close', id }), [])
  const onRenamePane = useCallback((id: string, label: string) => {
    dispatch({ type: 'rename', id, title: label })
  }, [])
  const onRestartPane = useCallback((id: string) => dispatch({ type: 'restart', id }), [])
  const onActivatePane = useCallback((id: string) => dispatch({ type: 'activate', id }), [])
  const onSetViewMode = useCallback((mode: ViewMode) => dispatch({ type: 'viewMode', mode }), [])

  // Normalize each session into a grid pane: the wire id folds id+epoch (the same
  // key the parked pty is keyed by) so refresh reattaches and a restart spawns a
  // fresh shell. The label is the session title; a foreign session carries attach.
  const panes: GridPane[] = state.sessions.map((s) => ({
    id: s.id,
    label: s.title,
    cli: s.cli,
    wireId: sessionKey(s),
    expectResume: expectsResume(s),
    ...(s.attach !== undefined ? { attach: s.attach } : {}),
  }))

  return (
    <PaneGrid
      panes={panes}
      activeId={state.activeId}
      viewMode={state.viewMode}
      clis={clis}
      viewComponent={viewComponent}
      tablistLabel="Panes"
      gridLabel="Pane grid"
      addLabel="New pane"
      addMenuLabel="New pane preset"
      capNoun="panes"
      onAddPane={onAddPane}
      onRemovePane={onRemovePane}
      onRenamePane={onRenamePane}
      onRestartPane={onRestartPane}
      onActivatePane={onActivatePane}
      onSetViewMode={onSetViewMode}
      onActiveStatusChange={onActiveStatusChange}
      onActiveClearReady={onActiveClearReady}
      onActiveRestartReady={onActiveRestartReady}
      renderPaneAside={(pane) =>
        isAwareCli(pane.cli) ? <PaneAwarenessChip cli={pane.cli} cwd={pane.cwd} /> : null
      }
    />
  )
}

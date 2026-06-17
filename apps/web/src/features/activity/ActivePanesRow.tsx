import { TerminalSquare } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ActivePane } from '@agent-deck/protocol'
import { useActivePanes } from './useActivePanes'

/**
 * The Home band's terminal section: agent panes (Claude Code / Codex) running in
 * saved workspaces, with their live run state read from each CLI's own transcript.
 * Renders NOTHING when no agent pane has locatable activity (honest — never a fake
 * "0 panes" row). A working pane gets the pulsing live dot; the rest read "idle".
 * Each links to its workspace.
 */
export function ActivePanesRow({ enabled = true }: { enabled?: boolean }) {
  const { data } = useActivePanes(enabled)
  const panes = data?.panes ?? []
  if (panes.length === 0) return null

  return (
    <div className="space-y-1.5" data-testid="active-panes">
      <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <TerminalSquare className="size-3.5 text-foreground-tertiary" aria-hidden />
        <span className="tabular-nums text-foreground" data-testid="active-panes-count">
          {panes.length}
        </span>
        {panes.length === 1 ? 'agent pane' : 'agent panes'}
        {data && data.workingCount > 0 ? (
          <>
            <span aria-hidden className="text-foreground-tertiary">
              ·
            </span>
            <span className="text-foreground" data-testid="active-panes-working">
              {data.workingCount} working
            </span>
          </>
        ) : null}
      </div>
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {panes.map((pane) => (
          <PaneChip key={`${pane.workspaceId}:${pane.paneId}`} pane={pane} />
        ))}
      </ul>
    </div>
  )
}

function PaneChip({ pane }: { pane: ActivePane }) {
  const working = pane.runState === 'working'
  const file = pane.activeFile ? basename(pane.activeFile) : null
  return (
    <li>
      <Link
        to={`/workspaces/${encodeURIComponent(pane.workspaceId)}`}
        className="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
        title={`${pane.label} · ${pane.cli} · ${pane.runState}${pane.activeFile ? ` · ${pane.activeFile}` : ''}`}
      >
        <span
          aria-hidden
          className={`size-1.5 shrink-0 rounded-full ${
            working ? 'bg-primary motion-safe:animate-pulse' : 'bg-foreground-tertiary'
          }`}
        />
        <span className="text-foreground">{pane.label}</span>
        {file ? (
          <span className="min-w-0 truncate font-mono text-foreground-tertiary">{file}</span>
        ) : null}
      </Link>
    </li>
  )
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const i = trimmed.lastIndexOf('/')
  return i >= 0 ? trimmed.slice(i + 1) : trimmed
}

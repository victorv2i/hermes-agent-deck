import { usePaneState } from './usePaneState'
import type { CliId } from './useTerminalClis'

/**
 * The pane header's awareness chip: what the agent CLI in this pane is doing right
 * now — its run state, the file it's touching, and its last tool call — read from
 * the CLI's own session transcript (see {@link usePaneState}). Self-fetching leaf
 * so the presentational PaneGrid stays decoupled from the network; renders NOTHING
 * until there's a real transcript to report (no fabricated activity).
 */
export function PaneAwarenessChip({
  cli,
  cwd,
}: {
  cli: CliId | undefined
  cwd: string | undefined
}) {
  const state = usePaneState(cli, cwd)
  if (!state || state.runState === 'unknown') return null

  const working = state.runState === 'working'
  const file = state.activeFile ? basename(state.activeFile) : null

  return (
    <span
      className="flex min-w-0 items-center gap-1.5 text-[11px] text-foreground-tertiary"
      title={awarenessTitle(state.runState, state.activeFile, state.lastTool)}
    >
      <span
        aria-hidden
        className={`size-1.5 shrink-0 rounded-full ${
          working ? 'bg-primary motion-safe:animate-pulse' : 'bg-foreground-tertiary'
        }`}
      />
      <span className="shrink-0">{working ? 'working' : 'idle'}</span>
      {state.lastTool ? (
        <span className="shrink-0 rounded-sm bg-muted px-1 py-px font-mono text-[10px] text-foreground-tertiary">
          {state.lastTool}
        </span>
      ) : null}
      {file ? (
        <span className="min-w-0 truncate font-mono text-foreground-tertiary">{file}</span>
      ) : null}
    </span>
  )
}

/** The last path segment, for a compact header label. */
function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const i = trimmed.lastIndexOf('/')
  return i >= 0 ? trimmed.slice(i + 1) : trimmed
}

/** A descriptive hover title carrying the full file path + tool. */
function awarenessTitle(
  runState: string,
  activeFile: string | null,
  lastTool: string | null,
): string {
  const parts = [`Agent is ${runState}`]
  if (lastTool) parts.push(`last tool: ${lastTool}`)
  if (activeFile) parts.push(`file: ${activeFile}`)
  return parts.join(' · ')
}

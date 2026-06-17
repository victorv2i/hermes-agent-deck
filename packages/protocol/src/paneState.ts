import { z } from 'zod'
import { CliIdSchema } from './workspace'

/**
 * Terminal pane runtime awareness — a SLIM, honest snapshot of what an agent CLI
 * running in a workspace pane is doing right now, read from that CLI's OWN session
 * transcript on disk (not by scraping the TUI byte stream). The deck runs on the
 * same machine, so it can read `~/.claude/projects/<cwd>/<session>.jsonl` (Claude
 * Code) or `~/.codex/sessions/.../*.jsonl` (Codex) and surface the run state +
 * last file + last tool in the pane header.
 *
 * Everything is best-effort and nullable: when no transcript can be located (the
 * pane just started, an unknown cwd, a CLI with no readable session log) the state
 * is honestly `unknown` with null fields — never a fabricated activity.
 */

/**
 * The pane's coarse run state, inferred from the transcript:
 *  - `working`        → the transcript was written within the freshness window
 *                       (the agent is actively producing output right now).
 *  - `idle`           → a transcript exists but has been quiet past the window.
 *  - `unknown`        → no transcript could be located for this pane.
 * We deliberately do NOT infer an `awaiting-approval` state: a CLI's approval gate
 * is not reliably present in its transcript, and guessing it would be a lie.
 */
export const PaneRunState = z.enum(['working', 'idle', 'unknown'])
export type PaneRunState = z.infer<typeof PaneRunState>

export const PaneRuntimeState = z.object({
  /** The CLI this pane runs (echoed back; the reader is CLI-specific). */
  cli: CliIdSchema,
  /** Coarse run state inferred from transcript freshness. */
  runState: PaneRunState,
  /** The file the agent most recently read/edited/wrote (full path), or null. */
  activeFile: z.string().nullable(),
  /** The agent's most recent tool call name (e.g. "Bash", "Edit"), or null. */
  lastTool: z.string().nullable(),
  /** The resolved session id of the transcript read, or null. */
  sessionId: z.string().nullable(),
  /** ISO-8601 timestamp of the transcript's last activity, or null. */
  updatedAt: z.string().nullable(),
})
export type PaneRuntimeState = z.infer<typeof PaneRuntimeState>

/** The honest empty snapshot: no transcript located for this pane. */
export function unknownPaneState(cli: PaneRuntimeState['cli']): PaneRuntimeState {
  return {
    cli,
    runState: 'unknown',
    activeFile: null,
    lastTool: null,
    sessionId: null,
    updatedAt: null,
  }
}

/**
 * One saved-workspace agent pane with a KNOWN runtime state (a transcript was
 * located) — for the Home "Active recently" band's terminal section. Panes whose
 * transcript can't be located (`unknown`) are omitted, so the band only ever
 * shows real activity.
 */
export const ActivePane = PaneRuntimeState.extend({
  /** The workspace this pane belongs to. */
  workspaceId: z.string(),
  workspaceName: z.string(),
  /** The pane id + its human label within the workspace. */
  paneId: z.string(),
  label: z.string(),
})
export type ActivePane = z.infer<typeof ActivePane>

/** Aggregate of agent panes across saved workspaces with a known runtime state. */
export const ActivePanesResponse = z.object({
  panes: z.array(ActivePane),
  /** How many of them are actively working right now. */
  workingCount: z.number().int().min(0),
})
export type ActivePanesResponse = z.infer<typeof ActivePanesResponse>

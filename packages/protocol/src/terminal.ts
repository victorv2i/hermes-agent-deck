import { z } from 'zod'

/**
 * One tmux-backed terminal session visible to the deck, as reported by
 * `GET /api/agent-deck/terminal/sessions`.
 *
 * `deckOwned` marks sessions the deck created (the `adk_` namespace): these can
 * be resumed by their stable id and killed from the UI. Anything else is a
 * FOREIGN session the user made in their own tmux — attachable, never killable
 * from the deck. `persistent` is true for every tmux-backed session (the shell
 * lives in the tmux server and survives deck restarts and disconnects).
 */
export const TerminalTmuxSession = z.object({
  name: z.string(),
  deckOwned: z.boolean(),
  /** How many tmux clients are attached right now (0 = detached, running). */
  attachedCount: z.number().int().min(0),
  /** Session creation time in epoch SECONDS (tmux's #{session_created}). */
  createdEpoch: z.number().int().min(0),
  persistent: z.boolean(),
})
export type TerminalTmuxSession = z.infer<typeof TerminalTmuxSession>

/**
 * Response of `GET /api/agent-deck/terminal/sessions`. When tmux is not
 * installed (or disabled via AGENT_DECK_DISABLE_TMUX=1) `tmuxAvailable` is
 * false and the list is honestly empty — terminals still work, they just fall
 * back to the in-process park/reattach layer.
 */
export const TerminalSessionsResponse = z.object({
  tmuxAvailable: z.boolean(),
  sessions: z.array(TerminalTmuxSession),
})
export type TerminalSessionsResponse = z.infer<typeof TerminalSessionsResponse>

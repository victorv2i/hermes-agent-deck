import { z } from 'zod'

/**
 * Multi-runtime adapters — the contract that lets Agentdeck present more than one
 * agent runtime (Hermes, Claude Code, Codex) through one surface.
 *
 * HONEST capability model: Claude Code and Codex, when run in a TERMINAL pane,
 * are interactive TUIs. The deck (co-located on disk) can READ their session
 * transcripts — so it can list sessions and tally token usage — but it CANNOT
 * inject a message or forward an approval into a running TUI. Those adapters are
 * therefore READ-ONLY ({chat:false, approvals:false, usage:true, sessions:true}).
 * Hermes, driven through its gateway BFF, is fully capable. The UI renders ONLY
 * what an adapter's capability flags report, so a read-only runtime never shows a
 * dead "send" affordance.
 */

/** The runtimes the deck can surface. */
export const RuntimeId = z.enum(['hermes', 'claude', 'codex'])
export type RuntimeId = z.infer<typeof RuntimeId>

/** What an adapter can actually do — the UI gates affordances on these. */
export const RuntimeCapabilities = z.object({
  /** Can start/stream a chat turn (Hermes only today). */
  chat: z.boolean(),
  /** Can forward an approval decision to the runtime (Hermes only today). */
  approvals: z.boolean(),
  /** Can report token usage / cost. */
  usage: z.boolean(),
  /** Can list past sessions. */
  sessions: z.boolean(),
})
export type RuntimeCapabilities = z.infer<typeof RuntimeCapabilities>

/** A single past session, normalized across runtimes. Timestamps are epoch ms. */
export const RuntimeSession = z.object({
  runtime: RuntimeId,
  id: z.string(),
  title: z.string().nullable(),
  model: z.string().nullable(),
  startedAt: z.number().nullable(),
  lastActive: z.number().nullable(),
  messageCount: z.number().int().min(0),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  /** Working directory for terminal runtimes (Claude Code / Codex); null for Hermes. */
  cwd: z.string().nullable(),
})
export type RuntimeSession = z.infer<typeof RuntimeSession>

/** Per-runtime rollup for the source filter (counts + whether it's reachable). */
export const RuntimeSource = z.object({
  runtime: RuntimeId,
  capabilities: RuntimeCapabilities,
  /** Sessions this runtime contributed to the merged list. */
  sessionCount: z.number().int().min(0),
  /** False when the runtime's data could not be read (honest empty, not an error). */
  available: z.boolean(),
})
export type RuntimeSource = z.infer<typeof RuntimeSource>

/** Response of `GET /api/agent-deck/runtimes/sessions` — the unified history. */
export const UnifiedSessionsResponse = z.object({
  /** All sessions across runtimes, newest-active first. */
  sessions: z.array(RuntimeSession),
  /** Per-runtime rollup (for the All/Hermes/Claude Code/Codex source filter). */
  sources: z.array(RuntimeSource),
})
export type UnifiedSessionsResponse = z.infer<typeof UnifiedSessionsResponse>

/** Token usage rollup for one runtime (the unified usage page). */
export const RuntimeUsage = z.object({
  runtime: RuntimeId,
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  /** Sessions counted into this rollup. */
  sessionCount: z.number().int().min(0),
})
export type RuntimeUsage = z.infer<typeof RuntimeUsage>

/**
 * The adapter contract. `id` + `capabilities` are always present; the methods an
 * adapter exposes are gated by its capabilities (a read-only runtime implements
 * `listSessions`/`getUsage` and leaves the write methods undefined). This is a
 * TypeScript interface (behavior), distinct from the zod DTOs above (wire shapes).
 */
export interface RuntimeAdapter {
  readonly id: RuntimeId
  readonly capabilities: RuntimeCapabilities
  /** List past sessions (when `capabilities.sessions`). */
  listSessions(limit?: number): Promise<RuntimeSession[]>
  /** Token-usage rollup (when `capabilities.usage`). */
  getUsage?(): Promise<RuntimeUsage>
}

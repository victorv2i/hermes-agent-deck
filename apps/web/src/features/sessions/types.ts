/**
 * Feature-local TS types for the Sessions surface — the web mirror of the BFF
 * wire shapes (apps/server/src/sessions/sessionTypes.ts). Kept local (not in
 * packages/protocol) so this surface ships independently in the parallel build.
 * Timestamps are unix seconds (state.db native).
 */

export interface SessionSummary {
  id: string
  source: string
  model: string | null
  title: string | null
  preview: string
  started_at: number
  last_active: number
  message_count: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number | null
  is_active: boolean
  /**
   * Per-session lifecycle signal mirrored from the server SessionSummary
   * (apps/server/src/sessions/sessionTypes.ts). The wire mapper always projects
   * these (nullable strings); they are OPTIONAL here so existing fixtures that
   * predate them keep compiling — a missing field reads as "normal" exactly like
   * an explicit null.
   */
  /** Lifecycle status (e.g. running/completed/failed), if the row carried one. */
  status?: string | null
  /** Why the session ended (e.g. completed/cancelled/error), if known. */
  end_reason?: string | null
  /** Handoff lifecycle marker for delegated/sub-agent sessions, if any. */
  handoff_state?: string | null
}

export interface SessionListResponse {
  sessions: SessionSummary[]
  total: number
}

/** The header detail for the opened session view. `status` / `end_reason` /
 * `handoff_state` are inherited from {@link SessionSummary}. */
export interface SessionDetail extends SessionSummary {
  ended_at: number | null
  tool_call_count: number
}

export interface SessionMessage {
  id: string
  role: string
  content: string
  timestamp: number | null
  reasoning: string | null
  tool_name: string | null
  tool_calls: string[]
}

export interface SessionMessagesResponse {
  session_id: string
  messages: SessionMessage[]
}

export interface SessionSearchResult {
  id: string
  snippet: string
  role: string | null
  source: string | null
  model: string | null
  started_at: number | null
}

export interface SessionSearchResponse {
  results: SessionSearchResult[]
}

/** Session store statistics from GET /api/agent-deck/sessions/stats. */
export interface SessionStats {
  total: number
  active_store: number
  archived: number
  messages: number
  by_source: Record<string, number>
}

/** Request body for PATCH /api/agent-deck/sessions/:id (rename / archive). */
export interface SessionPatchRequest {
  title?: string
  archived?: boolean
}

/** Response from PATCH /api/agent-deck/sessions/:id. */
export interface SessionPatchResponse {
  ok: boolean
  title: string
  archived?: boolean
}

/** Request body for POST /api/agent-deck/sessions/prune. */
export interface SessionPruneRequest {
  older_than_days: number
  source?: string
}

/** Response from POST /api/agent-deck/sessions/prune. */
export interface SessionPruneResponse {
  ok: boolean
  removed: number
}

/** The JSON payload returned by GET /api/agent-deck/sessions/:id/export. */
export interface SessionExportPayload {
  id: string
  title?: string | null
  messages?: unknown[]
  [key: string]: unknown
}

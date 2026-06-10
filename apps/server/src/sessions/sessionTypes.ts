/**
 * Feature-local wire types for the agent-deck Sessions BFF. These mirror the
 * confirmed hermes dashboard payloads (state.db `sessions` / `messages` columns,
 * see the stock Hermes dashboard contract) projected into a stable shape
 * the web client consumes. Kept feature-local (plain TS — the server package
 * does not depend on zod) so this surface ships independently in the parallel
 * build; validation lives in the pure mappers (sessionMappers.ts).
 *
 * Dashboard source of truth (read-only):
 *  - GET /api/sessions            → { sessions: rich_row[], total, limit, offset }
 *  - GET /api/sessions/{id}       → a single `sessions` table row
 *  - GET /api/sessions/{id}/messages → { session_id, messages: messages_row[] }
 *  - GET /api/sessions/search?q=  → { results: [{ session_id, snippet, … }] }
 */

/** A row in the session rail list. */
export interface SessionSummary {
  id: string
  source: string
  model: string | null
  title: string | null
  /** First-user-message preview (already truncated by the dashboard). */
  preview: string
  started_at: number
  last_active: number
  message_count: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number | null
  /** True when the session ran in the last ~5 minutes (dashboard-computed). */
  is_active: boolean
  /** Lifecycle status (e.g. running/completed/failed), if the row carried one. */
  status: string | null
  /** Why the session ended (e.g. completed/cancelled/error), if known. */
  end_reason: string | null
  /** Handoff lifecycle marker for delegated/sub-agent sessions, if any. */
  handoff_state: string | null
}

export interface SessionListResponse {
  sessions: SessionSummary[]
  total: number
}

/** The header detail for the opened session view. `end_reason` is inherited
 * from {@link SessionSummary}. */
export interface SessionDetail extends SessionSummary {
  ended_at: number | null
  tool_call_count: number
}

/** One persisted transcript message (state.db `messages` row, projected). */
export interface SessionMessage {
  id: string
  role: string
  content: string
  timestamp: number | null
  /** Reasoning summary text, if the row carried any. */
  reasoning: string | null
  /** Tool name on a `tool` (result) row. */
  tool_name: string | null
  /** Tool names invoked by an assistant turn (if any). */
  tool_calls: string[]
}

export interface SessionMessagesResponse {
  session_id: string
  messages: SessionMessage[]
}

/** A full-text search hit (grouped to one row per session by the dashboard). */
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

/** Session store statistics (mirrors `GET /api/sessions/stats`). */
export interface SessionStats {
  total: number
  active_store: number
  archived: number
  messages: number
  by_source: Record<string, number>
}

/** Request body for rename/archive PATCH (mirrors `PATCH /api/sessions/{id}`). */
export interface SessionPatchRequest {
  title?: string
  archived?: boolean
}

/** Response from PATCH (rename/archive); returns the settled title + archived flag. */
export interface SessionPatchResponse {
  ok: boolean
  title: string
  archived?: boolean
}

/** Prune request body (mirrors `POST /api/sessions/prune`). */
export interface SessionPruneRequest {
  older_than_days: number
  source?: string
}

/** Prune response. */
export interface SessionPruneResponse {
  ok: boolean
  removed: number
}

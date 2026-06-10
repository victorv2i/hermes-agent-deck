import { z } from 'zod'

// Shape refined in M2 after the spike captures the real state.db columns.
export const SessionSummary = z.object({
  id: z.string(),
  source: z.string(),
  model: z.string().nullable(),
  title: z.string().nullable(),
  started_at: z.number(),
  last_active: z.number().nullable(),
  message_count: z.number(),
  input_tokens: z.number(),
  output_tokens: z.number(),
})
export type SessionSummary = z.infer<typeof SessionSummary>

/**
 * Session store statistics returned by GET /api/sessions/stats
 * (web_server.py:3916). Surfaced by the BFF at GET /api/agent-deck/sessions/stats.
 */
export const SessionStats = z.object({
  total: z.number(),
  active_store: z.number(),
  archived: z.number(),
  messages: z.number(),
  by_source: z.record(z.string(), z.number()),
})
export type SessionStats = z.infer<typeof SessionStats>

/**
 * Request body for PATCH /api/sessions/{id} (rename + archive).
 * Both fields are optional; at least one must be provided.
 */
export const SessionPatchRequest = z.object({
  title: z.string().optional(),
  archived: z.boolean().optional(),
})
export type SessionPatchRequest = z.infer<typeof SessionPatchRequest>

/**
 * Response from PATCH /api/sessions/{id}.
 */
export const SessionPatchResponse = z.object({
  ok: z.boolean(),
  title: z.string(),
  archived: z.boolean().optional(),
})
export type SessionPatchResponse = z.infer<typeof SessionPatchResponse>

/**
 * Request body for POST /api/sessions/prune (web_server.py:4063).
 */
export const SessionPruneRequest = z.object({
  older_than_days: z.number().int().min(1),
  source: z.string().optional(),
})
export type SessionPruneRequest = z.infer<typeof SessionPruneRequest>

/**
 * Response from POST /api/sessions/prune.
 */
export const SessionPruneResponse = z.object({
  ok: z.boolean(),
  removed: z.number(),
})
export type SessionPruneResponse = z.infer<typeof SessionPruneResponse>

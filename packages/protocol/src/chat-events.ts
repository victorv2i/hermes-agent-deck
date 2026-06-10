import { z } from 'zod'

/**
 * Chat-run wire contract for the hermes gateway `:8643` `/v1/runs` transport.
 *
 * Authoritative source: docs/specs/2026-05-29-gateway-v1-runs-contract.md
 * (read from the live install + confirmed with a throwaway run).
 *
 * Wire facts encoded here:
 * - Every raw gateway SSE frame carries `event`, `run_id`, and `timestamp`.
 *   It does NOT carry `session_id` or a `cursor` — the agent-deck BFF adds
 *   `session_id` (known from the originating RunCommand) and a numeric `cursor`
 *   (for durable replay-then-tail). Both are therefore optional on these schemas.
 * - The gateway's consume-once SSE stream emits, on `/v1/runs/{id}/events`:
 *   message.delta, reasoning.available, tool.started, tool.completed,
 *   approval.request, approval.responded, run.completed, run.failed, run.cancelled.
 * - run.started / message.started / run.stopping are synthesized onto the durable
 *   `/chat-run` surface by the BFF (run.started on the POST 202, run.stopping on
 *   POST /stop). tool.progress / tool.failed mirror the session-stream vocabulary.
 *   They are included in the union so the client has one uniform event set.
 * - run.heartbeat is synthesized by the BFF from the gateway's SSE comment
 *   keepalives (sent ~every 30s on an active stream). It is a TRANSIENT liveness
 *   signal: never buffered/cursored into the replay log, never part of the
 *   transcript. It lets the client honestly tell "still alive, just quiet"
 *   (a long-thinking agent) from "no signal at all".
 */

// Fields the BFF stamps onto every event delivered over the durable `/chat-run`
// surface. `run_id` is present on every raw gateway frame; `session_id` and the
// numeric `cursor` are BFF-added (hence optional — raw gateway frames lack them).
const envelope = {
  run_id: z.string(),
  session_id: z.string().optional(),
  timestamp: z.number().optional(),
  /** Monotonic replay cursor assigned by the BFF. Absent on raw gateway frames. */
  cursor: z.number().optional(),
}

export const APPROVAL_CHOICES = ['once', 'session', 'always', 'deny'] as const
export const ApprovalChoice = z.enum(APPROVAL_CHOICES)
export type ApprovalChoice = z.infer<typeof ApprovalChoice>

export const TokenUsage = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  total_tokens: z.number(),
})
export type TokenUsage = z.infer<typeof TokenUsage>

export const ChatServerEvent = z.discriminatedUnion('event', [
  // --- run lifecycle ------------------------------------------------------
  // run.started is synthesized by the BFF from the POST /v1/runs 202 response.
  z.object({
    event: z.literal('run.started'),
    ...envelope,
    model: z.string().optional(),
    input: z.string().optional(),
  }),
  // message.started is synthesized by the BFF when the assistant message opens.
  z.object({
    event: z.literal('message.started'),
    ...envelope,
    message_id: z.string().optional(),
    role: z.literal('assistant').optional(),
  }),
  z.object({
    event: z.literal('message.delta'),
    ...envelope,
    delta: z.string(),
  }),
  z.object({
    event: z.literal('reasoning.available'),
    ...envelope,
    text: z.string(),
  }),

  // --- tools --------------------------------------------------------------
  z.object({
    event: z.literal('tool.started'),
    ...envelope,
    tool: z.string(),
    preview: z.string().nullable().optional(),
  }),
  z.object({
    event: z.literal('tool.progress'),
    ...envelope,
    tool: z.string(),
    delta: z.string().optional(),
    preview: z.string().nullable().optional(),
  }),
  z.object({
    event: z.literal('tool.completed'),
    ...envelope,
    tool: z.string(),
    duration: z.number().optional(),
    error: z.boolean().optional(),
  }),
  z.object({
    event: z.literal('tool.failed'),
    ...envelope,
    tool: z.string(),
    error: z.string().optional(),
  }),

  // --- approvals ----------------------------------------------------------
  z.object({
    event: z.literal('approval.request'),
    ...envelope,
    /** BFF-assigned id to correlate the response when a run has multiple approvals. */
    approval_id: z.string().optional(),
    command: z.string(),
    description: z.string(),
    pattern_key: z.string().optional(),
    pattern_keys: z.array(z.string()).optional(),
    choices: z.array(ApprovalChoice),
  }),
  z.object({
    event: z.literal('approval.responded'),
    ...envelope,
    approval_id: z.string().optional(),
    choice: ApprovalChoice,
    resolved: z.number().optional(),
  }),

  // --- terminal -----------------------------------------------------------
  z.object({
    event: z.literal('run.completed'),
    ...envelope,
    output: z.string().nullable().optional(),
    usage: TokenUsage.optional(),
  }),
  z.object({
    event: z.literal('run.failed'),
    ...envelope,
    error: z.string(),
  }),
  z.object({
    event: z.literal('run.cancelled'),
    ...envelope,
  }),
  // run.stopping is synthesized by the BFF from the POST /stop response status.
  z.object({
    event: z.literal('run.stopping'),
    ...envelope,
  }),
  // run.heartbeat is synthesized by the BFF from a gateway SSE keepalive comment.
  // Transient liveness only: cursor-less, never buffered into the replay log.
  z.object({
    event: z.literal('run.heartbeat'),
    ...envelope,
  }),
])
export type ChatServerEvent = z.infer<typeof ChatServerEvent>

// ---------------------------------------------------------------------------
// Client → BFF commands (the durable `/chat-run` Socket.IO surface).
// ---------------------------------------------------------------------------

/**
 * One image attachment carried on a run. Stock hermes routes vision NATIVELY:
 * the gateway `/v1/runs` accepts a multimodal `input` whose content parts may be
 * `{ type: 'image_url', image_url: { url: 'data:image/...;base64,...' } }`
 * (`gateway/platforms/api_server.py` `_normalize_multimodal_content`). There is
 * NO upload endpoint — the image rides inline as a base64 data URL.
 *
 * IMAGE ONLY by design: the gateway rejects `file`/`input_file` parts with
 * `unsupported_content_type`, so we never pretend to carry arbitrary documents.
 * `data_url` must be a `data:image/...` URL for the same reason (an http(s) URL
 * is allowed by the gateway but the composer only produces inline data URLs).
 */
/**
 * Safe image MIME types we accept in a RunAttachment. `image/svg+xml` is
 * intentionally excluded: SVG can embed inline scripts and event handlers, making
 * it an XSS vector if the browser ever renders it in a privileged context. We
 * accept only raster formats whose rendering path has no script execution surface.
 */
const SAFE_IMAGE_MIME_RE = /^data:image\/(png|jpeg|gif|webp|avif|bmp|tiff);/i

export const RunAttachment = z.object({
  kind: z.literal('image'),
  /** Original filename, for the transcript chip / accessibility label. */
  name: z.string(),
  /** The image MIME, e.g. `image/png`. */
  mime: z.string(),
  /**
   * The inline `data:image/...;base64,...` URL the gateway carries as-is.
   * Must be a safe raster type — SVG is rejected (XSS vector).
   */
  data_url: z
    .string()
    .regex(/^data:image\//, 'attachment data_url must be a data:image/... URL')
    .refine((v) => SAFE_IMAGE_MIME_RE.test(v), 'SVG data URLs are not allowed (XSS risk)'),
})
export type RunAttachment = z.infer<typeof RunAttachment>

/** Start a new run. Maps to POST /v1/runs. */
export const RunCommand = z.object({
  input: z.string(),
  model: z.string().optional(),
  session_id: z.string().optional(),
  /**
   * Image attachments to carry on this turn (paste / attach / drag-drop). When
   * present, the BFF builds the gateway's multimodal `input` array — text part
   * plus one `image_url` part per attachment. Omitted/empty → the plain string
   * input is sent exactly as before.
   */
  attachments: z.array(RunAttachment).optional(),
})
export type RunCommand = z.infer<typeof RunCommand>

/** Replay-then-tail an existing run after a reconnect. */
export const ResumeCommand = z.object({
  run_id: z.string(),
  after_cursor: z.number().optional(),
})
export type ResumeCommand = z.infer<typeof ResumeCommand>

/** Stop a run. Maps to POST /v1/runs/{run_id}/stop. */
export const AbortCommand = z.object({
  run_id: z.string(),
})
export type AbortCommand = z.infer<typeof AbortCommand>

/** Resolve a pending approval. Maps to POST /v1/runs/{run_id}/approval. */
export const ApprovalRespondCommand = z.object({
  run_id: z.string(),
  approval_id: z.string().optional(),
  choice: ApprovalChoice,
})
export type ApprovalRespondCommand = z.infer<typeof ApprovalRespondCommand>

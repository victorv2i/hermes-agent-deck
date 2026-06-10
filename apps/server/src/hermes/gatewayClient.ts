/**
 * Typed client for the hermes gateway `:8643` `/v1/runs` transport.
 *
 * Authoritative contract: docs/specs/2026-05-29-gateway-v1-runs-contract.md.
 * Every call carries `Authorization: Bearer <API_SERVER_KEY>`. The key is read
 * server-side from config and is NEVER logged, printed, or surfaced to the client.
 */
import type { ApprovalChoice, RunAttachment } from '@agent-deck/protocol'

export interface GatewayClientConfig {
  /** Base URL of the gateway, e.g. http://127.0.0.1:8643 */
  hermesGatewayUrl: string
  /** Gateway bearer key. Read server-side only. */
  hermesApiKey: string | null
  /** Timeout (ms) for unary calls (startRun/respondApproval/stopRun). The SSE
   * stream is long-lived and intentionally NOT bounded by this. Default 15s. */
  requestTimeoutMs?: number
}

/** Default timeout for the short request/response gateway calls. */
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000

/** Max bytes parseSse will buffer before a frame boundary, guarding against an
 * unbounded buffer from a pathological/never-terminated stream. */
const DEFAULT_MAX_SSE_BUFFER_BYTES = 8 * 1024 * 1024

export interface StartRunArgs {
  input: string
  model?: string
  sessionId?: string
  /** Image attachments to carry on this turn. When present, the run `input` is
   * sent as the gateway's native multimodal array (text + image_url parts);
   * otherwise it stays the plain string. See {@link RunAttachment}. */
  attachments?: RunAttachment[]
}

/** One OpenAI-style content part the gateway's `_normalize_multimodal_content`
 * accepts: a text part or an inline `image_url` part. */
type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

/**
 * Build the gateway `/v1/runs` `input` field. With no image attachments this is
 * the plain string (byte-identical to before). With attachments it is the stock
 * multimodal shape: a single `user` message whose `content` is a parts array —
 * the text part followed by one `image_url` part per image (data:image/... URL).
 * The gateway carries these natively (vision routing per the active model's
 * capability); `file`/document parts are intentionally never produced.
 */
function buildRunInput(text: string, attachments: RunAttachment[] | undefined): unknown {
  if (!attachments || attachments.length === 0) return text
  const content: ContentPart[] = [{ type: 'text', text }]
  for (const att of attachments) {
    content.push({ type: 'image_url', image_url: { url: att.data_url } })
  }
  return [{ role: 'user', content }]
}

/**
 * Structural surface the `/chat-run` handler depends on. The real
 * {@link GatewayClient} satisfies it; an in-process mock (test-support, injected
 * via `attachChat`'s gateway arg by the hermetic e2e launcher) can stand in for
 * it without touching the live gateway.
 */
export interface GatewayClientLike {
  startRun(args: StartRunArgs): Promise<{ runId: string }>
  /** Stream a run's SSE. `onHeartbeat` (optional) fires on every keepalive so a
   * caller can treat a keepalive-only stream (a long-thinking agent) as alive. */
  streamRun(
    runId: string,
    signal?: AbortSignal,
    onHeartbeat?: () => void,
  ): AsyncGenerator<GatewayEvent, void, unknown>
  respondApproval(
    runId: string,
    approvalId: string | undefined,
    choice: ApprovalChoice,
  ): Promise<void>
  stopRun(runId: string): Promise<void>
  /** Read a run's durable hermes `session_id` via GET /v1/runs/{id}. A NEW chat
   * starts session-less; the gateway derives/creates the session and exposes its
   * id here (set synchronously at queue time, so this is reliable right after
   * startRun). Returns `{ sessionId: null }` if unknown/unavailable — best-effort,
   * a run is never blocked on it. */
  getRunSession(runId: string): Promise<{ sessionId: string | null }>
}

/** A parsed gateway SSE event. The `event` field is the discriminator; other
 * fields vary by event type (see the contract). Raw frames carry `event`,
 * `run_id`, and `timestamp`; everything else is event-specific. */
export interface GatewayEvent {
  event: string
  run_id?: string
  timestamp?: number
  [key: string]: unknown
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'GatewayError'
  }
}

/**
 * Parse a stream of UTF-8 SSE chunks into structured gateway events.
 *
 * Robustness rules (per the contract framing):
 * - Frames are separated by a blank line; each `data:` line contributes to the
 *   frame's payload. Multiple `data:` lines in one frame are joined with `\n`.
 * - Lines beginning with `:` are comments (keepalives, `: stream closed`) and
 *   are never yielded as events. They DO, however, fire the optional
 *   `onHeartbeat` callback — the only signal of liveness on a stream that emits
 *   nothing but keepalives while a legitimately long-thinking agent works, so a
 *   reaper can tell "still alive, just quiet" from "the pump is wedged".
 * - Non-`data:` fields (`event:`, `id:`, `retry:`) are tolerated and ignored —
 *   the gateway encodes the event type inside the JSON payload, not the SSE
 *   `event:` field.
 * - A `data:` payload that is not valid JSON is skipped (defensive).
 * - Handles chunk boundaries that split a line or a frame.
 * - The internal line buffer is capped (`maxBufferBytes`); a stream that never
 *   produces a frame boundary throws a GatewayError instead of growing forever.
 */
export async function* parseSse(
  chunks: AsyncIterable<Uint8Array>,
  options: {
    maxBufferBytes?: number
    /** Fired for every SSE comment/keepalive line (`:`-prefixed). Lets a caller
     * treat keepalive-only activity as liveness without those lines polluting
     * the yielded event stream. */
    onHeartbeat?: () => void
  } = {},
): AsyncGenerator<GatewayEvent, void, unknown> {
  const maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_SSE_BUFFER_BYTES
  const onHeartbeat = options.onHeartbeat
  const decoder = new TextDecoder()
  let buffer = ''
  let dataLines: string[] = []

  function* flushFrame(): Generator<GatewayEvent> {
    if (dataLines.length === 0) return
    const payload = dataLines.join('\n')
    dataLines = []
    const trimmed = payload.trim()
    if (trimmed === '') return
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as GatewayEvent).event === 'string'
    ) {
      yield parsed as GatewayEvent
    }
  }

  function* consumeLine(line: string): Generator<GatewayEvent> {
    // SSE normalizes \r\n and \r to \n; strip a trailing \r defensively.
    const normalized = line.endsWith('\r') ? line.slice(0, -1) : line
    if (normalized === '') {
      // Blank line ends the current frame.
      yield* flushFrame()
      return
    }
    if (normalized.startsWith(':')) {
      // Comment / keepalive — never a data event, but a liveness signal.
      onHeartbeat?.()
      return
    }
    const colon = normalized.indexOf(':')
    const field = colon === -1 ? normalized : normalized.slice(0, colon)
    if (field !== 'data') return
    let value = colon === -1 ? '' : normalized.slice(colon + 1)
    // Per SSE spec, a single leading space after the colon is stripped.
    if (value.startsWith(' ')) value = value.slice(1)
    dataLines.push(value)
  }

  for await (const chunk of chunks) {
    buffer += decoder.decode(chunk, { stream: true })
    let newlineIndex: number
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex)
      buffer = buffer.slice(newlineIndex + 1)
      yield* consumeLine(line)
    }
    // No frame boundary in sight and the buffer is past the cap → bail out
    // instead of buffering an unbounded stream.
    if (buffer.length > maxBufferBytes) {
      throw new GatewayError('SSE buffer exceeded maximum size without a frame boundary')
    }
  }
  // Flush any trailing decoder state and a final unterminated line/frame.
  buffer += decoder.decode()
  if (buffer.length > 0) {
    yield* consumeLine(buffer)
  }
  yield* flushFrame()
}

export class GatewayClient {
  private readonly requestTimeoutMs: number

  constructor(private readonly config: GatewayClientConfig) {
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  }

  /** fetch() with a per-call abort timeout. A timeout/abort maps to a
   * GatewayError with a clear message that never includes the bearer key. */
  private async timedFetch(url: URL, init: RequestInit, label: string): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(this.requestTimeoutMs) })
    } catch (err) {
      if (
        err instanceof DOMException &&
        (err.name === 'TimeoutError' || err.name === 'AbortError')
      ) {
        throw new GatewayError(`${label} timed out after ${this.requestTimeoutMs}ms`)
      }
      throw new GatewayError(
        `${label} request failed: ${err instanceof Error ? err.message : 'network error'}`,
      )
    }
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra }
    if (this.config.hermesApiKey) {
      headers['Authorization'] = `Bearer ${this.config.hermesApiKey}`
    }
    return headers
  }

  private url(path: string): URL {
    return new URL(path, this.config.hermesGatewayUrl)
  }

  /** POST /v1/runs — start a run, returns its run_id. */
  async startRun(args: StartRunArgs): Promise<{ runId: string }> {
    const body: Record<string, unknown> = { input: buildRunInput(args.input, args.attachments) }
    if (args.model) body.model = args.model
    if (args.sessionId) body.session_id = args.sessionId

    const res = await this.timedFetch(
      this.url('/v1/runs'),
      {
        method: 'POST',
        headers: this.authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      },
      'startRun',
    )
    if (!res.ok) {
      throw new GatewayError(`startRun failed: HTTP ${res.status}`, res.status)
    }
    const json = (await res.json()) as { run_id?: unknown }
    if (typeof json.run_id !== 'string') {
      throw new GatewayError('startRun response missing run_id')
    }
    return { runId: json.run_id }
  }

  /** GET /v1/runs/{runId} — read the run's pollable status to learn the durable
   * hermes `session_id` the gateway assigned. Best-effort: any failure (non-2xx,
   * network, parse) resolves to `{ sessionId: null }` so a run never hangs on it. */
  async getRunSession(runId: string): Promise<{ sessionId: string | null }> {
    try {
      const res = await this.timedFetch(
        this.url(`/v1/runs/${encodeURIComponent(runId)}`),
        { method: 'GET', headers: this.authHeaders() },
        'getRunSession',
      )
      if (!res.ok) return { sessionId: null }
      const json = (await res.json()) as { session_id?: unknown }
      return { sessionId: typeof json.session_id === 'string' ? json.session_id : null }
    } catch {
      return { sessionId: null }
    }
  }

  /** GET /v1/runs/{runId}/events — async iterator of parsed gateway SSE events.
   * `onHeartbeat` (optional) fires on each keepalive so the caller can treat a
   * keepalive-only stream as alive. */
  async *streamRun(
    runId: string,
    signal?: AbortSignal,
    onHeartbeat?: () => void,
  ): AsyncGenerator<GatewayEvent, void, unknown> {
    const res = await fetch(this.url(`/v1/runs/${encodeURIComponent(runId)}/events`), {
      method: 'GET',
      headers: this.authHeaders({ Accept: 'text/event-stream' }),
      signal,
    })
    if (!res.ok || !res.body) {
      throw new GatewayError(`streamRun failed: HTTP ${res.status}`, res.status)
    }
    yield* parseSse(res.body as AsyncIterable<Uint8Array>, { onHeartbeat })
  }

  /** POST /v1/runs/{runId}/approval — resolve the run's pending approval. */
  async respondApproval(
    runId: string,
    _approvalId: string | undefined,
    choice: ApprovalChoice,
  ): Promise<void> {
    // The gateway wire has no per-approval id; the run id identifies the single
    // active approval. `_approvalId` is accepted for BFF/UI correlation only.
    const res = await this.timedFetch(
      this.url(`/v1/runs/${encodeURIComponent(runId)}/approval`),
      {
        method: 'POST',
        headers: this.authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ choice }),
      },
      'respondApproval',
    )
    if (!res.ok) {
      throw new GatewayError(`respondApproval failed: HTTP ${res.status}`, res.status)
    }
  }

  /** POST /v1/runs/{runId}/stop — interrupt a running agent. */
  async stopRun(runId: string): Promise<void> {
    const res = await this.timedFetch(
      this.url(`/v1/runs/${encodeURIComponent(runId)}/stop`),
      {
        method: 'POST',
        headers: this.authHeaders(),
      },
      'stopRun',
    )
    if (!res.ok) {
      throw new GatewayError(`stopRun failed: HTTP ${res.status}`, res.status)
    }
  }
}

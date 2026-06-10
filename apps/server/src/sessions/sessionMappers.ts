import type {
  SessionSummary,
  SessionDetail,
  SessionMessage,
  SessionSearchResult,
} from './sessionTypes'

/**
 * Pure mappers from raw hermes-dashboard payloads (loose `Record`s straight off
 * the wire) into the validated feature-local session shapes. Centralizing the
 * projection here keeps the dashboard's column quirks (nullable cost columns,
 * `last_active` fallbacks, varied tool-call encodings) out of the route layer
 * and unit-testable in isolation.
 */

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    throw new Error(`${label}: expected an object`)
  }
  return value as Record<string, unknown>
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function requireStr(value: unknown, field: string): string {
  const s = str(value)
  if (s === null) throw new Error(`session payload missing string field: ${field}`)
  return s
}

function intOr(value: unknown, fallback: number): number {
  return num(value) ?? fallback
}

/** Map a `list_sessions_rich` / single-session row to the rail summary shape. */
export function mapSessionSummary(raw: unknown): SessionSummary {
  const r = asRecord(raw, 'session summary')
  const startedAt = num(r.started_at)
  if (startedAt === null) throw new Error('session payload missing started_at')

  const inputTokens = intOr(r.input_tokens, 0)
  const outputTokens = intOr(r.output_tokens, 0)

  return {
    id: requireStr(r.id, 'id'),
    source: requireStr(r.source, 'source'),
    model: str(r.model),
    title: str(r.title),
    preview: str(r.preview) ?? '',
    started_at: startedAt,
    last_active: num(r.last_active) ?? startedAt,
    message_count: intOr(r.message_count, 0),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    cost_usd: pickCost(r),
    is_active: r.is_active === true,
    status: str(r.status),
    end_reason: str(r.end_reason),
    handoff_state: str(r.handoff_state),
  }
}

/** Map a full `sessions` row to the opened-session header detail shape. */
export function mapSessionDetail(raw: unknown): SessionDetail {
  const r = asRecord(raw, 'session detail')
  const summary = mapSessionSummary({
    ...r,
    // The detail row may omit the rich `last_active`; fall back to ended_at.
    last_active: num(r.last_active) ?? num(r.ended_at) ?? num(r.started_at),
  })
  return {
    ...summary,
    ended_at: num(r.ended_at),
    tool_call_count: intOr(r.tool_call_count, 0),
  }
}

/** Map a `messages` row to a transcript message. */
export function mapSessionMessage(raw: unknown): SessionMessage {
  const r = asRecord(raw, 'session message')
  return {
    id: String(r.id ?? ''),
    role: requireStr(r.role, 'role'),
    content: typeof r.content === 'string' ? r.content : '',
    timestamp: num(r.timestamp),
    reasoning: str(r.reasoning_content) ?? str(r.reasoning),
    tool_name: str(r.tool_name),
    tool_calls: extractToolCallNames(r.tool_calls),
  }
}

/** Map a search hit to the wire shape. */
export function mapSearchResult(raw: unknown): SessionSearchResult {
  const r = asRecord(raw, 'search result')
  return {
    id: requireStr(r.session_id, 'session_id'),
    snippet: typeof r.snippet === 'string' ? r.snippet : '',
    role: str(r.role),
    source: str(r.source),
    model: str(r.model),
    started_at: num(r.session_started),
  }
}

/** Prefer the actual (settled) cost, else the estimate, else null. */
function pickCost(r: Record<string, unknown>): number | null {
  return num(r.actual_cost_usd) ?? num(r.estimated_cost_usd)
}

/** Normalize the dashboard's varied `tool_calls` encodings to a name list.
 * Rows store JSON the dashboard already deserialized to an array; each entry may
 * be `{ function: { name } }` (OpenAI shape) or `{ name }`. Unknown shapes are
 * dropped rather than throwing. */
function extractToolCallNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const names: string[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const fn = e.function
    const fromFn = fn && typeof fn === 'object' ? str((fn as Record<string, unknown>).name) : null
    const name = fromFn ?? str(e.name)
    if (name) names.push(name)
  }
  return names
}

/**
 * Transcript import (Lane D) — the symmetric inverse of `export.ts`. It turns a
 * transcript that Agent Deck previously exported (JSON `{ session, messages }`,
 * or the readable Markdown role-block format) back into the in-memory
 * `SessionDetail` + `SessionMessage[]` so the History view can render it
 * READ-ONLY with the exact chat vocabulary.
 *
 * HONEST BOUNDARY: import is a LOCAL, client-side mirror of export. It NEVER
 * writes to hermes session storage and invents no endpoints — an imported
 * transcript is a read-only local view, nothing more. Parsing is total: it
 * validates with zod and returns a calm `{ ok: false, error }` for anything it
 * can't read, and NEVER throws.
 *
 * The JSON path round-trips faithfully (ids, timestamps, tokens all survive).
 * The Markdown path is best-effort by design: export drops system rows, ids and
 * timestamps, so we reconstruct what the readable document carries and assign
 * stable synthetic ids for rows the format didn't preserve.
 */
import type { SessionDetail, SessionMessage } from './types'

export type ParseResult =
  | { ok: true; session: SessionDetail | null; messages: SessionMessage[] }
  | { ok: false; error: string }

/**
 * Validation note: the web package can't resolve a direct `zod` import (it's
 * only a transitive dep of @agent-deck/protocol under strict pnpm isolation),
 * and the existing protocol `SessionSummary` schema is a partial early shape
 * that doesn't cover the export's local SessionDetail/SessionMessage. So we
 * validate the JSON shape with small TOTAL guards over the local `./types`
 * here — same contract as a schema (required `id`/`role`, defaulted optional
 * fields), no new dependency, and `parseTranscript` still never throws.
 */

/** Total guard: a record (non-null object that isn't an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate + normalize one JSON `messages[]` entry into a SessionMessage. Only
 * `id` and `role` are required (the export always emits the rest, but a
 * hand-edited doc may omit them); optional fields fall back to the canonical
 * empty shape so downstream code (transcriptToTurns) sees a uniform message.
 * Returns `null` for a row that fails the shape — the caller rejects the doc.
 */
function toMessage(value: unknown): SessionMessage | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || typeof value.role !== 'string') return null

  const content = typeof value.content === 'string' ? value.content : ''
  const timestamp = typeof value.timestamp === 'number' ? value.timestamp : null
  const reasoning = typeof value.reasoning === 'string' ? value.reasoning : null
  const tool_name = typeof value.tool_name === 'string' ? value.tool_name : null
  const tool_calls =
    Array.isArray(value.tool_calls) && value.tool_calls.every((t) => typeof t === 'string')
      ? (value.tool_calls as string[])
      : []

  return { id: value.id, role: value.role, content, timestamp, reasoning, tool_name, tool_calls }
}

/**
 * Parse an exported transcript (JSON or Markdown). Auto-detects the format,
 * validates, and returns a calm error for malformed input. Total — never throws.
 */
export function parseTranscript(input: string): ParseResult {
  const text = input.trim()
  if (text === '') {
    return { ok: false, error: 'Nothing to import. Paste a transcript or choose a file.' }
  }
  // JSON exports start with `{`; the Markdown export always starts with `# `.
  if (text.startsWith('{')) return parseJson(text)
  return parseMarkdown(text)
}

function parseJson(text: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: "That doesn't look like a valid JSON transcript." }
  }
  const malformed = {
    ok: false as const,
    error: "This JSON isn't a transcript Agent Deck can read (expected { session, messages }).",
  }
  if (!isRecord(raw) || !Array.isArray(raw.messages)) return malformed

  const messages: SessionMessage[] = []
  for (const entry of raw.messages) {
    const message = toMessage(entry)
    if (message === null) return malformed
    messages.push(message)
  }

  // `session` is informational (header banner only). A null/absent session is
  // valid; a present one is coerced best-effort. A non-record session is a sign
  // the doc is malformed.
  let session: SessionDetail | null = null
  if (raw.session != null) {
    if (!isRecord(raw.session)) return malformed
    session = coerceSession(raw.session)
  }

  return { ok: true, session, messages }
}

/**
 * Best-effort coercion of the imported session header into a SessionDetail.
 * Only fields used by the read-only banner need to be honest; the rest are
 * filled with neutral defaults (and never persisted). Numeric fields fall back
 * to 0 / null so a partial header still renders.
 */
function coerceSession(s: Record<string, unknown>): SessionDetail {
  const str = (k: string): string | null => (typeof s[k] === 'string' ? (s[k] as string) : null)
  const num = (k: string): number => (typeof s[k] === 'number' ? (s[k] as number) : 0)
  const numOrNull = (k: string): number | null =>
    typeof s[k] === 'number' ? (s[k] as number) : null
  return {
    id: str('id') ?? 'imported',
    source: str('source') ?? 'import',
    model: str('model'),
    title: str('title'),
    preview: str('preview') ?? '',
    started_at: num('started_at'),
    last_active: num('last_active'),
    message_count: num('message_count'),
    input_tokens: num('input_tokens'),
    output_tokens: num('output_tokens'),
    total_tokens: num('total_tokens'),
    cost_usd: numOrNull('cost_usd'),
    is_active: false,
    status: str('status'),
    end_reason: str('end_reason'),
    handoff_state: str('handoff_state'),
    ended_at: numOrNull('ended_at'),
    tool_call_count: num('tool_call_count'),
  }
}

/** Heading → canonical role, mirroring export.ts `roleLabel`. */
function roleFromHeading(heading: string): SessionMessage['role'] | null {
  switch (heading.trim().toLowerCase()) {
    case 'user':
      return 'user'
    case 'assistant':
      return 'assistant'
    case 'tool':
      return 'tool'
    default:
      return null
  }
}

/**
 * Parse the readable Markdown role-block format export.ts emits:
 *   # <title>
 *   **Model:** … · **Source:** … · **Messages:** …
 *   ## User|Assistant|Tool
 *   > _Thinking:_ <reasoning, blockquoted, possibly multi-line>
 *   <content paragraph(s)>
 *   `tool result · <name>`  |  `tool calls: a, b`
 */
function parseMarkdown(text: string): ParseResult {
  const lines = text.replace(/\r\n/g, '\n').split('\n')

  let title: string | null = null
  let model: string | null = null
  const blocks: { role: SessionMessage['role']; lines: string[] }[] = []
  let current: { role: SessionMessage['role']; lines: string[] } | null = null

  for (const line of lines) {
    const h1 = /^#\s+(.+)$/.exec(line)
    if (h1?.[1] !== undefined && title === null && current === null) {
      const t = h1[1].trim()
      title = t === 'Session transcript' ? null : t
      continue
    }
    const h2 = /^##\s+(.+)$/.exec(line)
    if (h2?.[1] !== undefined) {
      const role = roleFromHeading(h2[1])
      if (role) {
        current = { role, lines: [] }
        blocks.push(current)
        continue
      }
      // An unrecognized `##` heading inside a block is treated as content.
    }
    if (current === null) {
      // Pre-block lines: pick the model out of the meta line if present.
      const m = /\*\*Model:\*\*\s*([^·]+?)(?:\s{2}·|$)/.exec(line)
      if (m?.[1] !== undefined) model = m[1].trim()
      continue
    }
    current.lines.push(line)
  }

  if (blocks.length === 0) {
    return {
      ok: false,
      error: 'No transcript found: this Markdown has no role headings (## User / ## Assistant).',
    }
  }

  const messages = blocks.map((b, i) => blockToMessage(b, i))
  const session = title !== null || model !== null ? headerSession(title, model) : null
  return { ok: true, session, messages }
}

/** A minimal SessionDetail carrying only what the Markdown header preserved. */
function headerSession(title: string | null, model: string | null): SessionDetail {
  return {
    id: 'imported',
    source: 'import',
    model,
    title,
    preview: '',
    started_at: 0,
    last_active: 0,
    message_count: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    cost_usd: null,
    is_active: false,
    status: null,
    end_reason: null,
    handoff_state: null,
    ended_at: null,
    tool_call_count: 0,
  }
}

/** Reconstruct one SessionMessage from a role block's raw lines. */
function blockToMessage(
  block: { role: SessionMessage['role']; lines: string[] },
  index: number,
): SessionMessage {
  const reasoning: string[] = []
  const content: string[] = []
  let toolName: string | null = null
  let toolCalls: string[] = []
  let inReasoning = false

  for (const line of block.lines) {
    // Reasoning: a `> _Thinking:_ …` opener, then `> …` continuation lines.
    const opener = /^>\s*_Thinking:_\s?(.*)$/.exec(line)
    if (opener?.[1] !== undefined) {
      inReasoning = true
      reasoning.push(opener[1])
      continue
    }
    if (inReasoning && /^>\s?/.test(line)) {
      reasoning.push(line.replace(/^>\s?/, ''))
      continue
    }
    inReasoning = false

    // Tool footer lines (single backtick-wrapped).
    const result = /^`tool result · (.+)`$/.exec(line)
    if (result?.[1] !== undefined) {
      toolName = result[1].trim()
      continue
    }
    const calls = /^`tool calls: (.+)`$/.exec(line)
    if (calls?.[1] !== undefined) {
      toolCalls = calls[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      continue
    }

    content.push(line)
  }

  return {
    // Markdown drops ids; synthesize a stable, unique one per block.
    id: `imported-${index}`,
    role: block.role,
    content: content.join('\n').trim(),
    timestamp: null,
    reasoning: reasoning.length > 0 ? reasoning.join('\n').trim() : null,
    tool_name: toolName,
    tool_calls: toolCalls,
  }
}

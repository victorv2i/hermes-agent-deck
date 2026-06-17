/**
 * Read-only runtime adapters for Claude Code and Codex.
 *
 * Both, when run in a terminal pane, are interactive TUIs the deck cannot drive —
 * but they each write a structured JSONL session transcript on disk that the
 * co-located deck CAN read. These adapters list past sessions (and tally token
 * usage) from those transcripts, so the unified history / usage surfaces can
 * include them alongside Hermes. Their capability flags are honest: read-only.
 *
 * Bounded by design: only the N most-recently-active sessions per runtime are
 * read, and each file read is capped, so a long history never costs the world.
 */
import { openSync, readSync, closeSync, fstatSync, readdirSync, statSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { RuntimeCapabilities, RuntimeSession } from '@agent-deck/protocol'

/** Read-only runtimes report this exact capability set. */
export const READ_ONLY_CAPABILITIES: RuntimeCapabilities = {
  chat: false,
  approvals: false,
  usage: true,
  sessions: true,
}

/** Newest sessions to read per runtime (bounds cost of a history view). */
const DEFAULT_SESSION_LIMIT = 40
/** Max bytes read from a single transcript when tallying (bounds a huge log). */
const MAX_READ_BYTES = 16 * 1024 * 1024

export interface ListSessionsOptions {
  home?: string
  limit?: number
}

/** Read up to `maxBytes` from the END of a file as whole lines (drops a partial
 * leading line). Used so even a multi-GB transcript reads in bounded time. */
function readBoundedLines(path: string, maxBytes = MAX_READ_BYTES): string[] {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const start = size > maxBytes ? size - maxBytes : 0
    const len = size - start
    if (len <= 0) return []
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, start)
    let text = buf.toString('utf8')
    if (start > 0) {
      const nl = text.indexOf('\n')
      text = nl >= 0 ? text.slice(nl + 1) : ''
    }
    return text.split('\n').filter((l) => l.length > 0)
  } finally {
    closeSync(fd)
  }
}

/** A transcript file + its mtime (for newest-first ordering + lastActive). */
interface TranscriptFile {
  path: string
  mtimeMs: number
  /** The id derived from the filename stem (a fallback when the body has none). */
  stem: string
}

/** Collect `*.jsonl` files under a dir tree (bounded), newest mtime first. */
function collectTranscripts(root: string, limit: number): TranscriptFile[] {
  const found: TranscriptFile[] = []
  const walk = (dir: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        try {
          const st = statSync(full)
          found.push({ path: full, mtimeMs: st.mtimeMs, stem: entry.name.replace(/\.jsonl$/, '') })
        } catch {
          // skip unreadable
        }
      }
    }
  }
  walk(root)
  found.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return found.slice(0, limit)
}

/** First human-readable text in a transcript, trimmed to a title length. Strips
 * `<command-...>` wrappers (slash-command turns) so a title reads naturally. */
function toTitle(text: string | null): string | null {
  if (!text) return null
  const stripped = text
    .replace(/<command-[^>]*>[\s\S]*?<\/command-[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!stripped) return null
  return stripped.length <= 60 ? stripped : `${stripped.slice(0, 60).trimEnd()}…`
}

/** Parse epoch ms from an ISO timestamp string, or null. (No Date.now coupling.) */
function isoToMs(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/** List Claude Code sessions from `~/.claude/projects/<dir>/<session>.jsonl`. */
export function listClaudeSessions(opts: ListSessionsOptions = {}): RuntimeSession[] {
  const home = opts.home ?? homedir()
  const limit = opts.limit ?? DEFAULT_SESSION_LIMIT
  const root = join(home, '.claude', 'projects')
  const files = collectTranscripts(root, limit)

  const sessions: RuntimeSession[] = []
  for (const file of files) {
    let sessionId = file.stem
    let cwd: string | null = null
    let model: string | null = null
    let title: string | null = null
    let startedAt: number | null = null
    let lastActive: number | null = null
    let messageCount = 0
    let inputTokens = 0
    let outputTokens = 0

    for (const line of readBoundedLines(file.path)) {
      let r: Record<string, unknown>
      try {
        r = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }
      if (typeof r.sessionId === 'string') sessionId = r.sessionId
      if (typeof r.cwd === 'string') cwd = r.cwd
      const ts = isoToMs(r.timestamp)
      if (ts !== null) {
        if (startedAt === null) startedAt = ts
        lastActive = ts
      }
      const type = r.type
      if (type === 'user' || type === 'assistant') messageCount += 1
      const message = r.message
      if (message && typeof message === 'object') {
        const m = message as { model?: unknown; usage?: Record<string, unknown>; content?: unknown }
        if (typeof m.model === 'string') model = m.model
        if (m.usage) {
          if (typeof m.usage.input_tokens === 'number') inputTokens += m.usage.input_tokens
          if (typeof m.usage.output_tokens === 'number') outputTokens += m.usage.output_tokens
        }
        if (title === null && type === 'user') title = toTitle(extractText(m.content))
      }
    }

    sessions.push({
      runtime: 'claude',
      id: sessionId,
      title,
      model,
      startedAt,
      lastActive: lastActive ?? file.mtimeMs,
      messageCount,
      inputTokens,
      outputTokens,
      cwd,
    })
  }
  return sessions
}

/** List Codex sessions from `~/.codex/sessions/.../rollout-*.jsonl`. */
export function listCodexSessions(opts: ListSessionsOptions = {}): RuntimeSession[] {
  const home = opts.home ?? homedir()
  const limit = opts.limit ?? DEFAULT_SESSION_LIMIT
  const root = join(home, '.codex', 'sessions')
  const files = collectTranscripts(root, limit)

  const sessions: RuntimeSession[] = []
  for (const file of files) {
    let sessionId = file.stem
    let cwd: string | null = null
    let model: string | null = null
    let title: string | null = null
    let startedAt: number | null = null
    let lastActive: number | null = null
    let messageCount = 0
    let inputTokens = 0
    let outputTokens = 0

    for (const line of readBoundedLines(file.path)) {
      let r: { timestamp?: unknown; type?: unknown; payload?: Record<string, unknown> }
      try {
        r = JSON.parse(line) as typeof r
      } catch {
        continue
      }
      const ts = isoToMs(r.timestamp)
      if (ts !== null) {
        if (startedAt === null) startedAt = ts
        lastActive = ts
      }
      const payload = r.payload
      if (!payload || typeof payload !== 'object') continue
      if (r.type === 'session_meta') {
        if (typeof payload.id === 'string') sessionId = payload.id
        if (typeof payload.cwd === 'string') cwd = payload.cwd
        const provider = payload.model_provider
        if (typeof provider === 'string') model = provider
      }
      if (payload.type === 'message') {
        messageCount += 1
        if (title === null) title = toTitle(extractText(payload.content))
      }
      // Codex token-count events carry cumulative totals; keep the largest seen.
      if (typeof payload.input_tokens === 'number')
        inputTokens = Math.max(inputTokens, payload.input_tokens)
      if (typeof payload.output_tokens === 'number')
        outputTokens = Math.max(outputTokens, payload.output_tokens)
    }

    sessions.push({
      runtime: 'codex',
      id: sessionId,
      title,
      model,
      startedAt,
      lastActive: lastActive ?? file.mtimeMs,
      messageCount,
      inputTokens,
      outputTokens,
      cwd,
    })
  }
  return sessions
}

/** Extract plain text from a message content (string, or an array of text parts). */
function extractText(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === 'string') return block
      if (block && typeof block === 'object') {
        const b = block as { type?: unknown; text?: unknown }
        if ((b.type === 'text' || b.type === 'input_text') && typeof b.text === 'string')
          return b.text
      }
    }
  }
  return null
}

/**
 * Terminal pane awareness — read what an agent CLI running in a pane is doing,
 * from that CLI's OWN session transcript on disk. The deck is co-located with the
 * CLIs, so this is far more robust than scraping the TUI byte stream: Claude Code
 * writes a structured JSONL transcript per session under
 * `~/.claude/projects/<encoded-cwd>/<session>.jsonl`, appending as it works, so
 * the file's mtime is a reliable "actively working right now" signal and its tail
 * carries the last tool call + the last file touched.
 *
 * Everything is best-effort: a missing dir / unreadable file / unknown cwd yields
 * the honest `unknown` snapshot, never a fabricated state. Reads are bounded to a
 * tail window so a multi-megabyte transcript never costs more than a small read.
 */
import { openSync, readSync, closeSync, fstatSync, readdirSync, statSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { unknownPaneState, type CliId, type PaneRuntimeState } from '@agent-deck/protocol'

/** How recently the transcript must have been written to count as "working". */
const DEFAULT_FRESHNESS_MS = 12_000
/** Bytes of the transcript tail to read (bounds cost on huge session logs). */
const TAIL_BYTES = 64 * 1024

export interface PaneStateOptions {
  /** Home dir override (tests). Defaults to the real home. */
  home?: string
  /** Injected clock (tests). Defaults to Date.now. */
  now?: () => number
  /** Freshness window for `working` vs `idle`. */
  freshnessMs?: number
}

/**
 * Claude Code encodes a project directory as the absolute cwd with every `/` AND
 * `.` replaced by `-` (e.g. `/home/u/.hermes` → `-home-u--hermes`). The result is
 * a single path segment with no separators, so an attacker-influenced cwd can
 * never traverse out of the projects root.
 */
export function encodeClaudeProjectDir(cwd: string): string {
  return cwd.replace(/[/.]/g, '-')
}

/** Tools whose input names the file the agent is working on. */
const FILE_TOOL_INPUT_KEY: Record<string, string> = {
  Read: 'file_path',
  Edit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
}

/** Read the last `maxBytes` of a file as whole lines (drops a partial leading line
 * when the window starts mid-file). Bounded so a huge transcript stays cheap. */
function readTailLines(path: string, maxBytes = TAIL_BYTES): string[] {
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

/** The newest `*.jsonl` under a dir, or null when none/unreadable. */
function newestTranscript(dir: string): { path: string; mtimeMs: number } | null {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }
  let newest: { path: string; mtimeMs: number } | null = null
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue
    const path = join(dir, name)
    try {
      const st = statSync(path)
      if (!st.isFile()) continue
      if (!newest || st.mtimeMs > newest.mtimeMs) newest = { path, mtimeMs: st.mtimeMs }
    } catch {
      // skip an unreadable entry
    }
  }
  return newest
}

/**
 * Read the runtime state of a Claude Code pane from its session transcript.
 * `cwd` is the pane's working directory (where `claude` runs); the transcript
 * lives under `~/.claude/projects/<encoded-cwd>/`.
 */
export function readClaudePaneState(cwd: string, opts: PaneStateOptions = {}): PaneRuntimeState {
  const home = opts.home ?? homedir()
  const now = opts.now ?? Date.now
  const freshnessMs = opts.freshnessMs ?? DEFAULT_FRESHNESS_MS

  const dir = join(home, '.claude', 'projects', encodeClaudeProjectDir(cwd))
  const newest = newestTranscript(dir)
  if (!newest) return unknownPaneState('claude')

  let sessionId: string | null = null
  let lastTool: string | null = null
  let activeFile: string | null = null
  let updatedAt: string | null = null

  for (const line of readTailLines(newest.path)) {
    let record: Record<string, unknown>
    try {
      record = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (typeof record.sessionId === 'string') sessionId = record.sessionId
    if (typeof record.timestamp === 'string') updatedAt = record.timestamp
    const message = record.message
    const content =
      message && typeof message === 'object'
        ? (message as { content?: unknown }).content
        : undefined
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const b = block as { type?: unknown; name?: unknown; input?: Record<string, unknown> }
      if (b.type !== 'tool_use' || typeof b.name !== 'string') continue
      lastTool = b.name
      const key = FILE_TOOL_INPUT_KEY[b.name]
      const value = key && b.input ? b.input[key] : undefined
      if (typeof value === 'string' && value.length > 0) activeFile = value
    }
  }

  const runState = now() - newest.mtimeMs <= freshnessMs ? 'working' : 'idle'
  return { cli: 'claude', runState, activeFile, lastTool, sessionId, updatedAt }
}

/* ───────────────────────────── Codex ──────────────────────────────────────
 * Codex writes one rollout transcript per session under
 * `~/.codex/sessions/YYYY/MM/DD/rollout-<ISO>-<id>.jsonl`. Each record is
 * `{ timestamp, type, payload }`; the FIRST record is `session_meta` whose
 * payload carries the session `cwd` + `id`, and `response_item` records of
 * payload-type `function_call` carry the tool `name` + `arguments`. So we match a
 * pane's cwd to the NEWEST rollout whose session_meta.cwd equals it, then tail it
 * for the last tool call. The scan is bounded (newest-first, capped) so a user
 * with years of history never pays to walk it all.
 */

/** Max rollout files to consider when matching a pane's cwd. */
const CODEX_SCAN_LIMIT = 60

/** Read just the first line of a file (bounded head read). */
function readFirstLine(path: string, maxBytes = 16 * 1024): string | null {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const len = size > maxBytes ? maxBytes : size
    if (len <= 0) return null
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, 0)
    const text = buf.toString('utf8')
    const nl = text.indexOf('\n')
    return nl >= 0 ? text.slice(0, nl) : text
  } finally {
    closeSync(fd)
  }
}

/** Collect rollout transcript paths NEWEST-first (by date dir + filename, both
 * sort lexicographically in timestamp order), capped at `limit`. */
function recentCodexRollouts(sessionsDir: string, limit = CODEX_SCAN_LIMIT): string[] {
  const out: string[] = []
  const descend = (dir: string): void => {
    if (out.length >= limit) return
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    const files = entries
      .filter((e) => e.isFile() && e.name.startsWith('rollout-') && e.name.endsWith('.jsonl'))
      .map((e) => e.name)
      .sort()
      .reverse()
    for (const f of files) {
      if (out.length >= limit) return
      out.push(join(dir, f))
    }
    const subdirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse()
    for (const d of subdirs) {
      if (out.length >= limit) return
      descend(join(dir, d))
    }
  }
  descend(sessionsDir)
  return out
}

/** Best-effort path extraction from a Codex tool's JSON `arguments` string. */
function codexActiveFile(argumentsJson: unknown): string | null {
  if (typeof argumentsJson !== 'string') return null
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(argumentsJson) as Record<string, unknown>
  } catch {
    return null
  }
  for (const key of ['path', 'file_path', 'filename', 'file']) {
    const v = parsed[key]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return null
}

/** The cwd recorded in a rollout's first (`session_meta`) record, or null. */
function rolloutCwd(path: string): { cwd: string | null; sessionId: string | null } {
  const line = readFirstLine(path)
  if (!line) return { cwd: null, sessionId: null }
  try {
    const record = JSON.parse(line) as { payload?: { cwd?: unknown; id?: unknown } }
    const payload = record.payload
    return {
      cwd: payload && typeof payload.cwd === 'string' ? payload.cwd : null,
      sessionId: payload && typeof payload.id === 'string' ? payload.id : null,
    }
  } catch {
    return { cwd: null, sessionId: null }
  }
}

/**
 * Read the runtime state of a Codex pane from its rollout transcript (matched to
 * the pane cwd via each rollout's `session_meta.cwd`).
 */
export function readCodexPaneState(cwd: string, opts: PaneStateOptions = {}): PaneRuntimeState {
  const home = opts.home ?? homedir()
  const now = opts.now ?? Date.now
  const freshnessMs = opts.freshnessMs ?? DEFAULT_FRESHNESS_MS

  const sessionsDir = join(home, '.codex', 'sessions')
  let match: { path: string; sessionId: string | null } | null = null
  for (const path of recentCodexRollouts(sessionsDir)) {
    const meta = rolloutCwd(path)
    if (meta.cwd === cwd) {
      match = { path, sessionId: meta.sessionId }
      break // newest-first → first match is the most recent session for this cwd
    }
  }
  if (!match) return unknownPaneState('codex')

  let mtimeMs: number
  try {
    mtimeMs = statSync(match.path).mtimeMs
  } catch {
    return unknownPaneState('codex')
  }

  let lastTool: string | null = null
  let activeFile: string | null = null
  let updatedAt: string | null = null
  for (const line of readTailLines(match.path)) {
    let record: { timestamp?: unknown; payload?: Record<string, unknown> }
    try {
      record = JSON.parse(line) as typeof record
    } catch {
      continue
    }
    if (typeof record.timestamp === 'string') updatedAt = record.timestamp
    const payload = record.payload
    if (payload && payload.type === 'function_call' && typeof payload.name === 'string') {
      lastTool = payload.name
      const file = codexActiveFile(payload.arguments)
      if (file) activeFile = file
    }
  }

  const runState = now() - mtimeMs <= freshnessMs ? 'working' : 'idle'
  return { cli: 'codex', runState, activeFile, lastTool, sessionId: match.sessionId, updatedAt }
}

/**
 * Resolve a pane's runtime state for the given CLI. Only CLIs that write a
 * readable session transcript are supported (Claude Code, Codex); anything else
 * (or a missing cwd) is the honest `unknown` snapshot.
 */
export function readPaneState(
  cli: CliId,
  cwd: string | undefined,
  opts: PaneStateOptions = {},
): PaneRuntimeState {
  if (!cwd) return unknownPaneState(cli)
  if (cli === 'claude') return readClaudePaneState(cwd, opts)
  if (cli === 'codex') return readCodexPaneState(cwd, opts)
  return unknownPaneState(cli)
}

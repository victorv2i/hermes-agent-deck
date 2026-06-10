/**
 * Typed wrapper over the loopback dashboard's gated logs endpoint
 * (`GET /api/logs`, see hermes_cli/web_server.py → get_logs). The dashboard
 * returns `{ file, lines: string[] }`, where each line is a RAW formatted log
 * record, e.g. `2026-05-30 22:35:00,123 INFO hermes.gateway started`.
 *
 * This client builds the query (file / lines / level / search), delegates auth +
 * transport to the shared {@link DashboardClient}, and PARSES each raw line into
 * the structured {@link AgentDeckLogEntry} so the web surface can color by level
 * (semantic tokens) and key its rows without re-parsing strings on the client.
 *
 * Why a dedicated client (not piggy-backing dashboardClient.ts): like
 * statusClient/usageClient, the logs domain owns its own line-parsing + query
 * shaping. It depends only on the minimal `{ getJson }` slice so it can be unit
 * tested against a stub without the live dashboard.
 *
 * SECURITY: log MESSAGE bodies may contain absolute paths — that is inherent to
 * a logs viewer and is shown verbatim (the operator is authenticated to the
 * host). This client adds NO path fields of its own and constrains `level` to
 * the known set, so a malformed upstream line can't widen the DTO.
 */
import {
  type AgentDeckLogEntry,
  type AgentDeckLogs,
  type LogFile,
  type LogLevel,
} from '@agent-deck/protocol'
import type { DashboardClient } from '../hermes/dashboardClient'
import { scrubSecrets } from '../system/hermesCli'

/** The dashboard caps a single page at 500 lines (web_server.py: min(lines,500)). */
export const MAX_LOG_LINES = 500
const MIN_LOG_LINES = 1

/** Leading timestamp: `2026-05-30 22:35:00` or `...:00,123`. */
const TS_RE = /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:[,.]\d+)?)/
/**
 * Level + optional logger + message, after the timestamp. The level token is
 * surrounded by whitespace; an optional `[run_id]` bracket (the gateway prefixes
 * run-scoped lines with one) is skipped; the logger (if present) is the next
 * dotted/worded token, optionally suffixed with a colon. Everything after is the
 * message.
 */
const REST_RE =
  /^\s+(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s+(?:\[[^\]]+\]\s+)?(?:([\w.-]+):?\s+)?(.*)$/

const KNOWN_LEVELS: ReadonlySet<string> = new Set(['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'])

/** The raw `{ file, lines }` body the dashboard's `GET /api/logs` returns. */
interface RawLogsResponse {
  file?: unknown
  lines?: unknown
}

/** Options for a single logs fetch. */
export interface GetLogsOptions {
  file: LogFile
  /** Requested line count; clamped to [1, 500]. */
  lines: number
  /** Min-level filter; `'ALL'`/empty means no filter (omitted from the query). */
  level?: string
  /** Free-text substring filter applied by the dashboard. */
  search?: string
}

/**
 * Parse one raw log line into a structured entry. Lines that don't match the
 * standard `timestamp LEVEL logger message` shape (continuations, tracebacks)
 * become `unknown`-level entries whose `message` is the full raw line, so they
 * still render — quietly — rather than being dropped.
 */
export function parseLogLine(raw: string, id: number): AgentDeckLogEntry {
  // The dashboard returns each line WITH its trailing newline. In JS, `$` (no `m`
  // flag) matches only the absolute string end, so a trailing `\n` makes
  // REST_RE's `(.*)$` fail and every line fall to `unknown`. Strip it first (and
  // surface the clean line as `raw`, so the UI never shows a dangling newline).
  const line = raw.replace(/\r?\n$/, '')
  const tsMatch = TS_RE.exec(line)
  if (!tsMatch) {
    return { id, timestamp: null, level: 'unknown', logger: null, message: line, raw: line }
  }
  const timestamp = tsMatch[1]!
  const after = line.slice(timestamp.length)
  const restMatch = REST_RE.exec(after)
  if (!restMatch) {
    // Timestamp but no recognizable level token → treat the remainder as message.
    return {
      id,
      timestamp,
      level: 'unknown',
      logger: null,
      message: after.trim(),
      raw: line,
    }
  }
  const levelTok = restMatch[1]!
  const level: LogLevel = KNOWN_LEVELS.has(levelTok) ? (levelTok as LogLevel) : 'unknown'
  const logger = restMatch[2] ?? null
  const message = restMatch[3] ?? ''
  return { id, timestamp, level, logger, message, raw: line }
}

/** Clamp the requested line count into the dashboard's accepted band. */
function clampLines(lines: number): number {
  if (!Number.isFinite(lines)) return MIN_LOG_LINES
  const n = Math.floor(lines)
  if (n < MIN_LOG_LINES) return MIN_LOG_LINES
  if (n > MAX_LOG_LINES) return MAX_LOG_LINES
  return n
}

/** A level value is "real" only when it's a known level and not the ALL sentinel. */
function normalizeLevel(level: string | undefined): string | null {
  if (!level) return null
  const trimmed = level.trim()
  if (trimmed === '' || trimmed.toUpperCase() === 'ALL') return null
  return trimmed
}

/** Minimal slice of DashboardClient this client needs (eases test injection). */
export interface LogsDashboard {
  getJson<T>(path: string): Promise<T>
}

export class LogsClient {
  constructor(private readonly dashboard: LogsDashboard | DashboardClient) {}

  async getLogs(options: GetLogsOptions): Promise<AgentDeckLogs> {
    const lines = clampLines(options.lines)
    const params = new URLSearchParams({ file: options.file, lines: String(lines) })
    const level = normalizeLevel(options.level)
    if (level) params.set('level', level)
    const search = options.search?.trim()
    if (search) params.set('search', search)

    const raw = await this.dashboard.getJson<RawLogsResponse>(`/api/logs?${params.toString()}`)

    const file = (typeof raw?.file === 'string' ? raw.file : options.file) as LogFile
    const rawLines = Array.isArray(raw?.lines) ? raw.lines : []
    const entries = rawLines
      .filter((l): l is string => typeof l === 'string')
      .map((l, i) => parseLogLine(scrubSecrets(l), i))

    // The dashboard returns up to `lines` records; if it returned exactly that
    // many, older lines were almost certainly trimmed off the head.
    const truncated = entries.length >= lines

    return { file, entries, truncated }
  }
}

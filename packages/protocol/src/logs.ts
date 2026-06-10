import { z } from 'zod'

/**
 * Recent agent log lines — the SLIM, WHITELISTED view of the hermes dashboard's
 * gated `GET /api/logs`. The dashboard returns `{ file, lines: string[] }` where
 * each line is a raw formatted log record
 * (`2026-05-30 22:35:00,123 INFO some.logger message…`). The BFF parses each
 * raw line into the structured {@link AgentDeckLogEntry} below so the web surface
 * can color by level (semantic tokens) and filter without re-parsing on every
 * keystroke. The raw text is preserved on `raw` for monospace display + copy.
 *
 * SECURITY: log lines can contain absolute filesystem paths in their message
 * text — that is inherent to a logs viewer and is shown verbatim (the operator
 * is already authenticated to the host). This DTO does NOT try to scrub message
 * bodies; it only constrains the SHAPE. The BFF never adds path fields of its own
 * (no hermes_home / config_path envelope), and `level` is constrained to the
 * known set so a malformed upstream can't widen it into arbitrary markup.
 */

/** The log files the dashboard exposes (the `file` query param). */
export const LogFile = z.enum(['agent', 'errors', 'gateway'])
export type LogFile = z.infer<typeof LogFile>

/** The known Python log levels, ordered DEBUG < … < CRITICAL. `unknown` covers
 * continuation/wrapped lines (stack traces, multi-line messages) that carry no
 * level token of their own — they render as quiet, never as an error. */
export const LogLevel = z.enum(['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'unknown'])
export type LogLevel = z.infer<typeof LogLevel>

/** The min-level filter the UI offers (excludes the synthetic `unknown`). */
export const LOG_LEVEL_FILTERS = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'] as const
export type LogLevelFilter = (typeof LOG_LEVEL_FILTERS)[number]

export const AgentDeckLogEntry = z.object({
  /** Stable index within the returned page (oldest = 0); used as a React key
   * since raw lines are not unique. */
  id: z.number().int().nonnegative(),
  /** Parsed leading timestamp (`YYYY-MM-DD HH:MM:SS[,mmm]`), or null when the
   * line has none (e.g. a wrapped continuation line). Kept as the raw string —
   * no timezone is assumed. */
  timestamp: z.string().nullable(),
  /** Parsed level, or `unknown` for lines with no level token. */
  level: LogLevel,
  /** The logger name (e.g. `hermes.gateway`), or null when absent. */
  logger: z.string().nullable(),
  /** The message body with the timestamp/level/logger prefix stripped; falls
   * back to the full raw line when the line doesn't match the standard shape. */
  message: z.string(),
  /** The original, unmodified line text (for monospace display + copy). */
  raw: z.string(),
})
export type AgentDeckLogEntry = z.infer<typeof AgentDeckLogEntry>

export const AgentDeckLogs = z.object({
  /** Which file these lines came from. */
  file: LogFile,
  /** The parsed, oldest-first log entries (capped server-side). */
  entries: z.array(AgentDeckLogEntry),
  /** True when the file existed but the server capped/trimmed the returned set
   * to the requested line count (there may be older lines not shown). */
  truncated: z.boolean(),
})
export type AgentDeckLogs = z.infer<typeof AgentDeckLogs>

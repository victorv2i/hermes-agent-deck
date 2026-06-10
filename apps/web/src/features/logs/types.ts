/**
 * Feature-local UI constants for the Logs surface. The wire shapes live in
 * `@agent-deck/protocol` (logs.ts); these are just the selectable options +
 * their human labels for the segmented controls.
 */
import type { LogFile, LogLevel } from '@agent-deck/protocol'

/** The log files the surface lets you switch between (matches the backend set). */
export const LOG_FILES: ReadonlyArray<{ id: LogFile; label: string }> = [
  { id: 'agent', label: 'Agent' },
  { id: 'errors', label: 'Errors' },
  { id: 'gateway', label: 'Gateway' },
]

/** The min-level options. `'ALL'` is the no-filter sentinel (sent as omitted). */
export const LEVEL_OPTIONS = ['ALL', 'DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'] as const
export type LevelOption = (typeof LEVEL_OPTIONS)[number]

/** Hard cap on rendered rows — keeps the DOM bounded even if the backend cap
 * ever grows; the list is sliced to the most-recent N before render. */
export const MAX_RENDERED_LINES = 500

/**
 * Map a parsed level to its governed Tailwind text color. Semantic tokens ONLY
 * (color = status), never the amber action accent: error/critical →
 * destructive, warn → warning, info → info-muted, debug/unknown → quiet.
 */
export function levelTextClass(level: LogLevel): string {
  switch (level) {
    case 'ERROR':
    case 'CRITICAL':
      return 'text-destructive'
    case 'WARNING':
      return 'text-warning'
    case 'INFO':
      return 'text-info'
    default:
      // DEBUG + unknown continuation lines stay quiet.
      return 'text-muted-foreground'
  }
}

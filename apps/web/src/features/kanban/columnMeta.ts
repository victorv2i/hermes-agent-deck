/**
 * Per-column presentation — the CATEGORICAL vocabulary the board uses to tint and
 * label each lane. Governance (design-language §2/§10a): the action accent
 * (`--primary`) is reserved for action + the live/active state, so a *resting*
 * column never reaches for it. Each column gets a quiet semantic/categorical dot
 * tone instead. The ONE exception is `running`, the live lane — it carries the
 * accent because it represents work happening right now (an "active/live" state),
 * which is exactly what the accent governs.
 *
 * Tones map to existing tokens only (foreground-tertiary / muted / info / warning
 * / success / destructive / primary), so every column reads correctly across all
 * five themes with zero per-theme code.
 */
import type { KanbanColumnName } from '@agent-deck/protocol'

/** A column's dot/accent tone — a token name, not a hex. `live` == the accent. */
export type ColumnTone =
  | 'neutral'
  | 'muted'
  | 'info'
  | 'warning'
  | 'success'
  | 'destructive'
  | 'live'

export interface ColumnMeta {
  /** Human label shown in the column header. */
  label: string
  /** Categorical tone for the column's dot + count chip. */
  tone: ColumnTone
}

export const COLUMN_META: Record<KanbanColumnName, ColumnMeta> = {
  triage: { label: 'Incoming', tone: 'neutral' },
  todo: { label: 'To do', tone: 'muted' },
  scheduled: { label: 'Scheduled', tone: 'info' },
  ready: { label: 'Ready', tone: 'info' },
  running: { label: 'Running', tone: 'live' },
  blocked: { label: 'Blocked', tone: 'warning' },
  review: { label: 'Review', tone: 'warning' },
  done: { label: 'Done', tone: 'success' },
  archived: { label: 'Archived', tone: 'muted' },
}

/** Tailwind text-color class for a tone's dot (token-driven; theme-safe). */
export const TONE_DOT_CLASS: Record<ColumnTone, string> = {
  neutral: 'bg-foreground-tertiary',
  muted: 'bg-muted-foreground',
  info: 'bg-info',
  warning: 'bg-warning',
  success: 'bg-success',
  destructive: 'bg-destructive',
  live: 'bg-primary',
}

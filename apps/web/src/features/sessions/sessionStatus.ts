/**
 * Pure classifier for a session's *meaningful non-normal* lifecycle state, shared
 * by the rail rows (SessionList) and the opened-session header (SessionHistory)
 * so both surfaces read the same cross-source signal identically.
 *
 * Design intent (see docs/design/design-language.md §2): the common case
 * (running / completed / a normal `handoff_state: 'none'`) gets NO indicator —
 * we never clutter normal rows. Only an errored/failed session or a handed-off
 * session earns a subtle, accessible marker, and state is conveyed by
 * SHAPE/ICON + an aria-label/title (governed semantic color, never amber, and
 * never color alone — colorblind-safe).
 */

import type { SessionSummary } from './types'

/** The kinds of non-normal state we surface. `null` = nothing to show. */
export type SessionStateKind = 'failed' | 'handoff'

export interface SessionStateIndicator {
  kind: SessionStateKind
  /** Accessible label used for both `aria-label` and `title`. */
  label: string
}

/** `status`/`end_reason` tokens that mean the session ended badly. */
const FAILED_TOKENS = new Set(['failed', 'error', 'errored', 'crashed', 'aborted'])

/** `handoff_state` tokens that mean "no handoff" (the common case → no marker). */
const HANDOFF_NORMAL_TOKENS = new Set(['', 'none', 'null', 'normal', 'self'])

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

/** True when `status` or `end_reason` indicates the session errored/failed. */
export function isFailedSession(s: Pick<SessionSummary, 'status' | 'end_reason'>): boolean {
  return FAILED_TOKENS.has(norm(s.status)) || FAILED_TOKENS.has(norm(s.end_reason))
}

/** True when `handoff_state` indicates a real handoff (anything but the normal tokens). */
export function isHandedOffSession(s: Pick<SessionSummary, 'handoff_state'>): boolean {
  const h = norm(s.handoff_state)
  return h !== '' && !HANDOFF_NORMAL_TOKENS.has(h)
}

/**
 * The single indicator to render for a session, or `null` for the common
 * (normal/completed) case. Failure takes precedence over handoff — a session
 * that both handed off AND failed is most usefully flagged as failed.
 */
export function sessionStateIndicator(
  s: Pick<SessionSummary, 'status' | 'end_reason' | 'handoff_state'>,
): SessionStateIndicator | null {
  if (isFailedSession(s)) return { kind: 'failed', label: 'Session failed' }
  if (isHandedOffSession(s)) return { kind: 'handoff', label: 'Session handed off' }
  return null
}

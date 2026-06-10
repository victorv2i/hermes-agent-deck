import type { SessionSummary } from './types'

/**
 * The per-row "where did this session come from" marker (the `source` field is
 * already on the wire — e.g. `cli`, `web`, `api`, `cron`, `handoff`). The rail
 * shows a small colored dot so an operator can tell at a glance which channel a
 * session opened in, with the human label carried in the accessible
 * name/tooltip (color is never the only signal — colorblind-safe).
 *
 * Tones map to the design language's GOVERNED semantic palette tokens only
 * (`info` / `success` / `warning` / `muted` — never the amber action accent),
 * so a source dot can never be mistaken for the live/active marker. Unknown
 * sources fall back to a neutral muted dot rather than an arbitrary new color.
 */

export interface SourceMeta {
  /** A short, human label (Title Case) for the source. */
  label: string
  /** A Tailwind text/bg color class fragment for the governed semantic tone. */
  tone: 'info' | 'success' | 'warning' | 'muted'
}

const SOURCE_META: Record<string, SourceMeta> = {
  cli: { label: 'CLI', tone: 'info' },
  terminal: { label: 'Terminal', tone: 'info' },
  web: { label: 'Web', tone: 'success' },
  ui: { label: 'Web', tone: 'success' },
  api: { label: 'API', tone: 'warning' },
  cron: { label: 'Scheduled', tone: 'warning' },
  job: { label: 'Scheduled', tone: 'warning' },
  handoff: { label: 'Handoff', tone: 'muted' },
}

/** Resolve a raw source string to its display meta (defaults to a neutral dot). */
export function sourceMeta(source: string | null | undefined): SourceMeta {
  const key = source?.trim().toLowerCase()
  if (key && SOURCE_META[key]) return SOURCE_META[key]
  // Unknown but non-empty: keep the raw value as a readable label, neutral tone.
  if (key) return { label: titleCase(key), tone: 'muted' }
  return { label: 'Unknown source', tone: 'muted' }
}

/** Convenience: resolve a session's source meta. */
export function sessionSourceMeta(session: SessionSummary): SourceMeta {
  return sourceMeta(session.source)
}

/**
 * The source values that count as "this UI / agent-deck-originated" — `web` and
 * its `ui` alias (mirroring {@link SOURCE_META}, where both map to the "Web"
 * channel). These are the sessions the pane + History default to; every other
 * channel (cli / telegram / discord / cron / api / handoff / …) is an EXTERNAL
 * source revealed only behind an opt-in toggle, never a default dump.
 */
const WEB_SOURCES = new Set(['web', 'ui'])

/** Whether a session opened in THIS web UI (web/ui), case-insensitively. */
export function isWebOriginated(session: SessionSummary): boolean {
  const key = session.source?.trim().toLowerCase()
  return key !== undefined && WEB_SOURCES.has(key)
}

/**
 * Partition a session list into web-originated vs external channels,
 * order-preserving within each side. The pane/History default to the `web`
 * slice; the `external` slice powers the "Other sessions (N)" reveal so the
 * CLI/Telegram/Discord/cron sessions never interleave with web by date unless
 * the user opts in.
 */
export function splitBySource(sessions: SessionSummary[]): {
  web: SessionSummary[]
  external: SessionSummary[]
} {
  const web: SessionSummary[] = []
  const external: SessionSummary[] = []
  for (const session of sessions) {
    if (isWebOriginated(session)) web.push(session)
    else external.push(session)
  }
  return { web, external }
}

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1)
}

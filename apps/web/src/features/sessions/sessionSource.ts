import type { SessionSummary } from './types'

/**
 * The per-row "where did this session come from" marker (the `source` field is
 * already on the wire — e.g. `cli`, `web`, `api`, `cron`, `handoff`). The rail
 * shows a small colored dot so an operator can tell at a glance which channel a
 * session opened in, with the human label carried in the accessible
 * name/tooltip (color is never the only signal — colorblind-safe).
 *
 * Tones map to the design language's GOVERNED semantic palette tokens only
 * (`info` / `success` / `warning` / `muted` — never the sky-blue action accent),
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
 * The source values that count as "this UI / agent-deck-originated". `web` + its
 * `ui` alias are the portable web markers. The deck also drives the Hermes
 * gateway, which tags a chat opened through this deck by its ingress:
 *  - `dashboard`: the pre-2026-05-29 tag (the deck drove the dashboard's chat).
 *  - `api_server`: the current tag, since the deck moved to the gateway's
 *    `/v1/runs` transport on `:8643` (see the gateway-v1-runs contract). The
 *    gateway stamps `source: api_server` and the deck cannot relabel it.
 * Both are agent-deck-originated chats and BOTH default into the chat rail +
 * History; every other channel (cli / telegram / discord / cron / handoff / …)
 * is an EXTERNAL source folded behind the closed "Other sessions" reveal, never
 * a default dump.
 */
const WEB_SOURCES = new Set(['web', 'ui', 'dashboard', 'api_server'])

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

/**
 * Transcript export (T2.4 / #115) — turn a session's persisted messages into a
 * downloadable document for sharing or keeping ("here's what my agent did").
 * This needs NO new backend: the messages already arrive from
 * `GET /sessions/:id/messages`. Pure builders here (unit-tested); the row
 * overflow menu wires `triggerDownload` to a Blob.
 *
 * Three formats:
 *  - `html` — a SELF-CONTAINED HTML document (inline `<style>`, no external refs
 *    or scripts) that anyone can open in a browser. The shareable artifact.
 *  - `md`   — the readable Markdown alternative (also the import round-trip).
 *  - `json` — the faithful data export (used by the import round-trip).
 *
 * HONEST: every format is a LOCAL file the user downloads — there is no upload,
 * no hosting, and no share-link. The export touches nothing on the server.
 */
import type { SessionDetail, SessionMessage } from './types'
import { sanitizeSessionPreview } from './sessionPreview'

export type ExportFormat = 'html' | 'md' | 'json'

const EXTENSION: Record<ExportFormat, string> = { html: 'html', md: 'md', json: 'json' }

/** A safe, descriptive filename stem for an exported transcript. */
export function exportFilename(detail: SessionDetail | null, format: ExportFormat): string {
  const raw =
    sanitizeSessionPreview(detail?.title) ||
    sanitizeSessionPreview(detail?.preview) ||
    detail?.id ||
    'session'
  const slug =
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'session'
  return `${slug}.${EXTENSION[format]}`
}

/** Build the export payload (string body + mime type) for a transcript. */
export function buildExport(
  detail: SessionDetail | null,
  messages: SessionMessage[],
  format: ExportFormat,
): { body: string; mime: string } {
  switch (format) {
    case 'json':
      return { body: toJson(detail, messages), mime: 'application/json' }
    case 'html':
      return { body: toHtml(detail, messages), mime: 'text/html' }
    default:
      return { body: toMarkdown(detail, messages), mime: 'text/markdown' }
  }
}

/** A faithful, stable JSON document (detail + messages, pretty-printed). */
function toJson(detail: SessionDetail | null, messages: SessionMessage[]): string {
  return JSON.stringify({ session: detail, messages }, null, 2)
}

/** A readable Markdown transcript: a small front-matter header, then each
 * message as a role-labelled block (reasoning + tool calls rendered inline). */
function toMarkdown(detail: SessionDetail | null, messages: SessionMessage[]): string {
  const title =
    sanitizeSessionPreview(detail?.title) ||
    sanitizeSessionPreview(detail?.preview) ||
    'Session transcript'
  const lines: string[] = [`# ${title}`, '']

  const metaBits: string[] = []
  if (detail?.model) metaBits.push(`**Model:** ${detail.model}`)
  if (detail?.source) metaBits.push(`**Source:** ${detail.source}`)
  const date = formatExportDate(detail?.started_at)
  if (date) metaBits.push(`**Date:** ${date}`)
  if (detail && detail.message_count > 0) metaBits.push(`**Messages:** ${detail.message_count}`)
  if (metaBits.length > 0) lines.push(metaBits.join('  ·  '), '')

  for (const msg of messages) {
    const role = roleLabel(msg.role)
    if (role === null) continue // drop system/unknown from the readable doc
    lines.push(`## ${role}`, '')
    if (msg.reasoning?.trim()) {
      lines.push('> _Thinking:_ ' + msg.reasoning.trim().replace(/\n/g, '\n> '), '')
    }
    if (msg.content.trim()) {
      lines.push(msg.content.trim(), '')
    }
    if (msg.tool_name?.trim()) {
      lines.push(`\`tool result · ${msg.tool_name.trim()}\``, '')
    } else if (msg.tool_calls.length > 0) {
      lines.push(`\`tool calls: ${msg.tool_calls.join(', ')}\``, '')
    }
  }

  return (
    lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n'
  )
}

/** Capitalized role heading; `null` drops the row from the readable export. */
function roleLabel(role: string): string | null {
  switch (role) {
    case 'user':
      return 'User'
    case 'assistant':
      return 'Assistant'
    case 'tool':
      return 'Tool'
    default:
      return null
  }
}

/**
 * A SELF-CONTAINED HTML transcript: a full document with an inline `<style>`
 * block (no external stylesheet, no script — safe to open anywhere and to keep
 * offline). A header carries the session title + model + date; each message is a
 * role-labelled card with its reasoning and tool blocks rendered legibly. ALL
 * dynamic text is entity-escaped, so a message that contains markup is shown
 * verbatim and can never inject into the document.
 */
function toHtml(detail: SessionDetail | null, messages: SessionMessage[]): string {
  const title =
    sanitizeSessionPreview(detail?.title) ||
    sanitizeSessionPreview(detail?.preview) ||
    'Session transcript'

  const metaBits: string[] = []
  if (detail?.model) metaBits.push(`<dt>Model</dt><dd>${escapeHtml(detail.model)}</dd>`)
  if (detail?.source) metaBits.push(`<dt>Source</dt><dd>${escapeHtml(detail.source)}</dd>`)
  const date = formatExportDate(detail?.started_at)
  if (date) metaBits.push(`<dt>Date</dt><dd>${escapeHtml(date)}</dd>`)
  if (detail && detail.message_count > 0) {
    metaBits.push(`<dt>Messages</dt><dd>${detail.message_count}</dd>`)
  }
  const meta = metaBits.length > 0 ? `\n      <dl class="meta">${metaBits.join('')}</dl>` : ''

  const cards: string[] = []
  for (const msg of messages) {
    const role = roleLabel(msg.role)
    if (role === null) continue // drop system/unknown from the readable doc
    const roleClass = msg.role === 'user' || msg.role === 'assistant' ? msg.role : 'tool'
    const parts: string[] = [`      <article class="msg ${roleClass}">`]
    parts.push(`        <header class="role">${escapeHtml(role)}</header>`)
    if (msg.reasoning?.trim()) {
      parts.push(
        `        <div class="reasoning"><span class="label">Thinking</span>${paragraphs(msg.reasoning)}</div>`,
      )
    }
    if (msg.content.trim()) {
      parts.push(`        <div class="content">${paragraphs(msg.content)}</div>`)
    }
    if (msg.tool_name?.trim()) {
      parts.push(
        `        <div class="tool">tool result · ${escapeHtml(msg.tool_name.trim())}</div>`,
      )
    } else if (msg.tool_calls.length > 0) {
      parts.push(
        `        <div class="tool">tool calls: ${escapeHtml(msg.tool_calls.join(', '))}</div>`,
      )
    }
    parts.push('      </article>')
    cards.push(parts.join('\n'))
  }

  // Inline CSS only — neutral, legible, prints cleanly; no external/remote refs.
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="generator" content="Agent Deck" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0; padding: 2rem 1rem;
        font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: #1c2024; background: #f7f7f6;
      }
      main { max-width: 760px; margin: 0 auto; }
      .doc-header { border-bottom: 1px solid #d8d8d4; padding-bottom: 1rem; margin-bottom: 1.5rem; }
      .doc-header h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
      .meta { display: grid; grid-template-columns: auto 1fr; gap: .15rem 1rem; margin: 0; font-size: .8rem; color: #62646a; }
      .meta dt { font-weight: 600; }
      .meta dd { margin: 0; }
      .msg { margin: 0 0 1rem; padding: .9rem 1.1rem; background: #fff; border: 1px solid #e3e3df; border-radius: 10px; }
      .msg .role { font-size: .72rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #62646a; margin-bottom: .45rem; }
      .msg.assistant { border-color: #cfd8de; }
      .msg.tool { background: #f3f4f3; }
      .content p, .reasoning p { margin: 0 0 .6rem; white-space: pre-wrap; }
      .content p:last-child, .reasoning p:last-child { margin-bottom: 0; }
      .reasoning { border-left: 3px solid #d8d8d4; padding-left: .75rem; margin-bottom: .6rem; color: #4a4d52; font-size: .92rem; }
      .reasoning .label { display: block; font-size: .68rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #8a8d93; margin-bottom: .25rem; }
      .tool { margin-top: .5rem; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .82rem; color: #4a4d52; background: #ececea; border-radius: 6px; padding: .35rem .55rem; display: inline-block; }
      footer { margin-top: 2rem; font-size: .72rem; color: #8a8d93; text-align: center; }
      @media (prefers-color-scheme: dark) {
        body { color: #e6e6e6; background: #121414; }
        .doc-header { border-color: #2a2d2d; }
        .meta, .reasoning, .tool { color: #b6b9bd; }
        .msg { background: #1a1c1c; border-color: #2a2d2d; }
        .msg .role { color: #9a9da3; }
        .msg.tool { background: #161818; }
        .reasoning { border-color: #2a2d2d; }
        .tool { background: #232525; }
        footer { color: #75787d; }
      }
    </style>
  </head>
  <body>
    <main>
      <header class="doc-header">
        <h1>${escapeHtml(title)}</h1>${meta}
      </header>
${cards.join('\n')}
      <footer>Exported locally from Agent Deck · ${escapeHtml(formatExportDate(nowSeconds()) ?? '')}</footer>
    </main>
  </body>
</html>
`
}

/** Split text into entity-escaped `<p>` paragraphs (blank lines = breaks). */
function paragraphs(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join('')
}

/** Escape the five HTML-significant characters so dynamic text is inert. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * A stable, absolute date label for an export header from a unix-seconds
 * timestamp. UTC-based so the rendered string doesn't drift with the viewer's
 * timezone (the same file reads the same anywhere). Returns `null` for a missing
 * or non-positive timestamp so the header simply omits the date.
 */
function formatExportDate(startedAt: number | null | undefined): string | null {
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt) || startedAt <= 0) return null
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(startedAt * 1000))
}

/** Current time in unix seconds (extracted so the export footer is testable). */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * Trigger a client-side file download for an export. Guarded for non-browser
 * (test/SSR) environments — returns the object URL it created (or null) so
 * callers/tests can assert without a real DOM download. Side-effecting on
 * purpose; kept tiny and out of the pure builders above.
 */
export function triggerDownload(filename: string, body: string, mime: string): string | null {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return null
  const blob = new Blob([body], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick so the click has committed.
  setTimeout(() => URL.revokeObjectURL(url), 0)
  return url
}

/**
 * Search-snippet legibility helpers (T1.7).
 *
 * The backend full-text search returns snippets with the matched terms wrapped
 * in highlight markers. The LIVE hermes dashboard wraps matches as `>>>term<<<`
 * (triple-angle); some backends/fixtures emit `<b>…</b>` instead. We recognize
 * BOTH forms. The rail used to STRIP those markers (deleting the one affordance
 * that tells you *why* a session matched) and render the raw snippet —
 * frequently a wall of JSON from a tool-call/transcript row. These pure helpers
 * fix both halves of that:
 *
 *  - `parseHighlight` splits a snippet into plain / matched segments so the view
 *    can STYLE the match (sky-blue + bold) as safe React nodes — never
 *    dangerouslySetInnerHTML on untrusted content.
 *  - `humanizeSnippet` turns a raw-JSON-ish fragment into a readable line so the
 *    result reads like prose, not a serialized payload.
 */

export interface HighlightSegment {
  text: string
  match: boolean
}

/**
 * Matches either highlight marker form, keeping the delimiter when used as a
 * `split` separator so callers can toggle match state as they walk the pieces:
 *  - `>>>` / `<<<` — the LIVE hermes dashboard form (triple-angle), and
 *  - `<b>` / `</b>` — the legacy/fixture HTML form.
 */
const HIGHLIGHT_MARKER = /(>>>|<<<|<\/?b>)/i
/** The same markers, global + non-capturing, for tag-stripping passes. */
const HIGHLIGHT_MARKER_G = />>>|<<<|<\/?b>/gi

function isOpenMarker(part: string): boolean {
  return part === '>>>' || /^<b>$/i.test(part)
}

function isCloseMarker(part: string): boolean {
  return part === '<<<' || /^<\/b>$/i.test(part)
}

/**
 * Split a snippet on its highlight markers (`>>>…<<<` or `<b>…</b>`) into
 * ordered segments, each flagged as a match or not. Markers are consumed (never
 * emitted as text); unmatched/stray markers are tolerated. HTML entities the
 * backend may emit (`&lt;`, `&gt;`, `&amp;`, `&quot;`, `&#39;`) are decoded so
 * the styled text reads naturally. Empty segments are dropped.
 */
export function parseHighlight(snippet: string): HighlightSegment[] {
  const segments: HighlightSegment[] = []
  // Tokenize on the markers; the regex keeps the captured delimiters so we can
  // toggle match state as we walk the pieces.
  const parts = snippet.split(HIGHLIGHT_MARKER)
  let inMatch = false
  for (const part of parts) {
    if (part === undefined) continue
    if (isOpenMarker(part)) {
      inMatch = true
      continue
    }
    if (isCloseMarker(part)) {
      inMatch = false
      continue
    }
    if (part === '') continue
    segments.push({ text: decodeEntities(part), match: inMatch })
  }
  return segments
}

/** The match terms (decoded) a snippet highlights — handy for tests/leads. */
export function highlightTerms(snippet: string): string[] {
  return parseHighlight(snippet)
    .filter((s) => s.match && s.text.trim() !== '')
    .map((s) => s.text.trim())
}

/**
 * Make a snippet read like a human line rather than a serialized payload.
 *
 * Search frequently matches inside a tool-call/result row whose content is raw
 * JSON, so the snippet arrives as e.g. `{"command":"git status","cwd":"/repo"}`.
 * When a fragment looks JSON-ish, strip the structural punctuation and quoted
 * keys down to the readable values, collapse whitespace, and cap the length.
 * Highlight markers (`>>>…<<<` or `<b>…</b>`) are PRESERVED (so the caller can
 * still style the match); plain prose is returned essentially untouched (just
 * whitespace-collapsed).
 */
export function humanizeSnippet(snippet: string, max = 140): string {
  let s = snippet
  if (looksJsonish(s)) {
    s = s
      // Drop `"key":` labels (the values are what's human-meaningful).
      .replace(/"[\w$-]+"\s*:/g, ' ')
      // Strip structural punctuation and quotes, keeping the highlight tags.
      .replace(/[{}[\]"]/g, ' ')
      .replace(/,/g, ' · ')
  }
  s = s.replace(/\s*·\s*(·\s*)+/g, ' · ') // collapse runs of separators
  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/^·\s*/, '').replace(/\s*·$/, '') // trim dangling separators
  return clampPreservingTags(s, max)
}

/** Heuristic: does this fragment look like serialized JSON rather than prose? */
function looksJsonish(s: string): boolean {
  // A quoted-key+colon pair, or a brace/bracket paired with a quote, is the
  // reliable tell. Bare braces in prose ("use {x}") shouldn't trip this.
  return /"[\w$-]+"\s*:/.test(s) || (/[{[]/.test(s) && /["}\]]/.test(s) && /:/.test(s))
}

/** Decode the small set of HTML entities the FTS layer may emit. */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * Length-cap a string without splitting a highlight marker pair (`>>>…<<<` or
 * `<b>…</b>`). We measure the VISIBLE text (markers excluded), and if we must
 * cut, we close any still-open marker — with the SAME marker form we opened —
 * so `parseHighlight` downstream never sees an unbalanced marker.
 */
function clampPreservingTags(s: string, max: number): string {
  // Fast path: short enough by visible length.
  if (visibleLength(s) <= max) return s
  let visible = 0
  let out = ''
  // The close marker matching the currently-open form, or null when closed.
  let openClose: string | null = null
  const parts = s.split(HIGHLIGHT_MARKER)
  for (const part of parts) {
    if (part === undefined) continue
    if (isOpenMarker(part)) {
      out += part
      openClose = part === '>>>' ? '<<<' : '</b>'
      continue
    }
    if (isCloseMarker(part)) {
      out += part
      openClose = null
      continue
    }
    for (const ch of part) {
      if (visible >= max - 1) {
        out += '…'
        if (openClose) out += openClose
        return out
      }
      out += ch
      visible += 1
    }
  }
  return out
}

/** Visible (marker-stripped) length of a snippet. */
function visibleLength(s: string): number {
  return s.replace(HIGHLIGHT_MARKER_G, '').length
}

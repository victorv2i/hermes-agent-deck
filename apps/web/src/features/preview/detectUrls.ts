/**
 * URL detection for terminal output (#116). The xterm web-links addon already
 * tokenizes `http(s)://…` runs into clickable regions and hands the matched URI
 * to our click handler — so the terminal path doesn't itself need to scan text.
 *
 * This helper exists for (a) the unit tests that pin the contract of "what counts
 * as a previewable URL in plain output", and (b) any non-xterm caller that needs
 * to find URLs in a blob of text (e.g. a future log line). It is deliberately
 * conservative: only absolute `http(s)://` URLs, and trailing sentence
 * punctuation / closing brackets are trimmed so `(see https://x.dev).` yields
 * `https://x.dev`, not `https://x.dev).`.
 */

/**
 * The match pattern: an explicit http/https scheme followed by at least one
 * non-space, non-control character. We keep it permissive on the body and trim
 * trailing noise afterwards rather than trying to encode every RFC nuance.
 */
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi

/** Punctuation that commonly trails a URL in prose/output and isn't part of it. */
const TRAILING = /[.,;:!?)\]}'"»]+$/

/**
 * Trim trailing sentence punctuation from a matched URL, but keep a closing
 * paren/bracket when it balances one INSIDE the URL (e.g. a Wikipedia
 * `..._(disambiguation)` path), so we don't corrupt URLs that legitimately end
 * in `)`.
 */
function trimTrailing(url: string): string {
  let out = url
  // Iteratively peel trailing punctuation. For a closing `)`/`]`/`}`, only peel
  // it when there's no matching opener earlier in the URL (otherwise it's part
  // of the path).
  for (;;) {
    const m = TRAILING.exec(out)
    if (!m) break
    const last = out[out.length - 1]!
    if (last === ')' || last === ']' || last === '}') {
      const open = last === ')' ? '(' : last === ']' ? '[' : '{'
      const opens = out.split(open).length - 1
      const closes = out.split(last).length - 1
      // Balanced (the closer pairs with an opener in the URL) → keep it, stop.
      if (closes <= opens) break
    }
    out = out.slice(0, -1)
  }
  return out
}

/**
 * Extract every previewable http(s) URL from `text`, in order, with trailing
 * prose punctuation trimmed. Returns `[]` when there are none.
 */
export function extractUrls(text: string): string[] {
  const out: string[] = []
  for (const match of text.matchAll(URL_RE)) {
    const trimmed = trimTrailing(match[0])
    if (trimmed !== '') out.push(trimmed)
  }
  return out
}

/** The first previewable URL in `text`, or `null`. */
export function firstUrl(text: string): string | null {
  return extractUrls(text)[0] ?? null
}
